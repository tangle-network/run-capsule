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

export interface ImageRevealOptions {
  title?: string
  /** ms each image is held (incl. crossfade). Default 2600. */
  perMs?: number
}

/**
 * Reveal a sequence of rendered images full-frame — each held with a slow
 * Ken-Burns push and crossfaded to the next, with a per-image caption chip.
 * For CAD/design runs this is the payoff shot: the agent's actual rendered
 * output (round-by-round) shown big, not buried as tool-call text. Sets
 * `data-capsule-done` after the last image's hold.
 */
export function renderImageRevealHtml(
  images: ReadonlyArray<{ src: string; caption?: string }>,
  opts: ImageRevealOptions = {},
): string {
  const title = opts.title ?? 'Rendered result'
  const perMs = opts.perMs ?? 2600
  const fadeMs = 560
  const json = JSON.stringify(images.map((i) => ({ src: i.src, caption: i.caption ?? '' })))
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/><title>${esc(title)}</title><style>
  :root{color-scheme:dark;--per:${perMs}ms;--fade:${fadeMs}ms}*{box-sizing:border-box}
  body{margin:0;height:100vh;background:radial-gradient(circle at 50% 38%, #141d31 0%, #06080f 72%);color:#e6edf3;
    font:14px/1.5 ui-sans-serif,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;overflow:hidden}
  body::after{content:"";position:fixed;inset:0;pointer-events:none;
    background:radial-gradient(120% 120% at 50% 48%, transparent 60%, rgba(3,5,12,.6) 100%)}
  h1{font-size:1.05rem;font-weight:600;color:#9aa7b5;margin:0;letter-spacing:.02em;z-index:2}
  .stage{position:relative;width:min(880px,90vw);aspect-ratio:16/10;display:flex;align-items:center;justify-content:center;z-index:2}
  /* Two stacked buffers, opacity JS-driven (no implicit class toggles).
     Invariant: a buffer's src is overwritten only after its opacity has fully
     reached 0, so two distinct images are never partly visible at once. */
  .stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;
    transition:opacity var(--fade) ease;filter:drop-shadow(0 26px 64px rgba(0,0,0,.6));will-change:opacity,transform}
  .stage img.kb{animation:kb var(--per) linear forwards}
  @keyframes kb{from{transform:scale(1.01)}to{transform:scale(1.07)}}
  .cap{min-height:1.4em;color:#aeb9ff;font-weight:600;font-size:.95rem;letter-spacing:.04em;opacity:0;transition:opacity .4s ease;z-index:2}
  .cap.show{opacity:1}
  .empty{color:#5b6b7d;padding:40px}
  </style></head><body>
  <h1>🏠 ${esc(title)}</h1>
  <div class="stage" id="stage"><img id="a"/><img id="b"/></div>
  <div class="cap" id="cap"></div>
  <script>
    var IMGS=${json}, PER=${perMs}, FADE=${fadeMs};
    var cap=document.getElementById('cap'), a=document.getElementById('a'), b=document.getElementById('b');
    var done=function(){document.body.setAttribute('data-capsule-done','true')};
    function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
    function raf(){return new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});});}
    // Decode the next frame INTO the hidden back buffer (opacity 0) before
    // crossfading. Each load is capped so a stuck frame can't stall the recorder.
    function ready(im,src){return new Promise(function(res){
      var fin=false, ok=function(){if(!fin){fin=true;res();}};
      im.onload=ok; im.onerror=ok; im.src=src;
      if(im.decode){im.decode().then(ok).catch(function(){});}
    });}
    if(!IMGS.length){document.getElementById('stage').innerHTML='<span class="empty">No rendered output.</span>';done();}
    else{
      var front=a, back=b;
      (async function(){
        for(var n=0;n<IMGS.length;n++){
          // 1. Stage the next image in the (invisible) back buffer.
          back.classList.remove('kb'); back.style.transform='scale(1.01)';
          await Promise.race([ready(back, IMGS[n].src), sleep(1500)]);
          await raf(); // ensure the new src + reset transform are committed before we fade
          // 2. Crossfade: back rises while front falls — equal-and-opposite, so the
          //    composited result holds full luminance with no double-image flash.
          cap.textContent=IMGS[n].caption||''; cap.classList.toggle('show', !!IMGS[n].caption);
          back.style.opacity='1'; back.classList.add('kb'); front.style.opacity='0';
          await sleep(FADE);
          // 3. Fade complete — front is fully gone. Now it's safe to reuse it.
          front.classList.remove('kb');
          var tmp=front; front=back; back=tmp;
          await sleep(Math.max(0, PER-FADE));
        }
        done();
      })();
      // Absolute safety net: always signal done even if a load stalls.
      setTimeout(done, IMGS.length*(PER+1600)+2500);
    }
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
