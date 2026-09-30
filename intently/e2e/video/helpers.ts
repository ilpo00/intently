// Shared helpers for the video scenes: human-paced input and a visible pointer.
// Playwright's recorded video does not draw the OS cursor, so a small dot is
// injected into the page and moved with the real mouse events.

import type { Locator, Page } from '@playwright/test'

export const beat = (page: Page, ms: number) => page.waitForTimeout(ms)

/** Draw a pointer that follows the mouse, so clicks are readable on video. */
export async function showPointer(page: Page) {
  await page.addInitScript(() => {
    const install = () => {
      if (document.getElementById('__video_pointer')) return
      const dot = document.createElement('div')
      dot.id = '__video_pointer'
      Object.assign(dot.style, {
        position: 'fixed', zIndex: '2147483647', pointerEvents: 'none',
        width: '22px', height: '22px', borderRadius: '50%',
        background: 'rgba(28,107,84,0.28)', border: '2px solid rgba(28,107,84,0.9)',
        transform: 'translate(-50%, -50%)', left: '-40px', top: '-40px',
        transition: 'width 120ms, height 120ms, background 120ms',
      })
      document.documentElement.appendChild(dot)
      window.addEventListener('mousemove', e => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px` }, true)
      window.addEventListener('mousedown', () => { dot.style.width = '14px'; dot.style.height = '14px'; dot.style.background = 'rgba(28,107,84,0.6)' }, true)
      window.addEventListener('mouseup', () => { dot.style.width = '22px'; dot.style.height = '22px'; dot.style.background = 'rgba(28,107,84,0.28)' }, true)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install)
    else install()
  })
}

/** Enlarge the live app for a 1080p frame (the UI is designed for a laptop
 *  viewport and sits small in 1920×1080). Cards set their own sizes and are
 *  rendered with setContent, so they are left alone. */
export async function zoomApp(page: Page, factor = Number(process.env.VIDEO_ZOOM || 1.25)) {
  await page.addInitScript((z) => {
    const apply = () => {
      if (location.protocol === 'about:' || location.protocol === 'data:') return
      document.documentElement.style.zoom = String(z)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply)
    else apply()
  }, factor)
}

/** Glide the pointer to an element, pause, then click — no teleporting. */
export async function glideClick(page: Page, target: Locator, opts: { pause?: number } = {}) {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('glideClick: target has no bounding box')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 })
  await beat(page, opts.pause ?? 350)
  // Playwright's click picks a point that really hits the element (a link that
  // wraps onto two lines has a bounding-box centre in empty space).
  await target.click({ delay: 70 })
}

/** Type like a person: a steady pace with small pauses at word boundaries. */
export async function humanType(page: Page, target: Locator, text: string) {
  await glideClick(page, target, { pause: 200 })
  for (const ch of text) {
    await page.keyboard.type(ch)
    await beat(page, ch === ' ' ? 95 : ch === ',' ? 220 : 46)
  }
}

/** Smooth scroll inside the page (or a scroll container) so text stays readable. */
export async function slowScroll(page: Page, container: Locator | null, by: number, ms = 1600) {
  const steps = Math.max(12, Math.round(ms / 40))
  for (let i = 0; i < steps; i++) {
    if (container) await container.evaluate((el, d) => { el.scrollTop += d }, by / steps)
    else await page.mouse.wheel(0, by / steps)
    await beat(page, ms / steps)
  }
}

// ── On-screen text ───────────────────────────────────────────────────────────
// Captions and cards are rendered in the page (and so recorded), because the
// assembly step only cuts and joins — it does not draw text.

const CARD_CSS = `
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body {
    background: #fbfaf8; color: #1a1b19; display: grid; place-items: center;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  }
  .card { width: 1320px; }
  .eyebrow { font-size: 22px; letter-spacing: 0.18em; text-transform: uppercase; color: #1c6b54; font-weight: 600; margin-bottom: 28px; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: 84px; line-height: 1.12; letter-spacing: -0.01em; }
  p.sub { font-size: 32px; line-height: 1.45; color: #3a3c38; margin-top: 32px; max-width: 1100px; }
  table { width: 100%; border-collapse: collapse; margin-top: 44px; font-size: 30px; }
  td { padding: 22px 0; border-top: 1px solid #d3cec3; vertical-align: baseline; }
  td.v { text-align: right; font-weight: 600; white-space: nowrap; padding-left: 40px; font-variant-numeric: tabular-nums; }
  tr.weak td { color: #8a3b12; }
  .status { font-size: 18px; letter-spacing: 0.12em; text-transform: uppercase; color: #63625b; margin-left: 14px; font-weight: 600; }
  .url { font-size: 40px; color: #134a3a; margin-top: 40px; font-weight: 500; }
`

/** A full-screen card (title, evidence, end). `body` is trusted, local HTML. */
export async function showCard(page: Page, body: string) {
  await page.setContent(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${CARD_CSS}</style></head><body><div class="card">${body}</div></body></html>`,
  )
}

/** A lower-third caption over the live app. Pass null to remove it. */
export async function caption(page: Page, text: string | null) {
  await page.evaluate((t) => {
    let el = document.getElementById('__video_caption')
    if (!t) { el?.remove(); return }
    if (!el) {
      el = document.createElement('div')
      el.id = '__video_caption'
      Object.assign(el.style, {
        position: 'fixed', left: '50%', bottom: '44px', transform: 'translateX(-50%)',
        zIndex: '2147483646', pointerEvents: 'none', maxWidth: '1300px',
        padding: '16px 30px', borderRadius: '12px',
        background: 'rgba(26,27,25,0.92)', color: '#fff',
        font: '500 30px/1.35 "Helvetica Neue", Helvetica, Arial, sans-serif',
        textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        opacity: '0', transition: 'opacity 400ms ease',
      })
      document.documentElement.appendChild(el)
    }
    el.textContent = t
    requestAnimationFrame(() => { el!.style.opacity = '1' })
  }, text)
}
