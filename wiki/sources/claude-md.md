---
type: source
status: stable
updated: 2026-05-09
sources: []
tags: [project-config, instructions]
---

# claude-md

Source: [`/Users/ilmariv/intently/CLAUDE.md`](../../CLAUDE.md). The root project-level guidance file Claude Code loads at session start.

## What it covers

- **Repository layout** — code lives in the inner `intently/` subdirectory; root is config-only. All npm commands run from `intently/`.
- **Common commands** — install, dev, build, typecheck, lint, test, test:ci. Single-test selectors via `npx jest`.
- **CI** — typecheck/lint/test/build matrix in `.github/workflows/ci.yml`, all with `working-directory: intently`. Tests run with `NEXT_PUBLIC_AI_MODE=scripted` so no API key is needed.
- **Architecture** — the [[river-architecture]] mental model, the single [[intently-store]], the [[ai-mode-toggle]], the catalogue-vs-accounts data split (see [[supabase-over-medusa]]), and intent scoring driving layout. `src/` directory tour included.
- **Conventions** — kebab-case files, PascalCase components, strict TS, types live in `src/types/index.ts`, ClientShell overlay strategy, ESLint v9 flat config.
- **Dependency pinning** — see [[dependency-pinning]].
- **Environment** — `NEXT_PUBLIC_AI_MODE`, `ANTHROPIC_API_KEY`.
- **Roadmap pointer** — `intently/docs/roadmap.md` (not yet ingested).
- **Delegation rules** — when to route to `deepseek-read` / `deepseek-write` and when not to.

## Things to know that aren't obvious from the file

- The user instruction "Don't flatter me. Use radical candor." is at the top — it's a hard preference, not a politeness request.
- The DeepSeek delegation block at the bottom is the most recently added section (2026-05-05). It explicitly excludes the [[intently-store]] and dual-stream layout from delegation.
- `intently/docs/design.md` and `intently/docs/roadmap.md` are referenced but not yet ingested into this wiki.

## Wiki pages this source informed

- Entities: [[intently-store]], [[use-chat]]
- Concepts: [[river-architecture]], [[ai-mode-toggle]]
- Decisions: [[dependency-pinning]], [[supabase-over-medusa]]
