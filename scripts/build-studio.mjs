/**
 * Build-time: pre-bundle the studio React player (src/studio/app.tsx → the real
 * sandbox-ui RunGroup, React, radix, lucide) into one browser IIFE and inline
 * the package's prebuilt CSS, writing dist/studio/assets.json = { js, css }.
 *
 * This is why studio/composed work from a PUBLISHED dist: the heavy deps
 * (React, @tangle-network/sandbox-ui, esbuild) are build-time only; the shipped
 * package carries the self-contained bundle + CSS, so runtime needs only
 * agent-eval + playwright.
 */
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
// scripts/ → repo root (new URL('..') already lands on the run-capsule dir).
const ROOT = fileURLToPath(new URL('..', import.meta.url))

const result = await build({
  entryPoints: [path.join(ROOT, 'src/studio/app.tsx')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  minify: true,
  write: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'empty', '.svg': 'dataurl', '.woff': 'empty', '.woff2': 'empty' },
})
const js = result.outputFiles[0]?.text ?? ''

const css = ['@tangle-network/sandbox-ui/tokens.css', '@tangle-network/sandbox-ui/styles', '@tangle-network/sandbox-ui/globals.css']
  .map((spec) => {
    try {
      return fs.readFileSync(require_.resolve(spec), 'utf8')
    } catch {
      return ''
    }
  })
  .filter(Boolean)
  .join('\n')

const outDir = path.join(ROOT, 'dist/studio')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'assets.json'), JSON.stringify({ js, css }))
console.log(`[build-studio] dist/studio/assets.json — js ${(js.length / 1e3) | 0}kb · css ${(css.length / 1e3) | 0}kb`)
