/**
 * Map a run's trace (`Span[]`) into the EXACT data model sandbox-ui's run view
 * consumes — a `Run` + a `partMap` of `SessionPart[]` — so the video renders the
 * real `RunGroup` / `InlineToolItem` / `InlineThinkingItem` components, 1:1 with
 * the product, instead of a bespoke approximation.
 *
 * Shapes are checked against @tangle-network/sandbox-ui/types through type-only
 * imports, so this runtime module does not pull React:
 *   SessionPart = TextPart | ToolPart | ReasoningPart
 *   ToolPart.state = { status, input?, output?, error?, time? }
 *   Run = { id, messages, isComplete, isStreaming, stats, summaryText, finalTextPart }
 *
 * Tool names are normalised to the vocabulary sandbox-ui's getToolDisplayMetadata
 * keys off (bash / write / read / edit / grep / glob / web) so each tool call
 * gets its real specialized preview (command / write-file / diff / …).
 */

import type { Span } from '@tangle-network/agent-eval'
import type {
  Run,
  RunStats,
  SessionPart,
  ToolCategory,
  ToolPart,
  ToolStatus,
} from '@tangle-network/sandbox-ui/types'

type SerializedRun = Omit<Run, 'stats'> & {
  stats: Omit<RunStats, 'toolCategories'> & {
    toolCategories: ToolCategory[]
  }
}

export interface RunBundle {
  run: SerializedRun
  partMap: Record<string, SessionPart[]>
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

interface NormalizedTool {
  tool: string
  category: ToolCategory
  input: unknown
}

/** Map a tool span to sandbox-ui's display name and summary category. */
function normalizeTool(span: Extract<Span, { kind: 'tool' }>): NormalizedTool {
  const tn = span.toolName.toLowerCase()
  const a = obj(span.args)
  if (/edit|patch|apply|str_replace|diff/.test(tn)) {
    return {
      tool: 'edit',
      category: 'edit',
      input: { filePath: str(a?.path) ?? str(a?.file), diff: str(a?.diff) ?? str(a?.patch) },
    }
  }
  if (/write|create.*file|save/.test(tn)) {
    return {
      tool: 'write',
      category: 'write',
      input: { filePath: str(a?.path) ?? str(a?.file), content: str(a?.content) },
    }
  }
  if (/read|cat|open|view|get.*file/.test(tn)) {
    return { tool: 'read', category: 'read', input: { filePath: str(a?.path) ?? str(a?.file) } }
  }
  if (/grep|search/.test(tn)) return { tool: 'grep', category: 'search', input: a ?? span.args }
  if (/glob|find|list/.test(tn)) return { tool: 'glob', category: 'search', input: a ?? span.args }
  if (/browser|playwright|navigate|goto|page|web|http|fetch/.test(tn)) {
    return { tool: 'fetch', category: 'web', input: a ?? span.args }
  }
  if (/shell|bash|exec|run|terminal|command|sandbox|process|openscad|npm|pnpm|git/.test(tn)) {
    const command = typeof span.args === 'string' ? span.args : str(a?.command) ?? str(a?.cmd) ?? span.toolName
    return { tool: 'bash', category: 'command', input: { command } }
  }
  return { tool: span.toolName, category: 'other', input: span.args }
}

function toolPart(span: Extract<Span, { kind: 'tool' }>): {
  part: ToolPart
  category: ToolCategory
} {
  const { tool, category, input } = normalizeTool(span)
  const status: ToolStatus = span.status === 'error' || span.error ? 'error' : 'completed'
  const output =
    typeof span.result === 'string'
      ? span.result
      : span.result != null
        ? span.result
        : str((obj(span.attributes) ?? {}).output)
  return {
    category,
    part: {
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
  const finalAssistantIndex = ordered.findLastIndex(
    (span) => span.kind === 'llm' && Boolean(str(span.output)),
  )
  const userMsgId = 'u1'
  const asstMsgId = 'a1'
  const userParts: SessionPart[] = []
  const asstParts: SessionPart[] = []

  let firstUserCaptured = false
  let toolCount = 0
  let thinkingMs = 0
  const categories = new Set<ToolCategory>()
  const assistantTexts: string[] = []

  for (const [spanIndex, s] of ordered.entries()) {
    if (s.kind === 'llm') {
      const msgs = s.messages ?? []
      const userTurn = msgs.find((m) => m.role === 'user')
      const userText = str(userTurn?.content)
      if (!firstUserCaptured && userText) {
        userParts.push({ type: 'text', text: userText })
        firstUserCaptured = true
      }
      const out = str(s.output)
      if (out) {
        if (spanIndex === finalAssistantIndex) {
          asstParts.push({ type: 'text', text: out })
        } else {
          asstParts.push({
            type: 'reasoning',
            text: out,
            time: { start: s.startedAt, end: s.endedAt ?? s.startedAt },
          })
          thinkingMs += Math.max(0, (s.endedAt ?? s.startedAt) - s.startedAt)
        }
        assistantTexts.push(out)
      }
    } else if (s.kind === 'tool' || s.kind === 'sandbox') {
      // Screenshots / rendered images are not run-timeline text: sandbox-ui's run
      // view renders no images, so a data-URI dumped as tool output is just noise.
      // They surface as dedicated full-frame reveal shots in the composed film.
      const at = obj((s as { attributes?: unknown }).attributes)
      const toolName = (s as { toolName?: string }).toolName ?? s.name
      if (typeof at?.screenshot === 'string' || /screenshot|\brender\b|render\./i.test(toolName)) continue
      const tspan =
        s.kind === 'sandbox'
          ? ({ ...s, kind: 'tool', toolName: 'bash', args: { command: (s as { command?: string }).command ?? s.name } } as Extract<Span, { kind: 'tool' }>)
          : (s as Extract<Span, { kind: 'tool' }>)
      const normalized = toolPart(tspan)
      asstParts.push(normalized.part)
      toolCount++
      categories.add(normalized.category)
    }
  }

  const finalText = assistantTexts[assistantTexts.length - 1] ?? null
  const finalTextPartIndex = asstParts.findLastIndex(
    (part) => part.type === 'text' && !part.synthetic && part.text.trim().length > 0,
  )
  const partMap: Record<string, SessionPart[]> = {
    [userMsgId]: userParts,
    [asstMsgId]: asstParts,
  }
  const run: SerializedRun = {
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
      textPartCount: asstParts.filter((part) => part.type === 'text' && !part.synthetic).length,
      toolCategories: Array.from(categories), // serialized as array; the player rebuilds a Set
    },
    summaryText: finalText ? finalText.slice(0, 140) : null,
    finalTextPart:
      finalText && finalTextPartIndex >= 0
        ? { messageId: asstMsgId, partIndex: finalTextPartIndex, text: finalText }
        : null,
  }
  return { run, partMap }
}
