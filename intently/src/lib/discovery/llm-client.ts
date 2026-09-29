// ─────────────────────────────────────────────
// discovery/llm-client.ts  ·  SERVER ONLY
//
// Thin, dependency-light wrappers around the providers, raw-fetch (no SDK in the
// route bundle). DeepSeek via its OpenAI-compatible endpoint; Anthropic (Claude)
// via the Messages API. Both rules of the house:
//   · hard timeout via AbortController
//   · NEVER throw — return null on any error/timeout/malformed response, so the
//     route always falls back to the deterministic path ("return something nice")
//
// Provider note (measured 2026-06-11/12): the live path needs v4-flash with
// THINKING DISABLED (~1.6s, reliable). Thinking mode — the default — reasons
// verbosely before emitting (~4s, high runaway rate): unfit live. The old
// `deepseek-chat` name was exactly this non-thinking mode and is DEPRECATED
// 2026-07-24 (api-docs.deepseek.com/quick_start/pricing), so we call the real
// model name + the explicit `thinking: {type:"disabled"}` param. Claude Haiku
// (~1.0s) is the configured alternative.
//
// Keys (DEEPSEEK_API_KEY / ANTHROPIC_API_KEY) are read here and must never reach
// the client bundle — only route handlers import this.
// ─────────────────────────────────────────────

// Hard server boundary: importing this from a client component is a build
// error, so the API keys below can never be bundled to the browser.
import 'server-only'

const DEEPSEEK_BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
// Discovery-specific model knob (separate from the global DEEPSEEK_MODEL the
// batch helpers use). Discovery always disables thinking mode — see above.
const DEEPSEEK_MODEL = process.env.DISCOVERY_DEEPSEEK_MODEL || 'deepseek-v4-flash'
const ANTHROPIC_BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
const HAIKU_MODEL = process.env.DISCOVERY_HAIKU_MODEL || 'claude-haiku-4-5'
const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
// gpt-5.4-nano: $0.20/$1.25 per 1M (5× cheaper than gpt-5.6-luna) — right-sized
// for short JSON extraction + rephrase. Prefix prompt caching is automatic on
// OpenAI (cached input $0.02/1M), so keep the system prompt byte-stable.
const OPENAI_MODEL = process.env.DISCOVERY_OPENAI_MODEL || 'gpt-5.4-nano'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type Provider = 'deepseek' | 'haiku' | 'openai'

interface DeepSeekOpts {
  timeoutMs?: number
  jsonMode?: boolean
  maxTokens?: number
  temperature?: number
  // Request-time model override (the Studio bench probes specific models);
  // unset = the env-configured default.
  model?: string
  // Optional usage meter (analytics): when provided, the client ADDS the
  // response's token usage onto it. Mutation keeps the null-on-failure
  // return contract untouched for every existing caller.
  meter?: { tokensIn: number; tokensOut: number }
}

function meterAdd(meter: DeepSeekOpts['meter'], tokensIn: unknown, tokensOut: unknown): void {
  if (!meter) return
  if (typeof tokensIn === 'number') meter.tokensIn += tokensIn
  if (typeof tokensOut === 'number') meter.tokensOut += tokensOut
}

/**
 * One DeepSeek chat completion. Returns the assistant message content, or null
 * on any failure (no key, network, timeout, non-200, empty/malformed body).
 */
export async function deepseekChat(
  messages: ChatMessage[],
  opts: DeepSeekOpts = {},
): Promise<string | null> {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) return null

  const { timeoutMs = 2500, jsonMode = false, maxTokens = 768, temperature = 0 } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: opts.model || DEEPSEEK_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
        // Live path: thinking OFF, explicitly (the on-default reasons for ~4s
        // before emitting; the deprecated `deepseek-chat` alias was this mode).
        thinking: { type: 'disabled' },
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    meterAdd(opts.meter, data?.usage?.prompt_tokens, data?.usage?.completion_tokens)
    const content = data?.choices?.[0]?.message?.content
    return typeof content === 'string' && content.trim() ? content : null
  } catch {
    return null // timeout/network/parse — caller falls back to deterministic
  } finally {
    clearTimeout(timer)
  }
}

/**
 * One OpenAI chat completion (gpt-5.4-nano by default). Same request shape as
 * deepseekChat minus the DeepSeek-only `thinking` param (OpenAI rejects unknown
 * fields). Same null-on-failure contract.
 */
export async function openaiChat(
  messages: ChatMessage[],
  opts: DeepSeekOpts = {},
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null

  const { timeoutMs = 2500, jsonMode = false, maxTokens = 768, temperature = 0 } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: opts.model || OPENAI_MODEL,
        messages,
        temperature,
        // gpt-5.x rejects the legacy `max_tokens` param (400 unsupported_parameter)
        // — verified live 2026-07-15. `max_completion_tokens` is its replacement.
        max_completion_tokens: maxTokens,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      // Still null-on-failure for the caller, but surface WHY in the server log —
      // a silently swallowed 400 (wrong param, bad model name) is undebuggable.
      console.warn(`[llm-client] openai ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return null
    }
    const data = await res.json()
    meterAdd(opts.meter, data?.usage?.prompt_tokens, data?.usage?.completion_tokens)
    const content = data?.choices?.[0]?.message?.content
    return typeof content === 'string' && content.trim() ? content : null
  } catch {
    return null // timeout/network/parse — caller falls back to deterministic
  } finally {
    clearTimeout(timer)
  }
}

/**
 * One Claude (Anthropic Messages API) completion. The system message in
 * `messages` is lifted into the top-level `system` param. Same null-on-failure
 * contract as deepseekChat.
 */
export async function anthropicChat(
  messages: ChatMessage[],
  opts: { timeoutMs?: number; maxTokens?: number; temperature?: number; model?: string; meter?: DeepSeekOpts['meter'] } = {},
): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  const { timeoutMs = 4000, maxTokens = 768, temperature } = opts

  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
  const turns = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts.model || HAIKU_MODEL, max_tokens: maxTokens, system, messages: turns,
        ...(temperature !== undefined ? { temperature } : {}),
      }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    meterAdd(opts.meter, data?.usage?.input_tokens, data?.usage?.output_tokens)
    const text = data?.content?.[0]?.text
    return typeof text === 'string' && text.trim() ? text : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Dispatch a chat to the chosen provider, returning content or null. */
export function providerChat(
  provider: Provider,
  messages: ChatMessage[],
  opts: { timeoutMs?: number; maxTokens?: number; jsonMode?: boolean; temperature?: number; model?: string; meter?: DeepSeekOpts['meter'] } = {},
): Promise<string | null> {
  if (provider === 'haiku') {
    return anthropicChat(messages, { timeoutMs: opts.timeoutMs, maxTokens: opts.maxTokens, temperature: opts.temperature, model: opts.model, meter: opts.meter })
  }
  if (provider === 'openai') return openaiChat(messages, opts)
  return deepseekChat(messages, opts)
}

/** Best-effort JSON extraction from a model reply (handles stray prose/fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}
