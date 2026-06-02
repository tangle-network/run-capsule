/**
 * Audio for the film. run-capsule records SILENT video (headless Chromium
 * captures no audio), so sound is added in a post-record ffmpeg pass. Three
 * sources, all mixed down and muxed onto the recorded video:
 *   - agent-generated audio artifacts (whatever audio the run produced)
 *   - synthesized narration (router TTS over a script derived from the run)
 *   - a subtle music bed (ffmpeg-synthesized, ducked under narration)
 *
 * ffmpeg is the only hard dep (already required for the webm→mp4 transcode);
 * narration needs a router key (skipped, with a log, if absent — fail soft on
 * the optional polish layer, never on the core clip).
 */

import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface NarrationConfig {
  routerBaseUrl: string
  routerKey: string
  /** TTS model id on the router. Default 'gpt-4o-mini-tts'. */
  model?: string
  /** Voice name. Default 'alloy'. */
  voice?: string
}

/** Synthesize speech for `text` via the router's OpenAI-compatible TTS endpoint.
 *  Returns the mp3 path, or undefined if no key / the call fails (fail soft). */
export async function synthesizeNarration(
  text: string,
  cfg: NarrationConfig,
  outDir: string,
): Promise<string | undefined> {
  if (!cfg.routerKey || !text.trim()) return undefined
  try {
    const res = await fetch(`${cfg.routerBaseUrl.replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` },
      body: JSON.stringify({ model: cfg.model ?? 'gpt-4o-mini-tts', voice: cfg.voice ?? 'alloy', input: text.slice(0, 3500), format: 'mp3' }),
    })
    if (!res.ok) {
      console.warn(`[audio] TTS ${res.status} — narration skipped`)
      return undefined
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const out = path.join(outDir, 'narration.mp3')
    fs.writeFileSync(out, buf)
    return out
  } catch (err) {
    console.warn(`[audio] TTS failed (${err instanceof Error ? err.message : String(err)}) — narration skipped`)
    return undefined
  }
}

/** Synthesize a subtle ambient music bed of `durationSec` via ffmpeg (no asset
 *  files): two detuned low sines + a slow tremolo, kept quiet. */
export async function musicBed(durationSec: number, outDir: string): Promise<string | undefined> {
  const out = path.join(outDir, 'bed.m4a')
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', `sine=frequency=110:duration=${durationSec}`,
      '-f', 'lavfi', '-i', `sine=frequency=164.81:duration=${durationSec}`,
      '-filter_complex', '[0:a][1:a]amix=inputs=2,tremolo=f=0.15:d=0.4,volume=0.06[a]',
      '-map', '[a]', '-c:a', 'aac', out,
    ], { timeout: 60_000 })
    return out
  } catch {
    return undefined
  }
}

export interface AudioTrack {
  path: string
  /** Start offset in the film, seconds. Default 0. */
  startSec?: number
  /** Linear gain (1 = unchanged). Default 1. */
  gain?: number
}

/**
 * Mux a video + N audio tracks into one mp4. Tracks are delayed to their
 * start, gain-adjusted, mixed, and laid over the (silent) video; output length
 * follows the video. Returns the muxed path (replaces nothing — writes `*.av.mp4`).
 */
export async function muxAudioOntoVideo(
  videoPath: string,
  tracks: readonly AudioTrack[],
  outPath?: string,
): Promise<string> {
  const out = outPath ?? videoPath.replace(/\.(mp4|webm)$/i, '.av.mp4')
  if (tracks.length === 0) return videoPath
  const inputs: string[] = ['-i', videoPath]
  const filters: string[] = []
  tracks.forEach((t, i) => {
    inputs.push('-i', t.path)
    const delayMs = Math.max(0, Math.round((t.startSec ?? 0) * 1000))
    // audio input index is i+1 (video is 0)
    filters.push(`[${i + 1}:a]adelay=${delayMs}|${delayMs},volume=${t.gain ?? 1}[a${i}]`)
  })
  const mixIn = tracks.map((_, i) => `[a${i}]`).join('')
  filters.push(`${mixIn}amix=inputs=${tracks.length}:dropout_transition=0:normalize=0[mix]`)
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      ...inputs,
      '-filter_complex', filters.join(';'),
      '-map', '0:v', '-map', '[mix]',
      '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
      out,
    ],
    { timeout: 180_000, maxBuffer: 1024 * 1024 * 32 },
  )
  return out
}

/** Make a temp working dir for audio assets. */
export function audioTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rc-audio-'))
}
