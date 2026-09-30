// ─────────────────────────────────────────────
// discovery/runtime-config.ts  ·  SERVER ONLY
//
// The PM-editable "how the solution runs" layer — a runtime override over the
// env defaults, mirroring situation-overrides / product-overrides:
// `.enrichment/runtime-config.json` is gitignored, read on every request with
// a try/catch fallback, and stores ONLY the fields a PM has changed. When the
// file is absent (CI, fresh clone), the merged config is byte-identical to the
// env-configured behaviour — nothing changes until a PM saves something.
//
// Covers the two levers the Studio config surface exposes:
//   · which model answers each stage (parse / generation provider + model id)
//   · the LLM-use limits (daily call cap, per-IP rate, complexity threshold)
//
// Read by the route (per request, so a saved change takes effect without a
// redeploy) — never by the client. Backed by the doc-store seam: local JSON in
// dev/CI, Supabase runtime_kv on cloud (where the FS is read-only), so PM edits
// persist across serverless invocations. The env vars remain the deploy-time
// default the override layers on top of.
// ─────────────────────────────────────────────

import { join } from 'node:path'

import { parserProvider } from './parse-llm'
import { generationProvider } from './generate-llm'
import type { Provider } from './llm-client'
import { readDoc, readBaseDoc, writeDoc, deleteDoc, docExists } from '@/lib/store/doc-store'
import { isPublicDemo } from '@/lib/public-demo'

// Local file path (used only by tests to clean up); the store honors the same
// INTENTLY_RUNTIME_CONFIG_PATH override.
export function runtimeConfigPath(): string {
  return process.env.INTENTLY_RUNTIME_CONFIG_PATH
    || join(process.cwd(), '.enrichment/runtime-config.json')
}

// 'off' is the explicit "no LLM for this stage" choice (maps to a null provider).
export type StageProvider = Provider | 'off'

export interface StageConfig {
  provider: StageProvider
  model: string | null // null = the provider's env-default model
}

export interface RuntimeLimits {
  llmDailyCap: number   // global LLM calls/day before silent deterministic degrade
  ratePerMin: number    // per-IP requests/minute (429 above)
  ratePerDay: number    // per-IP requests/day
  escalateMinWords: number // complexity gate: word count that counts a turn "long"
}

// Online A/B (feature brainstorm #5): arm A is the base config below; arm B
// overrides the stage providers/models for `splitPct`% of sessions. Sticky
// per session (hash of the session id), recorded on every turn event so
// analytics can compare the arms live.
export interface ExperimentConfig {
  enabled: boolean
  splitPct: number          // 0..100 — share of sessions on arm B
  b: { parse: StageConfig; generation: StageConfig }
}

export interface RuntimeConfig {
  parse: StageConfig
  generation: StageConfig
  limits: RuntimeLimits
  experiment: ExperimentConfig | null
}

/** Deterministic, sticky arm assignment: FNV-1a over the session id → 0..99.
 *  'A' = base config; 'B' = experiment arm. No session id → always 'A'. */
export function armFor(sessionId: string | undefined, exp: ExperimentConfig | null): 'A' | 'B' {
  if (!exp?.enabled || !sessionId) return 'A'
  let h = 0x811c9dc5
  for (let i = 0; i < sessionId.length; i++) {
    h ^= sessionId.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 100 < exp.splitPct ? 'B' : 'A'
}

// The env-derived baseline (the deploy-time source of truth). Reused so the
// config surface and the live path never disagree about "what's the default".
function envDefaults(): RuntimeConfig {
  return {
    parse: { provider: parserProvider() ?? 'off', model: null },
    generation: { provider: generationProvider() ?? 'off', model: null },
    limits: {
      llmDailyCap: Number(process.env.DISCOVERY_LLM_DAILY_CAP || 2000),
      ratePerMin: Number(process.env.DISCOVERY_RATE_PER_MIN || 20),
      ratePerDay: Number(process.env.DISCOVERY_RATE_PER_DAY || 400),
      escalateMinWords: Number(process.env.DISCOVERY_ESCALATE_MINWORDS || 8),
    },
    experiment: null, // experiments are Studio-configured, never env-seeded
  }
}

const PROVIDERS = new Set<StageProvider>(['deepseek', 'haiku', 'openai', 'off'])

// Validate + clamp a saved partial onto the env baseline. Anything malformed in
// the file is ignored field-by-field — a bad edit can never break the live path.
function coerce(base: RuntimeConfig, raw: unknown): RuntimeConfig {
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  const stage = (key: 'parse' | 'generation'): StageConfig => {
    const s = r[key]
    if (!s || typeof s !== 'object') return base[key]
    const o = s as Record<string, unknown>
    const provider = PROVIDERS.has(o.provider as StageProvider) ? (o.provider as StageProvider) : base[key].provider
    const model = typeof o.model === 'string' && o.model.trim() ? o.model.trim() : null
    return { provider, model }
  }
  const lim = (r.limits ?? {}) as Record<string, unknown>
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback
  }
  return {
    parse: stage('parse'),
    generation: stage('generation'),
    limits: {
      llmDailyCap: num(lim.llmDailyCap, base.limits.llmDailyCap, 0, 1_000_000),
      ratePerMin: num(lim.ratePerMin, base.limits.ratePerMin, 1, 100_000),
      ratePerDay: num(lim.ratePerDay, base.limits.ratePerDay, 1, 10_000_000),
      escalateMinWords: num(lim.escalateMinWords, base.limits.escalateMinWords, 1, 100),
    },
    experiment: coerceExperiment(r.experiment),
  }
}

function coerceExperiment(raw: unknown): ExperimentConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const b = (e.b ?? {}) as Record<string, unknown>
  const stage = (s: unknown): StageConfig => {
    const o = (s ?? {}) as Record<string, unknown>
    const provider = PROVIDERS.has(o.provider as StageProvider) ? (o.provider as StageProvider) : 'off'
    const model = typeof o.model === 'string' && o.model.trim() ? o.model.trim() : null
    return { provider, model }
  }
  const split = Number(e.splitPct)
  return {
    enabled: e.enabled === true,
    splitPct: Number.isFinite(split) ? Math.min(100, Math.max(0, Math.round(split))) : 50,
    b: { parse: stage(b.parse), generation: stage(b.generation) },
  }
}

// PUBLIC DEMO: a visitor's config lives in their sandbox and must never be
// able to raise spend. So the cost caps (daily LLM cap, per-IP rates) always
// come from the SHARED config, never the visitor's copy, and a stage may only
// use its provider's deploy-time default model — no arbitrary model ids.
// Provider choice, the experiment split and the escalation threshold stay
// theirs to play with; the global daily cap bounds all of it.
function clampForPublicDemo(cfg: RuntimeConfig, shared: RuntimeConfig): RuntimeConfig {
  const defaultModel = (s: StageConfig): StageConfig => ({ provider: s.provider, model: null })
  return {
    parse: defaultModel(cfg.parse),
    generation: defaultModel(cfg.generation),
    limits: {
      llmDailyCap: shared.limits.llmDailyCap,
      ratePerMin: shared.limits.ratePerMin,
      ratePerDay: shared.limits.ratePerDay,
      escalateMinWords: cfg.limits.escalateMinWords,
    },
    experiment: cfg.experiment && {
      ...cfg.experiment,
      b: { parse: defaultModel(cfg.experiment.b.parse), generation: defaultModel(cfg.experiment.b.generation) },
    },
  }
}

/** The effective config: env defaults ⊕ the saved override. Always complete. */
export async function readRuntimeConfig(): Promise<RuntimeConfig> {
  const cfg = coerce(envDefaults(), await readDoc('runtime-config'))
  if (!isPublicDemo()) return cfg
  return clampForPublicDemo(cfg, coerce(envDefaults(), await readBaseDoc('runtime-config')))
}

/** The env baseline alone — for the "reset to defaults" affordance + diffing. */
export function runtimeConfigDefaults(): RuntimeConfig {
  return envDefaults()
}

/** True when a saved override exists (the config differs from env). */
export async function hasRuntimeOverride(): Promise<boolean> {
  return docExists('runtime-config')
}

/** Persist a full config. Writing the env-equal config still creates the
 *  override (an explicit "pinned" choice); use clearRuntimeConfig to revert. */
export async function writeRuntimeConfig(cfg: RuntimeConfig): Promise<RuntimeConfig> {
  let merged = coerce(envDefaults(), cfg)
  if (isPublicDemo()) {
    merged = clampForPublicDemo(merged, coerce(envDefaults(), await readBaseDoc('runtime-config')))
  }
  await writeDoc('runtime-config', merged)
  return merged
}

/** Revert to env defaults by removing the override — so hasRuntimeOverride
 *  reads false again and the live path tracks env. */
export async function clearRuntimeConfig(): Promise<void> {
  await deleteDoc('runtime-config')
}

/** null when the stage is 'off' — the shape the route/selectors expect. */
export function stageProvider(s: StageConfig): Provider | null {
  return s.provider === 'off' ? null : s.provider
}
