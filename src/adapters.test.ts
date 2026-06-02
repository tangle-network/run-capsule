import { describe, expect, it } from 'vitest'

import {
  extractCodeEdits,
  spansFromClaudeMessages,
  spansFromComputerUse,
  spansFromPlaywrightResult,
  spansFromRuntimeEvents,
} from './index.js'
import { screenStepsFromSpans } from './renderers/screen-capsule.js'
import { terminalStepsFromSpans } from './renderers/terminal-capsule.js'

describe('per-surface adapters', () => {
  it('playwright TestResult → browser spans carrying screenshots', () => {
    const spans = spansFromPlaywrightResult({
      agentResult: {
        turns: [
          { action: { action: 'navigate', url: 'https://app' }, state: { url: 'https://app', screenshot: 'QkFTRTY0' }, reasoning: 'open the app' },
          { action: { action: 'click', selector: '.go' }, state: { url: 'https://app/x', screenshot: 'QkFTRTY0Mg==' } },
        ],
      },
    })
    expect(spans).toHaveLength(2)
    const screen = screenStepsFromSpans(spans)
    expect(screen).toHaveLength(2)
    expect(screen[0]?.image).toMatch(/^data:image\/jpeg;base64,/)
    expect(screen[0]?.url).toBe('https://app')
  })

  it('computer-use steps → computer spans for the screen capsule', () => {
    const spans = spansFromComputerUse([
      { action: 'screenshot', screenshot: 'UE5HQg==' },
      { action: 'left_click', coordinate: [12, 34], screenshot: 'UE5HQg==' },
    ])
    const screen = screenStepsFromSpans(spans)
    expect(screen).toHaveLength(2)
    expect(screen[0]?.image).toMatch(/^data:image\/png;base64,/)
  })

  it('claude messages → tool spans (code) + tool_result outputs (terminal)', () => {
    const spans = spansFromClaudeMessages([
      { type: 'user', message: { role: 'user', content: 'Build a CLI' } },
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'text', text: 'Writing the entry file.' },
        { type: 'tool_use', id: 'tu1', name: 'create_file', input: { path: 'src/cli.ts', content: 'export const run = () => 0\n' } },
        { type: 'tool_use', id: 'tu2', name: 'shell.exec', input: { command: 'npm test' } },
      ] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu2', content: '5 passing' }] } },
    ])
    const edits = extractCodeEdits(spans)
    expect(edits.map((e) => e.path)).toContain('src/cli.ts')
    const term = terminalStepsFromSpans(spans)
    expect(term.some((s) => s.command === 'npm test' && s.output.includes('5 passing'))).toBe(true)
  })

  it('runtime events: artifact → create_file span the code capsule reads', () => {
    const spans = spansFromRuntimeEvents([
      { type: 'tool_call', toolName: 'read_file' } as never,
      { type: 'artifact', artifactId: 'a1', name: 'src/index.ts', content: 'export default 1\n' } as never,
    ])
    const edits = extractCodeEdits(spans)
    expect(edits.map((e) => e.path)).toEqual(['src/index.ts'])
  })
})
