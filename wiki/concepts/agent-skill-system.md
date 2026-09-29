---
type: concept
status: stable
updated: 2026-05-20
sources: []
tags: [agent-tooling, skills, claude-code, enforcement, claude-md]
---

# agent-skill-system

**Claude skills are the structural enforcement layer for Intently's hard rules.** [[claude-md]] holds the rules as prose; skills make them fire at the moment the agent is about to violate one. The skill set is intentionally small — only rules that have actually bitten get a skill.

## Why skills (and not more prose in CLAUDE.md)

Prose rules in [[claude-md]] reach the agent on every session, but description-level matching alone is not enforceable — a rule the agent has "read" can still be violated under flow. Skills shift the rule from "remembered" to "loaded at the relevant moment with a verification step", which the [[task-observer]] skill calls the *Pre-Flight Principle*: every skill with rules must have a mechanism to enforce them, not just document them.

The bias is small over large. A skill that fires on every prompt is dead weight in context; a skill that fires precisely when its rule is about to bind is leverage. Internal Intently skills target the second shape.

## Active skills (2026-05-20)

- **[[mise-preview-plan]]** — `~/.claude/skills/mise-preview-plan/`. Generates a structured Preview verification plan (Flow / Asserts / Success / Risk) before any browser MCP invocation on Intently work. Enforces the ASK-FIRST rule from [[claude-md]] § Browser verification. Iteration-2 added a "First: would reading the code obviate the Preview run?" pre-check that catches false premises and lets a code-level fix preempt the browser run. **Already battle-tested on main:** the 2026-05-19 inspire-me / taste-grid scroll-target bugfix used this skill to diagnose the below-the-fold issue via Preview (see [[log]] entry).
- **[[mise-motion-polish]]** — `~/.claude/skills/mise-motion-polish/`. Applies the five non-negotiable design.md rules (click-to-follow, frame-aligned deferrals, reduced-motion, no auto-scrolls past the assistant answer, no element exceeds viewport) when polishing motion or scroll. Composes with `mise-preview-plan` via a required handoff. Internalises rules learned post-incident from the phantom-waypoint trap and the Safari mid-animation stutter.
- **[[mise-tiered-ai]]** — `~/.claude/skills/mise-tiered-ai/`. Forces a tiered architecture proposal (Tier 0 deterministic / Tier 1 DeepSeek / Tier 2 Claude verifier) for any AI feature, instead of defaulting to Claude-everywhere. Enforces the standing memory rule that DeepSeek handles bulk, Claude verifies. Honesty clause: when the feature is too small to tier, the skill says so explicitly rather than performing tiers. **The pattern this skill enforces is no longer hypothetical** — [[tiered-ai-architecture]] (Phase 0.5 spike, 2026-05-16) landed exactly this shape on main: DeepSeek-V4-Flash primary, Anthropic Haiku verifier, Sonnet regenerator, with catalog warmup. The skill exists to keep new AI features in Intently faithful to that established pattern rather than reaching for Claude-everywhere defaults.

Plus, pre-existing global: **[[task-observer]]** (skill-improvement meta-skill) and three wiki helpers (`wiki-ingest`, `wiki-lint`, `wiki-status`).

## Skill triggers — when each one fires

| Skill | Trigger surface |
|---|---|
| `mise-preview-plan` | Changes touch `src/components/sections/` or `src/components/ui/`; agent considering Preview/Chrome MCP; user asks "verify in browser" / "check on dev server" |
| `mise-motion-polish` | "this feels janky", "smooth this out", "add a fade", "fix the auto-scroll", any motion/scroll task |
| `mise-tiered-ai` | User proposes any AI/LLM feature, intent classification, recommendation, summarisation, rephrasing |

Each skill description is intentionally "pushy" per skill-creator's anti-undertriggering guidance — explicit trigger phrases listed in the description, not just "what it does".

## What's deferred

Three skill candidates were considered and not built in the 2026-05-20 round:

- **`mise-section-scaffold`** — bootstrap a new river section with store slice + persistence gate + jest. Deferred until the next section is actually added (no current candidate).
- **`mise-retro-adr`** — generate retro+ADR wiki pattern when a spike rolls back. Deferred because [[wiki-ingest]] already covers most of this and the explicit retro pattern is rare enough that a skill may be overkill.
- **Open-source split of `mise-preview-plan`** — the general "ASK-FIRST before stateful browser tools" pattern could go public. Deferred until the internal version is stable across a few real sessions.

Also flagged but not addressed in this round: the `task-observer` log at `~/.claude/skill-observations/log.md` was empty across many sessions despite the skill being wired in `~/.claude/CLAUDE.md`. The 2026-05-20 round generated skills from *inferred* patterns (CLAUDE.md, design.md, git history) rather than from logged observations. Fixing the observation pipeline is the lead candidate for the next round.

## Round process (codified for future rounds)

The 2026-05-20 round followed a three-phase shape:

1. **Inventory + gap analysis.** Parallel surveys of (a) the existing skill library + observation log and (b) the project's recurring work patterns. The output is a candidate list with frequency estimates.
2. **Mixed-rigor build.** Skills with objectively-checkable output (e.g., `mise-preview-plan` produces a template) get the full skill-creator eval loop with with/without subagents. Skills with judgment outputs (`mise-motion-polish`, `mise-tiered-ai`) get vibe-eval — 3 hand-judged prompts.
3. **Iterate where the benchmark surfaces a real gap.** The iteration-1 benchmark on `mise-preview-plan` showed the baseline outperformed with-skill on technical specifics (volunteered the `will-change: transform` fix). Iteration-2 added a code-first pre-check that captured that win without losing the template.

The full process artifacts (responses, benchmarks, eval JSON) live under `~/.claude/skills/mise-*-workspace/iteration-N/`.

## When to update this concept page

- A new skill is added to the active set.
- An existing skill is significantly restructured or rescoped.
- The skill-system pattern itself changes (e.g., the open-source/internal distinction starts mattering for Intently skills).

Do NOT update for minor iteration tweaks to a single skill's body — those live in the skill's workspace history, not here. The wiki page is about the *system*, not the implementation details of each skill.

## Related

- [[claude-md]] — the prose rules these skills enforce structurally
- [[tiered-ai-architecture]] — the actual implementation the `mise-tiered-ai` skill nudges new AI work to remain faithful to
- [[rivers-spike-rejected]] — illustrates the kind of post-incident learning that surfaces skill candidates
- [[persistence-restores-data]] — the canonical rule that the `mise-motion-polish` skill's persistence-gate section enforces
