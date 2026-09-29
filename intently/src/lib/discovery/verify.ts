// ─────────────────────────────────────────────
// discovery/verify.ts
//
// Layer-2 grounding: the LLM re-voicer must never promise what Intently
// cannot deliver. faithful() (generate-llm.ts) protects the STRUCTURE of a
// rephrase — count, ids, no apologies. This module protects its CLAIMS:
//
//   1. Capability grounding — the assistant cannot act on the shop's behalf.
//      Prose that claims a performed action or a fulfilment promise ("added
//      to your cart", "it'll ship tomorrow", "I've reserved it") is rejected.
//   2. Product grounding — prose must not name a catalogue product that is
//      not in the shown results. Full-name matching only: exact enough to
//      never false-positive on ordinary words like "dress".
//
// Deterministic and pure — same contract as faithful(): a false return means
// the route keeps the engine's template. This denylist is the always-on
// floor, not a complete defence: paraphrases it doesn't know slip through
// (measured by scripts/scorecard.eval.ts on a held-out set). An LLM verifier
// for that residue is a documented option, not built — see prodprep.md.
// ─────────────────────────────────────────────

// Claims of performed actions or fulfilment promises the assistant cannot
// make. Talking ABOUT the cart is fine ("your dress is settled" refers to
// what the shopper themselves carted); claiming to have DONE something isn't.
const UNSUPPORTED_CLAIMS: RegExp[] = [
  /\b(i'?ve|i have|we'?ve|we have|i|we) (just )?(added|placed|put|moved|saved|popped|dropped|slipped|tucked)\b[^.!?]*\b(cart|bag|basket|trolley|order|wishlist)\b/i,
  /\badded (it|this|that|them|one)? ?to (your|the) (cart|bag|basket|order|wishlist)\b/i,
  /\b(i'?ve|i have|we'?ve|we have|i|we) (reserved|ordered|purchased|bought|shipped|dispatched|booked|held)\b/i,
  /\byour order (is|has been|will be)\b/i,
  /\b(will|it'?ll|they'?ll|should) (ship|arrive|be delivered|reach you)\b/i,
  /\b(free|next.day|express) (shipping|delivery)\b/i,
  /\bback in stock (by|on|next)\b/i,
  /\b(discount|coupon|promo) code\b/i,
  /\b(i|we) (can|could|will|'ll) (order|restock|source|get) (it|this|that|one) (in|for you)\b/i,
  // Holding stock: "we've put one aside", "I'll keep it on hold for you".
  /\b(i|we)('ve|'ll| have| will| can| could)? (just )?(put|set|kept|keep|held|hold) (it|one|this|that|them) (aside|back|on hold|for you)\b/i,
  // Delivery promises without the word "ship": "it'll be with you by Thursday".
  /\b(it'?ll|it will|they'?ll|they will) be (with you|on your doorstep|at your door)\b/i,
  /\b(i|we)('ll| will| can| could)? (have it |get it )?(send|sent|post|deliver)\b[^.!?]*\b(to you|over|your way)\b/i,
  // Claimed completion: "consider it done — it's waiting in your basket".
  /\bconsider it done\b/i,
  /\b(waiting|ready) (for you )?in (your|the) (cart|bag|basket)\b/i,
]

/** True when the text claims an action/promise Intently cannot back. */
export function claimsUnsupportedCapability(text: string): boolean {
  return UNSUPPORTED_CLAIMS.some(rx => rx.test(text))
}

/**
 * True when the text names a catalogue product that is NOT among the shown
 * results — i.e. the model surfaced inventory the engine didn't choose (or
 * the shop can't show). Whole-name, case-insensitive matching.
 */
export function namesUnshownProduct(
  text: string,
  shownNames: readonly string[],
  catalogNames: readonly string[],
): boolean {
  const t = text.toLowerCase()
  const shown = new Set(shownNames.map(n => n.toLowerCase()))
  return catalogNames.some(name => {
    const n = name.toLowerCase()
    return !shown.has(n) && t.includes(n)
  })
}

/**
 * Grounding gate for a full rephrase: every piece of spoken prose must pass
 * both checks. False → the route keeps the deterministic template.
 */
export function grounded(
  texts: ReadonlyArray<string | undefined>,
  shownNames: readonly string[],
  catalogNames: readonly string[],
): boolean {
  for (const text of texts) {
    if (!text) continue
    if (claimsUnsupportedCapability(text)) return false
    if (namesUnshownProduct(text, shownNames, catalogNames)) return false
  }
  return true
}
