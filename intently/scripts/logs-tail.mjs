// Tail the AI dev log with pretty formatting.
// Usage:
//   npm run logs                    # follow with pretty output
//   npm run logs -- --raw           # follow with raw JSON output (pipe to jq)
//   npm run logs -- --no-follow     # print existing log and exit
//   npm run logs:clear              # truncate the log file

import { existsSync, statSync, openSync, readSync, closeSync, watch, truncateSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const file = process.env.LOG_FILE ?? join(root, '.logs', 'ai.log')

const args = new Set(process.argv.slice(2))
const raw = args.has('--raw')
const follow = !args.has('--no-follow')
const clear = args.has('--clear')

if (clear) {
  if (existsSync(file)) truncateSync(file, 0)
  console.log(`cleared: ${file}`)
  process.exit(0)
}

const LEVEL_COLORS = { trace: '\x1b[90m', debug: '\x1b[36m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' }
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

function format(line) {
  if (raw) return line
  try {
    const e = JSON.parse(line)
    const color = LEVEL_COLORS[e.level] ?? ''
    const time = (e.ts ?? '').slice(11, 23)
    const tag = (e.level ?? '').toUpperCase().padEnd(5)
    const fields = Object.entries(e)
      .filter(([k]) => k !== 'ts' && k !== 'level' && k !== 'msg')
      .map(([k, v]) => `${DIM}${k}${RESET}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ')
    return `${DIM}${time}${RESET} ${color}${tag}${RESET} ${e.msg}${fields ? ' ' + fields : ''}`
  } catch {
    return line
  }
}

if (!existsSync(file)) {
  console.log(`no log file at ${file}`)
  console.log('start the dev server with NEXT_PUBLIC_AI_MODE=tiered and the file will appear.')
  process.exit(0)
}

let offset = follow ? statSync(file).size : 0
const fd = openSync(file, 'r')
const buf = Buffer.alloc(64 * 1024)
let carry = ''

function flush() {
  if (!existsSync(file)) return
  const size = statSync(file).size
  while (offset < size) {
    const n = readSync(fd, buf, 0, Math.min(buf.length, size - offset), offset)
    if (n <= 0) break
    offset += n
    carry += buf.subarray(0, n).toString('utf8')
    let i
    while ((i = carry.indexOf('\n')) !== -1) {
      const line = carry.slice(0, i)
      carry = carry.slice(i + 1)
      if (line.trim()) console.log(format(line))
    }
  }
}

if (!follow) {
  offset = 0
  flush()
  closeSync(fd)
  process.exit(0)
}

flush()
console.error(`${DIM}— tailing ${file} (Ctrl-C to stop) —${RESET}`)

watch(file, { persistent: true }, () => flush())

process.on('SIGINT', () => { closeSync(fd); process.exit(0) })
