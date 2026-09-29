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
import {
  readRuntimeConfig, runtimeConfigDefaults, hasRuntimeOverride,
} from '@/lib/discovery/runtime-config'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Configuration — Intently admin' }

export default async function ConfigPage() {
  return (
    <div className="space-y-10">
      <ConfigClient
        initialConfig={await readRuntimeConfig()}
        defaults={runtimeConfigDefaults()}
        overridden={await hasRuntimeOverride()}
        available={{
          deepseek: !!process.env.DEEPSEEK_API_KEY,
          haiku: !!process.env.ANTHROPIC_API_KEY,
          openai: !!process.env.OPENAI_API_KEY,
        }}
      />
      {/* Demo lifecycle lives next to configuration: both are "how this
          instance is set up", as opposed to the pipeline stages. */}
      <ResetPanel />
    </div>
  )
}
