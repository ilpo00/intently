---
type: decision
status: stable
updated: 2026-05-05
sources: [claude-md]
tags: [security, dependencies, peer-deps]
---

# dependency-pinning

`next`, `react`, `react-dom`, `@types/react`, `@types/react-dom` are pinned exactly (no `^`, no `~`). This is deliberate. Do not "modernize" the version strings in `intently/package.json`.

## Why pinned (security)

`next`, `react`, `react-dom` are the minimum patched versions for two CVEs:

- **CVE-2025-66478** — Next.js advisory
- **CVE-2025-55182** — React advisory

Floating to `^x.y.z` would resolve to ranges that include vulnerable patches in some npm cache states. Exact pins eliminate that surface. Rationale and links live in `intently/package.json` under `securityNotes`, plus `intently/README.md`.

## Why pinned (peer-dep stability)

`@types/react` and `@types/react-dom` are pinned exactly to avoid `@testing-library/react`'s peer-dep resolver pulling in `@types/react@18` against React 19. The mismatch produces a wave of compile errors in tests that look unrelated to the upgrade.

## Upgrade rule

When upgrading, **bump these together**, in one PR:

- `next`
- `react`
- `react-dom`
- `@types/react`
- `@types/react-dom`
- `eslint-config-next`

Bumping a subset is what causes the peer-dep error. Read the `securityNotes` block in `package.json` before changing any of them.

## Related

- [[claude-md]] — same rule, in the project guidance file
- `intently/package.json` `securityNotes` — canonical record of CVEs and rationale
- `intently/README.md` — public-facing version of the same info
