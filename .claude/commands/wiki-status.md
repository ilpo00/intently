---
description: Quick status of the Intently wiki — last 5 log entries plus index counts. No analysis.
---

Print a structural snapshot of the wiki. **No LLM analysis, no synthesis** — just shell output formatted for me.

Run these in order and print each result clearly labelled:

1. **Last 5 log entries** — `grep "^## \[" wiki/log.md | tail -5`
2. **Page counts by type** — `find wiki -type f -name "*.md" -not -name "AGENTS.md" -not -name "index.md" -not -name "log.md" | sed 's|/[^/]*$||' | sort | uniq -c`
3. **Pending pages from index** — `awk '/^## Pending pages/,/^## /' wiki/index.md | grep -E "^- " | head -20`
4. **Total wiki word count** — `find wiki -name "*.md" -exec cat {} + | wc -w`

That's it. No commentary, no recommendations. If I want a health check I'll run `/wiki-lint`.
