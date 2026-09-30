// ─────────────────────────────────────────────
// The short portfolio tour (~90 s), one continuous take with subtitles:
//   brief → adjustment → Studio correction → adjustment in the SAME conversation.
//
// The Studio opens in a second browser window that carries the same session
// cookie, so it edits the same visitor sandbox and the shopper conversation is
// still there when we come back. (A second *tab* made Chrome shrink the shop
// tab's capture on return.) Each window records its own video; this test writes
// out/timeline.json (which part of which tab to show, and every subtitle with
// its time) and scripts/video/assemble.mjs cuts the final film from it.
// ─────────────────────────────────────────────

import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beat, glideClick, showCard, showPointer, zoomApp } from './helpers'

const OUT = join(__dirname, 'out')
const BRIEF = 'A dress for a garden party, no florals'
const ADJUST_1 = 'something in red'
const ADJUST_2 = 'for an evening event'

type Tab = 'shop' | 'studio'
interface Segment { tab: Tab; from: number; to: number }
interface Cue { text: string; tab: Tab; at: number }

test('tour — the short cut', async ({ browser }) => {
  test.setTimeout(240_000)
  mkdirSync(join(OUT, 'tabs'), { recursive: true })
  const windowOptions = {
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: join(OUT, 'tabs'), size: { width: 1920, height: 1080 } },
    colorScheme: 'light' as const,
    locale: 'en-GB',
  }
  const context = await browser.newContext(windowOptions)

  const t0: Record<Tab, number> = { shop: 0, studio: 0 }
  const segments: Segment[] = []
  const cues: Cue[] = []
  const now = (tab: Tab) => (Date.now() - t0[tab]) / 1000

  // A subtitle, shown in the page (so it is in the footage) and logged (so the
  // assembler can also write a matching .vtt). null clears it.
  async function say(page: Page, tab: Tab, text: string | null) {
    cues.push({ text: text ?? '', tab, at: now(tab) })
    await page.evaluate((t) => {
      let el = document.getElementById('__video_caption')
      if (!t) { el?.remove(); return }
      if (!el) {
        el = document.createElement('div')
        el.id = '__video_caption'
        Object.assign(el.style, {
          // The page itself is zoomed for the video; sizes here are pre-zoom.
          position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)',
          zIndex: '2147483646', pointerEvents: 'none', maxWidth: '1180px', width: 'max-content',
          padding: '12px 26px', borderRadius: '10px',
          background: 'rgba(26,27,25,0.94)', color: '#fff',
          font: '500 24px/1.35 "Helvetica Neue", Helvetica, Arial, sans-serif',
          textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        })
        document.documentElement.appendChild(el)
      }
      el.textContent = t
    }, text)
  }

  /** Outline an element so the viewer's eye goes to it. */
  async function spotlight(page: Page, selector: string, on = true) {
    await page.evaluate(([sel, show]) => {
      const el = document.querySelector(sel as string) as HTMLElement | null
      if (!el) return
      el.style.transition = 'box-shadow 300ms ease, outline-color 300ms ease'
      el.style.outline = show ? '4px solid #e3a54a' : ''
      el.style.outlineOffset = show ? '4px' : ''
      el.style.boxShadow = show ? '0 0 0 12px rgba(227,165,74,0.25)' : ''
      el.style.borderRadius = el.style.borderRadius || '12px'
    }, [selector, on] as const)
  }

  async function settled(page: Page) {
    await expect(page.locator('.nx-canvas .nx-vask, .nx-canvas .nx-grid').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.nx-thinking')).toHaveCount(0, { timeout: 30_000 })
  }
  async function type(page: Page, text: string, perChar = 55) {
    for (const ch of text) { await page.keyboard.type(ch); await beat(page, ch === ' ' ? 80 : perChar) }
  }

  // ── SHOP tab ─────────────────────────────────────────────────────
  const shop = await context.newPage()
  t0.shop = Date.now()
  await showPointer(shop)
  const segFrom = 0.4

  await showCard(shop, `
    <div class="eyebrow">Intently</div>
    <h1>Describe a situation.<br>Get a short list — with reasons.</h1>`)
  await beat(shop, 3500)

  await zoomApp(shop)
  await shop.goto('/')
  const input = shop.locator('.nx-landing input').first()
  await expect(input).toBeVisible()
  await say(shop, 'shop', 'A shopper describes a situation, in their own words.')
  await glideClick(shop, input, { pause: 200 })
  await type(shop, BRIEF)
  await beat(shop, 500)
  await shop.keyboard.press('Enter')
  await settled(shop)

  // A thin brief gets one question first — answer it with a tap.
  const tile = shop.locator('.nx-canvas .nx-vask__tile').first()
  if (await tile.isVisible().catch(() => false)) {
    await say(shop, 'shop', 'If the brief is thin, it asks one question first.')
    await beat(shop, 2200)
    await glideClick(shop, tile)
    await settled(shop)
  }
  await expect(shop.locator('.nx-canvas .nx-grid').first()).toBeVisible()
  await say(shop, 'shop', 'Then a short list — each piece with the reason it fits.')
  await beat(shop, 7000)

  // Adjustment 1.
  const refine = shop.getByPlaceholder(/Refine/)
  await say(shop, 'shop', 'Adjust it in plain words.')
  await glideClick(shop, refine, { pause: 200 })
  await type(shop, ADJUST_1)
  await beat(shop, 400)
  await shop.keyboard.press('Enter')
  await settled(shop)
  await say(shop, 'shop', 'The list re-ranks in place: red first.')
  await beat(shop, 5500)

  // Pick the piece to correct: the first card whose name is unique on screen,
  // so its disappearance later is unmistakable.
  const target = await shop.evaluate(() => {
    const cards = [...document.querySelectorAll('.nx-canvas .nx-grid:not(.nx-grid--addons) > *')] as HTMLElement[]
    const info = cards.map((c, i) => {
      const img = c.querySelector('.nx-card__img') as HTMLImageElement | null
      const id = /\/catalog\/(\d+)\.webp/.exec(img?.getAttribute('src') ?? '')?.[1]
      return { i, name: img?.alt ?? '', id: id ? `cat-${id}` : null }
    })
    const pick = info.find(x => x.id && info.filter(y => y.name === x.name).length === 1) ?? info[0]
    cards[pick.i].id = '__video_target'
    return pick
  })
  if (!target.id) throw new Error('could not resolve the product to correct')
  const targetName = target.name
  await shop.locator('#__video_target').scrollIntoViewIfNeeded()
  await spotlight(shop, '#__video_target')
  await say(shop, 'shop', `The ${targetName} is listed as a solid colour.`)
  await beat(shop, 5000)
  segments.push({ tab: 'shop', from: segFrom, to: now('shop') })

  // ── STUDIO window (same visitor session: the sandbox cookie is copied) ──
  const studioContext = await browser.newContext(windowOptions)
  await studioContext.addCookies(await context.cookies())
  const studio = await studioContext.newPage()
  t0.studio = Date.now()
  await showPointer(studio)
  await zoomApp(studio)
  await studio.goto(`/admin/enrichment/studio?product=${encodeURIComponent(target.id)}`)
  await expect(studio.getByText('Public demo').first()).toBeVisible()
  const studioFrom = now('studio')
  await say(studio, 'studio', 'Behind the shop: the Studio, where the catalogue is curated.')
  await beat(studio, 5500)

  const pattern = studio.getByPlaceholder('solid')
  await pattern.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  await beat(studio, 1200)
  // Spotlight the Pattern field (its wrapper holds the label and the input).
  await pattern.evaluate(el => { (el.parentElement as HTMLElement).id = '__video_field' })
  await spotlight(studio, '#__video_field')
  await say(studio, 'studio', 'A merchandiser corrects one attribute: the pattern.')
  await beat(studio, 3000)
  await glideClick(studio, pattern, { pause: 250 })
  await studio.keyboard.press('ControlOrMeta+a')
  await beat(studio, 400)
  await type(studio, 'floral', 110)
  await say(studio, 'studio', 'Pattern: “solid” → “floral”.')
  await beat(studio, 3000)
  await glideClick(studio, studio.getByRole('button', { name: /Save to my session|Save & re-embed/ }))
  await expect(studio.getByRole('status').filter({ hasText: /Saved to your session/ })).toBeVisible({ timeout: 20_000 })
  await spotlight(studio, '#__video_field', false)
  await say(studio, 'studio', 'Saved — for this visitor only.')
  await beat(studio, 4500)
  segments.push({ tab: 'studio', from: studioFrom, to: now('studio') })
  const studioVideo = studio.video()
  await studioContext.close() // flushes the Studio recording

  // ── back to SHOP: same conversation, one more adjustment ─────────
  const backFrom = now('shop')
  await spotlight(shop, '#__video_target', false)
  await say(shop, 'shop', 'Back in the same conversation — remember: “no florals”.')
  await beat(shop, 4000)
  await glideClick(shop, refine, { pause: 200 })
  await type(shop, ADJUST_2)
  await beat(shop, 400)
  await shop.keyboard.press('Enter')
  await settled(shop)
  // The corrected piece must be gone — the video must not claim what did not happen.
  await expect(shop.locator(`.nx-canvas .nx-grid:not(.nx-grid--addons) img[src*="${target.id.replace('cat-', '')}"]`)).toHaveCount(0)
  await say(shop, 'shop', `The ${targetName} is gone — it is floral now.`)
  await beat(shop, 4500)
  await say(shop, 'shop', 'One correction in the Studio. The answer changed.')
  await beat(shop, 4000)
  await say(shop, 'shop', null)

  const url = (process.env.VIDEO_PUBLIC_URL || '').replace(/^https?:\/\//, '')
  await showCard(shop, `
    <div class="eyebrow">Intently</div>
    <h1>The code decides.<br>The model only phrases.</h1>
    ${url ? `<div class="url">Try it: ${url}</div>` : ''}`)
  await beat(shop, 6000)
  segments.push({ tab: 'shop', from: backFrom, to: now('shop') })

  const shopVideo = shop.video()
  await context.close() // flushes both videos
  const studioPath = await studioVideo!.path()
  const shopPath = await shopVideo!.path()

  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({
    videos: { shop: shopPath, studio: studioPath },
    segments,
    cues,
  }, null, 2))
})
