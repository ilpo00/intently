# Architecture decision records

Short records of the decisions that shape Intently: context, decision,
consequences. Longer rationale lives in the linked wiki pages; the code is
canonical for *what*, these are canonical for *why*.

## AI architecture

| ADR | Decision |
|---|---|
| [0001](0001-engine-decides-llm-phrases.md) | The engine decides, the LLM phrases |
| [0002](0002-per-turn-complexity-gate.md) | Deterministic-first tiers with a per-turn complexity gate |
| [0003](0003-hard-filters-need-deterministic-guards.md) | LLM output may only reach a hard filter through a deterministic guard |
| [0004](0004-deterministic-grounding-verifier.md) | A deterministic grounding verifier instead of an LLM verifier tier |
| [0005](0005-offline-vision-enrichment.md) | Vision enrichment as an offline, validated batch |

## Platform and operations

| ADR | Decision |
|---|---|
| [0006](0006-replica-safe-guardrails-on-upstash.md) | Replica-safe guardrail counters on Redis, not Postgres |
| [0007](0007-openai-embeddings-at-384-on-serverless.md) | OpenAI embeddings at 384 dims for the cloud path — zero migration |
| [0008](0008-public-demo-session-sandbox.md) | The open-web demo is a per-visitor sandbox, enforced at the route |
| [ADR-012](../../intently/docs/cloud-architecture-plan.md) | Cloud implementation plan — local-first to multi-replica |
| [private-demo-two-passwords](../../wiki/decisions/private-demo-two-passwords.md) | Private demo behind a two-credential edge gate |
| [supabase-over-medusa](../../wiki/decisions/supabase-over-medusa.md) | Supabase as the data backbone; Medusa deferred |
| [pim-strategy](../../wiki/decisions/pim-strategy.md) | Products mastered in the PIM; no product editor in Intently |
| [supabase-auth-over-clerk](../../wiki/decisions/supabase-auth-over-clerk.md) | Magic-link auth via Supabase (Phase 2, paused) |
| [dependency-pinning](../../wiki/decisions/dependency-pinning.md) | Exact pins for Next/React (CVE patches, peer-dep stability) |
| [rivers-spike-rejected](../../wiki/decisions/rivers-spike-rejected.md) | Multi-river UI spike rolled back (pre-pivot, kept for rationale) |
