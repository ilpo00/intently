// ─────────────────────────────────────────────
// analytics/mine-situations.ts  ·  SERVER ONLY
//
// The tightest loop in the product (feature brainstorm #3): mine what
// shoppers actually type for demand NO existing situation covers, and turn
// it into one-click situation suggestions for the tuner. Deterministic —
// no LLM, no new infrastructure; the analytics stream is the research.
//
// Method:
//   1. Take typed (non-tapped) queries from turn events.
//   2. Drop every query an existing situation already matches
//      (matchSituation — same matcher live discovery uses, so "covered"
//      here means covered in production).
//   3. Tokenize what remains; rank salient tokens by distinct-query reach;
//      greedily cluster queries under their strongest token so each query
//      backs at most one suggestion.
//   4. A cluster becomes a suggestion when enough DISTINCT queries back it.
//      Zero-result queries count double in ranking — they are shoppers the
//      engine failed outright.
// ─────────────────────────────────────────────

import { loadEvents, type TurnEvent } from './events'
import { matchSituation, type SituationProfile } from '@/lib/discovery/situation-match'

export interface SituationSuggestion {
  label: string        // title-cased cluster head, e.g. "Festival"
  keywords: string[]   // cluster head + strong co-occurring tokens
  queries: number      // distinct queries backing this
  zeroResults: number  // how many of them got nothing at all
  examples: string[]   // up to 3 verbatim shopper queries
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'i', 'im', "i'm", 'my', 'me', 'we', 'our', 'it', 'its',
  'is', 'am', 'are', 'be', 'to', 'of', 'in', 'on', 'at', 'and', 'or', 'so',
  'for', 'with', 'without', 'need', 'needs', 'want', 'wants', 'looking',
  'like', 'some', 'something', 'please', 'more', 'bit', 'that', 'this',
  'was', 'will', 'not', 'no', 'nothing', 'but', 'isnt', "isn't", 'hate',
  // generic garment/commerce words that would form meaningless clusters
  'dress', 'shirt', 'top', 'trousers', 'jacket', 'outfit', 'clothes', 'wear',
])

const MIN_QUERIES = Number(process.env.ANALYTICS_MINE_MIN_QUERIES || 2)

function tokens(q: string): string[] {
  return [...new Set(
    q.toLowerCase().replace(/[^\p{L}\p{N}'\s-]/gu, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !STOPWORDS.has(w)),
  )]
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export async function mineSituationSuggestions(
  profiles: SituationProfile[],
  sinceIso = '1970-01-01T00:00:00Z',
  limit = 5,
): Promise<SituationSuggestion[]> {
  const turns = (await loadEvents(sinceIso)).filter((e): e is TurnEvent => e.type === 'turn')

  // Distinct typed queries, uncovered by any existing situation.
  const seen = new Map<string, { zero: boolean }>()
  for (const t of turns) {
    if (t.answered) continue
    const q = t.query.toLowerCase().trim()
    if (!q || matchSituation(q, profiles)) continue
    const cur = seen.get(q)
    const zero = t.resultCount === 0 && !t.questionAsked
    if (cur) cur.zero = cur.zero || zero
    else seen.set(q, { zero })
  }

  // Token reach across distinct queries (zero-result queries weigh double).
  const reach = new Map<string, number>()
  for (const [q, meta] of seen) {
    for (const tok of tokens(q)) reach.set(tok, (reach.get(tok) ?? 0) + (meta.zero ? 2 : 1))
  }
  const ranked = [...reach.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  const rankOf = new Map(ranked.map((t, i) => [t, i]))

  // Greedy: each query backs its strongest (highest-reach) token only.
  const clusters = new Map<string, { queries: string[]; zero: number }>()
  for (const [q, meta] of seen) {
    const ts = tokens(q).sort((a, b) => (rankOf.get(a) ?? 1e9) - (rankOf.get(b) ?? 1e9))
    const head = ts[0]
    if (!head) continue
    const c = clusters.get(head) ?? { queries: [], zero: 0 }
    c.queries.push(q)
    if (meta.zero) c.zero += 1
    clusters.set(head, c)
  }

  return [...clusters.entries()]
    .filter(([, c]) => c.queries.length >= MIN_QUERIES)
    .sort((a, b) => (b[1].zero * 2 + b[1].queries.length) - (a[1].zero * 2 + a[1].queries.length))
    .slice(0, limit)
    .map(([head, c]) => {
      // Co-occurring tokens across the cluster's queries → extra keywords.
      const co = new Map<string, number>()
      for (const q of c.queries) for (const t of tokens(q)) if (t !== head) co.set(t, (co.get(t) ?? 0) + 1)
      const extra = [...co.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t)
      return {
        label: titleCase(head),
        keywords: [head, ...extra],
        queries: c.queries.length,
        zeroResults: c.zero,
        examples: c.queries.slice(0, 3),
      }
    })
}
