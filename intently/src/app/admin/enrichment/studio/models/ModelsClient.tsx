'use client'

// ─────────────────────────────────────────────────────────────────
// Model bench client — side-by-side model probes over /api/discover/probe.
// Column A vs column B: same query, different provider/model. Each run shows
// the complexity-gate verdict, the Tier-1 parse (patch + latency), the
// deterministic engine outcome, and the re-voiced prose with grounding.
// ─────────────────────────────────────────────────────────────────

import { useState } from 'react'

type ProviderKey = 'deterministic' | 'deepseek' | 'haiku' | 'openai'

interface ProbeResponse {
  escalate: boolean
  parse: { ok: boolean; ms: number; patch: unknown; budget: boolean } | null
  engine: { ms: number; message: string; question: string | null; results: { id: string; name: string }[] }
  generate: { ok: boolean; ms: number; budget: boolean; message: string | null; prompt: string | null; grounded: boolean | null } | null
}

interface ColumnConfig {
  provider: ProviderKey
  model: string
}

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  deterministic: 'Engine only (no AI)',
  deepseek: 'DeepSeek',
  haiku: 'Claude Haiku',
  openai: 'OpenAI',
}

// Suggested model ids per provider (free-text field — any id can be typed).
const MODEL_HINTS: Record<ProviderKey, string> = {
  deterministic: '',
  deepseek: 'deepseek-v4-flash',
  haiku: 'claude-haiku-4-5',
  openai: 'gpt-5.4-nano',
}

const SAMPLE_QUERIES = [
  'blue casual shirt for a summer evening',
  "dress for a friend's wedding in July, outdoors, smart casual",
  'I hate florals — something elegant for a dinner',
  'sturdy track pants for the gym',
]

export default function ModelsClient({
  available,
  activeDefaults,
}: {
  available: { deepseek: boolean; haiku: boolean; openai: boolean }
  activeDefaults: { parser: string; generation: string }
}) {
  const [query, setQuery] = useState(SAMPLE_QUERIES[0])
  const [cols, setCols] = useState<ColumnConfig[]>([
    { provider: available.openai ? 'openai' : 'deterministic', model: '' },
    { provider: available.deepseek ? 'deepseek' : 'deterministic', model: '' },
  ])
  const [results, setResults] = useState<(ProbeResponse | { error: string } | null)[]>([null, null])
  const [running, setRunning] = useState(false)

  const setCol = (i: number, patch: Partial<ColumnConfig>) =>
    setCols(cs => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const run = async () => {
    if (!query.trim() || running) return
    setRunning(true)
    setResults([null, null])
    const probes = cols.map(async (c): Promise<ProbeResponse | { error: string }> => {
      try {
        const res = await fetch('/api/discover/probe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            query,
            provider: c.provider === 'deterministic' ? null : c.provider,
            model: c.model.trim() || undefined,
          }),
        })
        if (!res.ok) return { error: `probe failed: ${res.status}` }
        return await res.json()
      } catch {
        return { error: 'probe unreachable' }
      }
    })
    setResults(await Promise.all(probes))
    setRunning(false)
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-serif text-2xl text-intently-ink">Model bench</h1>
        <p className="text-sm text-intently-slate mt-1 max-w-2xl">
          Same query, two configurations, side by side. The shopper path keeps the env default
          (parser: <code className="text-xs">{activeDefaults.parser}</code>, generation:{' '}
          <code className="text-xs">{activeDefaults.generation}</code>) — the bench probes explicit overrides.
        </p>
      </header>

      {/* Query + catalog */}
      <section className="space-y-2">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="a shopper situation…"
            className="flex-1 border border-intently-cloud rounded px-3 py-2 text-sm"
          />
          <button
            onClick={run}
            disabled={running || !query.trim()}
            className="px-4 py-2 text-sm rounded bg-intently-ink text-white disabled:opacity-40"
          >
            {running ? 'Running…' : 'Run probe'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_QUERIES.map(q => (
            <button key={q} onClick={() => setQuery(q)}
              className="text-xs px-2 py-1 rounded border border-intently-cloud text-intently-slate hover:text-intently-ink">
              {q}
            </button>
          ))}
        </div>
      </section>

      {/* Two configurable columns */}
      <section className="grid md:grid-cols-2 gap-6">
        {cols.map((c, i) => (
          <div key={i} className="border border-intently-cloud rounded-lg p-4 space-y-4">
            <div className="flex gap-2 items-center">
              <span className="text-xs uppercase tracking-wide text-intently-pebble">{i === 0 ? 'A' : 'B'}</span>
              <select
                value={c.provider}
                onChange={e => setCol(i, { provider: e.target.value as ProviderKey, model: '' })}
                className="border border-intently-cloud rounded px-2 py-1 text-sm"
              >
                {(Object.keys(PROVIDER_LABELS) as ProviderKey[]).map(p => (
                  <option key={p} value={p} disabled={p !== 'deterministic' && !available[p]}>
                    {PROVIDER_LABELS[p]}{p !== 'deterministic' && !available[p] ? ' — no key' : ''}
                  </option>
                ))}
              </select>
              {c.provider !== 'deterministic' && (
                <input
                  value={c.model}
                  onChange={e => setCol(i, { model: e.target.value })}
                  placeholder={MODEL_HINTS[c.provider]}
                  className="flex-1 border border-intently-cloud rounded px-2 py-1 text-sm font-mono"
                />
              )}
            </div>
            <ProbeResult r={results[i]} />
          </div>
        ))}
      </section>
    </div>
  )
}

function Verdict({ ok, yes, no }: { ok: boolean | null; yes: string; no: string }) {
  if (ok === null) return <span className="text-intently-pebble">—</span>
  return ok
    ? <span className="text-green-700">✓ {yes}</span>
    : <span className="text-red-700">✕ {no}</span>
}

function ProbeResult({ r }: { r: ProbeResponse | { error: string } | null }) {
  if (!r) return <p className="text-sm text-intently-pebble italic">No run yet.</p>
  if ('error' in r) return <p className="text-sm text-red-700">{r.error}</p>

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-intently-slate">
        <span>complexity: {r.escalate ? 'needs AI' : 'simple — engine only'}</span>
        <span>engine {r.engine.ms}ms</span>
        {r.parse && <span>parse {r.parse.ms}ms</span>}
        {r.generate && <span>generate {r.generate.ms}ms</span>}
      </div>

      {r.parse && (
        <div>
          <div className="text-xs uppercase tracking-wide text-intently-pebble mb-1">
            AI comprehension <Verdict ok={r.parse.budget ? r.parse.ok : null} yes="understood the brief" no="fell back to keyword parsing" />
            {!r.parse.budget && <span className="text-red-700 ml-2">daily LLM budget exhausted</span>}
          </div>
          {r.parse.patch != null && (
            <pre className="text-xs bg-intently-cloud/30 rounded p-2 overflow-x-auto">
              {JSON.stringify(r.parse.patch, null, 1)}
            </pre>
          )}
        </div>
      )}

      <div>
        <div className="text-xs uppercase tracking-wide text-intently-pebble mb-1">Engine answer — the ground truth</div>
        <p className="text-intently-ink">{r.engine.message}</p>
        {r.engine.question && <p className="text-intently-slate mt-1">Q: {r.engine.question}</p>}
        {r.engine.results.length > 0 && (
          <ul className="mt-1 text-xs text-intently-slate list-disc list-inside">
            {r.engine.results.slice(0, 6).map(p => <li key={p.id}>{p.name}</li>)}
          </ul>
        )}
      </div>

      {r.generate && (
        <div>
          <div className="text-xs uppercase tracking-wide text-intently-pebble mb-1">
            Re-voiced <Verdict ok={r.generate.budget ? r.generate.ok : null} yes="faithful + grounded" no="rejected — template kept" />
            {r.generate.grounded === false && <span className="text-red-700 ml-2">grounding failed</span>}
            {!r.generate.budget && <span className="text-red-700 ml-2">daily LLM budget exhausted</span>}
          </div>
          {r.generate.message && <p className="text-intently-ink">{r.generate.message}</p>}
          {r.generate.prompt && <p className="text-intently-slate mt-1">Q: {r.generate.prompt}</p>}
        </div>
      )}
    </div>
  )
}
