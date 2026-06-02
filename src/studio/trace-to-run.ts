/**
 * Map a run's trace (`Span[]`) into the EXACT data model sandbox-ui's run view
 * consumes — a `Run` + a `partMap` of `SessionPart[]` — so the video renders the
 * real `RunGroup` / `InlineToolItem` / `InlineThinkingItem` components, 1:1 with
 * the product, instead of a bespoke approximation.
 *
 * Shapes mirror @tangle-network/sandbox-ui/types (kept as local structural types
 * so this module stays usable from plain TS without pulling React):
 *   SessionPart = TextPart | ToolPart | ReasoningPart
 *   ToolPart.state = { status, input?, output?, error?, time? }
 *   Run = { id, messages, isComplete, isStreaming, stats, summaryText, finalTextPart }
 *
 * Tool names are normalised to the vocabulary sandbox-ui's getToolDisplayMetadata
 * keys off (bash / write / read / edit / grep / glob / web) so each tool call
 * gets its real specialized preview (command / write-file / diff / …).
 */

import type { Span } from '@tangle-network/agent-eval'

export interface RunBundle {
  run: unknown // sandbox-ui Run (structural; the React side imports the real type)
  partMap: Record<string, unknown[]> // Record<string, SessionPart[]>
}

type ToolStatus = 'pending' | 'running' | 'completed' | 'error'

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

/** Map a tool span's name to sandbox-ui's tool vocabulary so it gets the right
 *  icon + specialized preview. */
function normalizeTool(span: Extract<Span, { kind: 'tool' }>): { tool: string; input: unknown } {
  const tn = span.toolName.toLowerCase()
  const a = obj(span.args)
  if (/edit|patch|apply|str_replace|diff/.test(tn)) {
    return { tool: 'edit', input: { filePath: str(a?.path) ?? str(a?.file), diff: str(a?.diff) ?? str(a?.patch) } }
  }
  if (/write|create.*file|save/.test(tn)) {
    return { tool: 'write', input: { filePath: str(a?.path) ?? str(a?.file), content: str(a?.content) } }
  }
  if (/read|cat|open|view|get.*file/.test(tn)) {
    return { tool: 'read', input: { filePath: str(a?.path) ?? str(a?.file) } }
  }
  if (/grep|search/.test(tn)) return { tool: 'grep', input: a ?? span.args }
  if (/glob|find|list/.test(tn)) return { tool: 'glob', input: a ?? span.args }
  if (/browser|playwright|navigate|goto|page|web|http|fetch|render|screenshot/.test(tn)) {
    return { tool: 'web', input: a ?? span.args }
  }
  if (/shell|bash|exec|run|terminal|command|sandbox|process|openscad|npm|pnpm|git/.test(tn)) {
    const command = typeof span.args === 'string' ? span.args : str(a?.command) ?? str(a?.cmd) ?? span.toolName
    return { tool: 'bash', input: { command } }
  }
  return { tool: span.toolName, input: span.args }
}

function toolPart(span: Extract<Span, { kind: 'tool' }>): unknown {
  const { tool, input } = normalizeTool(span)
  const status: ToolStatus = span.status === 'error' || span.error ? 'error' : 'completed'
  const output =
    typeof span.result === 'string'
      ? span.result
      : span.result != null
        ? span.result
        : str((obj(span.attributes) ?? {}).output)
  return {
    type: 'tool',
    id: span.spanId,
    tool,
    callID: span.spanId,
    state: {
      status,
      input,
      output,
      error: span.error,
      time: { start: span.startedAt, end: span.endedAt ?? span.startedAt },
    },
  }
}

/**
 * Reduce the trace into one user message (the brief) + one assistant run whose
 * parts are the interleaved reasoning / tool calls / final text — exactly what
 * RunGroup expects. The first user turn becomes the user message; assistant
 * `output` text becomes reasoning blocks (so the thinking UI shows), tool spans
 * become tool calls, and the last assistant output becomes the final text part.
 */
export function traceToRunBundle(spans: readonly Span[]): RunBundle {
  const ordered = [...spans].sort((a, b) => a.startedAt - b.startedAt)
  const userMsgId = 'u1'
  const asstMsgId = 'a1'
  const userParts: unknown[] = []
  const asstParts: unknown[] = []

  let firstUserCaptured = false
  let toolCount = 0
  let thinkingMs = 0
  const categories = new Set<string>()
  const assistantTexts: string[] = []

  for (const s of ordered) {
    if (s.kind === 'llm') {
      const msgs = s.messages ?? []
      const userTurn = msgs.find((m) => m.role === 'user')
      if (!firstUserCaptured && userTurn && str(userTurn.content)) {
        userParts.push({ type: 'text', text: str(userTurn.content) })
        firstUserCaptured = true
      }
      const out = str(s.output)
      if (out) {
        // Assistant prose → a reasoning block (shows the thinking UI), and track
        // it as the running narrative; the final one also becomes the answer.
        asstParts.push({ type: 'reasoning', text: out, time: { start: s.startedAt, end: s.endedAt ?? s.startedAt } })
        thinkingMs += Math.max(0, (s.endedAt ?? s.startedAt) - s.startedAt)
        assistantTexts.push(out)
      }
    } else if (s.kind === 'tool' || s.kind === 'sandbox') {
      const tspan =
        s.kind === 'sandbox'
          ? ({ ...s, kind: 'tool', toolName: 'bash', args: { command: (s as { command?: string }).command ?? s.name } } as Extract<Span, { kind: 'tool' }>)
          : (s as Extract<Span, { kind: 'tool' }>)
      asstParts.push(toolPart(tspan))
      toolCount++
      categories.add(normalizeTool(tspan).tool)
    }
  }

  const finalText = assistantTexts[assistantTexts.length - 1] ?? null
  const partMap: Record<string, unknown[]> = { [userMsgId]: userParts, [asstMsgId]: asstParts }
  const run = {
    id: 'run-1',
    messages: [
      { id: userMsgId, role: 'user', _insertionIndex: 0 },
      { id: asstMsgId, role: 'assistant', _insertionIndex: 1 },
    ],
    isComplete: true,
    isStreaming: false,
    stats: {
      toolCount,
      messageCount: 1,
      thinkingDurationMs: thinkingMs,
      textPartCount: assistantTexts.length,
      toolCategories: Array.from(categories), // serialized as array; the player rebuilds a Set
    },
    summaryText: finalText ? finalText.slice(0, 140) : null,
    finalTextPart: finalText ? { type: 'text', text: finalText } : null,
  }
  return { run, partMap }
}
