/**
 * Extract the media ARTIFACTS an agent generated from its trace — video, audio,
 * and documents — so they can be shown/played/heard in the film, not just the
 * code/terminal/screen the agent touched. Images are handled by the screen
 * capsule and 3D models by the orbit capsule; this covers the rest.
 *
 * Sources, per span: a data: URI or http(s) URL on attributes / result / args
 * whose mime or extension names the modality. Keeps it heuristic + permissive —
 * an agent that emits `attributes.video` or a `.mp4` result is surfaced.
 *
 * Also derives a short narration script from the run for TTS.
 */

import type { Span } from '@tangle-network/agent-eval'
import { reduceToSemanticEvents } from '@tangle-network/agent-eval/storyboard'

export interface MediaArtifact {
  src: string
  label: string
  spanId: string
}
export interface RunArtifacts {
  videos: MediaArtifact[]
  audios: MediaArtifact[]
  docs: MediaArtifact[]
}

const VIDEO_RE = /^data:video\/|\.(mp4|webm|mov|m4v)(\?|$)/i
const AUDIO_RE = /^data:audio\/|\.(mp3|wav|m4a|ogg|flac|aac)(\?|$)/i
const DOC_RE = /^data:application\/pdf|\.(pdf)(\?|$)/i

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

/** Pull every string-ish field off a span where an artifact might ride. */
function candidates(span: Span): string[] {
  const out: string[] = []
  const push = (v: unknown) => {
    const s = str(v)
    if (s) out.push(s)
  }
  const a = obj(span.attributes)
  if (a) for (const k of ['video', 'audio', 'pdf', 'doc', 'url', 'href', 'artifact', 'output', 'src', 'file']) push(a[k])
  push((span as { result?: unknown }).result)
  const r = obj((span as { result?: unknown }).result)
  if (r) for (const k of ['url', 'src', 'video', 'audio', 'pdf', 'path', 'artifact']) push(r[k])
  const args = obj((span as { args?: unknown }).args)
  if (args) for (const k of ['url', 'src', 'path', 'output', 'outputPath']) push(args[k])
  return out
}

/** Extract video / audio / doc artifacts an agent produced, in trace order. */
export function extractArtifacts(spans: readonly Span[]): RunArtifacts {
  const out: RunArtifacts = { videos: [], audios: [], docs: [] }
  const seen = new Set<string>()
  for (const span of [...spans].sort((x, y) => x.startedAt - y.startedAt)) {
    const label = span.kind === 'tool' ? (span as { toolName?: string }).toolName ?? span.name : span.name
    for (const c of candidates(span)) {
      if (seen.has(c)) continue
      if (VIDEO_RE.test(c)) {
        out.videos.push({ src: c, label, spanId: span.spanId })
        seen.add(c)
      } else if (AUDIO_RE.test(c)) {
        out.audios.push({ src: c, label, spanId: span.spanId })
        seen.add(c)
      } else if (DOC_RE.test(c)) {
        out.docs.push({ src: c, label, spanId: span.spanId })
        seen.add(c)
      }
    }
  }
  return out
}

/** A short voiceover script derived from the run: the ask, the key beats, the
 *  outcome. Kept terse — it's narration, not a transcript. */
export function buildNarrationScript(spans: readonly Span[], title: string): string {
  const ev = reduceToSemanticEvents(spans)
  const ask = ev.find((e) => e.kind === 'understood_task')?.summary
  const reply = [...ev].reverse().find((e) => e.kind === 'agent_reply')?.summary
  const edits = ev.filter((e) => e.kind === 'edited_code').length
  const cmds = ev.filter((e) => e.kind === 'ran_command').length
  const fails = ev.filter((e) => e.kind === 'observed_failure').length
  const parts: string[] = [`${title}.`]
  if (ask) parts.push(`The task: ${ask}.`)
  const did: string[] = []
  if (edits) did.push(`${edits} code ${edits === 1 ? 'edit' : 'edits'}`)
  if (cmds) did.push(`${cmds} ${cmds === 1 ? 'command' : 'commands'}`)
  if (fails) did.push(`recovering from ${fails} ${fails === 1 ? 'failure' : 'failures'}`)
  if (did.length) parts.push(`The agent worked through ${did.join(', ')}.`)
  if (reply) parts.push(reply)
  return parts.join(' ')
}
