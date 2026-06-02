/**
 * runToVideo — the one entrypoint. A run's trace (Span[]) in, shareable video
 * links out. Auto-selects which capsules to render based on what the trace
 * actually contains (code edits → code capsule, shell/sandbox → terminal,
 * browser/computer → screen, plus the unified storyboard replay), records each
 * headless, and uploads to a temp host.
 *
 * This is what every project hooks once: emit a trace, call runToVideo, post the
 * links. The quality of the output is the quality of the trace.
 */

import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type { Span } from '@tangle-network/agent-eval'
import {
  compileStoryboard,
  extractCodeEdits,
  reduceToSemanticEvents,
  renderStoryboardHtml,
} from '@tangle-network/agent-eval/storyboard'

import { audioTmpDir, muxAudioOntoVideo, musicBed, synthesizeNarration, type AudioTrack } from './audio.js'
import { buildNarrationScript, extractArtifacts } from './artifacts.js'
import { autoCompose, renderCompositionHtml } from './composition.js'
import { directStoryboard } from './direct.js'
import { redactSpans } from './redact.js'
import { recordHtmlToVideo } from './record.js'
import { renderCodeCapsuleHtml } from './renderers/code-capsule.js'
import {
  conversationStepsFromSpans,
  renderConversationCapsuleHtml,
} from './renderers/conversation-capsule.js'
import { renderOrbitCapsuleHtml } from './renderers/orbit-capsule.js'
import { renderScreenCapsuleHtml, screenStepsFromSpans } from './renderers/screen-capsule.js'
import { renderTerminalCapsuleHtml, terminalStepsFromSpans } from './renderers/terminal-capsule.js'
import { renderRunStudioHtml } from './studio/render.js'
import { type LitterboxExpiry, type ShareHost, uploadToShareHost } from './upload.js'

/** code/terminal/screen/conversation/replay = zero-dep capsules (auto-detected).
 *  studio = the 1:1 sandbox-ui run view; orbit = a rendered-model spin;
 *  composed = the full sequenced film. The last three are opt-in (heavier). */
export type CapsuleKind =
  | 'code'
  | 'terminal'
  | 'screen'
  | 'conversation'
  | 'replay'
  | 'studio'
  | 'orbit'
  | 'composed'

export interface RunToVideoOptions {
  title?: string
  /** Which capsules to render. Default: auto — every kind the trace supports. */
  kinds?: CapsuleKind[]
  /** Output root. A timestamped run dir is created under it. */
  outDir: string
  upload?: boolean
  host?: ShareHost
  expiry?: LitterboxExpiry
  toMp4?: boolean
  /** Stable run id (else derived from the clock). */
  runId?: string
  /** Ordered rendered-model frames (data URIs) for the orbit/composed shots. */
  orbitFrames?: readonly string[]
  /** ms between revealing each part in studio/composed timelines. */
  stepMs?: number
  /** Add a synthesized VO narration track (needs routerKey). */
  narrate?: boolean
  /** Add a subtle music bed. */
  music?: boolean
  /** Router creds for TTS narration (OpenAI-compatible /audio/speech). */
  routerKey?: string
  routerBaseUrl?: string
  /** TTS voice. Default 'alloy'. */
  voice?: string
  /** Which kinds get the audio pass. Default: the film kinds (composed/studio/replay). */
  audioKinds?: CapsuleKind[]
}

export interface CapsuleResult {
  kind: CapsuleKind
  htmlPath: string
  /** Absent if recording failed. */
  videoPath?: string
  url?: string
  /** Present if this capsule failed to record or upload — the others still ran. */
  error?: string
}

/** Which capsules does this trace actually have content for? */
export function supportedKinds(spans: readonly Span[]): CapsuleKind[] {
  const kinds: CapsuleKind[] = []
  if (extractCodeEdits(spans).length > 0) kinds.push('code')
  if (terminalStepsFromSpans(spans).length > 0) kinds.push('terminal')
  if (screenStepsFromSpans(spans).length > 0) kinds.push('screen')
  if (conversationStepsFromSpans(spans).length > 0) kinds.push('conversation')
  kinds.push('replay')
  return kinds
}

async function renderKind(
  kind: CapsuleKind,
  spans: readonly Span[],
  title: string,
  opts: RunToVideoOptions,
): Promise<string> {
  switch (kind) {
    case 'code':
      return renderCodeCapsuleHtml(spans, { title: `${title} — writing code` })
    case 'terminal':
      return renderTerminalCapsuleHtml(spans, { title: `${title} — terminal` })
    case 'screen':
      return renderScreenCapsuleHtml(spans, { title: `${title} — on screen` })
    case 'conversation':
      return renderConversationCapsuleHtml(spans, { title: `${title} — conversation` })
    case 'replay':
      return renderStoryboardHtml(
        directStoryboard(compileStoryboard(reduceToSemanticEvents(spans), { title })),
        { title },
      )
    case 'studio':
      return renderRunStudioHtml(spans, { title, stepMs: opts.stepMs })
    case 'orbit':
      return renderOrbitCapsuleHtml(opts.orbitFrames ?? [], { title: `${title} — rendered` })
    case 'composed':
      return renderCompositionHtml(
        await autoCompose(spans, { title, orbitFrames: opts.orbitFrames, stepMs: opts.stepMs }),
      )
  }
}

const FILM_KINDS: ReadonlySet<CapsuleKind> = new Set(['composed', 'studio', 'replay'])

/** ffprobe a media file's duration in seconds (0 if unknown). */
async function probeDurationSec(file: string): Promise<number> {
  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const { stdout } = await promisify(execFile)('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
    ])
    return Number.parseFloat(stdout.trim()) || 0
  } catch {
    return 0
  }
}

/** Build narration + music + agent-audio tracks and mux them onto the video.
 *  Returns the (possibly new) video path; on any failure returns the input. */
async function maybeAddAudio(
  videoPath: string,
  kind: CapsuleKind,
  spans: readonly Span[],
  title: string,
  opts: RunToVideoOptions,
): Promise<string> {
  const wantAudio = opts.narrate || opts.music
  const kindsForAudio = opts.audioKinds ? new Set(opts.audioKinds) : FILM_KINDS
  if (!wantAudio || !kindsForAudio.has(kind)) return videoPath
  try {
    const dir = audioTmpDir()
    const tracks: AudioTrack[] = []
    // agent-generated audio artifacts ride first (full level)
    for (const a of extractArtifacts(spans).audios) tracks.push({ path: a.src, gain: 1 })
    if (opts.narrate && opts.routerKey) {
      const script = buildNarrationScript(spans, title)
      const vo = await synthesizeNarration(script, {
        routerBaseUrl: opts.routerBaseUrl ?? 'https://router.tangle.tools/v1',
        routerKey: opts.routerKey,
        voice: opts.voice,
      }, dir)
      if (vo) tracks.push({ path: vo, startSec: 0.4, gain: 1 })
    }
    if (opts.music) {
      const durSec = (await probeDurationSec(videoPath)) || 24
      const bed = await musicBed(durSec, dir)
      if (bed) tracks.push({ path: bed, gain: 1 }) // already quiet (volume=0.06)
    }
    if (tracks.length === 0) return videoPath
    return await muxAudioOntoVideo(videoPath, tracks)
  } catch (err) {
    console.warn(`[audio] mux skipped (${err instanceof Error ? err.message : String(err)})`)
    return videoPath
  }
}

export async function runToVideo(
  spans: readonly Span[],
  opts: RunToVideoOptions,
): Promise<{ runDir: string; results: CapsuleResult[] }> {
  const title = opts.title ?? 'Agent run'
  // Strip secrets BEFORE anything is rendered/recorded/uploaded — the clip is
  // published. Everything downstream operates on the redacted copy.
  const safe = redactSpans(spans)
  const kinds = opts.kinds && opts.kinds.length ? opts.kinds : supportedKinds(safe)
  // Default run id is a deterministic content hash, so re-running the same trace
  // re-uses the same dir (no clock dependence).
  const runId = opts.runId ?? `run-${createHash('sha1').update(JSON.stringify(safe)).digest('hex').slice(0, 12)}`
  const runDir = path.join(opts.outDir, runId)
  fs.mkdirSync(runDir, { recursive: true })

  const results: CapsuleResult[] = []
  for (const kind of kinds) {
    const htmlPath = path.join(runDir, `${kind}.html`)
    // One capsule failing (a flaky upload, a recorder hiccup) must not lose the
    // others — record the error on this capsule and keep going.
    try {
      fs.writeFileSync(htmlPath, await renderKind(kind, safe, title, opts))
      const { webm, mp4 } = await recordHtmlToVideo(htmlPath, runDir, { toMp4: opts.toMp4 ?? true })
      let videoPath = mp4 ?? webm
      // Audio pass (opt-in): lay narration + music + the agent's own audio over
      // the silent recording. Fail soft — a film without sound still ships.
      videoPath = await maybeAddAudio(videoPath, kind, safe, title, opts)
      let url: string | undefined
      if (opts.upload ?? true) {
        url = await uploadToShareHost(videoPath, { host: opts.host, expiry: opts.expiry })
      }
      results.push({ kind, htmlPath, videoPath, url })
    } catch (err) {
      results.push({ kind, htmlPath, error: err instanceof Error ? err.message : String(err) })
    }
  }

  fs.writeFileSync(
    path.join(runDir, 'capsule.json'),
    JSON.stringify({ runId, title, results: results.map(({ kind, url, videoPath }) => ({ kind, url, videoPath })) }, null, 2),
  )
  return { runDir, results }
}
