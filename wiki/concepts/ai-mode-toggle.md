---
type: concept
status: retired
updated: 2026-07-15
sources: [claude-md]
tags: [pattern, ai, env-var, removed]
---

# ai-mode-toggle (REMOVED 2026-07-15)

`NEXT_PUBLIC_AI_MODE` is gone. Discovery is **live-only**: every turn `POST`s
`/api/discover`; the deterministic engine is the server-side default and the
client-side error fallback. There is no scripted client branch to toggle.

## What replaced the toggle's jobs

- **CI / no-key runs** — the route itself is keyless-deterministic when the
  `DISCOVERY_PARSER` / `DISCOVERY_GENERATION` flags are unset; route tests
  import the handler directly and hook tests stub `fetch` with the engine
  (`src/tests/discover-route.test.ts`, `consult-flow.test.tsx`).
- **Offline resilience** — `useDiscover`'s `catch` still runs the client-side
  engine on any fetch error ("the demo never dead-ends"), independent of any
  mode flag.
- **Cost control** — per-turn now, not per-deployment: the complexity gate
  ([[tiered-conversation]], `escalate.ts`) keeps simple turns off the LLM, and
  the grounding verifier (`verify.ts`) rejects unfaithful prose.

## History

The flag was MISE-era ([[use-chat]] selected tiered vs `scripted-ai.ts`), then
briefly gated the `useDiscover` client-side engine branch. Removed together
with the CI `NEXT_PUBLIC_AI_MODE=scripted` env (both CI files) and the
`setup.ts` test default. Any doc still describing scripted mode is stale.

## Related

- [[tiered-conversation]] — the live Tier-0/Tier-1 architecture
- [[use-chat]] — the removed MISE contract this flag originally served
