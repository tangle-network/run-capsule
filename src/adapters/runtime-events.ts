/**
 * Adapter: agent-eval `RuntimeEventLike[]` → Span[].
 *
 * The generic fallback for anything that already emits the produced-state event
 * stream (tool_call / artifact / proposal_created) — e.g. blueprint's
 * PlaywrightPlaybackDriver `events.json`, or any agent-runtime stream. Artifact
 * events become file-write tool spans (so the code capsule shows them); tool
 * calls become tool spans for the replay.
 */

import type { RuntimeEventLike, Span } from '@tangle-network/agent-eval'

export function spansFromRuntimeEvents(events: readonly RuntimeEventLike[], runId = 'runtime'): Span[] {
  const spans: Span[] = []
  let t = 1000
  events.forEach((ev, i) => {
    if (ev.type === 'tool_call') {
      const name = (ev as { toolName?: string }).toolName ?? 'tool'
      spans.push({
        spanId: `rt-${i}`, runId, kind: 'tool', name, toolName: name, args: {},
        startedAt: t, endedAt: t + 20, status: 'ok',
      } as Span)
    } else if (ev.type === 'artifact') {
      const a = ev as { artifactId?: string; name?: string; content?: string }
      const path = a.name ?? a.artifactId ?? `artifact-${i}`
      spans.push({
        spanId: `rt-${i}`, runId, kind: 'tool', name: 'create_file', toolName: 'create_file',
        args: { path, content: a.content ?? '' },
        startedAt: t, endedAt: t + 20, status: 'ok',
      } as Span)
    }
    t += 21
  })
  return spans
}
