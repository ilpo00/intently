// ─────────────────────────────────────────────────────────────────
// assemble.mjs — join the recorded scenes into the portfolio tour.
//
//   npm run video:record      # the short tour → e2e/video/out/ (timeline.json + tab videos)
//   npm run video:assemble    # → ../docs/video/out/
//
// Two inputs are understood:
//   · the short tour: e2e/video/out/timeline.json lists which part of which
//     tab to show, and every subtitle with its time — one continuous story;
//   · the long cut (VIDEO_TOUR=long): one recorded clip per scene, joined in order.
//
// Produces:
//   intently-tour.mp4   1920×1080, H.264, silent, captions/cards already in the footage
//   poster.png          a frame from the shortlist scene
//   intently-tour.vtt   one caption cue per scene, carrying the narration text
//                       (scene-level timing; retime to the voice-over once recorded)
//   scenes.json         scene order, start times and durations — the edit decision list
//
// Needs the system ffmpeg/ffprobe. It only cuts, scales and joins; all on-screen
// text is rendered in the page when the scene is recorded.
// ─────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const INTENTLY = resolve(HERE, '..', '..')
const RAW = join(INTENTLY, 'e2e', 'video', 'out', 'raw')
const WORK = join(INTENTLY, 'e2e', 'video', 'out', 'work')
const OUT = resolve(INTENTLY, '..', 'docs', 'video', 'out')
const NARRATION = resolve(INTENTLY, '..', 'docs', 'video', 'narration.json')

// Every recording opens on a blank frame while the page loads; drop it.
const HEAD_TRIM_S = 0.7
const CRF = process.env.VIDEO_CRF || '24' // raise to shrink the file

const run = (bin, args) => execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
const duration = (file) =>
  Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim())

function vttTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60).toFixed(3).padStart(6, '0')
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec}`
}

const TIMELINE = join(INTENTLY, 'e2e', 'video', 'out', 'timeline.json')
const encode = (args) => run('ffmpeg', [
  '-y', '-v', 'error', ...args,
  '-vf', 'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-an',
])

if (process.env.VIDEO_TOUR !== 'long' && existsSync(TIMELINE)) {
  const tl = JSON.parse(readFileSync(TIMELINE, 'utf8'))
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })
  mkdirSync(OUT, { recursive: true })

  // 1 — cut each segment from its tab's recording.
  const parts = []
  let outCursor = 0
  tl.segments.forEach((seg, i) => {
    const dst = join(WORK, `seg-${i}.mp4`)
    encode(['-ss', String(seg.from), '-to', String(seg.to), '-i', tl.videos[seg.tab], dst])
    const d = duration(dst)
    parts.push({ ...seg, file: dst, outStart: outCursor, outDuration: d })
    outCursor += d
  })

  // 2 — join.
  const listFile = join(WORK, 'concat.txt')
  writeFileSync(listFile, parts.map(p => `file '${p.file.replace(/'/g, `'\\''`)}'`).join('\n'))
  const mp4 = join(OUT, 'intently-tour.mp4')
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', mp4])

  // 3 — subtitles in final-cut time: each cue lasts until the next one (or the
  // end of its segment); an empty cue only ends the previous one.
  const placed = []
  for (const p of parts) {
    const inSeg = tl.cues.filter(c => c.tab === p.tab && c.at >= p.from - 0.05 && c.at <= p.to)
    inSeg.forEach((c, k) => {
      const start = p.outStart + Math.max(0, c.at - p.from)
      const next = inSeg[k + 1]
      const end = next ? p.outStart + (next.at - p.from) : p.outStart + p.outDuration
      if (c.text) placed.push({ start, end: Math.max(start + 0.5, end - 0.05), text: c.text })
    })
  }
  writeFileSync(join(OUT, 'intently-tour.vtt'),
    `WEBVTT\n\n${placed.map(c => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}`).join('\n\n')}\n`)

  // 4 — poster: the first shortlist, just after its subtitle appears.
  const firstList = placed.find(c => c.text.startsWith('Then a short list'))
  run('ffmpeg', ['-y', '-v', 'error', '-ss', String((firstList?.start ?? 12) + 2.5), '-i', mp4, '-frames:v', '1', join(OUT, 'poster.png')])
  writeFileSync(join(OUT, 'scenes.json'), JSON.stringify({ total: Number(outCursor.toFixed(3)), segments: parts.map(({ file, ...r }) => r), subtitles: placed }, null, 2) + '\n')

  const mb = (Number(run('stat', ['-f', '%z', mp4]).trim()) / 1024 / 1024).toFixed(1)
  console.log(`${mp4}\n  ${parts.length} segments · ${Math.floor(outCursor / 60)}:${String(Math.round(outCursor % 60)).padStart(2, '0')} · ${mb} MB · ${placed.length} subtitles`)
  process.exit(0)
}

if (!existsSync(RAW)) {
  console.error(`No recordings at ${RAW}. Run "npm run video:record" first.`)
  process.exit(1)
}

// Scene folders look like "tour.scene.ts-02-consult-and-shortlist".
const scenes = readdirSync(RAW)
  .map(dir => ({ dir, id: /-(\d{2})-/.exec(dir)?.[1] }))
  .filter(s => s.id && existsSync(join(RAW, s.dir, 'video.webm')))
  .sort((a, b) => a.id.localeCompare(b.id))

if (scenes.length === 0) {
  console.error('No scene recordings found.')
  process.exit(1)
}

rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })
mkdirSync(OUT, { recursive: true })

const narration = existsSync(NARRATION) ? JSON.parse(readFileSync(NARRATION, 'utf8')) : {}

// 1 — normalise each scene to identical codec settings so they join cleanly.
const edl = []
let cursor = 0
for (const s of scenes) {
  const src = join(RAW, s.dir, 'video.webm')
  const dst = join(WORK, `${s.id}.mp4`)
  run('ffmpeg', [
    '-y', '-v', 'error', '-ss', String(HEAD_TRIM_S), '-i', src,
    '-vf', 'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-an', dst,
  ])
  const d = duration(dst)
  edl.push({ id: s.id, scene: s.dir.replace(/^tour\.scene\.ts-\d{2}-/, ''), start: Number(cursor.toFixed(3)), duration: Number(d.toFixed(3)) })
  cursor += d
}

// 2 — join.
const listFile = join(WORK, 'concat.txt')
writeFileSync(listFile, edl.map(e => `file '${join(WORK, `${e.id}.mp4`).replace(/'/g, `'\\''`)}'`).join('\n'))
const mp4 = join(OUT, 'intently-tour.mp4')
run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', mp4])

// 3 — poster: late in the shortlist scene, when the results are on screen.
const shortlist = edl.find(e => e.id === '02') ?? edl[0]
run('ffmpeg', ['-y', '-v', 'error', '-ss', String(shortlist.start + Math.min(12, shortlist.duration * 0.4)), '-i', mp4, '-frames:v', '1', join(OUT, 'poster.png')])

// 4 — captions: one cue per scene with its narration, to be retimed to the voice.
const cues = edl
  .filter(e => narration[e.id])
  .map(e => `${vttTime(e.start)} --> ${vttTime(e.start + e.duration - 0.2)}\n${narration[e.id]}`)
writeFileSync(join(OUT, 'intently-tour.vtt'), `WEBVTT\n\n${cues.join('\n\n')}\n`)
writeFileSync(join(OUT, 'scenes.json'), JSON.stringify({ total: Number(cursor.toFixed(3)), scenes: edl }, null, 2) + '\n')

const mb = (Number(run('stat', ['-f', '%z', mp4]).trim()) / 1024 / 1024).toFixed(1)
console.log(`${mp4}\n  ${edl.length} scenes · ${Math.floor(cursor / 60)}:${String(Math.round(cursor % 60)).padStart(2, '0')} · ${mb} MB`)
for (const e of edl) console.log(`  ${e.id}  ${vttTime(e.start).slice(3, 8)}  ${e.duration.toFixed(1).padStart(5)}s  ${e.scene}`)
