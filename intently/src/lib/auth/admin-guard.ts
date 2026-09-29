// ─────────────────────────────────────────────────────────────────
// Intently · Admin route guard — local-mode stub
//
// The reconciled Phase-1 build runs without the auth/account stack
// (the MISE-era auth/account layer was removed in the pivot; it lives in
// git history if ever revived). The enrichment admin inspector is the one
// admin surface kept live, so it needs `requireAdmin` / `assertAdminApi`
// to resolve — but in local-only mode there is no auth to enforce.
//
// This permissive stub allows every request (matching the old guard's
// local-mode short-circuit, which also bypassed the check). When a real
// auth stack returns, replace this stub with an enforcing guard.
// ─────────────────────────────────────────────────────────────────

import type { NextResponse } from 'next/server'

const LOCAL_ADMIN_ID = 'local-admin'

/** Server-component guard. Local mode → always allowed. */
export async function requireAdmin(): Promise<{ userId: string | null }> {
  return { userId: LOCAL_ADMIN_ID }
}

/** Route-handler guard. Local mode → never denies (returns null). */
export async function assertAdminApi(): Promise<NextResponse | null> {
  return null
}
