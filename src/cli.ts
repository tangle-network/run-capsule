#!/usr/bin/env node
/**
 * run-capsule CLI — trace → shareable video links.
 *
 *   run-capsule --demo
 *   run-capsule --workdir ./generated-project
 *   run-capsule --trace run.json --kinds code,terminal --host catbox
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { Span } from '@tangle-network/agent-eval'

import { spansFromClaudeMessages } from './adapters/claude-messages.js'
import { spansFromPlaywrightResult } from './adapters/playwright.js'
import { spansFromRuntimeEvents } from './adapters/runtime-events.js'
import { spansFromWorkdir } from './adapters/workdir.js'
import type { EvalResult } from './renderers/scoreboard.js'
import { type CapsuleKind, runToVideo } from './run-to-video.js'
import type { LitterboxExpiry, ShareHost } from './upload.js'

interface Args {
  demo: boolean
  trace?: string
  workdir?: string
  playwright?: string
  claude?: string
  events?: string
  kinds?: CapsuleKind[]
  host: ShareHost
  expiry: LitterboxExpiry
  upload: boolean
  mp4: boolean
  title: string
  outDir: string
  orbitDir?: string
  result?: string
  narrate: boolean
  music: boolean
  voice?: string
}

function parse(argv: string[]): Args {
  const a: Args = {
    demo: false, host: 'litterbox', expiry: '72h', upload: true, mp4: true,
    title: 'Agent run', outDir: path.resolve('run-capsules'), narrate: false, music: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue
    switch (arg) {
      case '--demo': a.demo = true; break
      case '--trace': a.trace = argv[++i]; break
      case '--workdir': a.workdir = argv[++i]; break
      case '--playwright': a.playwright = argv[++i]; break
      case '--claude': a.claude = argv[++i]; break
      case '--events': a.events = argv[++i]; break
      case '--kinds': a.kinds = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean) as CapsuleKind[]; break
      case '--host': a.host = (argv[++i] as ShareHost) ?? 'litterbox'; break
      case '--expiry': a.expiry = (argv[++i] as LitterboxExpiry) ?? '72h'; break
      case '--title': a.title = argv[++i] ?? a.title; break
      case '--out': a.outDir = path.resolve(argv[++i] ?? a.outDir); break
      case '--orbit-dir': a.orbitDir = argv[++i]; break
      case '--result': a.result = argv[++i]; break
      case '--narrate': a.narrate = true; break
      case '--music': a.music = true; break
      case '--voice': a.voice = argv[++i]; break
      case '--no-upload': a.upload = false; break
      case '--no-mp4': a.mp4 = false; break
      case '--help': case '-h': help(); process.exit(0)
      default: if (arg.startsWith('--')) { console.error(`Unknown flag: ${arg}`); process.exit(1) }
    }
  }
  if (!a.demo && !a.trace && !a.workdir && !a.playwright && !a.claude && !a.events) { help(); process.exit(1) }
  return a
}

function help(): void {
  console.log(`run-capsule — trace → shareable video

  --demo               Built-in sample run
  --trace <file.json>  A Span[] JSON file
  --workdir <dir>      A generated project directory (code capsule from real files)
  --playwright <f>     agent-browser-driver TestResult JSON (browser/screen)
  --claude <f.jsonl>   Anthropic Messages stream (sandbox-driver stream-shot)
  --events <f.json>    agent-eval RuntimeEventLike[] JSON
  --kinds <list>       code,terminal,screen,conversation,replay (auto-detect)
                       + opt-in: studio (1:1 sandbox-ui run view),
                         orbit (rendered-model spin), composed (sequenced film)
  --orbit-dir <dir>    Dir of rendered frames (PNG) for orbit/composed shots
  --result <f.json>    Eval verdict JSON → animated scoreboard shot in the film
  --narrate            Add synthesized VO narration (needs ROUTER_KEY env)
  --music              Add a subtle music bed
  --voice <v>          TTS voice (default alloy)
  --host <h>           litterbox (temp) | catbox (permanent)
  --expiry <e>         1h|12h|24h|72h  (litterbox)
  --no-upload          Render + record only
  --no-mp4             Keep .webm
  --title <t>          Title in the clips
  --out <dir>          Output root (default ./run-capsules)`)
}

function demoSpans(): Span[] {
  const tool = (id: string, ts: number, toolName: string, args: unknown, over: Record<string, unknown> = {}): Span =>
    ({ spanId: id, runId: 'demo', kind: 'tool', name: toolName, toolName, args, startedAt: ts, endedAt: ts + 40, status: 'ok', ...over }) as Span
  const sandbox = (id: string, ts: number, over: Record<string, unknown>): Span =>
    ({ spanId: id, runId: 'demo', kind: 'sandbox', name: 'npm test', startedAt: ts, endedAt: ts + 60, status: 'ok', ...over }) as Span
  return [
    { spanId: 's0', runId: 'demo', kind: 'llm', name: 'plan', model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Build a React + TypeScript todo app with localStorage.' }], startedAt: 1000, endedAt: 1100, status: 'ok' } as Span,
    tool('s1', 1200, 'create_file', { path: 'package.json', content: '{\n  "name": "react-todo",\n  "dependencies": { "react": "^18.3.1" }\n}\n' }),
    tool('s2', 1300, 'write_file', { path: 'src/types.ts', content: 'export interface Todo {\n  id: string\n  title: string\n  completed: boolean\n}\n' }),
    tool('s3', 1400, 'shell.exec', { command: 'npm install' }, { result: 'added 42 packages in 3s' }),
    sandbox('s4', 1600, { command: 'npm test', testsTotal: 5, testsPassed: 3, exitCode: 1, status: 'error', error: '2 failing: toggle did not flip completed' }),
    tool('s5', 1800, 'str_replace_editor', { path: 'src/App.tsx', diff: '--- a\n+++ b\n+const { todos, toggle } = useTodos()\n+<input type="checkbox" onChange={() => toggle(t.id)} />\n' }),
    sandbox('s6', 2000, { command: 'npm test', testsTotal: 5, testsPassed: 5, exitCode: 0 }),
  ]
}

async function main() {
  const a = parse(process.argv.slice(2))
  const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf-8'))
  const readJsonl = (f: string) =>
    fs.readFileSync(f, 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  const spans: Span[] = a.demo
    ? demoSpans()
    : a.workdir
      ? spansFromWorkdir(a.workdir)
      : a.playwright
        ? spansFromPlaywrightResult(readJson(a.playwright))
        : a.claude
          ? spansFromClaudeMessages(readJsonl(a.claude))
          : a.events
            ? spansFromRuntimeEvents(readJson(a.events))
            : (readJson(a.trace as string) as Span[])

  // Rendered-model frames (for orbit/composed) loaded as data URIs from a dir.
  const orbitFrames = a.orbitDir
    ? fs.readdirSync(a.orbitDir)
        .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
        .sort()
        .map((f) => {
          const ext = path.extname(f).slice(1).toLowerCase()
          const mime = ext === 'jpg' ? 'jpeg' : ext
          return `data:image/${mime};base64,${fs.readFileSync(path.join(a.orbitDir as string, f)).toString('base64')}`
        })
    : undefined

  const result = a.result ? (readJson(a.result) as EvalResult) : undefined

  console.log(`\nrun-capsule  (${spans.length} spans) → ${a.host}${a.host === 'litterbox' ? ` (${a.expiry})` : ''}`)
  const { runDir, results } = await runToVideo(spans, {
    title: a.title, kinds: a.kinds, outDir: a.outDir,
    upload: a.upload, host: a.host, expiry: a.expiry, toMp4: a.mp4,
    orbitFrames, result,
    narrate: a.narrate, music: a.music, voice: a.voice,
    routerKey: process.env.ROUTER_KEY, routerBaseUrl: process.env.ROUTER_BASE,
  })
  console.log(`\n=== ${results.length} capsule(s) → ${runDir} ===`)
  for (const r of results) {
    console.log(`  ${r.kind.padEnd(9)} ${r.url ?? r.videoPath ?? `FAILED: ${r.error}`}`)
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })
