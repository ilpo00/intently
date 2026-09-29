// ─────────────────────────────────────────────
// discovery/situation-active.ts  ·  SERVER ONLY
//
// Per-situation on/off. Each situation (built-in or custom) can be individually
// activated or deactivated; only ACTIVE situations bias live discovery. We
// store only the exceptions (the deactivated ids), so a fresh clone / new
// situation is active out of the box.
//
// Backed by the doc-store seam (key 'situation-active'): local JSON in dev/CI,
// Supabase runtime_kv on cloud (INTENTLY_STORE=supabase). Read by the discovery
// route (active-only) and the tuner; never by the client.
// ─────────────────────────────────────────────

import { readDoc, writeDoc, deleteDoc } from '@/lib/store/doc-store'

interface ActiveDoc { inactive: string[] }

/** Ids explicitly deactivated. Everything not listed is active. */
export async function readInactiveIds(): Promise<string[]> {
  const doc = await readDoc<ActiveDoc>('situation-active')
  return Array.isArray(doc?.inactive) ? doc!.inactive.filter(x => typeof x === 'string') : []
}

export async function isActive(id: string): Promise<boolean> {
  return !(await readInactiveIds()).includes(id)
}

/** Set a situation active/inactive. Activating clears the exception; emptying
 *  the set removes the doc entirely (back to the all-active default). */
export async function setActive(id: string, active: boolean): Promise<string[]> {
  const inactive = new Set(await readInactiveIds())
  if (active) inactive.delete(id)
  else inactive.add(id)
  const next = [...inactive]
  if (next.length) await writeDoc('situation-active', { inactive: next })
  else await deleteDoc('situation-active')
  return next
}

/** Drop an id from the store entirely (used when a custom situation is deleted). */
export async function forgetActive(id: string): Promise<void> {
  const inactive = await readInactiveIds()
  if (inactive.includes(id)) {
    const next = inactive.filter(x => x !== id)
    if (next.length) await writeDoc('situation-active', { inactive: next })
    else await deleteDoc('situation-active')
  }
}
