/**
 * Record a self-contained capsule HTML page to a real video.
 *
 * Drives the auto-playing HTML in headless Chromium and captures it as .webm,
 * then (optionally) transcodes to .mp4 via ffmpeg. Every capsule's play button
 * flips to "▶ Play" on completion — that's the done-signal contract this poller
 * relies on, so recording stops exactly when the animation finishes.
 */

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { chromium } from 'playwright'

export interface RecordVideoOptions {
  width?: number
  height?: number
  /** Cap on waiting for the animation to finish. Default 240s. */
  maxDurationMs?: number
  /** Keep recording this long after completion. Default 1200ms. */
  tailMs?: number
  /** Transcode webm → mp4 (H.264). Default true. */
  toMp4?: boolean
}

function animationDonePredicate(): boolean {
  // Primary contract: a capsule sets data-capsule-done on <body> when finished.
  if (document.body.getAttribute('data-capsule-done') === 'true') return true
  // Fallback for capsules that only flip their play button to "▶ Play".
  return Array.from(document.querySelectorAll('button')).some((b) => /Play/.test(b.textContent || ''))
}

export async function recordHtmlToVideo(
  htmlPath: string,
  outDir: string,
  opts: RecordVideoOptions = {},
): Promise<{ webm: string; mp4?: string; durationMs: number }> {
  const width = opts.width ?? 1280
  const height = opts.height ?? 720
  fs.mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] })
  const startedAt = Date.now()
  let raw: string | undefined
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      recordVideo: { dir: outDir, size: { width, height } },
    })
    const page = await context.newPage()
    await page.goto(`file://${path.resolve(htmlPath)}`, { waitUntil: 'load' })
    try {
      await page.waitForFunction(animationDonePredicate, { timeout: opts.maxDurationMs ?? 240_000 })
    } catch {
      // No completion signal in time — keep what recorded rather than fail.
    }
    await page.waitForTimeout(opts.tailMs ?? 1200)
    const video = page.video()
    await page.close()
    await context.close()
    raw = video ? await video.path() : undefined
  } finally {
    await browser.close()
  }
  if (!raw) throw new Error('recordHtmlToVideo: no video captured')

  const base = path.basename(htmlPath).replace(/\.html$/, '')
  const webm = path.join(outDir, `${base}.webm`)
  if (path.resolve(raw) !== path.resolve(webm)) fs.renameSync(raw, webm)

  let mp4: string | undefined
  if (opts.toMp4 ?? true) {
    mp4 = path.join(outDir, `${base}.mp4`)
    try {
      execFileSync(
        'ffmpeg',
        ['-y', '-i', webm, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4],
        { stdio: 'ignore' },
      )
    } catch {
      mp4 = undefined
    }
  }
  return { webm, mp4, durationMs: Date.now() - startedAt }
}
