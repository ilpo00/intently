# ADR-0006 — Replica-safe guardrail counters on Redis (Upstash), not Postgres

- **Status:** Accepted (2026-07-17). In production from 2026-07-17; on 2026-09-30 the Redis database was found to have been removed (inactive free tier), with the deployment silently on the in-memory fallback — see Consequences and `prodprep.md`
- **Detail:** `intently/src/lib/discovery/guardrails-shared.ts` · [ADR-012 cloud plan](../../intently/docs/cloud-architecture-plan.md)

## Context

The per-IP rate limit and the global daily LLM budget started in process
memory. On N serverless replicas every cap silently becomes cap × N — the one
guardrail failure that is invisible until the bill arrives.

## Decision

Move both counters to Upstash Redis over REST: an atomic `INCR` per request and
per LLM call, daily keys that `EXPIRE` themselves. Postgres was rejected for
this: a round-trip and row churn on *every* request for data with a 24-hour
lifespan is the wrong tool. Unset credentials fall back to in-memory (local dev,
CI); a Redis error or timeout fails open to the in-memory check for that
request — a shopper's turn must never fail because a counter did.

## Consequences

- The configured caps are the real caps on the multi-replica deployment.
- Fail-open trades strictness for availability during a Redis outage; the
  provider-side monthly spend cap remains the hard financial backstop.
- The client IP still comes from `x-forwarded-for` — tracked in `prodprep.md`.
- **Fail-open has a cost that this decision under-weighted: it is silent.** When the database
  disappeared, every limit quietly became per-instance and nothing reported it. The fix is not
  to stop failing open for rate limits, but to make the state visible: a health check surfaced in
  the Studio (added 2026-09-30) and, before real traffic, an alert on it.
