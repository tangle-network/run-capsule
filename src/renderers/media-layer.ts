/**
 * Self-contained layers for agent-generated media artifacts — a video clip the
 * agent produced, or a document (PDF). Used as composition layers/shots so an
 * agent's output media appears in the film alongside the run timeline.
 *
 * Video plays muted in the visual layer (its audio, if any, is extracted +
 * muxed separately by audio.ts so it survives the silent screen-record). Both
 * set `data-capsule-done` when finished.
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function attr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

export interface MediaLayerOptions {
  title?: string
  caption?: string
  /** Fallback done-signal if the media doesn't fire `ended`, ms. Default 8000. */
  maxMs?: number
}

/** A layer that plays an agent-generated video clip (muted; audio muxed separately). */
export function renderVideoLayerHtml(src: string, opts: MediaLayerOptions = {}): string {
  const title = opts.title ?? 'Generated video'
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  body{margin:0;height:100vh;background:#05070d;color:#e6edf3;font:14px ui-sans-serif,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
  h1{font-size:1rem;color:#9aa7b5;margin:0;font-weight:600}
  video{max-width:92vw;max-height:78vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.6);background:#000}
  .cap{color:#7d8da0;font-size:.9rem;max-width:680px;text-align:center}
  </style></head><body>
  <h1>🎞 ${esc(title)}</h1>
  <video id="v" src="${attr(src)}" autoplay muted playsinline></video>
  ${opts.caption ? `<div class="cap">${esc(opts.caption)}</div>` : ''}
  <script>
    var v=document.getElementById('v'), done=function(){document.body.setAttribute('data-capsule-done','true')};
    v.addEventListener('ended',done); v.addEventListener('error',done);
    setTimeout(done, ${opts.maxMs ?? 8000});
  </script></body></html>`
}

/** A layer that shows an agent-generated document (PDF data-URI or URL). */
export function renderDocLayerHtml(src: string, opts: MediaLayerOptions = {}): string {
  const title = opts.title ?? 'Generated document'
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  body{margin:0;height:100vh;background:#0b0f17;color:#e6edf3;font:14px ui-sans-serif,system-ui,sans-serif;display:flex;flex-direction:column}
  header{padding:9px 16px;background:#111824;border-bottom:1px solid #1e2a3a;color:#9aa7b5;font-size:.85rem;font-weight:600}
  .frame{flex:1;border:0;background:#1b1f2a}
  iframe{width:100%;height:100%;border:0;background:#fff}
  </style></head><body>
  <header>📄 ${esc(title)}</header>
  <iframe class="frame" src="${attr(src)}"></iframe>
  <script>setTimeout(function(){document.body.setAttribute('data-capsule-done','true')}, ${opts.maxMs ?? 7000});</script>
  </body></html>`
}
