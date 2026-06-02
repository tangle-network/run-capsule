/**
 * Conversation capsule — animate the dialogue of a run as a chat recording: the
 * user's ask types in, the agent replies type back, turn by turn. This is the
 * marketing money-shot for chat-shaped agents (legal/gtm/tax) the way the code
 * capsule is for coding agents.
 *
 * Reuses the substrate's conversation extraction (agent-eval 0.76+
 * `reduceToSemanticEvents` emits understood_task / user_message / agent_reply
 * with prose visuals, deduped across the repeated message history) rather than
 * re-deriving it here — the consumer adds only the chat presentation. Self-
 * contained (zero-dep); on completion it flips the play button to "▶ Play" AND
 * sets `data-capsule-done` on <body> (the recorder's done-signal).
 */

import type { Span } from '@tangle-network/agent-eval'
import { reduceToSemanticEvents } from '@tangle-network/agent-eval/storyboard'

export interface ConversationTurn {
  role: 'user' | 'agent'
  text: string
}

/** Pull the dialogue turns from a run's spans, in order, deduped. Built on the
 *  substrate reducer so the dedup/first-turn logic stays in one place. */
export function conversationStepsFromSpans(spans: readonly Span[]): ConversationTurn[] {
  return reduceToSemanticEvents(spans)
    .filter((e) => e.kind === 'understood_task' || e.kind === 'user_message' || e.kind === 'agent_reply')
    .map((e) => ({
      role: e.kind === 'agent_reply' ? ('agent' as const) : ('user' as const),
      text: e.visual.type === 'prose' ? e.visual.text : e.summary,
    }))
    .filter((t) => t.text.trim().length > 0)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface ConversationCapsuleOptions {
  title?: string
  /** Characters typed per animation tick. Default 6. */
  charsPerTick?: number
  /** Pause between turns, ms. Default 550. */
  pauseBetweenMs?: number
}

export function renderConversationCapsuleHtml(
  source: readonly Span[] | readonly ConversationTurn[],
  opts: ConversationCapsuleOptions = {},
): string {
  const turns: ConversationTurn[] =
    source.length > 0 && 'role' in (source[0] as object)
      ? (source as ConversationTurn[])
      : conversationStepsFromSpans(source as readonly Span[])
  const title = opts.title ?? 'Agent conversation'
  const cpt = opts.charsPerTick ?? 6
  const pause = opts.pauseBetweenMs ?? 550
  const turnsJson = JSON.stringify(turns)

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;height:100vh;background:#0b0f17;color:#e6edf3;font:15px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif;display:flex;flex-direction:column}
  header{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#111824;border-bottom:1px solid #1e2a3a;font-size:.85rem;color:#9aa7b5}
  .dot{width:11px;height:11px;border-radius:50%}.r{background:#ff5f56}.y{background:#ffbd2e}.g{background:#27c93f}
  header b{color:#e6edf3;margin-left:6px;font-weight:600}
  .chat{flex:1;overflow:auto;padding:22px 18px;display:flex;flex-direction:column;gap:14px}
  .row{display:flex;gap:10px;max-width:80%}
  .row.user{align-self:flex-start}.row.agent{align-self:flex-end;flex-direction:row-reverse}
  .avatar{width:30px;height:30px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:1rem}
  .user .avatar{background:#1f2937}.agent .avatar{background:#10331f}
  .bubble{padding:11px 15px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
  .user .bubble{background:#1b2636;border-bottom-left-radius:4px}
  .agent .bubble{background:#10b98122;border:1px solid #10b98155;border-bottom-right-radius:4px}
  .cursor{display:inline-block;width:7px;height:1.05em;vertical-align:text-bottom;background:#9aa7b5;animation:blink .9s steps(1) infinite}
  @keyframes blink{50%{opacity:0}}
  .enter{animation:rise .35s cubic-bezier(.2,.7,.3,1.2)}@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  footer{display:flex;align-items:center;gap:14px;padding:9px 16px;background:#111824;border-top:1px solid #1e2a3a;font-size:.82rem;color:#8b98a6}
  .btn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:30px;background:#1b2636;color:#e6edf3;border:1px solid #2a3a4f;border-radius:8px;cursor:pointer}
  .btn:hover{background:#243349}
  .progress{flex:1;height:5px;background:#1e2a3a;border-radius:4px;overflow:hidden}.progress>i{display:block;height:100%;width:0;background:#10b981;transition:width .12s linear}
  .empty{color:#8b98a6;padding:30px}
</style></head>
<body>
  <header><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><b>${esc(title)}</b></header>
  <div class="chat" id="chat"></div>
  <footer><button class="btn" id="pp">⏸</button><button class="btn" id="restart">↻</button><div class="progress"><i id="fill"></i></div><span id="counter"></span></footer>
<script>
  var TURNS=${turnsJson}, CPT=${cpt}, PAUSE=${pause};
  var ti=0, ci=0, playing=true, raf=0, advancing=false;
  var chat=document.getElementById('chat'), fill=document.getElementById('fill'), counter=document.getElementById('counter'), pp=document.getElementById('pp');
  if(!TURNS.length){chat.innerHTML='<span class="empty">No conversation in this run.</span>';}
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function avatar(role){return role==='agent'?'🤖':'💬';}
  function done(){playing=false;advancing=false;pp.textContent='▶ Play';fill.style.width='100%';document.body.setAttribute('data-capsule-done','true');}
  function render(){
    chat.innerHTML='';
    for(var k=0;k<=ti && k<TURNS.length;k++){
      var t=TURNS[k];
      var typing=(k===ti);
      var shown=typing?t.text.slice(0,ci):t.text;
      var row=document.createElement('div');
      row.className='row '+t.role+(typing?' enter':'');
      row.innerHTML='<div class="avatar">'+avatar(t.role)+'</div><div class="bubble">'+esc(shown)+(typing&&playing?'<span class="cursor"></span>':'')+'</div>';
      chat.appendChild(row);
    }
    chat.scrollTop=chat.scrollHeight;
    var total=TURNS.length, prog=total?(ti+(TURNS[ti]?ci/Math.max(1,TURNS[ti].text.length):0))/total:1;
    fill.style.width=(prog*100)+'%'; counter.textContent='turn '+Math.min(ti+1,total)+' / '+total;
  }
  function tick(){
    if(!playing||advancing||!TURNS.length)return;
    var t=TURNS[ti];
    if(ci<t.text.length){ci=Math.min(t.text.length,ci+CPT);render();raf=requestAnimationFrame(tick);}
    else if(ti<TURNS.length-1){advancing=true;render();setTimeout(function(){ti++;ci=0;advancing=false;render();raf=requestAnimationFrame(tick);},PAUSE);}
    else{render();done();}
  }
  pp.onclick=function(){if(!playing){playing=true;pp.textContent='⏸';tick();}else{playing=false;pp.textContent='▶ Play';cancelAnimationFrame(raf);}};
  document.getElementById('restart').onclick=function(){cancelAnimationFrame(raf);ti=0;ci=0;playing=true;advancing=false;pp.textContent='⏸';document.body.removeAttribute('data-capsule-done');render();tick();};
  if(TURNS.length){render();tick();}else{done();}
</script></body></html>
`
}
