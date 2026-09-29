// ─────────────────────────────────────────────────────────────────
// Intently · /admin/analytics — the analytics surface
//
// Three lenses over the local event stream (analytics-plan.md):
//   Commerce     — the funnel, cart adds + where they happened, demand
//   Conversation — Intently-specific: escalation, consultation, grounding
//   Budget       — LLM spend, unit costs, rolling burn + forward projection
//
// Server aggregates once per load (aggregate.ts); the client renders and
// explains — every metric card documents WHAT it is, HOW it's computed and
// WHY it matters. Range via the shared RangePicker (?range=).
// ─────────────────────────────────────────────────────────────────

import { aggregate } from '@/lib/analytics/aggregate'
import { parseRange, sinceFor } from '@/components/admin/RangePicker'
import AnalyticsClient from './AnalyticsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Analytics — Intently admin' }

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; tab?: string }> }) {
  const sp = await searchParams
  const range = parseRange(sp.range)
  const tab = sp.tab === 'conversation' || sp.tab === 'budget' ? sp.tab : 'commerce'
  const agg = await aggregate(sinceFor(range))
  return <AnalyticsClient agg={agg} range={range} initialTab={tab} />
}
