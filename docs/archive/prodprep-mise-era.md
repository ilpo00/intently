# prodprep.md — archived entries (MISE era)

These entries were moved out of the live [`prodprep.md`](../../prodprep.md) on
2026-09-29 because the code they describe **no longer exists** — it was removed
with `src/_parked/` in the MISE → Intently pivot (2026-06-15; see
[`intently/docs/mise_to_intently_migration.md`](../../intently/docs/mise_to_intently_migration.md)).
They are kept verbatim for the record: several describe failure classes (PII in
logs, trusting a body `userId`, RLS-rejected server writes) that apply again the
moment the Phase-2 account layer is recovered from git history. Re-read them
before reviving that layer.

---

### Tool-name allowlist duplication — `intently/src/lib/ai/providers/{deepseek,anthropic}.ts`

Both providers maintain the same hardcoded list of valid tool names (`recommend_products`, `cite_recipe`, `ask_clarifying`, `show_taste_grid`). Adding a fifth tool today requires edits in four files (tools.ts, validator.ts, deepseek.ts, anthropic.ts).

Extract a single `const ALLOWED_TOOL_NAMES = new Set(...)` derived from `ToolCall['name']` and use it in both providers.

### Markdown emphasis stripper is naïve — `intently/src/components/ui/LinkifiedText.tsx`

The regex `\*\*?(.*?)\*\*?` is non-greedy and handles only well-balanced single-line emphasis. Nested or unbalanced asterisks (`**foo*` in mid-sentence) will produce garbled output. The current LLM responses don't trigger this, but if a future recipe title contains a literal `*` or the prose includes a list marker, it'll break.

Replace with a tiny dedicated parser, or pull in `marked`/`micromark` if we end up needing more markdown features in the chat anyway.

### `cachedTerms` staleness on hot-reload — `intently/src/lib/ai/text-mentions.ts`

The parser caches its search terms at module load (`cachedTerms: SearchTerm[] | null`). If the catalog ever becomes mutable at runtime (recipe seeds reload, Supabase-backed catalog), the cache won't pick up new entries until the process restarts.

Today the catalog is compile-time so this is moot. Add an invalidation hook (or drop the cache and rebuild per-request — it's ~12 recipes, trivial) the moment catalog mutability lands.

### Linear lookups in `resolveToolCallProducts/Recipe` — `intently/src/lib/ai/validator.ts:101,107`

The functions use `getProductById` / `getRecipeById` (which are `.find()` loops over the catalog) on the hot path. The same module already builds `Set`s of ids at line 50 for validation. At 32 products + 12 recipes, this is invisible. At 200+ assets, it shows up.

Move to a `Map<id, Product>` (similarly for recipes) at the data layer (`src/lib/data.ts`, `src/lib/recipes.ts`) and have both validator and route consume it.

### Unknown tool names silently dropped — `intently/src/lib/ai/providers/deepseek.ts:65`

`parseToolCalls` filters out tool calls whose `name` isn't in the allowlist. This is correct defensive behaviour, but the drop is silent. If the model starts emitting a tool we haven't registered (a model upgrade, a hallucinated name), we'd see "the AI returned nothing" without knowing why.

Add a `log.warn('deepseek emitted unknown tool', { name })` in the `continue` branch.

### PII in logs — `intently/src/lib/ai/orchestrator.ts:34`

`reqLog.info('orchestrator start', { lastUser: lastUser?.content?.slice(0, 120) })` logs the first 120 chars of every user message to `.logs/ai.log`. Anniversary plans, dietary restrictions, names — all land in the log file.

Fine for solo dev. For prod:
- Gate behind an env var `LOG_USER_PROMPTS` (default false in prod).
- Or replace the field with a hash (`crypto.createHash('sha1').update(content).digest('hex').slice(0, 8)`) so we can correlate without retaining content.

### Upstream error body in thrown Error — `intently/src/lib/ai/providers/deepseek.ts:120`

When DeepSeek returns a non-2xx response, we throw `new Error(\`DeepSeek ${res.status}: ${body.slice(0, 200)}\`)`. The route handler catches this and returns a generic 500 to the client, so today nothing leaks. But if anyone ever surfaces the caught error message to the user (e.g., a debug toast, an error page that includes the cause), DeepSeek's error body — which sometimes echoes the input prompt — would leak.

Two options: drop the body from the thrown message and only keep it in the WARN log (already there); or only include the body when `process.env.NODE_ENV !== 'production'`.

### `/api/chat/conversion` unauthenticated + accepts arbitrary userId — `intently/src/app/api/chat/conversion/route.ts:47`

The conversion-analytics endpoint accepts a `?userId=<id>` query string and returns that user's entire recommendation history. Today there's exactly one user (`demo-user`) so it's information leakage to nobody. Once v0.2 ships real auth, any unauthenticated caller could enumerate other users' rec-event history.

Two gates before prod:
- Require an auth JWT and constrain to the JWT's `sub` (ignore the query-string userId).
- Add the same abuse-mitigation envelope as `/api/chat` — rate-limit per IP at minimum.

### `/api/chat` trusts the `userId` field from the request body — `intently/src/app/api/chat/route.ts`

The route reads `body.userId` and persists chat messages + rec events under that id. Anyone can POST with another user's id and pollute their audit log. Fine for v0.1.x demo (single `demo-user` constant); pre-v0.2-auth, replace with the JWT's `sub` and stop trusting the body.

### Server-side AccountStore writes fail RLS for user-scoped tables — `intently/src/lib/account/account-store-factory.ts`

Companion to the 2026-05-25 browser fix (see [[account-store-auth-aware-client]] wiki). The server branch in the factory still builds a headless anon-key Supabase client with no cookies, so any PostgREST write it makes runs under the `anon` role and `auth.uid()` is NULL. After `0005_enable_rls`, that means every user-scoped write from `/api/chat`'s `persistTurn` (`appendChatMessage`, `recordRecommendationEvent`) is silently rejected with `42501`.

The route's catch swallows the error ("logged, not surfaced") so the chat UX still works, but the audit tables (`chat_messages`, `recommendation_events`) never fill — and the v0.2 "remembers previous conversations" feature degrades to "never has any prior context."

Two acceptable fixes; pick before prod:
- Use `SUPABASE_SERVICE_ROLE_KEY` for the server-side AccountStore. RLS bypass is fine because the route has ALREADY resolved `auth.uid()` via `getSupabaseServer()` and is using that as the trusted `userId`. The audit writes are server-trusted.
- Construct a per-request auth-aware server client (cookies-aware) and route it into a one-shot AccountStore instance per request. Heavier; preserves "AccountStore is anon-key only" as a principle.

### `selectAsset` fires `markRecommendationClicked` on every selection — `intently/src/store/intently-store.ts`

The store action is called from many surfaces (ProductCard, CartDrawer, AssetDetail cross-links, LinkifiedText, RecipeCard tool links). Each call attempts to stamp a rec_event; the no-match-no-op behaviour keeps it correct but wastes one async call per non-recommendation click.

Add an optional `from: 'recommendation' | 'cart' | 'related' | 'catalog'` hint to `selectAsset(asset, opts?)` and only fire the stamper when `from === 'recommendation'` (or unset, for backward-compat). Eight-ish call sites to migrate; ship when the wasted calls become measurable.

### Pretty-printed budget JSON — `intently/src/lib/ai/budget.ts:88`

`writeFileSync(BUDGET_FILE, JSON.stringify(state, null, 2))` pretty-prints the state file with 2-space indent. Machine-only file, no human reads it, no diffs to look pretty in (the file is gitignored). One-line `JSON.stringify(state)` is fine.

Negligible — note it if you're already in there for the concurrency fix.

### Waypoints slice — UI removed, data layer kept dormant

The chrome redesign (top-left BrowsingChip + top-right SiteChrome panel) removed the `WaypointStrip` UI and stopped calling `pushWaypoint()` from any user-facing surface. The underlying store slice still exists:

- `intently/src/store/waypoints-slice.ts` — `pushWaypoint`, `restoreWaypoint`, `clearWaypoints`, `MAX_WAYPOINTS`
- `intently/src/tests/waypoints-slice.test.ts` — slice tests still pass; slice still works
- Persisted localStorage / Supabase `waypoints` columns (if any) — still hydrate cleanly

The slice is kept so old persisted state loads without error and so the data layer is ready if waypoints (or a "history" feature) come back. **If no waypoint-style UI is reintroduced before public launch, delete the slice, its tests, and any persistence keys** to drop dead code. The acknowledgment lives at the top of `intently/src/components/ui/BrowsingChip.tsx`.
