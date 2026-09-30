// ─────────────────────────────────────────────────────────────────
// Intently · /admin/enrichment/studio/config — Configuration
//
// The PM control surface for how discovery runs: which model answers each
// stage (parse / generation), and the LLM-use limits (daily call cap, per-IP
// rate, complexity threshold). Saved as a runtime override the live
// /api/discover reads per request — no redeploy. Env vars remain the
// deploy-time default; "Reset to defaults" reverts to them.
// ─────────────────────────────────────────────────────────────────

import ConfigClient from './ConfigClient'
import ResetPanel from '@/components/admin/ResetPanel'
import { isPublicDemo } from '@/lib/public-demo'
import { sharedStoreStatus } from '@/lib/discovery/guardrails-shared'
import {
  readRuntimeConfig, runtimeConfigDefaults, hasRuntimeOverride,
} from '@/lib/discovery/runtime-config'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Configuration — Intently admin' }

export default async function ConfigPage() {
  const publicDemo = isPublicDemo()
  // The rate limit and the daily LLM cap fail open when the shared store is
  // down, so say so here — it is otherwise invisible.
  const store = await sharedStoreStatus()
  return (
    <div className="space-y-10">
      {store !== 'ok' && (
        <div role="alert" className={`rounded-lg border p-4 text-sm ${store === 'unavailable' ? 'border-red-300 bg-red-50 text-red-900' : 'border-intently-cloud text-intently-slate'}`}>
          {store === 'unavailable' ? (
            <>
              <strong>Shared store unavailable.</strong> Redis is configured but not answering. The per-visitor rate limit
              and the daily LLM cap are running per server instance (they reset on a cold start and are not shared), and
              public-demo session changes cannot be saved. Check <code className="font-mono">UPSTASH_REDIS_REST_URL</code>.
            </>
          ) : (
            <>
              <strong>No shared store configured.</strong> The rate limit and the daily LLM cap are kept in memory —
              fine for local development, not for a deployment with more than one instance.
            </>
          )}
        </div>
      )}
      <ConfigClient
        initialConfig={await readRuntimeConfig()}
        defaults={runtimeConfigDefaults()}
        overridden={await hasRuntimeOverride()}
        available={{
          deepseek: !!process.env.DEEPSEEK_API_KEY,
          haiku: !!process.env.ANTHROPIC_API_KEY,
          openai: !!process.env.OPENAI_API_KEY,
        }}
        publicDemo={publicDemo}
      />
      {/* Demo lifecycle lives next to configuration: both are "how this
          instance is set up", as opposed to the pipeline stages. */}
      <ResetPanel publicDemo={publicDemo} />
    </div>
  )
}
