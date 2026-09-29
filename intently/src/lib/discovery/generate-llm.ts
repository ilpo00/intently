// ─────────────────────────────────────────────
// discovery/generate-llm.ts  ·  SERVER ONLY
//
// Tier-1 generation: re-voice the tailor's SPOKEN prose so the conversation
// reads written-by-a-person, not templated — without letting the model decide
// anything. The deterministic engine has already chosen what to show/ask and
// stated it correctly (voice.ts); this step only rephrases that text, keeping
// every fact identical. The deterministic text is the ground truth, the
// verification reference, AND the fallback.
//
// Covered: the assistant message, the consultation question prompt + option
// labels, and the outfit-completion slot leads. NOT the per-product "why" lines
// (truth-critical, attribute-grounded — they stay deterministic this round).
//
// Faithfulness is enforced deterministically against the original (count
// preserved, no apology/lack framing, structure intact). On any failure the
// route keeps the deterministic prose — the conversation never dead-ends.
// ─────────────────────────────────────────────

import { providerChat, extractJson, type ChatMessage, type Provider } from './llm-client'

export interface RephraseInput {
  message: string
  prompt?: string
  options?: { id: string; label: string }[]
  leads?: { slotId: string; lead: string }[]
  // Facts the model must preserve / may lean on for tone (not invent beyond).
  facts: {
    count: number
    learned: string[]        // what the shopper said this turn (for warmth)
    cartSettled?: string     // "your dress is settled" — must be honoured
    gapGarment?: string      // an unstocked garment named honestly
  }
}

export interface RephrasedProse {
  message: string
  prompt?: string
  options?: { id: string; label: string }[]
  leads?: { slotId: string; lead: string }[]
}

const APOLOGY = /\b(sorry|apolog|unfortunately|afraid|regret|sadly)\b/i

function systemPrompt(): string {
  return [
    'You are re-voicing a personal tailor\'s lines so they read warm, brief and natural — never templated, never salesy.',
    'You ONLY rephrase. You must NOT change any fact, number, or decision; do NOT add claims about specific products; do NOT invent options or pieces; do NOT apologise or imply the shop lacks anything.',
    'Keep the exact count of pieces if one is stated. Keep the meaning of every option label and lead. If a line says a carted item is settled, keep that. If a line names a garment the shop doesn\'t stock today, keep that honest framing (confident, not apologetic).',
    'Return ONLY a JSON object with the SAME keys you were given (message, and prompt/options/leads if present). For options, return an array of {id, label} with the SAME ids. For leads, an array of {slotId, lead} with the SAME slotIds. Rephrase each value; change nothing structural.',
  ].join('\n')
}

function userPrompt(input: RephraseInput): string {
  const f = input.facts
  const ctx: string[] = [`pieces shown: ${f.count}`]
  if (f.learned.length) ctx.push(`shopper just said: ${f.learned.join(', ')}`)
  if (f.cartSettled) ctx.push(`already in cart (do not re-offer): ${f.cartSettled}`)
  if (f.gapGarment) ctx.push(`not stocked today (keep honest): ${f.gapGarment}`)
  const payload = {
    message: input.message,
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.options ? { options: input.options } : {}),
    ...(input.leads ? { leads: input.leads } : {}),
  }
  return `Context: ${ctx.join('; ')}.\nRe-voice these lines (return the same JSON shape):\n${JSON.stringify(payload)}`
}

// ── Deterministic faithfulness check ──
// The original is ground truth. A rephrase that drops the count, sneaks in an
// apology, or mangles the structure is rejected — the route keeps the template.
// Exported for unit testing (network-free).
export function faithful(input: RephraseInput, out: RephrasedProse): boolean {
  if (!out.message || typeof out.message !== 'string') return false
  if (APOLOGY.test(out.message)) return false
  // Count must survive if it appeared in the original.
  const n = String(input.facts.count)
  if (input.message.includes(n) && !out.message.includes(n)) return false
  // Structure must be preserved exactly (same ids / slotIds, all non-empty).
  if (input.prompt && (!out.prompt || APOLOGY.test(out.prompt))) return false
  if (input.options) {
    const wantIds = input.options.map(o => o.id).sort()
    const gotIds = (out.options ?? []).map(o => o.id).sort()
    if (gotIds.length !== wantIds.length || gotIds.some((id, i) => id !== wantIds[i])) return false
    if ((out.options ?? []).some(o => !o.label || !o.label.trim())) return false
  }
  if (input.leads) {
    const wantSlots = input.leads.map(l => l.slotId).sort()
    const gotSlots = (out.leads ?? []).map(l => l.slotId).sort()
    if (gotSlots.length !== wantSlots.length || gotSlots.some((s, i) => s !== wantSlots[i])) return false
    if ((out.leads ?? []).some(l => !l.lead || !l.lead.trim())) return false
  }
  return true
}

export function coerce(raw: unknown, input: RephraseInput): RephrasedProse | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: RephrasedProse = { message: typeof r.message === 'string' ? r.message.trim() : '' }
  if (input.prompt && typeof r.prompt === 'string') out.prompt = r.prompt.trim()
  if (input.options && Array.isArray(r.options)) {
    out.options = r.options
      .map(o => (o && typeof o === 'object' ? { id: String((o as Record<string, unknown>).id ?? ''), label: String((o as Record<string, unknown>).label ?? '').trim() } : null))
      .filter((o): o is { id: string; label: string } => !!o && !!o.id)
  }
  if (input.leads && Array.isArray(r.leads)) {
    out.leads = r.leads
      .map(l => (l && typeof l === 'object' ? { slotId: String((l as Record<string, unknown>).slotId ?? ''), lead: String((l as Record<string, unknown>).lead ?? '').trim() } : null))
      .filter((l): l is { slotId: string; lead: string } => !!l && !!l.slotId)
  }
  return out
}

/**
 * Re-voice the tailor's spoken prose, or null if the model is unavailable or
 * produced anything unfaithful. A non-null result is verified safe to use.
 */
export async function rephraseProse(
  input: RephraseInput,
  provider: Provider,
  model?: string, // request-time override (Studio bench); unset = env default
  meter?: { tokensIn: number; tokensOut: number }, // analytics token capture
): Promise<RephrasedProse | null> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: userPrompt(input) },
  ]
  // A little warmth (temperature) so the re-voicing varies turn to turn and
  // doesn't settle into a new template; faithfulness is still gated downstream.
  const raw = await providerChat(provider, messages, { jsonMode: true, timeoutMs: 4500, maxTokens: 700, temperature: 0.4, model, meter })
  if (!raw) return null
  const json = extractJson(raw)
  if (json === null) return null
  const out = coerce(json, input)
  if (!out || !faithful(input, out)) return null
  return out
}

/** DISCOVERY_GENERATION selects the live re-voicer (unset = deterministic). */
export function generationProvider(): Provider | null {
  const v = (process.env.DISCOVERY_GENERATION || '').toLowerCase()
  if (v === 'deepseek' || v === 'llm') return 'deepseek'
  if (v === 'haiku') return 'haiku'
  if (v === 'openai') return 'openai'
  return null
}
