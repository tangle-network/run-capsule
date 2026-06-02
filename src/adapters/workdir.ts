/**
 * Build a code-edit span stream from a REAL generated project workdir.
 *
 * The storyboard/code-capsule renderers animate whatever code the trace carries.
 * A live agent run's trace already carries its edits — but to demo the renderer
 * on genuine output (not a hand-written sample), this walks an actual generated
 * project, picks the highest-signal source files, and emits one edit span per
 * file with the real file body. The animation then "writes" the real code.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { Span } from '@tangle-network/agent-eval'

const CODE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.sol', '.py', '.rs', '.go', '.css', '.json', '.md',
])
const SKIP_DIR = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.cache', 'target', 'out',
  'coverage', '.vite', 'artifacts', 'cache', 'typechain-types', 'typechain',
])
const SKIP_NAME = /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.d\.ts$|tsconfig.*\.json|\.eslintrc|\.prettierrc|vite-env)/

export interface WorkdirSpansOptions {
  /** Max files to include. Default 12. */
  maxFiles?: number
  /** Max bytes of each file's body to type out. Default 2400. */
  maxBytesPerFile?: number
}

/** Rank a file by how "interesting" it is to watch being written — the AGENT's
 *  own source, not vendored dependencies. */
function score(rel: string): number {
  let s = 0
  // Vendored deps (forge lib/, OZ, etc.) are not the agent's work — bury them.
  if (/(^|\/)(lib|vendor|third_party|deps|external)\//.test(rel)) s -= 8
  if (/forge-std|openzeppelin|@openzeppelin|solmate|node_modules/i.test(rel)) s -= 8
  if (/(^|\/)(contracts?|src|app|hooks|components|pages|routes|api)\//.test(rel)) s += 3
  const ext = path.extname(rel)
  if (ext === '.sol' || ext === '.tsx') s += 2
  else if (ext === '.ts') s += 1
  if (/(test|spec|__tests__|\.config\.|stories|mock|fixture)/i.test(rel)) s -= 4
  if (rel === 'package.json') s += 1
  if (/readme/i.test(rel)) s -= 2
  return s
}

export function spansFromWorkdir(workdir: string, opts: WorkdirSpansOptions = {}): Span[] {
  const maxFiles = opts.maxFiles ?? 12
  const maxBytes = opts.maxBytesPerFile ?? 2400
  const found: string[] = []

  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (SKIP_DIR.has(e.name) || e.name.startsWith('.')) continue
        walk(full, r)
      } else if (e.isFile()) {
        if (SKIP_NAME.test(e.name)) continue
        if (!CODE_EXT.has(path.extname(e.name))) continue
        found.push(r)
      }
    }
  }
  walk(workdir, '')

  const picked = found
    .map((rel) => ({ rel, s: score(rel) }))
    .sort((a, b) => b.s - a.s || a.rel.length - b.rel.length)
    .slice(0, maxFiles)
    .map((x) => x.rel)
    .sort() // coherent display order once selected

  return picked.map((rel, i) => {
    let content = ''
    try {
      const buf = fs.readFileSync(path.join(workdir, rel))
      content = buf.subarray(0, maxBytes).toString('utf8')
      if (buf.length > maxBytes) content += `\n// …(${buf.length - maxBytes} more bytes)`
    } catch {
      content = `// ${rel}`
    }
    return {
      spanId: `wf-${i}`,
      runId: 'workdir',
      kind: 'tool',
      name: 'create_file',
      toolName: 'create_file',
      args: { path: rel, content },
      startedAt: 1000 + i * 100,
      endedAt: 1000 + i * 100 + 40,
      status: 'ok',
    } as Span
  })
}
