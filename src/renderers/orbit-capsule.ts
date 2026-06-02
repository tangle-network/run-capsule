/**
 * Orbit capsule — turn a discrete set of rendered model frames (e.g. an OpenSCAD
 * camera sweep around a CAD model) into a CONTINUOUS spin clip. The CAD render
 * itself is discrete (code → one PNG); rendering the model at N rotating camera
 * angles and cycling them gives real motion — the finished artifact rotating.
 *
 * Self-contained (frames inlined as data URIs); sets `data-capsule-done` on
 * <body> after `revolutions` full turns (the recorder's done-signal).
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface OrbitCapsuleOptions {
  title?: string
  caption?: string
  /** Frames per second of the spin. Default 24. */
  fps?: number
  /** Full revolutions before the done-signal. Default 2. */
  revolutions?: number
}

/** Render a spin clip from ordered frame images (data URIs or URLs). */
export function renderOrbitCapsuleHtml(frames: readonly string[], opts: OrbitCapsuleOptions = {}): string {
  const title = opts.title ?? 'Rendered model'
  const caption = opts.caption ?? ''
  const fps = opts.fps ?? 24
  const revolutions = opts.revolutions ?? 2
  const framesJson = JSON.stringify(frames)

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  body{margin:0;height:100vh;background:radial-gradient(circle at 50% 40%, #131a2a 0%, #070b12 70%);color:#e6edf3;
    font:14px/1.5 ui-sans-serif,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
  .stage{position:relative;width:min(720px,86vw);aspect-ratio:9/7;display:flex;align-items:center;justify-content:center}
  .stage img{position:absolute;max-width:100%;max-height:100%;object-fit:contain;opacity:0;
    filter:drop-shadow(0 24px 60px rgba(0,0,0,.55))}
  .stage img.on{opacity:1}
  h1{font-size:1.05rem;font-weight:600;color:#9aa7b5;margin:0;letter-spacing:.02em}
  .cap{color:#7d8da0;font-size:.9rem;max-width:680px;text-align:center}
  .empty{color:#5b6b7d;padding:40px}
</style></head>
<body>
  <h1>🧊 ${esc(title)}</h1>
  <div class="stage" id="stage"></div>
  ${caption ? `<div class="cap">${esc(caption)}</div>` : ''}
<script>
  var FRAMES=${framesJson}, FPS=${fps}, REVS=${revolutions};
  var stage=document.getElementById('stage');
  if(!FRAMES.length){stage.innerHTML='<span class="empty">No rendered frames.</span>';document.body.setAttribute('data-capsule-done','true');}
  var imgs=FRAMES.map(function(src,i){var im=document.createElement('img');im.src=src;if(i===0)im.className='on';stage.appendChild(im);return im;});
  var i=0, shown=0, target=FRAMES.length*REVS, iv=1000/FPS, last=0;
  function tick(t){
    if(!last)last=t;
    if(t-last>=iv){
      last=t; imgs[i].classList.remove('on'); i=(i+1)%FRAMES.length; imgs[i].classList.add('on'); shown++;
      if(shown>=target){document.body.setAttribute('data-capsule-done','true');return;}
    }
    requestAnimationFrame(tick);
  }
  if(FRAMES.length) requestAnimationFrame(tick);
</script></body></html>
`
}
