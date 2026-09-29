# AGENTS.md — wiki schema

> **Update discipline lives in `intently/CLAUDE.md` under "Project wiki" — the "DO NOT update for" list there is the canonical source. This file documents HOW to update; CLAUDE.md says WHEN.**

This is the schema for the Intently wiki. Read this once at the start of any wiki session. It tells you (the LLM) what the wiki is, how it's organised, and what workflows to follow when ingesting sources, answering questions, or maintaining the wiki.

The user (Ilmari) is in charge of sourcing, exploration, and asking questions. You do all the writing — summaries, cross-references, page updates, log entries. The user reads.

## Purpose

A persistent, compounding knowledge base for Intently. Goal: when a Claude Code session asks "where is X" or "why is Y this way", you find the answer in this wiki in 1–2 page reads instead of grepping the source tree. Saves tokens. Preserves rationale across sessions.

The wiki is **not** a paraphrase of the code. The code is the source of truth for what code does. The wiki captures: rationale (why), conventions (how we do it here), entity overviews (what is X, where does it live), decisions (what we chose and why), and synthesis across multiple sources.

## Directory structure

```
wiki/
  AGENTS.md          # this file (schema)
  index.md           # catalog — read this first when answering a query
  log.md             # chronological record of ingests, queries, lints (append-only)
  entities/          # files, modules, hooks, components — anything you'd link to from code
  concepts/          # patterns, architectural shapes, mental models
  decisions/         # ADR-style records of choices and tradeoffs
  sources/           # ingested external/internal documents — summarized, not stored verbatim
```

Add new top-level folders only if a real category emerges that doesn't fit the four above. Don't create folders speculatively.

## File naming

- Lowercase, kebab-case, `.md` extension.
- Entity pages: name matches the symbol or file (`intently-store.md`, `use-chat.md`, `scripted-ai.md`). Drop file extensions and `src/` prefixes.
- Concept pages: short noun phrase (`river-architecture.md`, `ai-mode-toggle.md`).
- Decision pages: `<slug>.md` describing the decision (`dependency-pinning.md`).
- Source pages: derive from the source path (`claude-md.md`, `design-md.md`, `roadmap-md.md`).

## Page format

Every page starts with YAML frontmatter, then a `# Title`, then content. Required frontmatter:

```yaml
---
type: entity | concept | decision | source
status: draft | stable | stale
updated: 2026-MM-DD
sources: [list of source-page slugs that informed this page]
tags: [free-form, lowercased]
---
```

Body conventions:
- First paragraph is a one-line definition / TL;DR. The user (or future you) should be able to skim this and skip the rest if it answers them.
- Use Obsidian-style `[[wikilinks]]` for cross-references. They render as graph edges in Obsidian and let you navigate without grep.
- Cite source files with bare backticks: `` `src/store/intently-store.ts` ``. Cite the section of an ingested doc with `[[source-name]]`.
- Don't repeat code verbatim. Quote 5 lines max, only when the code itself is the point. Otherwise describe.
- If a claim came from a specific source, note it in-line: "(per [[claude-md]])".

## Cross-link rules

- Every page MUST link to at least one other wiki page (entity → concept, concept → decisions, etc.). Orphan pages get caught by `lint`.
- When you create or update a page, update the **inbound** links on related pages too. Bookkeeping is your job.
- `index.md` lists every page once, grouped by type, with a one-line summary.

## Workflows

### Ingest

When the user asks you to ingest a source (a doc, an article, a transcript, a Slack thread):

1. **Read the source.** All of it. Don't sample.
2. **Discuss key takeaways with the user** before writing — 3–5 bullets, ask if anything else stands out to them.
3. **Create `sources/<source-slug>.md`** with: the source path, date ingested, a 5–15 line summary, and a list of the entities/concepts/decisions you'll create or touch.
4. **Create or update entity / concept / decision pages** that the source informs. A single source typically touches 5–15 wiki pages — that's normal.
5. **Update `index.md`** with any new pages.
6. **Append an entry to `log.md`** of the form `## [YYYY-MM-DD] ingest | <source>` followed by a 1–3 line summary of what changed.

Do not skip step 6. The log is how the user (and you, next session) reconstruct what's been done.

### Query

When the user asks a question against the wiki:

1. **Read `index.md` first.** Find pages whose summaries match the question.
2. **Read those pages.** If they cite source files, you may re-read the source for ground truth — but the wiki should answer most "what" and "why" questions on its own.
3. **Answer with citations** to wiki pages (`[[intently-store]]`) and source files (`src/store/intently-store.ts`).
4. **If the answer is a substantial synthesis**, ask the user whether to file it back as a new wiki page (a comparison, an analysis, a connection). Good answers should compound, not vanish into chat.
5. **Append to `log.md`** if a new page was created or a non-trivial update happened. Don't log every read.

### Lint

When the user asks for a wiki health check:

1. Run through `index.md` and check every page exists.
2. For each page, verify: at least one inbound link, frontmatter present, `updated` field within the last 90 days (older = flag as `stale`).
3. List orphan pages (no inbound links).
4. List concepts mentioned 3+ times across the wiki that lack their own page.
5. List contradictions between pages (e.g. one page says X, another says not-X).
6. List frontmatter `status: stale` pages.
7. Suggest concrete fixes — write the fixes only after the user picks which to apply.
8. Append a `## [YYYY-MM-DD] lint` entry to `log.md` with the findings.

## What goes in vs out

**In-wiki:**
- Architectural rationale ("why Zustand and not Redux")
- Conventions and gotchas ("never prop-drill more than 2 levels")
- Entity overviews with file pointers
- Decision records (security pins, library choices, tradeoffs)
- Summaries of design docs and external sources
- Cross-cutting patterns (river architecture, AI mode toggle)

**Out-of-wiki:**
- Verbatim code (link to the file instead)
- Paraphrased function signatures (the file is canonical)
- TODO lists (use the project tracker, not this wiki)
- Per-PR notes (use git history)
- The CLAUDE.md root file itself — that's a session-config file, not a wiki page. The wiki may reference it via [[claude-md]] (an ingested-source page) but should not duplicate it.

## Token-budget rules

The whole point of this wiki is to save tokens vs reading raw source. Keep pages tight.

- Entity / concept / decision pages: aim for 50–120 lines. If a page exceeds 200 lines, split it.
- `index.md` entries: one line per page. The full index should fit in a single read.
- Source summaries: 5–15 lines, no more. The source itself is the canonical doc.

## When in doubt

Ask the user. Don't invent structure. The schema co-evolves with use — propose changes here, get them approved, then apply them.
