import { describe, expect, it } from 'vitest'

import type { Span } from '@tangle-network/agent-eval'
import type { Run } from '@tangle-network/sandbox-ui/types'
import { traceToRunBundle } from './trace-to-run.js'

describe('traceToRunBundle', () => {
  it('matches the current Run API and points finalTextPart at the rendered answer', () => {
    const spans = [
      {
        spanId: 'reasoning',
        runId: 'run',
        kind: 'llm',
        name: 'reason',
        model: 'model',
        messages: [{ role: 'user', content: 'Fix the failing test' }],
        output: 'I will inspect the failure.',
        startedAt: 1,
        endedAt: 3,
        status: 'ok',
      },
      {
        spanId: 'shell',
        runId: 'run',
        kind: 'tool',
        name: 'shell.exec',
        toolName: 'shell.exec',
        args: { command: 'pnpm test' },
        result: '1 failing',
        startedAt: 4,
        endedAt: 5,
        status: 'ok',
      },
      {
        spanId: 'search',
        runId: 'run',
        kind: 'tool',
        name: 'grep',
        toolName: 'grep',
        args: { pattern: 'failure' },
        result: 'src/example.ts',
        startedAt: 6,
        endedAt: 7,
        status: 'ok',
      },
      {
        spanId: 'answer',
        runId: 'run',
        kind: 'llm',
        name: 'answer',
        model: 'model',
        messages: [],
        output: 'The test now passes.',
        startedAt: 8,
        endedAt: 9,
        status: 'ok',
      },
    ] as Span[]

    const bundle = traceToRunBundle(spans)
    const assistantParts = bundle.partMap.a1 ?? []
    const run: Run = {
      ...bundle.run,
      stats: {
        ...bundle.run.stats,
        toolCategories: new Set(bundle.run.stats.toolCategories),
      },
    }

    expect(assistantParts.map((part) => part.type)).toEqual([
      'reasoning',
      'tool',
      'tool',
      'text',
    ])
    expect(run.stats).toMatchObject({
      toolCount: 2,
      messageCount: 1,
      thinkingDurationMs: 2,
      textPartCount: 1,
    })
    expect([...run.stats.toolCategories]).toEqual(['command', 'search'])
    expect(run.finalTextPart).toEqual({
      messageId: 'a1',
      partIndex: 3,
      text: 'The test now passes.',
    })
  })
})
