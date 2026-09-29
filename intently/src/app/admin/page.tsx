// ─────────────────────────────────────────────
// /admin — admin home.
//
// There is no standalone admin dashboard; the Studio is the admin surface. Send
// the bare /admin URL (── :3017/discovery/admin under the plugin basePath ──)
// straight to the enrichment Studio so the natural entry point resolves instead
// of 404-ing. redirect() applies the basePath automatically.
// ─────────────────────────────────────────────

import { redirect } from 'next/navigation'

export default function AdminIndex() {
  redirect('/admin/enrichment/studio')
}
