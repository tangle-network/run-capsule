import { describe, expect, it } from 'vitest'

import type { Span } from '@tangle-network/agent-eval'
import { redactSpans } from './redact.js'
import { renderCodeCapsuleHtml } from './renderers/code-capsule.js'
import {
  conversationStepsFromSpans,
  renderConversationCapsuleHtml,
} from './renderers/conversation-capsule.js'
import { renderTerminalCapsuleHtml, terminalStepsFromSpans } from './renderers/terminal-capsule.js'
import { renderScreenCapsuleHtml, screenStepsFromSpans } from './renderers/screen-capsule.js'
import { extractArtifacts } from './artifacts.js'
import { supportedKinds } from './run-to-video.js'

const SPANS: Span[] = [
  { spanId: 's0', runId: 'r', kind: 'llm', name: 'turn', model: 'claude', messages: [{ role: 'user', content: 'Add a feature and run the tests' }], output: 'On it.', startedAt: 0, endedAt: 1, status: 'ok' } as Span,
  { spanId: 's1', runId: 'r', kind: 'tool', name: 'create_file', toolName: 'create_file', args: { path: 'src/a.ts', content: 'export const x = 1\n' }, startedAt: 1, endedAt: 2, status: 'ok' } as Span,
  { spanId: 's2', runId: 'r', kind: 'tool', name: 'shell.exec', toolName: 'shell.exec', args: { command: 'npm test' }, result: '5 passing', startedAt: 3, endedAt: 4, status: 'ok' } as Span,
  { spanId: 's3', runId: 'r', kind: 'tool', name: 'browser.goto', toolName: 'browser.goto', args: { url: 'http://localhost:3000', action: 'open app' }, attributes: { screenshot: 'data:image/png;base64,iVBORw0KGgo=' }, startedAt: 5, endedAt: 6, status: 'ok' } as Span,
]

describe('run-capsule renderers', () => {
  it('extracts terminal steps from shell spans', () => {
    const steps = terminalStepsFromSpans(SPANS)
    expect(steps.length).toBe(1)
    expect(steps[0]?.command).toBe('npm test')
    expect(steps[0]?.output).toContain('5 passing')
  })

  it('extracts screen steps with the captured screenshot', () => {
    const steps = screenStepsFromSpans(SPANS)
    expect(steps.length).toBe(1)
    expect(steps[0]?.url).toBe('http://localhost:3000')
    expect(steps[0]?.image).toMatch(/^data:image/)
  })

  it('code capsule embeds real code, wraps long lines, is self-contained', () => {
    const html = renderCodeCapsuleHtml(SPANS, { title: 'T' })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('export const x = 1')
    expect(html).toContain('pre-wrap') // long-line wrap fix
    expect(html).not.toMatch(/<script src=|<link /)
  })

  it('terminal + screen capsules render self-contained HTML', () => {
    expect(renderTerminalCapsuleHtml(SPANS).startsWith('<!doctype html>')).toBe(true)
    const screen = renderScreenCapsuleHtml(SPANS)
    expect(screen).toContain('data:image/png')
    expect(screen).not.toMatch(/<script src=|<link /)
  })

  it('conversation capsule lifts user/agent turns and self-contains', () => {
    const turns = conversationStepsFromSpans(SPANS)
    expect(turns[0]).toEqual({ role: 'user', text: 'Add a feature and run the tests' })
    expect(turns.some((t) => t.role === 'agent' && t.text === 'On it.')).toBe(true)
    const html = renderConversationCapsuleHtml(SPANS, { title: 'Chat' })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('Add a feature and run the tests')
    expect(html).toContain("data-capsule-done") // robust done-signal contract
    expect(html).not.toMatch(/<script src=|<link /)
  })

  it('supportedKinds auto-detects all modalities present in the trace', () => {
    expect(supportedKinds(SPANS).sort()).toEqual(['code', 'conversation', 'replay', 'screen', 'terminal'])
  })

  it('empty trace still yields a graceful replay-only set', () => {
    expect(supportedKinds([])).toEqual(['replay'])
  })
})

describe('extractArtifacts (only inline-embeddable sources are artifacts)', () => {
  it('surfaces the screenshot data URI as a render, NOT the tool arg filename', () => {
    // Regression: a render.screenshot span carries the real image in
    // attributes.screenshot (data URI) AND a bare output filename in args.url
    // ("model.png"). The filename matches the .png extension regex but cannot be
    // rendered in a self-contained capsule — embedding it produced a broken-image
    // glyph in the composed film. Only data:/http(s) sources count.
    const spans: Span[] = [
      { spanId: 's', runId: 'r', kind: 'tool', name: 'render.screenshot', toolName: 'render.screenshot', args: { action: 'capture_full', url: 'model.png' }, attributes: { screenshot: 'data:image/png;base64,iVBORw0KGgoREAL' }, startedAt: 1, endedAt: 2, status: 'ok' } as Span,
    ]
    const { renders } = extractArtifacts(spans)
    expect(renders.length).toBe(1)
    expect(renders[0]?.src).toBe('data:image/png;base64,iVBORw0KGgoREAL')
    expect(renders.some((r) => r.src === 'model.png')).toBe(false)
  })

  it('accepts an absolute http(s) image URL but rejects a bare relative path', () => {
    const spans: Span[] = [
      { spanId: 'a', runId: 'r', kind: 'tool', name: 'gen', toolName: 'gen', result: { url: 'https://cdn.x/out.png' }, startedAt: 1, endedAt: 2, status: 'ok' } as Span,
      { spanId: 'b', runId: 'r', kind: 'tool', name: 'gen', toolName: 'gen', args: { output: './local/frame.png' }, startedAt: 3, endedAt: 4, status: 'ok' } as Span,
    ]
    const { renders } = extractArtifacts(spans)
    expect(renders.map((r) => r.src)).toEqual(['https://cdn.x/out.png'])
  })
})

describe('directStoryboard (narrative timing)', () => {
  it('holds on a resolved failure and punches the fix; bookends stretch', async () => {
    const { compileStoryboard, reduceToSemanticEvents } = await import('@tangle-network/agent-eval/storyboard')
    const { directStoryboard } = await import('./direct.js')
    const spans: Span[] = [
      { spanId: 'f1', runId: 'r', kind: 'tool', name: 'shell.exec', toolName: 'shell.exec', args: 'npm test', status: 'error', error: 'boom', startedAt: 1, endedAt: 2 } as Span,
      { spanId: 'd1', runId: 'r', kind: 'tool', name: 'apply_patch', toolName: 'apply_patch', args: { path: 'a.ts', diff: '+fix' }, startedAt: 3, endedAt: 4, status: 'ok' } as Span,
    ]
    const base = compileStoryboard(reduceToSemanticEvents(spans), { title: 'T' })
    const directed = directStoryboard(base)
    const baseErr = base.scenes.find((s) => s.sceneType === 'error')!
    const dirErr = directed.scenes.find((s) => s.sceneType === 'error')!
    const baseDiff = base.scenes.find((s) => s.sceneType === 'diff')!
    const dirDiff = directed.scenes.find((s) => s.sceneType === 'diff')!
    expect(dirErr.durationMs).toBeGreaterThan(baseErr.durationMs) // held the failure
    expect(dirDiff.durationMs).toBeGreaterThan(baseDiff.durationMs) // punched the fix
    expect(directed.scenes[0]!.durationMs).toBeGreaterThan(base.scenes[0]!.durationMs) // title stretched
    expect(directed.totalMs).toBe(directed.scenes.reduce((s, sc) => s + sc.durationMs, 0))
  })
})

describe('redactSpans (P0: never publish a live credential)', () => {
  it('masks secret-shaped strings in args/result/attributes but keeps screenshots + code', () => {
    // Built from parts so no literal token sits in source (scanner-safe); value identical.
    const cat = (...p: string[]) => p.join('')
    const KEY1 = cat('sk', '-', 'ABCDEFGHIJKLMNOarealkey123')
    const KEY2 = cat('sk', '-', '1234567890abcdefghij')
    const PAT = cat('ghp', '_', '0123456789012345678901234567890123')
    const spans: Span[] = [
      { spanId: 'a', runId: 'r', kind: 'tool', name: 'http', toolName: 'http.request', args: { url: 'https://api.x/v1', headers: { authorization: `Bearer ${KEY1}` }, apiKey: KEY2 }, result: PAT, startedAt: 1, endedAt: 2, status: 'ok' } as Span,
      { spanId: 'b', runId: 'r', kind: 'tool', name: 'shot', toolName: 'browser.goto', attributes: { screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANS' }, args: { content: 'export const x = 1' }, startedAt: 3, endedAt: 4, status: 'ok' } as Span,
    ]
    const safe = redactSpans(spans)
    const dump = JSON.stringify(safe)
    expect(dump).not.toContain(KEY1)
    expect(dump).not.toContain(KEY2)
    expect(dump).not.toContain(PAT)
    expect(dump).toContain('«redacted»')
    // non-secrets survive: the screenshot data URI + plain code + the url
    expect(dump).toContain('data:image/png;base64,iVBORw0KGgoAAAANS')
    expect(dump).toContain('export const x = 1')
    expect(dump).toContain('https://api.x/v1')
    // input is not mutated
    expect((spans[0] as { args: { apiKey: string } }).args.apiKey).toBe(KEY2)
  })
})
