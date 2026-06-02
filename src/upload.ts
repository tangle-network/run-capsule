/**
 * Upload a generated clip to a public host and return a shareable link.
 *   - litterbox.catbox.moe — TEMPORARY (1h/12h/24h/72h), no account. Default.
 *   - catbox.moe — PERMANENT, optional userhash.
 *
 * NOTE: this PUBLISHES the file — anyone with the link can view it, and even
 * temporary uploads may be cached. Only upload clips safe to share publicly.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

export type ShareHost = 'litterbox' | 'catbox'
export type LitterboxExpiry = '1h' | '12h' | '24h' | '72h'

export interface UploadOptions {
  host?: ShareHost
  expiry?: LitterboxExpiry
  userhash?: string
}

const ENDPOINT: Record<ShareHost, string> = {
  litterbox: 'https://litterbox.catbox.moe/resources/internals/api.php',
  catbox: 'https://catbox.moe/user/api.php',
}

const CONTENT_TYPE: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.html': 'text/html',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.json': 'application/json',
}

export async function uploadToShareHost(filePath: string, opts: UploadOptions = {}): Promise<string> {
  const host = opts.host ?? 'litterbox'
  const data = fs.readFileSync(filePath)
  const file = new File([data], path.basename(filePath), {
    type: CONTENT_TYPE[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
  })
  const form = new FormData()
  form.set('reqtype', 'fileupload')
  if (host === 'litterbox') form.set('time', opts.expiry ?? '72h')
  if (host === 'catbox' && opts.userhash) form.set('userhash', opts.userhash)
  form.set('fileToUpload', file)

  const res = await fetch(ENDPOINT[host], { method: 'POST', body: form })
  const text = (await res.text()).trim()
  if (!res.ok || !/^https?:\/\//.test(text)) {
    throw new Error(`${host} upload failed (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  return text
}
