// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — Embedder
//
// Three impls:
//   XenovaEmbedder      — real model (all-MiniLM-L6-v2, 384-dim).
//                         Server-only. Lazy-loads ~30 MB of weights
//                         on first call, then caches in memory.
//                         Needs the onnxruntime native binary — does
//                         NOT run on Vercel serverless (see prodprep).
//   OpenAIEmbedder      — hosted API (text-embedding-3-small requested
//                         at dimensions:384 so it slots into the same
//                         vector(384) schema). No native dependency —
//                         runs anywhere, including Vercel. ~$0.02/1M tok.
//   DeterministicEmbedder
//                       — hash-based pseudo-embedding. No model load.
//                         Used in CI / unit tests / when xenova fails
//                         to install on a constrained machine.
//                         NOT for real similarity — collisions are
//                         arbitrary.
//
// Toggle via ENRICHMENT_EMBEDDER:
//   xenova        → XenovaEmbedder (default)
//   openai        → OpenAIEmbedder (needs OPENAI_API_KEY)
//   deterministic → DeterministicEmbedder
//
// CONSTRAINT: stored and query vectors must come from the same model.
// Vectors from different embedders are not comparable — switching
// embedders on a populated store means clear + full re-sync.
//
// Why a singleton: the xenova pipeline holds a heavy WASM/transformer
// graph in memory. Recreating per request would crater latency.
// ─────────────────────────────────────────────────────────────────

import type { Embedder } from '@/types/enrichment'

import { normalise } from './vector-math'

const XENOVA_MODEL = 'Xenova/all-MiniLM-L6-v2'
const XENOVA_DIM = 384

// ─── Deterministic fallback ──────────────────────────────────────
// Repeatable per (input, dim) — hash → indices → +1 mod dim. Gives
// us a usable shape for tests that just need *some* vector. Vectors
// are L2-normalised so cosine math behaves.

class DeterministicEmbedder implements Embedder {
  readonly modelId = 'deterministic-hash-v1'
  readonly dimension = XENOVA_DIM

  async embed(text: string): Promise<number[]> {
    const v = new Array<number>(this.dimension).fill(0)
    // Token-level hashing — good enough for "different inputs produce
    // different vectors" without claiming semantic meaning.
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    for (const tok of tokens) {
      let h = 2166136261 // FNV-1a 32-bit
      for (let i = 0; i < tok.length; i++) {
        h ^= tok.charCodeAt(i)
        h = Math.imul(h, 16777619)
      }
      const idx = Math.abs(h) % this.dimension
      v[idx] += 1
    }
    // L2-normalise so cosine returns values in [0, 1] for any input.
    let n = 0
    for (let i = 0; i < v.length; i++) n += v[i] * v[i]
    n = Math.sqrt(n)
    if (n === 0) return v
    for (let i = 0; i < v.length; i++) v[i] /= n
    return v
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)))
  }
}

// ─── Real Xenova-backed embedder ─────────────────────────────────

type FeatureExtractionPipeline = (
  text: string | string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{
  data: Float32Array | number[]
  dims: number[]
  tolist?: () => number[][]
}>

class XenovaEmbedder implements Embedder {
  readonly modelId = XENOVA_MODEL
  readonly dimension = XENOVA_DIM
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null

  private async getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      // Dynamic import keeps @xenova/transformers out of the client
      // bundle. Eager `require` would fight the Next 16 / webpack build.
      this.pipelinePromise = (async () => {
        const xenova = await import('@xenova/transformers')
        // Suppress browser-cache lookups in the Node/dev runtime. MUTATE the
        // existing env config object — do NOT reassign `xenova.env`, which is a
        // read-only ES-module export binding (reassigning throws "Cannot assign
        // to read only property 'env'" under Next 16 / Turbopack).
        const xenovaEnv = (xenova as { env?: { useBrowserCache?: boolean } }).env
        if (xenovaEnv) xenovaEnv.useBrowserCache = false
        const pipe = await xenova.pipeline('feature-extraction', XENOVA_MODEL)
        return pipe as unknown as FeatureExtractionPipeline
      })()
    }
    return this.pipelinePromise
  }

  async embed(text: string): Promise<number[]> {
    const pipe = await this.getPipeline()
    const out = await pipe(text, { pooling: 'mean', normalize: true })
    // out.data is Float32Array of length 384 for a single input.
    const arr = Array.from(out.data)
    if (arr.length !== this.dimension) {
      throw new Error(
        `XenovaEmbedder: expected ${this.dimension} dims, got ${arr.length}`,
      )
    }
    return arr
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const pipe = await this.getPipeline()
    const out = await pipe(texts, { pooling: 'mean', normalize: true })
    // Batch output is shape [n, 384] flattened in `data`.
    const dim = this.dimension
    const data = Array.from(out.data)
    if (data.length !== texts.length * dim) {
      throw new Error(
        `XenovaEmbedder: batch shape mismatch — ${data.length} vs ${texts.length}*${dim}`,
      )
    }
    const result: number[][] = []
    for (let i = 0; i < texts.length; i++) {
      result.push(data.slice(i * dim, (i + 1) * dim))
    }
    return result
  }
}

// ─── OpenAI-hosted embedder ──────────────────────────────────────
// text-embedding-3-small supports truncating output to any smaller
// size via the `dimensions` request param (Matryoshka representation
// learning). Requesting exactly 384 matches the existing
// product_vectors vector(384) column and enrichment_search RPC — no
// migration needed. The API returns unit vectors, but we re-normalise
// anyway (idempotent) so this impl never depends on that guarantee.

const OPENAI_DEFAULT_MODEL = 'text-embedding-3-small'
const OPENAI_DIM = 384
// Inputs per request. Well under OpenAI's 2048-input ceiling; keeps a
// full 292-product catalogue sync at 3 round-trips instead of 292.
const OPENAI_BATCH = 128

interface OpenAIEmbeddingResponse {
  data: { index: number; embedding: number[] }[]
}

class OpenAIEmbedder implements Embedder {
  readonly modelId: string
  readonly dimension = OPENAI_DIM
  private readonly model: string

  constructor() {
    this.model = process.env.ENRICHMENT_OPENAI_MODEL ?? OPENAI_DEFAULT_MODEL
    // Record the truncation in the stored model id so a mismatch with a
    // differently-dimensioned run of the same model is visible in data.
    this.modelId = `${this.model}@${OPENAI_DIM}`
  }

  async embed(text: string): Promise<number[]> {
    const [v] = await this.embedMany([text])
    return v
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const key = process.env.OPENAI_API_KEY
    if (!key) {
      throw new Error(
        'OpenAIEmbedder: OPENAI_API_KEY is not set (ENRICHMENT_EMBEDDER=openai requires it)',
      )
    }
    const out: number[][] = []
    for (let i = 0; i < texts.length; i += OPENAI_BATCH) {
      const chunk = texts.slice(i, i + OPENAI_BATCH)
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: chunk,
          dimensions: OPENAI_DIM,
        }),
      })
      if (!res.ok) {
        // Status only — upstream error bodies can echo the input
        // (see prodprep.md, "Upstream error body in thrown Error").
        throw new Error(`OpenAIEmbedder: HTTP ${res.status} from embeddings API`)
      }
      const json = (await res.json()) as OpenAIEmbeddingResponse
      if (!Array.isArray(json.data) || json.data.length !== chunk.length) {
        throw new Error(
          `OpenAIEmbedder: expected ${chunk.length} embeddings, got ${json.data?.length ?? 0}`,
        )
      }
      // The API documents order-by-index; sort defensively.
      const sorted = [...json.data].sort((a, b) => a.index - b.index)
      for (const item of sorted) {
        if (item.embedding.length !== this.dimension) {
          throw new Error(
            `OpenAIEmbedder: expected ${this.dimension} dims, got ${item.embedding.length}`,
          )
        }
        out.push(normalise(item.embedding))
      }
    }
    return out
  }
}

// ─── Factory ──────────────────────────────────────────────────────

let cached: Embedder | null = null

export function getEmbedder(): Embedder {
  if (cached) return cached
  const mode = (process.env.ENRICHMENT_EMBEDDER ?? 'xenova').toLowerCase()
  if (mode === 'deterministic') {
    cached = new DeterministicEmbedder()
    return cached
  }
  if (mode === 'openai') {
    cached = new OpenAIEmbedder()
    return cached
  }
  cached = new XenovaEmbedder()
  return cached
}

/** Test helper — never call from app code. */
export function __resetEmbedderForTests(): void {
  cached = null
}

// Internal exports for unit tests.
export { DeterministicEmbedder, OpenAIEmbedder, XenovaEmbedder }
