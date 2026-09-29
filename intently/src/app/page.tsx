// ─────────────────────────────────────────────
// Intently · Home Page
//
// The Intently app has exactly two faces:
//   · the DISCOVERY plugin (this page) — the "Shop by situation" surface,
//     proxied into the Medusa storefront at :8000/discovery (basePath
//     /discovery), and also reachable standalone for dev at :3017/discovery.
//   · the ADMIN studio at /admin (so :3017/discovery/admin under the basePath).
//
// NextExperience is the self-contained discovery surface (its own header, cart,
// thread, results canvas; shared Medusa cart when embedded, a local demo cart
// standalone). The former standalone "river" (Entry → Conversation → StyleGrid
// → Discovery → Checkout sections) is retired — its sections were removed with
// src/_parked/ in the pivot cleanup (recoverable from git history). See
// wiki/concepts/deployment-topology.
// ─────────────────────────────────────────────

import './next/theme.css'
import { NextExperience } from './next/NextExperience'

export default function Home() {
  return <NextExperience />
}
