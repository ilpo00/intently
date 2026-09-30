// ─────────────────────────────────────────────
// The portfolio tour, scene by scene — see docs/video/storyboard.md.
// Each test records one clip to e2e/video/out/raw/<scene>/video.webm.
// Run one scene:  npm run video:record -- -g "02"
// ─────────────────────────────────────────────

import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beat, caption, glideClick, humanType, showCard, showPointer, slowScroll, zoomApp } from './helpers'

const BRIEF = 'A black dress for a party, it might get cold later'
const REFINE = 'nothing with a print'
const NO_FLORALS = 'A dress for a garden party, no florals'

test.beforeEach(async ({ page }) => {
  await showPointer(page)
  await zoomApp(page)
})

const landingInput = (page: Page) => page.locator('.nx-landing input').first()
const refineInput = (page: Page) => page.getByPlaceholder(/Refine/)
// Scoped to the desktop canvas: the thread also holds a (hidden) mobile grid.
const grid = (page: Page) => page.locator('.nx-canvas .nx-grid').first()

/** Wait for a turn to settle: either a question or a shortlist is on screen. */
async function turnSettled(page: Page) {
  await expect(page.locator('.nx-canvas .nx-vask, .nx-canvas .nx-grid').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.nx-thinking')).toHaveCount(0, { timeout: 30_000 })
}

/** Answer blocking questions (first option) until the shortlist shows. */
async function answerUntilShortlist(page: Page, pause = 1800) {
  for (let i = 0; i < 3; i++) {
    if (await grid(page).isVisible().catch(() => false)) return
    const tile = page.locator('.nx-canvas .nx-vask__tile').first()
    if (!(await tile.isVisible().catch(() => false))) break
    await beat(page, pause)
    await glideClick(page, tile)
    await turnSettled(page)
  }
  await expect(grid(page)).toBeVisible({ timeout: 30_000 })
}

test('00 title card', async ({ page }) => {
  await showCard(page, `
    <div class="eyebrow">Intently</div>
    <h1>People shop for a situation.<br>Shops ask for a category.</h1>
    <p class="sub">A working system that answers the situation — and explains its picks.</p>`)
  await beat(page, 6000)
})

test('01 landing — the problem', async ({ page }) => {
  await page.goto('/')
  await expect(landingInput(page)).toBeVisible()
  await beat(page, 7000) // hold: the placeholder cycles through situations
  await humanType(page, landingInput(page), BRIEF)
  await beat(page, 1200)
  await page.keyboard.press('Enter')
  await turnSettled(page)
  await beat(page, 2500)
})

test('02 consult and shortlist', async ({ page }) => {
  await page.goto('/')
  await landingInput(page).fill(BRIEF)
  await page.keyboard.press('Enter')
  await turnSettled(page)
  await beat(page, 2500)
  await caption(page, 'One or two questions. Then a short list, with reasons.')
  await answerUntilShortlist(page)
  await beat(page, 3500) // read the first why-lines

  const canvas = page.locator('.nx-canvas')
  await page.mouse.move(1250, 620, { steps: 20 })
  await slowScroll(page, canvas, 520, 3200)
  await beat(page, 2500)
  // Down to the "complete the look" rail, if the situation earned one.
  const rail = page.locator('.nx-canvas .nx-addons').first()
  if (await rail.count()) {
    await rail.scrollIntoViewIfNeeded()
    await beat(page, 4500)
  }
  await canvas.evaluate(el => el.scrollTo({ top: 0, behavior: 'smooth' }))
  await beat(page, 1500)

  await caption(page, null)
  await humanType(page, refineInput(page), REFINE)
  await beat(page, 700)
  await page.keyboard.press('Enter')
  await turnSettled(page)
  await caption(page, 'A stated exclusion is a hard rule. It is never broken.')
  await beat(page, 5000) // the grid re-ranks in place
})

test('03 studio — curate, then the recommendation changes', async ({ page }) => {
  // BEFORE: the shortlist for a "no florals" brief.
  await page.goto('/')
  await landingInput(page).fill(NO_FLORALS)
  await page.keyboard.press('Enter')
  await turnSettled(page)
  await answerUntilShortlist(page, 1200)
  await beat(page, 3500)

  // Curate a piece the viewer can recognise again: the first card whose name
  // is unique in this shortlist (colour variants share a name and look alike).
  const target = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.nx-canvas .nx-grid:not(.nx-grid--addons) .nx-card__img')] as HTMLImageElement[]
    const names = cards.map(c => c.alt)
    const idx = names.findIndex(n => names.filter(x => x === n).length === 1)
    const img = cards[Math.max(idx, 0)]
    const id = /\/catalog\/(\d+)\.webp/.exec(img.getAttribute('src') ?? '')?.[1]
    return { index: Math.max(idx, 0), name: img.alt, id: id ? `cat-${id}` : null }
  })
  if (!target.id) throw new Error('could not resolve the product id to curate')
  const card = page.locator('.nx-canvas .nx-grid:not(.nx-grid--addons) .nx-card__img').nth(target.index)
  await card.scrollIntoViewIfNeeded()
  const box = await card.boundingBox()
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 30 })
  await beat(page, 3000) // "this one"

  // THE STUDIO: what sits behind the answer.
  await page.goto(`/admin/enrichment/studio?product=${encodeURIComponent(target.id)}`)
  await expect(page.getByText('Public demo').first()).toBeVisible()
  await caption(page, 'The Studio: where the business steers it.')
  await beat(page, 4500) // the banner, the pipeline ribbon, the product
  await page.mouse.move(1100, 700, { steps: 20 })
  await slowScroll(page, null, 700, 3500) // provenance: product data vs read-from-photo
  await beat(page, 3000)

  await caption(page, null)
  const pattern = page.getByPlaceholder('solid')
  await pattern.scrollIntoViewIfNeeded()
  await beat(page, 1500)
  await glideClick(page, pattern)
  await page.keyboard.press('ControlOrMeta+a')
  await beat(page, 300)
  for (const ch of 'floral') { await page.keyboard.type(ch); await beat(page, 90) }
  await beat(page, 900)
  await glideClick(page, page.getByRole('button', { name: /Save to my session|Save & re-embed/ }))
  await expect(page.getByRole('status').filter({ hasText: /Saved to your session/ })).toBeVisible({ timeout: 20_000 })
  await beat(page, 4000)

  // AFTER: the same brief no longer offers it.
  await glideClick(page, page.getByRole('link', { name: /Open the shopper view/ }))
  await expect(landingInput(page)).toBeVisible()
  await beat(page, 1200)
  await humanType(page, landingInput(page), NO_FLORALS)
  await beat(page, 800)
  await page.keyboard.press('Enter')
  await turnSettled(page)
  await answerUntilShortlist(page, 1200)
  await expect(page.locator(`.nx-canvas .nx-grid:not(.nx-grid--addons) img[src*="${target.id.replace('cat-', '')}"]`)).toHaveCount(0)
  await caption(page, 'One edit in the Studio. The recommendation changes.')
  await beat(page, 5500)
})

test('04 model bench — where the language model sits', async ({ page }) => {
  await page.goto('/admin/enrichment/studio/models')
  await expect(page.getByRole('heading', { name: 'Model bench' })).toBeVisible()
  await beat(page, 3500)
  await glideClick(page, page.getByRole('button', { name: /nothing too loud/ }))
  await beat(page, 900)
  await glideClick(page, page.getByRole('button', { name: 'Run probe' }))
  await expect(page.getByText(/Recorded result/).first()).toBeVisible({ timeout: 20_000 })
  await caption(page, 'The code decides. The model only phrases.')
  await beat(page, 2500)
  await page.mouse.move(960, 700, { steps: 20 })
  await slowScroll(page, null, 520, 3500) // parsed context → engine answer → re-voiced prose
  await beat(page, 6000)
})

// The numbers on this card are read from the committed scorecard at record
// time — the card cannot drift from the measurement.
function scorecardValue(md: string, rowStartsWith: string): string {
  const line = md.split('\n').find(l => l.replace(/\*/g, '').startsWith(`| ${rowStartsWith}`))
  if (!line) throw new Error(`scorecard row not found: ${rowStartsWith}`)
  return line.split('|')[2].replace(/\*/g, '').trim()
}

test('05 evidence — including the weak spot', async ({ page }) => {
  const md = readFileSync(join(__dirname, '..', '..', 'docs', 'eval-scorecard-latest.md'), 'utf8')
  const row = (label: string, startsWith: string, weak = false) =>
    `<tr${weak ? ' class="weak"' : ''}><td>${label}<span class="status">Measured</span></td><td class="v">${scorecardValue(md, startsWith)}</td></tr>`
  await showCard(page, `
    <div class="eyebrow">Measured on every change</div>
    <h1 style="font-size:64px">What holds, and what does not yet.</h1>
    <table>
      ${row('Stated exclusions honoured, shortlist and add-ons', 'Parsed exclusions honoured')}
      ${row('Prose naming a product that was not shown: rejected', 'Unshown product named in prose')}
      ${row('Correct prose wrongly rejected', 'Faithful prose wrongly rejected')}
      ${row('Promises the shop cannot keep, phrasings never seen before: caught', 'Action / fulfilment claim → rejected — held-out set', true)}
    </table>`)
  await beat(page, 14000)
})

test('06 end card', async ({ page }) => {
  const url = (process.env.VIDEO_PUBLIC_URL || '').replace(/^https?:\/\//, '')
  await showCard(page, `
    <div class="eyebrow">Intently</div>
    <h1>It is open. Try it.</h1>
    ${url ? `<div class="url">${url}</div>` : ''}
    <p class="sub">Shopper view and Studio, no sign-in. Source and write-up on GitHub.</p>`)
  await beat(page, 6000)
})
