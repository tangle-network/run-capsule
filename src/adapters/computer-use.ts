/**
 * Adapter: computer-use steps → Span[].
 *
 * Computer-use agents (Anthropic computer-use, OpenAI CUA, desktop drivers) act
 * by taking a screenshot then issuing GUI actions — left_click, type, key,
 * scroll, screenshot — usually with the post-action screenshot attached. This
 * maps each step to a `computer.*` tool span carrying that frame on
 * `attributes.screenshot`, so the screen capsule replays the desktop session.
 *
 * Structurally typed so it fits whatever a given computer-use loop emits: pass
 * `{ action, screenshot?, coordinate?, text?, url?, reasoning? }[]`.
 */

import type { Span } from '@tangle-network/agent-eval'

export interface ComputerUseStep {
  /** e.g. 'screenshot' | 'left_click' | 'type' | 'key' | 'scroll' | 'mouse_move' */
  action: string
  /** base64 PNG/JPEG or a URL of the frame after the action. */
  screenshot?: string
  /** [x, y] for click/move actions. */
  coordinate?: [number, number] | number[]
  /** typed text or key chord. */
  text?: string
  /** target app/url if the loop tracks one. */
  url?: string
  reasoning?: string
  /** ms the step took, if known. */
  durationMs?: number
}

function asDataUri(s: string | undefined): string | undefined {
  if (!s) return undefined
  if (s.startsWith('data:') || /^https?:\/\//.test(s)) return s
  // computer-use frames are typically PNG.
  return `data:image/png;base64,${s}`
}

export function spansFromComputerUse(steps: readonly ComputerUseStep[], runId = 'computer-use'): Span[] {
  const spans: Span[] = []
  let t = 1000
  steps.forEach((step, i) => {
    const dur = step.durationMs ?? 60
    const label = step.text ? `${step.action} ${step.text}` : step.action
    spans.push({
      spanId: `cu-${i}`,
      runId,
      kind: 'tool',
      name: `computer.${step.action}`,
      toolName: `computer.${step.action}`,
      args: { action: label, coordinate: step.coordinate, text: step.text, url: step.url },
      attributes: {
        screenshot: asDataUri(step.screenshot),
        url: step.url,
        reasoning: step.reasoning,
      },
      startedAt: t,
      endedAt: t + dur,
      status: 'ok',
    } as Span)
    t += dur + 1
  })
  return spans
}
