// ─────────────────────────────────────────────
// discovery/infer-catalog.ts
//
// Fashion vs outdoor is INFERRED from the situation, never chosen by hand — the
// shopper types "a wedding outfit" or "track pants for the gym" and the engine
// routes. Order matters: an activity already in context locks the catalog (so a
// turn-2 "it'll be cold" stays outdoor); then explicit garment/occasion words
// win for fashion (so "outdoor WEDDING" isn't misrouted by the word "outdoor");
// then genuine outdoor-activity signals. Default fashion.
//
// Server + client safe (pure) — used by the live hook (useDiscover) and the
// admin probe so the bench routes identically to production.
// ─────────────────────────────────────────────

import type { Catalog, SessionContext } from '@/types'

export function inferCatalog(query: string, ctx: SessionContext): Catalog {
  if (ctx.activity) return 'outdoor'
  const t = query.toLowerCase()
  if (/\b(dress|wedding|gown|cocktail|gala|outfit|heels|party|bridal|guest)\b/.test(t)) return 'fashion'
  if (/\b(hik|trek|trail|camp|daypack|hiking|mountaineer|base ?layer)\b/.test(t)) return 'outdoor'
  return 'fashion'
}
