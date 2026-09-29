'use client'

// ─────────────────────────────────────────────────────────────────
// Configuration client — edit the runtime config and PUT it to
// /api/admin/config. Two panels: model per stage, and LLM-use limits.
// A dirty banner + Save / Reset-to-defaults; greys out providers without a key.
// ─────────────────────────────────────────────────────────────────

import { useState } from 'react'

type StageProvider = 'off' | 'deepseek' | 'haiku' | 'openai'

interface StageConfig { provider: StageProvider; model: string | null }
interface RuntimeLimits {
  llmDailyCap: number; ratePerMin: number; ratePerDay: number; escalateMinWords: number
}
interface ExperimentConfig {
  enabled: boolean; splitPct: number
  b: { parse: StageConfig; generation: StageConfig }
}
interface RuntimeConfig {
  parse: StageConfig; generation: StageConfig; limits: RuntimeLimits
  experiment: ExperimentConfig | null
}

const EMPTY_EXPERIMENT: ExperimentConfig = {
  enabled: false, splitPct: 50,
  b: { parse: { provider: 'off', model: null }, generation: { provider: 'off', model: null } },
}

interface Available { deepseek: boolean; haiku: boolean; openai: boolean }

const PROVIDER_LABEL: Record<StageProvider, string> = {
  off: 'Off — engine only (no AI)',
  deepseek: 'DeepSeek',
  haiku: 'Claude Haiku',
  openai: 'OpenAI',
}
const MODEL_HINT: Record<StageProvider, string> = {
  off: '', deepseek: 'deepseek-v4-flash', haiku: 'claude-haiku-4-5', openai: 'gpt-5.4-nano',
}

const LIMIT_META: { key: keyof RuntimeLimits; label: string; help: string; min: number; max: number }[] = [
  { key: 'llmDailyCap', label: 'Daily LLM call cap', help: 'Global LLM calls/day. Over cap → silent deterministic degrade.', min: 0, max: 1000000 },
  { key: 'escalateMinWords', label: 'Complexity threshold (words)', help: 'A turn this long or longer escalates to the LLM. Lower = more turns use the LLM.', min: 1, max: 100 },
  { key: 'ratePerMin', label: 'Per-visitor rate / minute', help: 'Requests per IP per minute before a 429.', min: 1, max: 100000 },
  { key: 'ratePerDay', label: 'Per-visitor rate / day', help: 'Requests per IP per day.', min: 1, max: 10000000 },
]

function sameConfig(a: RuntimeConfig, b: RuntimeConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export default function ConfigClient({
  initialConfig, defaults, overridden, available,
}: {
  initialConfig: RuntimeConfig; defaults: RuntimeConfig; overridden: boolean; available: Available
}) {
  const [cfg, setCfg] = useState<RuntimeConfig>(initialConfig)
  const [saved, setSaved] = useState<RuntimeConfig>(initialConfig)
  const [isOverridden, setIsOverridden] = useState(overridden)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const dirty = !sameConfig(cfg, saved)

  const setStage = (stage: 'parse' | 'generation', patch: Partial<StageConfig>) =>
    setCfg(c => ({ ...c, [stage]: { ...c[stage], ...patch } }))
  const setLimit = (key: keyof RuntimeLimits, value: number) =>
    setCfg(c => ({ ...c, limits: { ...c.limits, [key]: value } }))

  const save = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cfg),
      })
      const d = await res.json()
      setCfg(d.config); setSaved(d.config); setIsOverridden(d.overridden)
      setFlash('Saved — live on the next discovery turn.')
    } catch {
      setFlash('Save failed.')
    } finally {
      setBusy(false)
      setTimeout(() => setFlash(null), 4000)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/config', { method: 'DELETE' })
      const d = await res.json()
      setCfg(d.config); setSaved(d.config); setIsOverridden(d.overridden)
      setFlash('Reverted to environment defaults.')
    } catch {
      setFlash('Reset failed.')
    } finally {
      setBusy(false)
      setTimeout(() => setFlash(null), 4000)
    }
  }

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-intently-ink">Configuration</h1>
          <p className="text-sm text-intently-slate mt-1 max-w-2xl">
            How discovery runs — the model per stage and the LLM-use limits. Saved changes take
            effect on the next turn, no redeploy. {isOverridden
              ? <span className="text-intently-ink">A runtime override is active.</span>
              : <span>Running on environment defaults.</span>}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={reset} disabled={busy || !isOverridden}
            className="px-3 py-2 text-sm rounded border border-intently-cloud text-intently-slate disabled:opacity-40">
            Reset to defaults
          </button>
          <button onClick={save} disabled={busy || !dirty}
            className="px-4 py-2 text-sm rounded bg-intently-ink text-white disabled:opacity-40">
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </header>

      {flash && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{flash}</div>}
      {dirty && <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">Unsaved changes.</div>}

      {/* Models per stage */}
      <section className="space-y-4">
        <h2 className="text-sm uppercase tracking-wide text-intently-pebble">Models</h2>
        <div className="grid md:grid-cols-2 gap-6">
          {(['parse', 'generation'] as const).map(stage => (
            <StagePanel
              key={stage}
              title={stage === 'parse' ? 'Comprehension (parse)' : 'Generation (re-voice)'}
              subtitle={stage === 'parse'
                ? 'Understands the shopper’s free text. Off = keyword parsing only.'
                : 'Rephrases the tailor’s answers naturally. Off = built-in templates.'}
              stage={cfg[stage]}
              envDefault={defaults[stage]}
              available={available}
              onChange={patch => setStage(stage, patch)}
            />
          ))}
        </div>
      </section>

      {/* Online A/B experiment */}
      <section className="space-y-4">
        <h2 className="text-sm uppercase tracking-wide text-intently-pebble">Experiment (online A/B)</h2>
        <div className="border border-intently-cloud rounded-lg p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-intently-ink">
              <input type="checkbox"
                checked={cfg.experiment?.enabled ?? false}
                onChange={e => setCfg(c => ({
                  ...c,
                  experiment: { ...(c.experiment ?? EMPTY_EXPERIMENT), enabled: e.target.checked },
                }))} />
              Run an experiment
            </label>
            {cfg.experiment && (
              <label className="flex items-center gap-2 text-sm text-intently-slate">
                Arm B gets
                <input type="number" min={0} max={100} value={cfg.experiment.splitPct}
                  onChange={e => setCfg(c => ({
                    ...c,
                    experiment: { ...(c.experiment ?? EMPTY_EXPERIMENT), splitPct: Number(e.target.value) },
                  }))}
                  className="w-16 border border-intently-cloud rounded px-2 py-1 text-sm font-mono" />
                % of sessions
              </label>
            )}
          </div>
          <p className="text-xs text-intently-slate">
            <strong className="text-intently-ink">Arm A</strong> is the base configuration above.
            <strong className="text-intently-ink"> Arm B</strong> (below) replaces the models for its share of
            sessions — assignment is sticky per shopper session, and every turn is tagged with its arm so
            <strong className="text-intently-ink"> Analytics</strong> compares them live (acceptance, grounding, cost, latency, cart adds).
          </p>
          {cfg.experiment && (
            <div className="grid md:grid-cols-2 gap-4">
              {(['parse', 'generation'] as const).map(stage => (
                <div key={stage} className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-intently-pebble">
                    Arm B — {stage === 'parse' ? 'comprehension' : 'generation'}
                  </div>
                  <select
                    value={cfg.experiment!.b[stage].provider}
                    onChange={e => setCfg(c => {
                      const exp = c.experiment ?? EMPTY_EXPERIMENT
                      return { ...c, experiment: { ...exp, b: { ...exp.b, [stage]: { provider: e.target.value as StageProvider, model: null } } } }
                    })}
                    className="w-full border border-intently-cloud rounded px-2 py-1.5 text-sm"
                  >
                    {(Object.keys(PROVIDER_LABEL) as StageProvider[]).map(p => (
                      <option key={p} value={p} disabled={p !== 'off' && !available[p]}>
                        {PROVIDER_LABEL[p]}{p !== 'off' && !available[p] ? ' — no key' : ''}
                      </option>
                    ))}
                  </select>
                  {cfg.experiment!.b[stage].provider !== 'off' && (
                    <input
                      value={cfg.experiment!.b[stage].model ?? ''}
                      onChange={e => setCfg(c => {
                        const exp = c.experiment ?? EMPTY_EXPERIMENT
                        return { ...c, experiment: { ...exp, b: { ...exp.b, [stage]: { ...exp.b[stage], model: e.target.value.trim() || null } } } }
                      })}
                      placeholder={`${MODEL_HINT[cfg.experiment!.b[stage].provider]} (provider default)`}
                      className="w-full border border-intently-cloud rounded px-2 py-1.5 text-sm font-mono"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* LLM-use limits */}
      <section className="space-y-4">
        <h2 className="text-sm uppercase tracking-wide text-intently-pebble">LLM-use limits</h2>
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
          {LIMIT_META.map(m => (
            <div key={m.key} className="border border-intently-cloud rounded-lg p-4">
              <label className="block text-sm font-medium text-intently-ink">{m.label}</label>
              <p className="text-xs text-intently-slate mt-0.5 mb-2">{m.help}</p>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={m.min} max={m.max} value={cfg.limits[m.key]}
                  onChange={e => setLimit(m.key, Number(e.target.value))}
                  className="w-40 border border-intently-cloud rounded px-2 py-1 text-sm font-mono"
                />
                {cfg.limits[m.key] !== defaults.limits[m.key] && (
                  <span className="text-xs text-intently-pebble">env default: {defaults.limits[m.key]}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function StagePanel({
  title, subtitle, stage, envDefault, available, onChange,
}: {
  title: string; subtitle: string; stage: StageConfig; envDefault: StageConfig
  available: Available; onChange: (patch: Partial<StageConfig>) => void
}) {
  return (
    <div className="border border-intently-cloud rounded-lg p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium text-intently-ink">{title}</h3>
        <p className="text-xs text-intently-slate mt-0.5">{subtitle}</p>
      </div>
      <select
        value={stage.provider}
        onChange={e => onChange({ provider: e.target.value as StageProvider, model: null })}
        className="w-full border border-intently-cloud rounded px-2 py-1.5 text-sm"
      >
        {(Object.keys(PROVIDER_LABEL) as StageProvider[]).map(p => (
          <option key={p} value={p} disabled={p !== 'off' && !available[p]}>
            {PROVIDER_LABEL[p]}{p !== 'off' && !available[p] ? ' — no key' : ''}
          </option>
        ))}
      </select>
      {stage.provider !== 'off' && (
        <div>
          <input
            value={stage.model ?? ''}
            onChange={e => onChange({ model: e.target.value.trim() || null })}
            placeholder={`${MODEL_HINT[stage.provider]} (provider default)`}
            className="w-full border border-intently-cloud rounded px-2 py-1.5 text-sm font-mono"
          />
          <p className="text-xs text-intently-pebble mt-1">Blank = the provider&apos;s default model.</p>
        </div>
      )}
      {stage.provider !== envDefault.provider && (
        <p className="text-xs text-intently-pebble">env default: {PROVIDER_LABEL[envDefault.provider]}</p>
      )}
    </div>
  )
}
