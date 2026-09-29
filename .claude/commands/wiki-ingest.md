---
description: Ingest a source file into the Intently wiki per wiki/AGENTS.md workflow.
argument-hint: <path-to-source>
---

Ingest the source at `$ARGUMENTS` into the wiki at `wiki/`.

Follow the **Ingest** workflow defined in `wiki/AGENTS.md` (steps 1–6):

1. Read the entire source file.
2. **Stop here.** Discuss 3–5 key takeaways with me as a numbered list. Ask whether anything else stands out before writing any pages.
3. (After I respond) Create `wiki/sources/<source-slug>.md` per the page format in AGENTS.md.
4. Create or update entity / concept / decision pages the source informs. A single source typically touches 5–15 wiki pages.
5. Update `wiki/index.md` with new pages, grouped by section.
6. Append an entry to `wiki/log.md` of the form `## [YYYY-MM-DD] ingest | <source>` with a 1–3 line summary of what changed and which pages were created or modified.

Constraints:

- Do not skip the discussion stop after step 1. Ingest is collaborative, not autonomous.
- Use Obsidian-style `[[wikilinks]]` for all cross-references.
- Required YAML frontmatter on every new page (see AGENTS.md).
- Page length budget: 50–120 lines for entity/concept/decision pages; 5–15 lines for source summaries.
- The code is canonical for what code does. The wiki captures rationale, conventions, decisions, and synthesis. Do not paraphrase code line-by-line.
