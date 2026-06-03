/**
 * Cinematic intro / outro cards. The film opens on the task framed as a mission
 * (kinetic word-by-word title, brand wordmark, animated gradient + vignette) and
 * closes on the outcome. Richer than the plain `renderCardHtml` summary card —
 * these are the bookend shots.
 *
 * Self-contained; sets `data-capsule-done` after the in-animation settles + a
 * hold, the recorder's stop signal.
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Split a title into word spans so each can stagger-in (kinetic typography). */
function kineticWords(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => `<span class="w" style="--d:${i * 90}ms">${esc(w)}</span>`)
    .join(' ')
}

const BRAND_CSS = `
  :root{color-scheme:dark;--accent:#7c8bff;--accent2:#34d399}*{box-sizing:border-box}
  html,body{margin:0;height:100%;overflow:hidden}
  body{height:100vh;color:#eef1fb;font:16px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;padding:24px 8%;
    position:relative;background:#06070e}
  /* Slow animated aurora behind everything. */
  .aurora{position:fixed;inset:-20%;z-index:0;filter:blur(60px);opacity:.55;
    background:
      radial-gradient(40% 50% at 28% 32%, rgba(124,139,255,.55), transparent 70%),
      radial-gradient(38% 46% at 74% 60%, rgba(52,211,153,.32), transparent 70%),
      radial-gradient(46% 52% at 56% 24%, rgba(99,102,241,.4), transparent 72%);
    animation:drift 14s ease-in-out infinite alternate}
  @keyframes drift{from{transform:translate3d(-3%,-2%,0) scale(1.02)}to{transform:translate3d(4%,3%,0) scale(1.12)}}
  .vignette{position:fixed;inset:0;z-index:1;pointer-events:none;
    background:radial-gradient(120% 120% at 50% 46%, transparent 52%, rgba(3,4,10,.82) 100%)}
  .wrap{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:14px;max-width:min(900px,92vw)}
  .brand{display:flex;align-items:center;gap:9px;font-weight:700;letter-spacing:.04em;font-size:.92rem;color:#c7cffb;
    opacity:0;animation:up .7s cubic-bezier(.2,.7,.2,1) .05s forwards}
  .brand .mk{width:22px;height:22px;border-radius:6px;
    background:conic-gradient(from 210deg,var(--accent),var(--accent2),var(--accent));
    box-shadow:0 0 18px rgba(124,139,255,.6);display:inline-block}
  .eyebrow{font-size:.74rem;letter-spacing:.34em;text-transform:uppercase;font-weight:700;color:#8a97c8;
    opacity:0;animation:up .7s cubic-bezier(.2,.7,.2,1) .25s forwards}
  h1{font-size:clamp(1.9rem,4.6vw,3rem);font-weight:760;margin:0;line-height:1.1;letter-spacing:-.015em;
    max-width:16ch;text-wrap:balance}
  h1 .w{display:inline-block;opacity:0;transform:translateY(22px) rotateX(40deg);transform-origin:bottom;
    background:linear-gradient(180deg,#ffffff,#c5ccf7);-webkit-background-clip:text;background-clip:text;color:transparent;
    animation:wordin .62s cubic-bezier(.2,.75,.25,1.1) forwards;animation-delay:calc(.55s + var(--d))}
  @keyframes wordin{to{opacity:1;transform:none}}
  p{color:#aeb8d8;font-size:1.06rem;margin:0;max-width:42ch;opacity:0;white-space:pre-wrap;
    animation:up .8s ease forwards;animation-delay:1.1s}
  .rule{width:0;height:3px;border-radius:3px;margin-top:4px;
    background:linear-gradient(90deg,var(--accent),var(--accent2));
    box-shadow:0 0 16px rgba(124,139,255,.5);animation:grow 1s cubic-bezier(.2,.7,.2,1) .9s forwards}
  @keyframes grow{to{width:120px}}
  @keyframes up{to{opacity:1;transform:none}}
  .stat{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:8px;opacity:0;
    animation:up .8s ease forwards;animation-delay:1.2s}
  .stat .chip{font-size:.84rem;color:#bcc6e6;padding:7px 14px;border-radius:999px;
    background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);font-weight:600;font-variant-numeric:tabular-nums}
  .stat .chip b{color:#fff}
`

export interface IntroOptions {
  eyebrow?: string
  /** Mission line — the task, framed. */
  subtitle?: string
  brand?: string
  /** Hold (ms) after the in-animation before done. Default 1200. */
  holdMs?: number
}

/** The opening shot: brand wordmark → eyebrow → kinetic title → mission line. */
export function renderIntroHtml(title: string, opts: IntroOptions = {}): string {
  const brand = opts.brand ?? 'Tangle'
  const eyebrow = opts.eyebrow ?? 'Agent mission'
  const holdMs = opts.holdMs ?? 1200
  // last word lands at ~.55 + (n-1)*.09 + .62s; mission at 1.1 + .8s
  const words = title.split(/\s+/).filter(Boolean).length
  const settleMs = Math.max(1900, 550 + (words - 1) * 90 + 620, 1100 + 800)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><title>${esc(title)}</title>
<style>${BRAND_CSS}</style></head><body>
  <div class="aurora"></div><div class="vignette"></div>
  <div class="wrap">
    <div class="brand"><span class="mk"></span>${esc(brand)}</div>
    <div class="eyebrow">${esc(eyebrow)}</div>
    <h1>${kineticWords(title)}</h1>
    <div class="rule"></div>
    ${opts.subtitle ? `<p>${esc(opts.subtitle)}</p>` : ''}
  </div>
  <script>setTimeout(function(){document.body.setAttribute('data-capsule-done','true');}, ${settleMs + holdMs});</script>
</body></html>`
}

export interface OutroOptions {
  eyebrow?: string
  subtitle?: string
  brand?: string
  /** Optional outcome chips (e.g. "7/7 checks", "score 1.00"). */
  stats?: string[]
  holdMs?: number
}

/** The closing shot: outcome framed, brand sign-off, optional stat chips. */
export function renderOutroHtml(title: string, opts: OutroOptions = {}): string {
  const brand = opts.brand ?? 'Tangle'
  const eyebrow = opts.eyebrow ?? 'Verified'
  const holdMs = opts.holdMs ?? 1600
  const words = title.split(/\s+/).filter(Boolean).length
  const settleMs = Math.max(2000, 550 + (words - 1) * 90 + 620, 1200 + 800)
  const stats = (opts.stats ?? [])
    .map((s) => {
      // Bold the first numeric token (e.g. "7/7", "1.00", "308") wherever it sits.
      const m = /(\d[\d./]*)/.exec(s.trim())
      if (!m) return `<span class="chip">${esc(s.trim())}</span>`
      const before = s.trim().slice(0, m.index)
      const after = s.trim().slice(m.index + m[0].length)
      return `<span class="chip">${esc(before)}<b>${esc(m[0])}</b>${esc(after)}</span>`
    })
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><title>${esc(title)}</title>
<style>${BRAND_CSS}</style></head><body>
  <div class="aurora"></div><div class="vignette"></div>
  <div class="wrap">
    <div class="brand"><span class="mk"></span>${esc(brand)}</div>
    <div class="eyebrow">${esc(eyebrow)}</div>
    <h1>${kineticWords(title)}</h1>
    <div class="rule"></div>
    ${opts.subtitle ? `<p>${esc(opts.subtitle)}</p>` : ''}
    ${stats ? `<div class="stat">${stats}</div>` : ''}
  </div>
  <script>setTimeout(function(){document.body.setAttribute('data-capsule-done','true');}, ${settleMs + holdMs});</script>
</body></html>`
}
