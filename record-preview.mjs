import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import { uploadToShareHost } from './dist/index.js'

const url = process.argv[2] || 'http://localhost:3100/'
const dir = '/tmp/preview-cap'
fs.mkdirSync(dir, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } })
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
await page.waitForTimeout(1800) // let the app mount + render
// a gentle tour of the running app
for (let i = 0; i < 7; i++) { await page.mouse.wheel(0, 320); await page.waitForTimeout(750) }
await page.waitForTimeout(1200)
const video = page.video()
await page.close(); await ctx.close(); await browser.close()
const raw = await video.path()
const webm = `${dir}/preview.webm`; if (raw) fs.renameSync(raw, webm)
const mp4 = `${dir}/preview.mp4`
execFileSync('ffmpeg', ['-y','-i',webm,'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-movflags','+faststart',mp4], { stdio: 'ignore' })
const link = await uploadToShareHost(mp4, { host: 'litterbox', expiry: '72h' })
console.log('PREVIEW_LINK', link)
