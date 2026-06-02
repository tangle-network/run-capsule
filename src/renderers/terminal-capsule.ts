/**
 * Terminal capsule — animate the agent's shell/sandbox activity as a typed
 * terminal recording: each command types out after a `$` prompt, its output
 * prints, the next command follows. Built from shell/exec tool spans + sandbox
 * spans. Self-contained (zero-dep), records to mp4 like the other capsules; the
 * play button flips to "▶ Play" on completion (recorder done-signal).
 */

import type { Span } from '@tangle-network/agent-eval'

export interface TerminalStep {
  command: string
  output: string
  exitCode?: number
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}
function asText(v: unknown, max = 1600): string {
  if (v == null) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > max ? `${s.slice(0, max)}\n…(${s.length - max} more)` : s
}

const SHELL = /^(shell|bash|sh|exec|run|terminal|command|process|npm|pnpm|yarn|git|cargo|forge|python)/i

/** Pull terminal steps (command + output) from a run's spans, in order. */
export function terminalStepsFromSpans(spans: readonly Span[]): TerminalStep[] {
  const out: TerminalStep[] = []
  for (const span of [...spans].sort((a, b) => a.startedAt - b.startedAt)) {
    if (span.kind === 'sandbox') {
      const sb = span as Extract<Span, { kind: 'sandbox' }>
      const tests = (sb.testsTotal ?? 0) > 0 ? `${sb.testsPassed ?? 0}/${sb.testsTotal} tests passing` : ''
      out.push({
        command: sb.command ?? span.name,
        output: [tests, span.error].filter(Boolean).join('\n') || (sb.exitCode === 0 ? 'ok' : ''),
        exitCode: sb.exitCode,
      })
    } else if (span.kind === 'tool') {
      const tool = span as Extract<Span, { kind: 'tool' }>
      if (!SHELL.test(tool.toolName)) continue
      const command =
        (typeof tool.args === 'string' ? tool.args : str(obj(tool.args)?.command) ?? str(obj(tool.args)?.cmd)) ??
        tool.toolName
      out.push({
        command,
        output: asText(tool.result),
        exitCode: span.status === 'error' ? 1 : 0,
      })
    }
  }
  return out
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface TerminalCapsuleOptions {
  title?: string
  charsPerTick?: number
  pauseBetweenMs?: number
}

export function renderTerminalCapsuleHtml(
  source: readonly Span[] | readonly TerminalStep[],
  opts: TerminalCapsuleOptions = {},
): string {
  const steps: TerminalStep[] =
    source.length > 0 && 'command' in (source[0] as object)
      ? (source as TerminalStep[])
      : terminalStepsFromSpans(source as readonly Span[])
  const title = opts.title ?? 'Agent in the terminal'
  const cpt = opts.charsPerTick ?? 3
  const pause = opts.pauseBetweenMs ?? 500
  const stepsJson = JSON.stringify(steps.map((s) => ({ command: s.command, output: s.output, exitCode: s.exitCode ?? 0 })))

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;height:100vh;background:#05080d;color:#cfe3d6;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;display:flex;flex-direction:column}
  header{display:flex;align-items:center;gap:8px;padding:9px 16px;background:#0b1018;border-bottom:1px solid #16202c;font-family:ui-sans-serif,system-ui,sans-serif;font-size:.85rem;color:#6b7d8c}
  .dot{width:11px;height:11px;border-radius:50%}.r{background:#ff5f56}.y{background:#ffbd2e}.g{background:#27c93f}
  header b{color:#cfe3d6;margin-left:6px;font-weight:600}
  .term{flex:1;overflow:auto;padding:18px 22px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
  .prompt{color:#27c93f}.cmd{color:#e6edf3}.out{color:#8da2b0}.err{color:#ff7b72}
  .cursor{display:inline-block;width:8px;height:1.05em;vertical-align:text-bottom;background:#27c93f;animation:blink .9s steps(1) infinite}
  @keyframes blink{50%{opacity:0}}
  footer{display:flex;align-items:center;gap:14px;padding:9px 16px;background:#0b1018;border-top:1px solid #16202c;font-family:ui-sans-serif,system-ui,sans-serif;font-size:.82rem;color:#6b7d8c}
  .btn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:30px;background:#16202c;color:#cfe3d6;border:1px solid #243441;border-radius:8px;cursor:pointer}
  .btn:hover{background:#1d2a37}
  .progress{flex:1;height:5px;background:#16202c;border-radius:4px;overflow:hidden}.progress>i{display:block;height:100%;width:0;background:#27c93f;transition:width .12s linear}
  .empty{color:#6b7d8c;padding:30px}
</style></head>
<body>
  <header><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><b>${esc(title)}</b></header>
  <div class="term" id="term"></div>
  <footer><button class="btn" id="pp">⏸</button><button class="btn" id="restart">↻</button><div class="progress"><i id="fill"></i></div><span id="counter"></span></footer>
<script>
  var STEPS=${stepsJson}, CPT=${cpt}, PAUSE=${pause};
  var si=0, ci=0, playing=true, raf=0, advancing=false, done='';
  var term=document.getElementById('term'), fill=document.getElementById('fill'), counter=document.getElementById('counter'), pp=document.getElementById('pp');
  if(!STEPS.length){term.innerHTML='<span class="empty">No terminal activity in this run.</span>';}
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function render(){
    var s=STEPS[si]; if(!s)return;
    var typed=s.command.slice(0,ci);
    var html=done;
    html+='<div><span class="prompt">$ </span><span class="cmd">'+esc(typed)+'</span>'+(ci<s.command.length&&playing?'<span class="cursor"></span>':'')+'</div>';
    term.innerHTML=html;
    term.scrollTop=term.scrollHeight;
    var total=STEPS.length, prog=(si+(ci/Math.max(1,s.command.length)))/total;
    fill.style.width=(prog*100)+'%'; counter.textContent='step '+Math.min(si+1,total)+' / '+total;
  }
  function commit(s){
    var cls=s.exitCode&&s.exitCode!==0?'err':'out';
    done+='<div><span class="prompt">$ </span><span class="cmd">'+esc(s.command)+'</span></div>';
    if(s.output)done+='<div class="'+cls+'">'+esc(s.output)+'</div>';
  }
  function tick(){
    if(!playing||advancing||!STEPS.length)return;
    var s=STEPS[si];
    if(ci<s.command.length){ci=Math.min(s.command.length,ci+CPT);render();raf=requestAnimationFrame(tick);}
    else{advancing=true;render();setTimeout(function(){commit(s);if(si<STEPS.length-1){si++;ci=0;advancing=false;render();raf=requestAnimationFrame(tick);}else{term.innerHTML=done;playing=false;advancing=false;pp.textContent='▶ Play';fill.style.width='100%';document.body.setAttribute('data-capsule-done','true');}},PAUSE);}
  }
  pp.onclick=function(){if(!playing){playing=true;pp.textContent='⏸';tick();}else{playing=false;pp.textContent='▶ Play';cancelAnimationFrame(raf);}};
  document.getElementById('restart').onclick=function(){cancelAnimationFrame(raf);si=0;ci=0;done='';playing=true;advancing=false;pp.textContent='⏸';document.body.removeAttribute('data-capsule-done');render();tick();};
  if(STEPS.length){render();tick();}else{document.body.setAttribute('data-capsule-done','true');}
</script></body></html>
`
}
