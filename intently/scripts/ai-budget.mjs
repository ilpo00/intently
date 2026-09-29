// Show or reset the dev-mode AI budget. Run via:
//   npm run ai:budget          → status
//   npm run ai:budget:reset    → reset today's counts to zero

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const BUDGET_FILE = join(root, '.ai-budget.json')

const today = new Date().toISOString().slice(0, 10)
const cap = (k, fallback) => Number(process.env[k] ?? fallback)
const caps = {
  deepseek: cap('AI_DAILY_CAP_DEEPSEEK', 100),
  haiku: cap('AI_DAILY_CAP_HAIKU', 50),
  openai: cap('AI_DAILY_CAP_OPENAI', 100),
  warmup: cap('AI_DAILY_CAP_WARMUP', 30),
}

const empty = { date: today, counts: { deepseek: 0, haiku: 0, openai: 0, warmup: 0 } }

function read() {
  if (!existsSync(BUDGET_FILE)) return empty
  try {
    const raw = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'))
    if (raw.date !== today) return empty
    return raw
  } catch {
    return empty
  }
}

function write(state) {
  writeFileSync(BUDGET_FILE, JSON.stringify(state, null, 2))
}

const mode = process.argv[2]
if (mode === 'reset') {
  write(empty)
  console.log(`reset: ${BUDGET_FILE} → all counts 0 for ${today}`)
  process.exit(0)
}

const state = read()
console.log(`AI budget for ${state.date}  (file: ${BUDGET_FILE})`)
console.log('')
console.log('  provider   used / cap   remaining')
console.log('  --------   ----------   ---------')
for (const p of ['deepseek', 'haiku', 'openai', 'warmup']) {
  const used = state.counts[p] ?? 0
  const c = caps[p]
  const rem = Math.max(0, c - used)
  const bar = used >= c ? '  [CAPPED]' : ''
  console.log(`  ${p.padEnd(10)} ${String(used).padStart(4)} / ${String(c).padEnd(4)}   ${String(rem).padStart(4)}${bar}`)
}
console.log('')
console.log('Reset:    npm run ai:budget:reset')
console.log('Raise:    add AI_DAILY_CAP_DEEPSEEK=200 (etc) to .env.local')
