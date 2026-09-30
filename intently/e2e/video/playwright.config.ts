// ─────────────────────────────────────────────
// Playwright config for the portfolio video footage (docs/video/storyboard.md).
// Not a test suite: each "test" is one scene, recorded at 1920×1080.
//
//   npm run video:record          # the short tour → e2e/video/out/ (VIDEO_TOUR=long for the 7-scene cut)
//
// Expects the app already running in public-demo mode on VIDEO_BASE_URL
// (default http://localhost:3101) — see .claude/launch.json
// "intently-public-demo", or:
//   INTENTLY_PUBLIC_DEMO=1 NEXT_PUBLIC_CATALOG=vision npm run dev -- --port 3101
// ─────────────────────────────────────────────

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  // Default: the short continuous tour. VIDEO_TOUR=long records the older
  // seven-scene cut (tour-long.scene.ts).
  testMatch: process.env.VIDEO_TOUR === 'long' ? /tour-long\.scene\.ts$/ : /tour\.scene\.ts$/,
  outputDir: './out/raw',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.VIDEO_BASE_URL || 'http://localhost:3101',
    // The Chrome already installed on this machine — no browser download.
    // (Set VIDEO_CHANNEL=chromium to use Playwright's bundled build instead.)
    channel: process.env.VIDEO_CHANNEL === 'chromium' ? undefined : 'chrome',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    video: { mode: 'on', size: { width: 1920, height: 1080 } },
    colorScheme: 'light',
    locale: 'en-GB',
    // A clean profile every run: no history, no personal data on screen.
    storageState: undefined,
  },
})
