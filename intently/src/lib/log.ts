import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Server-side structured logger. JSON lines to a file (greppable, jq-able),
// pretty-formatted to stdout (readable inline with the dev server). Designed
// for the AI plumbing — every tier transition, validator flag, provider call.
// No deps; ~80 lines. Swap to pino in Phase 1c if/when we outgrow it.

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50,
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  trace: '\x1b[90m',   // grey
  debug: '\x1b[36m',   // cyan
  info: '\x1b[32m',    // green
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
}
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

const minLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info'
const logFile = process.env.LOG_FILE ?? join(process.cwd(), '.logs', 'ai.log')
const pretty = process.env.LOG_PRETTY !== 'false'
const writeFile = process.env.LOG_FILE_ENABLED !== 'false'

let fileReady = false
function ensureFileDir(): void {
  if (fileReady || !writeFile) return
  try { mkdirSync(dirname(logFile), { recursive: true }) } catch { /* ignore */ }
  fileReady = true
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel]
}

// Truncate large string fields so a single bad prompt doesn't bloat the log.
// Override per-field with explicit slicing before passing to log() if needed.
function compact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' && v.length > 400) out[k] = v.slice(0, 400) + '…'
    else out[k] = v
  }
  return out
}

function emit(level: LogLevel, msg: string, fields: Record<string, unknown>): void {
  if (!shouldLog(level)) return
  const event = { ts: new Date().toISOString(), level, msg, ...compact(fields) }

  if (writeFile) {
    try {
      ensureFileDir()
      appendFileSync(logFile, JSON.stringify(event) + '\n')
    } catch { /* swallow log-self errors */ }
  }

  if (pretty) {
    const color = LEVEL_COLORS[level]
    const time = event.ts.slice(11, 23)  // HH:mm:ss.SSS
    const tag = level.toUpperCase().padEnd(5)
    const tail = Object.entries(fields)
      .map(([k, v]) => `${DIM}${k}${RESET}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ')
    process.stdout.write(`${DIM}${time}${RESET} ${color}${tag}${RESET} ${msg}${tail ? ' ' + tail : ''}\n`)
  } else {
    process.stdout.write(JSON.stringify(event) + '\n')
  }
}

export interface Logger {
  trace: (msg: string, fields?: Record<string, unknown>) => void
  debug: (msg: string, fields?: Record<string, unknown>) => void
  info: (msg: string, fields?: Record<string, unknown>) => void
  warn: (msg: string, fields?: Record<string, unknown>) => void
  error: (msg: string, fields?: Record<string, unknown>) => void
  child: (bindings: Record<string, unknown>) => Logger
}

function build(bindings: Record<string, unknown> = {}): Logger {
  const make = (level: LogLevel) => (msg: string, fields: Record<string, unknown> = {}) =>
    emit(level, msg, { ...bindings, ...fields })
  return {
    trace: make('trace'),
    debug: make('debug'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    child: (extra) => build({ ...bindings, ...extra }),
  }
}

export const log: Logger = build()
