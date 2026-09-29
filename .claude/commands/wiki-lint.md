---
description: Health-check the Intently wiki per wiki/AGENTS.md lint workflow. Reports findings; fixes nothing without approval.
---

Run the **Lint** workflow defined in `wiki/AGENTS.md`.

Output a numbered list of findings under these headings (omit a heading if it has no findings):

1. **Missing pages** — entries listed in `wiki/index.md` whose files don't exist.
2. **Orphan pages** — pages in `wiki/` with zero inbound `[[wikilinks]]` from other pages.
3. **Stale pages** — frontmatter `updated:` older than 90 days, OR explicit `status: stale`.
4. **Missing frontmatter** — pages without the required `type` / `status` / `updated` fields.
5. **Concepts mentioned 3+ times that lack their own page** — candidates for promotion from index's "Pending pages" section.
6. **Contradictions** — pages that make incompatible claims (e.g. one says X, another says not-X).

After the findings, suggest concrete fixes. **Do not apply any fix until I pick which to do.**

Append a `## [YYYY-MM-DD] lint | findings` entry to `wiki/log.md` summarizing the counts (e.g. "2 orphans, 1 stale, 0 contradictions"). One log entry per lint run, not per finding.

Constraints:

- Read-only first. No edits during the analysis pass.
- If the wiki is in good shape, say so explicitly. Don't invent findings.
- Use `grep`/`find`/`rg` for the structural checks (orphans, missing frontmatter); reserve LLM judgment for contradictions and concept-promotion candidates.
