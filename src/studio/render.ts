/**
 * Build the 1:1 studio page: the React player (app.tsx, which mounts the REAL
 * sandbox-ui RunGroup) bundled to one browser script + the package's prebuilt
 * CSS, with the run bundle injected as `window.__RUN__`, returned as one
 * self-contained HTML string the recorder drives headless.
 *
 * Two asset sources, in order:
 *   1. dist/studio/assets.json — pre-bundled at build time (scripts/build-studio.mjs).
 *      This is the PUBLISHED path: no React/sandbox-ui/esbuild at runtime.
 *   2. live esbuild from src/studio/app.tsx — the dev/source path (deps present).
 */

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Span } from '@tangle-network/agent-eval'
import { traceToRunBundle } from './trace-to-run.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface StudioAssets {
  js: string
  css: string
}

/** Live-build the bundle + read css from node_modules — dev/source path only.
 *  esbuild is imported dynamically so the published lib never hard-depends on it. */
async function buildLiveAssets(): Promise<StudioAssets> {
  const { build } = await import('esbuild')
  const require_ = createRequire(import.meta.url)
  const entry = fs.existsSync(path.join(HERE, 'app.tsx'))
    ? path.join(HERE, 'app.tsx')
    : path.join(HERE, '../../src/studio/app.tsx')
  const result = await build({
    entryPoints: [entry],
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
  return { js, css }
}

let cached: StudioAssets | undefined
async function studioAssets(): Promise<StudioAssets> {
  if (cached) return cached
  // Prefer the pre-bundled, self-contained assets (published path).
  for (const p of [path.join(HERE, 'assets.json'), path.join(HERE, 'studio/assets.json')]) {
    if (fs.existsSync(p)) {
      cached = JSON.parse(fs.readFileSync(p, 'utf8')) as StudioAssets
      return cached
    }
  }
  cached = await buildLiveAssets()
  return cached
}

export interface StudioRenderOptions {
  title?: string
  /** ms between revealing each assistant part. Default 1100. */
  stepMs?: number
}

/** Render a trace as the 1:1 studio HTML (real RunGroup, streamed). */
export async function renderRunStudioHtml(
  spans: readonly Span[],
  opts: StudioRenderOptions = {},
): Promise<string> {
  const bundle = traceToRunBundle(spans)
  const { js, css } = await studioAssets()
  const data = JSON.stringify({ ...bundle, title: opts.title, stepMs: opts.stepMs }).replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(opts.title ?? 'Agent run')}</title>
<style>${css}</style>
<style>html,body{margin:0;background:var(--md3-surface,#0a0a14)}</style>
</head>
<body data-sandbox-ui>
<div id="root"></div>
<script>window.__RUN__ = ${data};</script>
<script>${js}</script>
</body>
</html>
`
}
