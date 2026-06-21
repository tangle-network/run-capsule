/**
 * Adapter: @tangle-network/agent-browser-driver `TestResult` → Span[].
 *
 * The browser driver records one `Turn` per action with the page `state`
 * (url + base64 JPEG screenshot), the `action` (click/type/navigate/…), and the
 * agent's `reasoning`. This maps each turn to a browser tool span carrying the
 * screenshot on `attributes.screenshot` — exactly what the screen capsule needs
 * to show real product frames. blueprint's PlaywrightPlaybackDriver writes this
 * shape to `agent-result.json`.
 */

import type { Span } from '@tangle-network/agent-eval'

interface PwAction {
  action?: string
  selector?: string
  text?: string
  url?: string
}
interface PwState {
  url?: string
  title?: string
  screenshot?: string
}
interface PwTurn {
  turn?: number
  action?: PwAction
  state?: PwState
  reasoning?: string
  tokensUsed?: number
  durationMs?: number
  verified?: boolean
  error?: string
}
interface PwSingleResult {
  agentResult?: { turns?: PwTurn[]; result?: string }
  turns?: PwTurn[]
}
/**
 * Accepts every shape the driver writes:
 * - a bare `Turn[]`,
 * - a single `TestResult` (`{ agentResult }`) or its `agentResult` (`{ turns }`),
 * - the canonical on-disk `report.json`, which is a `TestSuiteResult`
 *   (`{ results: TestResult[] }`). For a suite we map the first case by default;
 *   selecting among multiple cases is a caller/CLI concern, not the adapter's.
 */
type PlaywrightResultLike =
  | (PwSingleResult & { results?: PwSingleResult[] })
  | PwTurn[]

function asDataUri(b64OrUrl: string | undefined, mime: string): string | undefined {
  if (!b64OrUrl) return undefined
  if (b64OrUrl.startsWith('data:') || /^https?:\/\//.test(b64OrUrl)) return b64OrUrl
  return `data:${mime};base64,${b64OrUrl}`
}

export function spansFromPlaywrightResult(result: PlaywrightResultLike, runId = 'playwright'): Span[] {
  const single: PwSingleResult = Array.isArray(result)
    ? {}
    : (result.results?.[0] ?? result)
  const turns: PwTurn[] = Array.isArray(result)
    ? result
    : (single.agentResult?.turns ?? single.turns ?? [])

  const spans: Span[] = []
  let t = 1000
  turns.forEach((turn, i) => {
    const a = turn.action ?? {}
    const verb = a.action ?? 'action'
    const dur = turn.durationMs ?? 50
    const screenshot = asDataUri(turn.state?.screenshot, 'image/jpeg')
    spans.push({
      spanId: `pw-${i}`,
      runId,
      kind: 'tool',
      name: `browser.${verb}`,
      toolName: `browser.${verb}`,
      args: { url: turn.state?.url, action: verb, selector: a.selector, text: a.text },
      result: turn.error ? { error: turn.error } : { ok: true },
      attributes: {
        screenshot,
        url: turn.state?.url,
        title: turn.state?.title,
        reasoning: turn.reasoning,
      },
      startedAt: t,
      endedAt: t + dur,
      status: turn.error ? 'error' : 'ok',
      ...(turn.error ? { error: turn.error } : {}),
    } as Span)
    t += dur + 1
  })
  return spans
}
