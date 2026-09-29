// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — File-backed vector store
//
// Stand-in for pgvector that needs zero infra. Loads everything into
// memory on first read; persists writes immediately to a single JSON
// file.
//
// Honest about scale: linear scan over all vectors at query time. Fine
// up to ~10k vectors (a few ms). Beyond that, switch to Supabase via
// ENRICHMENT_STORE=supabase — same interface, no caller changes.
//
// File location: `.enrichment/vectors.json` at the Next.js working
// directory (i.e. intently/). Gitignored.
// ─────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import type {
  SearchOpts,
  SearchResult,
  VectorRecord,
  VectorStore,
} from '@/types/enrichment'

import { cosine } from './vector-math'

interface OnDiskFormat {
  version: 1
  /** Convenience metadata — not enforced. */
  dimension?: number
  /** Convenience metadata — not enforced. */
  model?: string
  records: VectorRecord[]
}

const STORE_DIR = '.enrichment'
const STORE_FILE = 'vectors.json'

function resolveStorePath(): string {
  const base = process.env.ENRICHMENT_LOCAL_DIR
    ? path.resolve(process.env.ENRICHMENT_LOCAL_DIR)
    : path.resolve(process.cwd(), STORE_DIR)
  return path.join(base, STORE_FILE)
}

export class LocalJsonVectorStore implements VectorStore {
  private records: Map<string, VectorRecord> = new Map()
  private loaded = false
  private readonly storePath: string

  constructor(storePath?: string) {
    this.storePath = storePath ?? resolveStorePath()
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = await fs.readFile(this.storePath, 'utf-8')
      const parsed = JSON.parse(raw) as OnDiskFormat
      for (const r of parsed.records ?? []) {
        this.records.set(r.id, r)
      }
    } catch (err) {
      // First run — file doesn't exist yet. Anything else surfaces.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.storePath)
    await fs.mkdir(dir, { recursive: true })
    const first = this.records.values().next().value as VectorRecord | undefined
    const out: OnDiskFormat = {
      version: 1,
      dimension: first?.dimension,
      model: first?.model,
      records: Array.from(this.records.values()),
    }
    await fs.writeFile(this.storePath, JSON.stringify(out, null, 2), 'utf-8')
  }

  async upsert(record: VectorRecord): Promise<void> {
    await this.ensureLoaded()
    this.records.set(record.id, record)
    await this.persist()
  }

  async upsertMany(records: VectorRecord[]): Promise<void> {
    await this.ensureLoaded()
    for (const r of records) this.records.set(r.id, r)
    await this.persist()
  }

  async search(
    query: number[],
    k: number,
    opts?: SearchOpts,
  ): Promise<SearchResult[]> {
    await this.ensureLoaded()
    const scored: SearchResult[] = []
    for (const r of this.records.values()) {
      if (opts?.filter && !opts.filter(r)) continue
      const score = cosine(query, r.embedding)
      if (opts?.minScore !== undefined && score < opts.minScore) continue
      scored.push({
        id: r.id,
        score,
        metadata: r.metadata,
        ...(opts?.includeEmbedding ? { embedding: r.embedding } : {}),
      })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, k)
  }

  async get(id: string): Promise<VectorRecord | null> {
    await this.ensureLoaded()
    return this.records.get(id) ?? null
  }

  async list(): Promise<VectorRecord[]> {
    await this.ensureLoaded()
    return Array.from(this.records.values())
  }

  async delete(id: string): Promise<void> {
    await this.ensureLoaded()
    this.records.delete(id)
    await this.persist()
  }

  async count(): Promise<number> {
    await this.ensureLoaded()
    return this.records.size
  }

  async clear(): Promise<void> {
    await this.ensureLoaded()
    this.records.clear()
    await this.persist()
  }
}
