-- ─────────────────────────────────────────────────────────────────
-- Intently · 0010_enrichment_vectors
--
-- Vector store for the enrichment layer. Mirrors what
-- LocalJsonVectorStore holds in `.enrichment/vectors.json`, but with
-- pgvector behind it so the discovery layer can query in
-- milliseconds at scale.
--
-- Schema design notes:
--
--   - One row per PIM product. `id text PK` so we keep the upstream
--     identifier (e.g. `kaggle-15970`, `prod_01J5KZ...` from Medusa).
--     No surrogate UUID — we never join `product_vectors` to itself
--     and the PIM id is already stable.
--
--   - `embedding vector(384)` because we ship with all-MiniLM-L6-v2.
--     If we swap to text-embedding-3-small later (1536-dim) we will
--     write a new migration rather than ALTER this column — pgvector
--     can hold one dimension per column, and ANN indexes need rebuild.
--
--   - `metadata jsonb` carries the PimProduct snapshot so search
--     results return product context without a Medusa round-trip on
--     the hot path. This is the deliberate "decoupled" choice from
--     the ADR (intently/docs/enrichment-layer.md).
--
--   - `embed_text` stored verbatim so admins can see *exactly* what
--     was fed to the model and decide whether to tune `enrich-text.ts`
--     before re-embedding.
--
-- Index strategy: HNSW with cosine ops.
--
--   HNSW gives better recall than IVFFlat on small-to-medium
--   datasets and doesn't require a sample of vectors to be built
--   (IVFFlat needs to train its centroids). For <100k vectors,
--   build time is acceptable. Beyond that, swap to IVFFlat or shard.
--
-- RPC strategy: `enrichment_search(query, k, min_score)` returns
--   ranked rows. We wrap the `<=>` cosine-distance operator in a
--   SQL function because the supabase-js client surfaces RPCs more
--   cleanly than raw `<=>` syntax, and a server-side function lets
--   us cap k and apply min_score consistently.
--
-- Apply via Supabase Dashboard → SQL Editor, `supabase db push`, or
-- the Supabase MCP `apply_migration` tool. Wrapped in a single
-- transaction so partial application can't leave the project in a
-- half-extended state.
-- ─────────────────────────────────────────────────────────────────

begin;

-- ── 1. Extension ─────────────────────────────────────────────────
-- pgvector ships with Supabase but is not enabled by default.
create extension if not exists vector with schema extensions;

-- ── 2. Table ─────────────────────────────────────────────────────
create table if not exists public.product_vectors (
  id           text        primary key,
  embedding    extensions.vector(384) not null,
  embed_text   text        not null,
  embedded_at  timestamptz not null default now(),
  model        text        not null,
  dimension    int         not null check (dimension = 384),
  metadata     jsonb       not null default '{}'::jsonb,
  -- For partial re-embeds: if embed_text hasn't changed and model is
  -- the same, we can skip the model call. Indexed for the lookup.
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.product_vectors is
  'Embedding-per-product mirror of the PIM. Metadata is a denormalised PimProduct snapshot.';
comment on column public.product_vectors.embedding is
  '384-dim all-MiniLM-L6-v2 vector. Cosine-normalised by the model.';
comment on column public.product_vectors.embed_text is
  'Exact string fed to the embedder. Stored so admins can see and tune enrich-text.ts.';
comment on column public.product_vectors.metadata is
  'Denormalised PimProduct (title, category, color, imageUrl, etc.) so search results need no PIM round-trip.';

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists product_vectors_touch_updated_at on public.product_vectors;
create trigger product_vectors_touch_updated_at
  before update on public.product_vectors
  for each row execute function public.touch_updated_at();

-- ── 3. Indexes ───────────────────────────────────────────────────

-- HNSW on cosine distance. `vector_cosine_ops` is the operator class
-- that makes the `<=>` operator index-aware.
--
-- m and ef_construction are pgvector defaults; tune later if recall
-- becomes a problem.
drop index if exists public.product_vectors_embedding_hnsw_cosine;
create index product_vectors_embedding_hnsw_cosine
  on public.product_vectors
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- GIN on metadata for filtered search (e.g. only "Apparel" results).
create index if not exists product_vectors_metadata_gin
  on public.product_vectors
  using gin (metadata);

-- ── 4. RLS ───────────────────────────────────────────────────────
-- Search is public (any client may call the RPC).
-- Writes are admin-only and go through the service_role key, which
-- bypasses RLS — so a single permissive read policy is enough here.
alter table public.product_vectors enable row level security;

drop policy if exists "vectors public read" on public.product_vectors;
create policy "vectors public read"
  on public.product_vectors for select
  using (true);

-- Explicitly: no insert/update/delete policies for `anon` or
-- `authenticated`. The sync pipeline runs server-side with the
-- service_role key (or a server-side admin client) and bypasses RLS.

-- ── 5. Search RPC ────────────────────────────────────────────────
-- Returns top-N matches by cosine similarity.
--   similarity := 1 - cosine_distance
-- The `<=>` operator is cosine *distance* (0 = identical, 2 = opposite
-- for unit vectors). We convert to similarity so the API surface and
-- the local JSON store agree.
--
-- min_score is optional: pass null to skip the filter.
--
-- SECURITY DEFINER is NOT needed — the RPC reads from a public-
-- readable table. Keeping it INVOKER lets us reason about access
-- locally.
--
-- Operator note: pgvector lives in the `extensions` schema (Supabase
-- best practice). SQL-language function bodies resolve operators at
-- CREATE time against the parser's search_path, and the Supabase
-- default search_path does NOT include `extensions`. So bare `<=>`
-- would fail with `operator does not exist: extensions.vector <=>
-- extensions.vector`. We schema-qualify the operator with the
-- `operator(extensions.<=>)` form, which is parse-time safe regardless
-- of session search_path.

drop function if exists public.enrichment_search(extensions.vector, int, real);

create or replace function public.enrichment_search(
  query_embedding extensions.vector(384),
  match_count     int default 5,
  min_score       real default null
)
returns table (
  id          text,
  similarity  real,
  metadata    jsonb,
  embed_text  text,
  embedded_at timestamptz,
  model       text
)
language sql
stable
as $$
  select
    pv.id,
    (1 - (pv.embedding operator(extensions.<=>) query_embedding))::real as similarity,
    pv.metadata,
    pv.embed_text,
    pv.embedded_at,
    pv.model
  from public.product_vectors pv
  where (min_score is null
         or (1 - (pv.embedding operator(extensions.<=>) query_embedding))::real >= min_score)
  order by pv.embedding operator(extensions.<=>) query_embedding
  limit greatest(1, least(match_count, 50));
$$;

comment on function public.enrichment_search is
  'Cosine k-NN search over product_vectors. Returns similarity in [-1, 1] (typically [0, 1] for unit-normalised vectors).';

-- ── 6. PIM mirror (optional, future-facing) ──────────────────────
-- We do NOT mirror Medusa products into Postgres in v0.1 — the
-- embedding metadata is enough for the discovery layer. If a later
-- iteration needs structured filters (e.g. faceted search across
-- categories) we'll add a `pim_products` table here and migrate
-- the metadata column to a foreign-keyed reference. Documented in
-- intently/docs/enrichment-layer.md "Open questions".

commit;

-- ─────────────────────────────────────────────────────────────────
-- After applying this migration:
--
--   1. Set ENRICHMENT_STORE=supabase in intently/.env.local
--   2. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
--      are set (the service role bypasses RLS for the sync pipeline).
--   3. Run a sync from the admin UI — the SupabaseVectorStore impl
--      will use this RPC for search.
--
-- Smoke test from the SQL editor:
--
--   select id, similarity, metadata->>'title'
--   from public.enrichment_search(
--     (select embedding from public.product_vectors limit 1),
--     5,
--     null
--   );
--
-- Expected: the seed row at the top with similarity ~= 1.0, then
-- the next 4 closest neighbours.
-- ─────────────────────────────────────────────────────────────────
