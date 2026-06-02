/**
 * Adapter: a Claude / Anthropic Messages stream → Span[].
 *
 * Covers any agent whose trace is a sequence of Anthropic messages — including
 * blueprint's sandbox-driver, whose `stream-shot-*.jsonl` lines are
 * `{ type: 'assistant'|'user', message: { role, content } }`. Assistant
 * `tool_use` blocks become tool spans (so code/terminal/screen capsules pick
 * them up); matching `tool_result` blocks fill in outputs; the first user
 * message seeds the task. cli-bridge's SSE passthrough carries the same message
 * payloads, so feeding its `data` here works too.
 */

import type { Span } from '@tangle-network/agent-eval'

interface Block {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
}
interface Msg {
  role?: string
  content?: string | Block[]
}
/** A raw message, or the sandbox-driver `{ type, message }` envelope. */
type MessageLike = Msg | { type?: string; message?: Msg }

function unwrap(m: MessageLike): Msg {
  return 'message' in m && m.message ? m.message : (m as Msg)
}
function textOf(content: string | Block[] | undefined): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n').trim()
}
function blocks(content: string | Block[] | undefined): Block[] {
  return Array.isArray(content) ? content : []
}
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === 'string' ? c : (c as Block)?.text ?? '')).join('\n')
  }
  return content == null ? '' : JSON.stringify(content)
}

export function spansFromClaudeMessages(
  messages: readonly MessageLike[],
  opts: { runId?: string; model?: string } = {},
): Span[] {
  const runId = opts.runId ?? 'claude'
  const spans: Span[] = []
  const toolSpanById = new Map<string, Span>()
  let t = 1000
  let taskSeeded = false

  for (const raw of messages) {
    const msg = unwrap(raw)
    const role = msg.role ?? (('type' in raw ? (raw as { type?: string }).type : undefined) ?? 'assistant')
    const text = textOf(msg.content)

    if (role === 'user') {
      if (!taskSeeded && text) {
        spans.push({
          spanId: `msg-${spans.length}`, runId, kind: 'llm', name: 'task',
          model: opts.model ?? 'claude', messages: [{ role: 'user', content: text }],
          startedAt: t, endedAt: t + 10, status: 'ok',
        } as Span)
        taskSeeded = true
        t += 11
      }
      // tool_result blocks fill in the matching tool span's output.
      for (const b of blocks(msg.content)) {
        if (b.type === 'tool_result' && b.tool_use_id) {
          const span = toolSpanById.get(b.tool_use_id)
          if (span) (span as { result?: unknown }).result = resultText(b.content)
        }
      }
      continue
    }

    // assistant: reasoning text → llm span; tool_use → tool spans.
    if (text) {
      spans.push({
        spanId: `msg-${spans.length}`, runId, kind: 'llm', name: 'assistant',
        model: opts.model ?? 'claude', messages: [{ role: 'assistant', content: text }], output: text,
        startedAt: t, endedAt: t + 10, status: 'ok',
      } as Span)
      t += 11
    }
    for (const b of blocks(msg.content)) {
      if (b.type === 'tool_use' && b.name) {
        const span = {
          spanId: `tool-${spans.length}`, runId, kind: 'tool', name: b.name, toolName: b.name,
          args: b.input ?? {}, startedAt: t, endedAt: t + 30, status: 'ok',
        } as Span
        spans.push(span)
        if (b.id) toolSpanById.set(b.id, span)
        t += 31
      }
    }
  }
  return spans
}
