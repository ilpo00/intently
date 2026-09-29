'use client'

// ─────────────────────────────────────────────
// ClientShell
//
// Wraps the persistent client-side overlays. The root layout is a Server
// Component and can't import hook-using client components directly; this thin
// wrapper satisfies that constraint.
// ─────────────────────────────────────────────

import { EmbeddedNav } from '@/components/ui/EmbeddedNav'

// NextExperience (the discovery surface) owns its OWN chrome — header, cart,
// start-over. The former river's global overlays (CartButton / CartDrawer /
// SessionReset) are retired with the river. In embedded mode a thin
// back-to-store nav still rides above the plugin.
const EMBEDDED = (process.env.NEXT_PUBLIC_BASE_PATH || '') !== ''

export function ClientShell() {
  return EMBEDDED ? <EmbeddedNav /> : null
}
