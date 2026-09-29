---
type: concept
status: removed
updated: 2026-06-09
sources: [snoopy-sonnet-plan]
tags: [theming, design-system, tokens, embeddable, css-variables]
---

> **REMOVED (2026-06-09).** The multi-theme feature (the "OG company inc" skin, the
> `?theme=`/`NEXT_PUBLIC_THEME` switch, and the in-header switcher) was cut — the demo
> uses the single Intently skin only. The token *architecture* below (one block of CSS
> custom properties under `[data-intently-next]`) still describes how `theme.css` is
> built and remains a valid path if per-brand theming returns. The `og` token block and
> switcher no longer exist in code.

# theming-tokens

How the [[next-overlay-ux]] is **re-skinned per host store** without forking the UI: every colour, radius, elevation, motion duration and font is a **CSS custom property** scoped under `[data-intently-next][data-intently-theme="…"]`. Intently's signature lives in *structure + motion + the explained card*; only the token layer changes per brand. Defined in `intently/src/app/next/theme.css`.

This is the embeddable answer to "can it match our look and feel?" — yes, by mapping the host's brand to one block of tokens. A live **Theme** switcher in the overlay header and a `?theme=` deep-link demonstrate it.

## The split: signature vs themeable

- **Always Intently (not tokenised):** the explained card layout, the "understood" chips, the re-rank diff choreography, the calm pacing, the layout rhythm. These read as Intently regardless of palette.
- **Themeable (token-driven):** `--nx-surface*`, `--nx-ink*`, `--nx-muted`, `--nx-line*`, `--nx-accent*`, `--nx-positive`, radius (`--nx-r-*`), elevation (`--nx-shadow-*`), motion (`--nx-dur*`, `--nx-ease*`), and fonts (`--nx-font-display` / `--nx-font-sans`).

The base block on `[data-intently-next]` ships the default **Intently** skin (warm paper, near-black ink, one Nordic-pine accent, Cormorant + Inter — the fonts the root `layout.tsx` already loads).

## A separate "comprehension" accent

CTAs and the understood-chips/diff banner are *different* token families, so a host can colour the comprehension layer independently of buttons:

- `--nx-accent` / `--nx-accent-deep` / `--nx-accent-tint` → CTAs, send, launch, best-match ring.
- `--nx-chip-accent` / `--nx-chip-tint` / `--nx-chip-ink` → the "understood" chips + the diff banner. Default: track the accent.

This granularity is what lets the demo theme below run **orange CTAs + a green comprehension layer** from the same component.

## Adding a host theme (worked example: "OG company inc")

A whole re-skin is one selector block — no component changes:

```css
[data-intently-next][data-intently-theme='og'] {
  --nx-accent: #b5470a;        /* orange — CTAs */
  --nx-chip-accent: #2f7d3a;   /* green — comprehension layer */
  --nx-font-display: 'Fraunces', Georgia, serif;
  --nx-font-sans: 'Space Grotesk', system-ui, sans-serif;
  /* …surface / ink / line / radius overrides… */
}
```

Steps to tailor for a real customer: (1) drop a `[data-intently-theme="<brand>"]` block overriding the tokens; (2) provide brand fonts (the demo `@import`s Fraunces/Space Grotesk; a real embed would inherit the store's font stack or load host fonts only when that theme is active); (3) keep **WCAG AA** contrast — orange-on-white is the trap, so the demo uses `#b5470a` (≈5.4:1 with white) rather than a brighter orange that fails on buttons. Effort is on the order of minutes, not a rebuild.

## Wiring

- The overlay root sets `data-intently-theme={theme}` (state in `NextExperience.tsx`); the switcher flips it live; `?theme=og` presets it for screenshots/deep-links.
- Because tokens cascade from that one attribute, switching themes is a single attribute change — no re-render of structure, no asset swap.

## Cost note

The OG font `@import` currently loads on every `/next` visit (both themes). For production, load host fonts only when their theme is active, or let the embed inherit the storefront's typography — the token model supports either.

## Related

- [[next-overlay-ux]] — the UX these tokens skin
- [[river-architecture]] — the older surface, styled with fixed Tailwind `intently-*` colours rather than overridable tokens
