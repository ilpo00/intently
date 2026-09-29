// Copy .env.example -> .env.local without overwriting an existing file.
// Run via `npm run env:init`.

import { copyFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const example = join(root, '.env.example')
const target = join(root, '.env.local')

if (!existsSync(example)) {
  console.error('error: .env.example not found at', example)
  process.exit(1)
}

if (existsSync(target)) {
  console.log(`.env.local already exists at ${target} — leaving it alone.`)
  console.log('To start over, delete it manually first: rm intently/.env.local')
  process.exit(0)
}

copyFileSync(example, target)
console.log(`copied: ${example} -> ${target}`)
console.log('Fill in DEEPSEEK_API_KEY, optionally ANTHROPIC_API_KEY, then `npm run dev`.')
