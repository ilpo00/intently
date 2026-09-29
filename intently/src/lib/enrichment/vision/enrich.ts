// ─────────────────────────────────────────────────────────────────
// Vision enrichment core — Tier-1 worker + Tier-0 validator.
//
// The SINGLE implementation of "read a product photo → validated attributes".
// Extracted from the old scripts/vision-enrich.mjs (retired 2026-07-18) so
// that local and cloud runs cannot diverge: the chunked API route
// (/api/admin/vision-enrich) is now the only caller, and it runs in-process
// rather than spawning a child — which is what lets this work on serverless.
//
// Tier 0 (validate) is the contract enforcer: the model proposes, code
// enforces the discovery vocabulary. Nothing here runs in the discovery hot
// path — enrichment is an offline, cached step.
// ─────────────────────────────────────────────────────────────────

import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import type { VisionAttrs, VisionRecord, VisionInput } from '@/types/vision'

export const VISION_MODEL_DEFAULT = 'claude-haiku-4-5-20251001'

/** Assumed Haiku 4.5 list pricing. Tokens are the hard number; this is an
 *  estimate and is labelled as such wherever it surfaces. */
export const RATE = { in: 1.0 / 1e6, out: 5.0 / 1e6 }
export const RATE_NOTE = 'assumed Haiku 4.5 $1/MTok in, $5/MTok out'

/** Anthropic low-tier org limits (50 req/min, 10k output tok/min) — one call
 *  per 2.6s ≈ 23/min. The chunk loop honours this between products. */
export const THROTTLE_MS = 2600

const ARCHETYPES = ['classic', 'minimalist', 'romantic', 'bohemian', 'sporty', 'edgy', 'preppy', 'relaxed', 'elegant']
const SEASONS = ['spring', 'summer', 'autumn', 'winter']
const PATTERNS = ['solid', 'stripe', 'floral', 'check', 'print', 'graphic', 'colourblock', 'camo', 'other']

/** Prompt v2 — full-range formality rubric, controlled vocab enforced
 *  in-prompt, SPECIFIC situational occasions, and discoveryQueries (the field
 *  that feeds the discovery layer). v1 is retired with the script. */
export const PROMPT = `You are cataloguing a fashion product from its photo for a SITUATIONAL discovery engine —
shoppers search with situations like "a warm layer for a cold evening hike" or "a relaxed summer
city outfit", not keywords. Look ONLY at the image. Ground every claim in what is visible; if
unsure, lower confidence rather than guess. Return STRICT JSON only — no prose, no fences.

{
  "garmentType": string,
  "primaryColour": string,            // specific: "rust", "dark navy", "sage", not just "blue"
  "colours": string[],
  "pattern": "solid|stripe|floral|check|print|graphic|colourblock|camo|other",
  "materials": string[],              // visible material guesses
  "silhouette": string,               // garment-appropriate: "boxy", "a-line", "tapered", "longline", "fitted"
  "formality": number,                // USE THE FULL RANGE — 1 sportswear/loungewear, 2 everyday casual,
                                      // 3 smart casual/office, 4 formal/cocktail, 5 black tie
  "seasons": string[],                // subset of: spring, summer, autumn, winter
  "occasions": string[],              // SPECIFIC situations, NOT "everyday/casual": e.g.
                                      // "cold-weather layering", "beach holiday", "office", "summer wedding guest", "trail hiking"
  "styleArchetypes": string[],        // 1-3 MOST distinctive, ONLY from: classic, minimalist, romantic,
                                      // bohemian, sporty, edgy, preppy, relaxed, elegant. Never output "casual" (use "relaxed").
  "discoveryQueries": string[],       // 2-3 natural shopper situations this product should surface for
  "description": string,              // ONE merchandising sentence grounded in the image
  "confidence": number                // 0..1
}
Return only the JSON object.`

function clamp(n: unknown, lo: number, hi: number, dflt: number): number {
  const x = Number(n)
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt
}

function strArr(v: unknown): string[] {
  return Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === 'string').map(s => s.trim().toLowerCase()).filter(Boolean))]
    : []
}

function intersect(v: unknown, allowed: string[]): string[] {
  return strArr(v).filter(x => allowed.includes(x))
}

/** Tier-0 validator: model proposes, code enforces the discovery contract.
 *  Every correction is recorded as a flag so the Studio can show what the
 *  model got wrong rather than hiding it. */
export function validate(raw: Record<string, unknown>): { out: VisionAttrs; flags: string[] } {
  const flags: string[] = []
  const out: VisionAttrs = {
    garmentType: String(raw.garmentType ?? '').trim() || 'unknown',
    primaryColour: String(raw.primaryColour ?? '').trim().toLowerCase() || 'unknown',
    colours: strArr(raw.colours),
    pattern: (() => {
      const p = String(raw.pattern ?? 'solid').trim().toLowerCase()
      if (!PATTERNS.includes(p)) { flags.push(`pattern "${p}" → other`); return 'other' }
      return p
    })(),
    materials: strArr(raw.materials),
    silhouette: String(raw.silhouette ?? '').trim().toLowerCase() || 'unspecified',
    formality: (() => {
      const f = clamp(Math.round(Number(raw.formality)), 1, 5, 2)
      if (f !== Number(raw.formality)) flags.push(`formality ${raw.formality} → ${f}`)
      return f
    })(),
    seasons: (() => {
      const s = intersect(raw.seasons, SEASONS)
      if (s.length !== strArr(raw.seasons).length) flags.push('dropped non-vocab seasons')
      return s
    })(),
    occasions: strArr(raw.occasions),
    styleArchetypes: (() => {
      const s = intersect(raw.styleArchetypes, ARCHETYPES)
      const dropped = strArr(raw.styleArchetypes).filter(x => !ARCHETYPES.includes(x))
      if (dropped.length) flags.push(`dropped styles: ${dropped.join(', ')}`)
      return s
    })(),
    discoveryQueries: Array.isArray(raw.discoveryQueries)
      ? raw.discoveryQueries.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean).slice(0, 3)
      : [],
    description: String(raw.description ?? '').trim(),
    confidence: clamp(raw.confidence, 0, 1, 0.5),
  }
  return { out, flags }
}

/** Models sometimes wrap JSON in prose or fences despite the instruction. */
export function parseJson(text: string): Record<string, unknown> {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const first = t.indexOf('{'); const last = t.lastIndexOf('}')
  if (first >= 0 && last > first) t = t.slice(first, last + 1)
  return JSON.parse(t) as Record<string, unknown>
}

/** Product photos ship in the repo under public/. On serverless they are only
 *  on the function's filesystem because next.config declares them in
 *  outputFileTracingIncludes — a dynamic path like this is otherwise not
 *  traced, and the read would ENOENT in production only. */
async function imageBase64(image: string): Promise<string> {
  const path = join(process.cwd(), 'public', image.replace(/^\//, ''))
  return (await readFile(path)).toString('base64')
}

export function visionClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 6 })
}

/** One product: photo → model → Tier-0 validated attributes. Throws; the
 *  caller decides whether a failure aborts the run or is recorded per-product. */
export async function analyzeOne(
  client: Anthropic,
  product: VisionInput,
  model = process.env.VISION_MODEL || VISION_MODEL_DEFAULT,
): Promise<VisionRecord> {
  const b64 = await imageBase64(product.image)
  const started = Date.now()
  const msg = await client.messages.create({
    model,
    max_tokens: 420,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: b64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  })
  const text = msg.content.filter(c => c.type === 'text').map(c => c.text).join('')
  const { out, flags } = validate(parseJson(text))
  return {
    id: product.id,
    image: product.image,
    ...(product.pim ? { pim: product.pim } : {}),
    vision: out,
    flags,
    usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens },
    model,
    ms: Date.now() - started,
  }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
