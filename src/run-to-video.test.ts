import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveKinds, runToVideo } from './run-to-video.js'

describe('resolveKinds — ingested video supersedes the screenshot replay', () => {
  it('drops the screen capsule when a recording is ingested', () => {
    expect(resolveKinds(['code', 'screen', 'replay'], true)).toEqual(['code', 'replay'])
  })

  it('keeps every kind when no video is ingested', () => {
    expect(resolveKinds(['code', 'screen', 'replay'], false)).toEqual(['code', 'screen', 'replay'])
  })

  it('is a no-op when there was no screen capsule to begin with', () => {
    expect(resolveKinds(['conversation', 'replay'], true)).toEqual(['conversation', 'replay'])
  })
})

describe('runToVideo — publishing is opt-in', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Ingesting a ready .mp4 with only the screen kind skips the browser recorder,
  // so this exercises the real upload decision without Chromium or ffmpeg.
  function ingestOnly(upload?: boolean) {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-capsule-upload-'))
    const video = path.join(outDir, 'recording.mp4')
    fs.writeFileSync(video, 'not really a video')
    return runToVideo([], { outDir, video, kinds: ['screen'], ...(upload === undefined ? {} : { upload }) })
  }

  it('keeps every clip local when upload is not requested', async () => {
    const fetchSpy = vi.fn(async () => new Response('https://files.example/clip.mp4'))
    vi.stubGlobal('fetch', fetchSpy)

    const { results } = await ingestOnly()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0]?.url).toBeUndefined()
    expect(results[0]?.error).toBeUndefined()
    expect(results[0]?.videoPath).toMatch(/screen\.mp4$/)
  })

  it('publishes only when the caller sets upload: true', async () => {
    const fetchSpy = vi.fn(async () => new Response('https://files.example/clip.mp4'))
    vi.stubGlobal('fetch', fetchSpy)

    const { results } = await ingestOnly(true)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(results[0]?.url).toBe('https://files.example/clip.mp4')
  })
})
