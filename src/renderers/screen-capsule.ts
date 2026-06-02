/**
 * Screen capsule — animate the agent's browser / computer-use activity as a
 * screenshot replay: each step shows what the agent saw, with the action + URL
 * captioned, advancing like a screencast. Built from browser/computer tool
 * spans. A step shows its screenshot when the trace carried one
 * (`attributes.screenshot` / `result.screenshot`, a data-URI or URL); otherwise
 * it degrades to an action card. Self-contained; play button → "▶ Play" on done.
 */

import type { Span } from '@tangle-network/agent-eval'

export interface ScreenStep {
  label: string
  url?: string
  /** data: URI or http(s) URL of the frame, if captured. */
  image?: string
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}
function isImg(s: string | undefined): s is string {
  return !!s && (s.startsWith('data:image') || /^https?:\/\//.test(s))
}

const SCREEN = /(browser|playwright|puppeteer|computer|cua|desktop|gui|navigate|goto|click|type|screenshot|page|scroll|hover|press|dom)/i

/** Pull screen steps from a run's spans, in order. */
export function screenStepsFromSpans(spans: readonly Span[]): ScreenStep[] {
  const out: ScreenStep[] = []
  for (const span of [...spans].sort((a, b) => a.startedAt - b.startedAt)) {
    if (span.kind !== 'tool') continue
    const tool = span as Extract<Span, { kind: 'tool' }>
    if (!SCREEN.test(tool.toolName)) continue
    const a = obj(tool.args)
    const attrs = obj(span.attributes)
    const result = obj(tool.result)
    const image =
      str(attrs?.screenshot) ?? str(attrs?.screenshotUrl) ?? str(attrs?.image) ?? str(attrs?.frame) ??
      str(result?.screenshot) ?? str(result?.image)
    out.push({
      label: str(a?.action) ?? str(a?.selector) ?? tool.toolName,
      url: str(a?.url) ?? str(attrs?.url),
      image: isImg(image) ? image : undefined,
    })
  }
  return out
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface ScreenCapsuleOptions {
  title?: string
  /** Ms each step is shown. Default 2600. */
  perStepMs?: number
}

export function renderScreenCapsuleHtml(
  source: readonly Span[] | readonly ScreenStep[],
  opts: ScreenCapsuleOptions = {},
): string {
  const steps: ScreenStep[] =
    source.length > 0 && 'label' in (source[0] as object)
      ? (source as ScreenStep[])
      : screenStepsFromSpans(source as readonly Span[])
  const title = opts.title ?? 'Agent on screen'
  const perStepMs = opts.perStepMs ?? 2600
  const stepsJson = JSON.stringify(steps)

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  body{margin:0;height:100vh;background:#0b0f17;color:#e6edf3;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;display:flex;flex-direction:column}
  header{display:flex;align-items:center;gap:8px;padding:9px 16px;background:#111a29;border-bottom:1px solid #1e2a3a;font-size:.85rem;color:#9aa7b5}
  .dot{width:11px;height:11px;border-radius:50%}.r{background:#ff5f56}.y{background:#ffbd2e}.g{background:#27c93f}
  header b{color:#e6edf3;margin-left:6px;font-weight:600}
  .stage{flex:1;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#070b12}
  .frame{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .4s}
  .frame.on{opacity:1}
  .frame img{max-width:100%;max-height:100%;object-fit:contain;box-shadow:0 10px 40px rgba(0,0,0,.5)}
  .placeholder{display:flex;flex-direction:column;align-items:center;gap:14px;color:#5b6b7d}
  .placeholder .big{font-size:2.4rem}
  .caption{position:absolute;left:0;right:0;bottom:0;padding:14px 22px;background:linear-gradient(transparent,rgba(5,8,13,.92));font-family:ui-sans-serif,system-ui,sans-serif}
  .caption .act{font-size:1.05rem;font-weight:600}
  .caption .url{color:#58a6ff;font-size:.85rem;word-break:break-all}
  footer{display:flex;align-items:center;gap:14px;padding:9px 16px;background:#111a29;border-top:1px solid #1e2a3a;font-size:.82rem;color:#9aa7b5}
  .btn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:30px;background:#1b2636;color:#e6edf3;border:1px solid #2a3a4f;border-radius:8px;cursor:pointer}
  .btn:hover{background:#243349}
  .progress{flex:1;height:5px;background:#1e2a3a;border-radius:4px;overflow:hidden}.progress>i{display:block;height:100%;width:0;background:#58a6ff;transition:width .12s linear}
  .empty{color:#5b6b7d;padding:30px}
</style></head>
<body>
  <header><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><b>${esc(title)}</b></header>
  <div class="stage" id="stage"></div>
  <footer><button class="btn" id="pp">⏸</button><button class="btn" id="restart">↻</button><div class="progress"><i id="fill"></i></div><span id="counter"></span></footer>
<script>
  var STEPS=${stepsJson}, PER=${perStepMs};
  var i=0, playing=true, timer=0, raf=0, t0=0;
  var stage=document.getElementById('stage'), fill=document.getElementById('fill'), counter=document.getElementById('counter'), pp=document.getElementById('pp');
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  if(!STEPS.length){stage.innerHTML='<span class="empty">No browser/screen activity in this run.</span>';}
  else{
    STEPS.forEach(function(s,k){
      var f=document.createElement('div'); f.className='frame'; f.dataset.k=k;
      var inner = s.image ? '<img src="'+s.image+'" alt="">' : '<div class="placeholder"><div class="big">🖥️</div><div>'+esc(s.label)+'</div></div>';
      f.innerHTML=inner+'<div class="caption"><div class="act">'+esc(s.label)+'</div>'+(s.url?'<div class="url">'+esc(s.url)+'</div>':'')+'</div>';
      stage.appendChild(f);
    });
  }
  function show(){
    [].forEach.call(stage.children,function(f){f.className='frame'+(Number(f.dataset.k)===i?' on':'');});
    counter.textContent=(i+1)+' / '+STEPS.length;
  }
  function loop(t){
    if(!playing||!STEPS.length)return;
    if(!t0)t0=t;
    var p=Math.min(1,(t-t0)/PER); fill.style.width=(((i+p)/STEPS.length)*100)+'%';
    if(p>=1){ if(i<STEPS.length-1){i++;t0=0;show();} else {playing=false;pp.textContent='▶ Play';document.body.setAttribute('data-capsule-done','true');return;} }
    raf=requestAnimationFrame(loop);
  }
  function go(n){i=Math.max(0,Math.min(STEPS.length-1,n));t0=0;cancelAnimationFrame(raf);show();if(playing)raf=requestAnimationFrame(loop);}
  pp.onclick=function(){if(!playing){playing=true;pp.textContent='⏸';t0=0;raf=requestAnimationFrame(loop);}else{playing=false;pp.textContent='▶ Play';cancelAnimationFrame(raf);}};
  document.getElementById('restart').onclick=function(){playing=true;pp.textContent='⏸';document.body.removeAttribute('data-capsule-done');go(0);};
  if(!STEPS.length){document.body.setAttribute('data-capsule-done','true');}
  if(STEPS.length){show();raf=requestAnimationFrame(loop);}
</script></body></html>
`
}
