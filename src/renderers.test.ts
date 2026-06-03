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
import { renderImageRevealHtml } from './renderers/media-layer.js'
import { type EvalResult, renderScoreboardHtml, scoreboardDurationMs } from './renderers/scoreboard.js'
import { renderIntroHtml, renderOutroHtml } from './renderers/title-cards.js'
import { autoCompose, renderCompositionHtml } from './composition.js'
import { extractArtifacts, buildNarrationScript } from './artifacts.js'
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

const RESULT: EvalResult = {
  task: 'two-story house',
  resolved: true,
  score: 1,
  checks: { volumes: true, detail: true, bboxX: true, bboxY: true, bboxZ: true, pitchedRoof: true, hollow: true },
  geo: { triangles: 308, volumes: 1, bbox: { x: 80, y: 60, z: 98 } },
}

describe('renderScoreboardHtml (the verdict payoff shot)', () => {
  it('renders every check, the tally, the verdict, score, and the bbox readout, self-contained', () => {
    const html = renderScoreboardHtml(RESULT)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).not.toMatch(/<script src=|<link /)
    // The verdict + final tally are present (count-up lands on these).
    expect(html).toContain('RESOLVED')
    expect(html).toContain('0/7') // tally starts at zero and counts up to 7
    expect(html).toContain('"passed":7')
    expect(html).toContain('"total":7')
    // Each check label is rendered as a row.
    expect(html).toContain('Pitched / gabled roof')
    expect(html).toContain('Hollow shell (interior cavity)')
    expect(html).toContain('Single watertight volume')
    // The measured geometry backs the verdict.
    expect(html).toContain('80 × 60 × 98')
    expect(html).toContain('>308<')
    // Robust done-signal contract for the recorder.
    expect(html).toContain('data-capsule-done')
  })

  it('shows a red cross for a failed check and an UNRESOLVED verdict', () => {
    const failed: EvalResult = { ...RESULT, resolved: false, score: 0.4, checks: { ...RESULT.checks, hollow: false } }
    const html = renderScoreboardHtml(failed)
    expect(html).toContain('UNRESOLVED')
    expect(html).toContain('class="cross"') // the failing check draws a cross, not a tick
    expect(html).toContain('"passed":6')
  })

  it('duration grows with the check count (so the composition can size the slot)', () => {
    const two: EvalResult = { ...RESULT, checks: { a: true, b: true } }
    expect(scoreboardDurationMs(RESULT)).toBeGreaterThan(scoreboardDurationMs(two))
  })
})

describe('renderImageRevealHtml (clean crossfade — no mid-fade ghosting)', () => {
  it('awaits the fade before reusing a buffer so an outgoing src is never overwritten while visible', () => {
    const html = renderImageRevealHtml(
      [{ src: 'data:image/png;base64,A', caption: 'one' }, { src: 'data:image/png;base64,B', caption: 'two' }],
      { perMs: 3000 },
    )
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).not.toMatch(/<script src=|<link /)
    // The fix: the front buffer's opacity is driven to 0 and the loop waits FADE
    // ms before the buffer is swapped/reused. A regression that reuses the buffer
    // synchronously (the old ghosting path) drops this await.
    expect(html).toContain("await sleep(FADE)")
    expect(html).toContain("front.style.opacity='0'")
    // Both source frames are embedded; no external asset URLs.
    expect(html).toContain('data:image/png;base64,A')
    expect(html).toContain('data:image/png;base64,B')
  })
})

describe('renderIntroHtml / renderOutroHtml (cinematic bookends)', () => {
  it('intro frames the mission with a kinetic title + brand wordmark, self-contained', () => {
    const html = renderIntroHtml('Agent designs a house', { eyebrow: 'Agent mission', subtitle: 'Build it.' })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).not.toMatch(/<script src=|<link /)
    expect(html).toContain('class="w"') // kinetic per-word spans
    expect(html).toContain('Tangle') // brand wordmark
    expect(html).toContain('data-capsule-done')
  })

  it('outro renders outcome stat chips with the numeric part bolded', () => {
    const html = renderOutroHtml('Verified by the real engine', { stats: ['7/7 checks', 'score 1.00'] })
    expect(html).toContain('<b>7/7</b>')
    expect(html).toContain('<b>1.00</b>')
  })
})

describe('autoCompose (the directed film)', () => {
  const SCAD = 'W=80;\nmodule house(){cube([80,60,98]);}\nhouse();\n'
  const cadSpans: Span[] = [
    { spanId: 'b', runId: 'r', kind: 'llm', name: 'brief', model: 'm', messages: [{ role: 'user', content: 'Write OpenSCAD source for a two-story house.\nRequirements:\n- footprint 80x60' }], startedAt: 0, endedAt: 1, status: 'ok' } as Span,
    { spanId: 'a', runId: 'r', kind: 'llm', name: 'author', model: 'm', output: SCAD, startedAt: 1, endedAt: 2, status: 'ok' } as Span,
    { spanId: 'c', runId: 'r', kind: 'tool', name: 'write', toolName: 'create_file', args: { path: 'model.scad', content: SCAD }, startedAt: 2, endedAt: 3, status: 'ok' } as Span,
    { spanId: 'd', runId: 'r', kind: 'tool', name: 'render', toolName: 'render.screenshot', args: { url: 'model.png' }, attributes: { screenshot: 'data:image/png;base64,iVBORENDER' }, startedAt: 4, endedAt: 5, status: 'ok' } as Span,
  ]

  it('pushes the scoreboard shot ONLY when a result is given', async () => {
    const withResult = await autoCompose(cadSpans, { title: 'House', result: RESULT })
    const without = await autoCompose(cadSpans, { title: 'House' })
    const score = (c: Awaited<ReturnType<typeof autoCompose>>) =>
      c.shots.filter((s) => s.layers.some((l) => l.html.includes('RESOLVED'))).length
    expect(score(withResult)).toBe(1)
    expect(score(without)).toBe(0)
  })

  it('frames the intro mission with the brief lead line, NOT the full requirements dump', async () => {
    const comp = await autoCompose(cadSpans, { title: 'House' })
    const intro = comp.shots[0]!.layers[0]!.html
    expect(intro).toContain('Write OpenSCAD source for a two-story house')
    expect(intro).not.toContain('footprint 80x60') // the bullet list is dropped
  })

  it('never puts raw artifact source (the .scad) in the outro subtitle', async () => {
    const comp = await autoCompose(cadSpans, { title: 'House', result: RESULT })
    const outro = comp.shots[comp.shots.length - 1]!.layers[0]!.html
    expect(outro).toContain('cleared every geometry check')
    expect(outro).not.toContain('module house')
  })

  it('shots crossfade-overlap: each shot starts before the prior one ends (no black gap)', async () => {
    const comp = await autoCompose(cadSpans, { title: 'House', result: RESULT })
    for (let i = 1; i < comp.shots.length; i++) {
      const prev = comp.shots[i - 1]!
      const cur = comp.shots[i]!
      expect(cur.startMs).toBeLessThan(prev.startMs + prev.durationMs)
    }
  })

  it('renderCompositionHtml ends on the final shot signal (last shot is not auto-hidden)', () => {
    const html = renderCompositionHtml({
      title: 'T',
      shots: [
        { id: 's0', startMs: 0, durationMs: 1000, transition: 'fade', layers: [{ html: '<html></html>', frame: 'full' }] },
        { id: 's1', startMs: 800, durationMs: 1000, transition: 'fade', layers: [{ html: '<html></html>', frame: 'full' }] },
      ],
    })
    // The final shot waits for its iframe's done-signal (polled via contentDocument)
    // rather than auto-hiding at startMs+durationMs — otherwise the outro fades to
    // black before its animation lands.
    expect(html).toContain('idx===LAST')
    expect(html).toContain("getAttribute('data-capsule-done')")
    expect(html).toContain('contentDocument')
  })
})

describe('buildNarrationScript (closes on the verdict when scored)', () => {
  it('names the gate result so the VO lands on the scoreboard beat', () => {
    const spans: Span[] = [
      { spanId: 's', runId: 'r', kind: 'tool', name: 'write', toolName: 'create_file', args: { path: 'a.scad', content: 'x' }, startedAt: 1, endedAt: 2, status: 'ok' } as Span,
    ]
    const script = buildNarrationScript(spans, 'House', { resolved: true, score: 1, checks: { a: true, b: true } })
    expect(script).toContain('2 of 2 checks')
    expect(script).toContain('resolved')
    expect(script).toContain('1.00')
  })

  it('omits the verdict sentence when no result is given', () => {
    const spans: Span[] = [
      { spanId: 's', runId: 'r', kind: 'tool', name: 'write', toolName: 'create_file', args: { path: 'a.scad', content: 'x' }, startedAt: 1, endedAt: 2, status: 'ok' } as Span,
    ]
    expect(buildNarrationScript(spans, 'House')).not.toMatch(/geometry gate/i)
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
