import { describe, expect, it } from 'vitest'

import { resolveKinds } from './run-to-video.js'

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
