# ADR-0006 — Replica-safe guardrail counters on Redis (Upstash), not Postgres

- **Status:** Accepted (2026-07-17), in production
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
