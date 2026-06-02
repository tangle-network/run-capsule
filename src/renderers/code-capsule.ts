/**
 * Code Capsule — a richer "watch the agent build the project" animation than the
 * agent-eval baseline `renderCodeAnimationHtml`.
 *
 * Consumer-side on purpose: the substrate emits the zero-dep baseline; this
 * presentation layer (file-explorer + accumulating tabs + syntax highlighting +
 * a clean transport bar) lives in the consumer, reusing the published `CodeEdit`
 * IR (`extractCodeEdits` from @tangle-network/agent-eval/storyboard) — not a
 * fork of the reducer.
 *
 * UX vs the baseline:
 *   - left FILE EXPLORER lists the whole project up front (you see what's coming)
 *   - TABS accumulate as each file starts, so it reads as one growing project,
 *     not a sequence of disconnected single files
 *   - typed code is SYNTAX HIGHLIGHTED (tiny inline tokenizer, still zero-dep)
 *   - one clean ▶/⏸ toggle + restart + progress, no ambiguous button state
 *   - click any started file (tab or explorer) to inspect it; ▶ resumes typing
 *
 * Still fully self-contained (no external assets), so the Playwright recorder
 * captures it to mp4 exactly like the baseline. The play button flips to
 * "▶ Play" on completion — the recorder's done-signal contract.
 */

import type { CodeEdit } from '@tangle-network/agent-eval/storyboard'
import { extractCodeEdits } from '@tangle-network/agent-eval/storyboard'
import type { Span } from '@tangle-network/agent-eval'

function editAnimationText(edit: CodeEdit): string {
  if (edit.after && edit.after.trim()) return edit.after
  if (edit.diff) {
    const added = edit.diff
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.slice(1))
      .join('\n')
    if (added.trim()) return added
  }
  return `// ${edit.path}\n// (${edit.additions} line${edit.additions === 1 ? '' : 's'} written)`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface CodeCapsuleOptions {
  title?: string
  /** Characters typed per animation tick. Default 5. */
  charsPerTick?: number
  /** Pause between files, ms. Default 700. */
  pauseBetweenMs?: number
}

/** Build the self-contained capsule HTML from a run's spans or pre-extracted
 *  edits. */
export function renderCodeCapsuleHtml(
  source: readonly Span[] | readonly CodeEdit[],
  opts: CodeCapsuleOptions = {},
): string {
  const edits: CodeEdit[] =
    source.length > 0 && 'path' in (source[0] as object)
      ? (source as CodeEdit[])
      : extractCodeEdits(source as readonly Span[])

  const files = edits.map((e) => ({
    path: e.path,
    language: e.language ?? '',
    additions: e.additions,
    deletions: e.deletions,
    code: editAnimationText(e),
  }))
  const title = opts.title ?? 'Agent building the project'
  const charsPerTick = opts.charsPerTick ?? 5
  const pauseBetweenMs = opts.pauseBetweenMs ?? 700
  const filesJson = JSON.stringify(files)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; --bg:#0d1117; --panel:#0f1623; --panel2:#111a29; --line:#1e2a3a;
    --fg:#c9d4e0; --dim:#5b6b7d; --accent:#58a6ff;
    --kw:#c678dd; --str:#98c379; --com:#5c6370; --num:#d19a66; --typ:#e5c07b; --tag:#e06c75; --fn:#61afef; --pun:#8b98a6; }
  * { box-sizing: border-box; }
  body { margin:0; height:100vh; background:var(--bg); color:var(--fg);
    font:13.5px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; display:flex; flex-direction:column; }
  header { display:flex; align-items:center; gap:10px; padding:9px 16px; background:var(--panel2); border-bottom:1px solid var(--line);
    font-family:ui-sans-serif,system-ui,sans-serif; font-size:.85rem; color:var(--dim); }
  header .dot{width:11px;height:11px;border-radius:50%}
  header .r{background:#ff5f56}.y{background:#ffbd2e}.g{background:#27c93f}
  header b{color:var(--fg);font-weight:600;margin-left:6px}
  .body{flex:1;display:flex;min-height:0}
  .explorer{width:210px;flex:none;background:var(--panel);border-right:1px solid var(--line);overflow:auto;padding:10px 0}
  .explorer h2{font:600 .7rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin:4px 14px 8px}
  .ex-item{display:flex;align-items:center;gap:7px;padding:4px 14px;cursor:pointer;white-space:nowrap;color:var(--dim)}
  .ex-item:hover{background:#15203010}
  .ex-item.done{color:var(--fg)} .ex-item.active{color:var(--accent);background:#132033}
  .ex-item .st{width:14px;text-align:center;flex:none}
  .main{flex:1;display:flex;flex-direction:column;min-width:0}
  .tabs{display:flex;gap:1px;background:var(--panel2);border-bottom:1px solid var(--line);overflow-x:auto}
  .tab{display:flex;align-items:center;gap:6px;padding:8px 14px;cursor:pointer;color:var(--dim);background:var(--panel2);
    border-right:1px solid var(--line);white-space:nowrap;font-family:ui-sans-serif,system-ui,sans-serif;font-size:.82rem}
  .tab.active{color:var(--fg);background:var(--bg);box-shadow:inset 0 2px 0 var(--accent)}
  .tab .pulse{width:7px;height:7px;border-radius:50%;background:var(--accent);animation:blink .9s steps(1) infinite}
  .codewrap{flex:1;display:flex;overflow-x:hidden;overflow-y:auto;background:var(--bg)}
  .gutter{padding:14px 10px 24px 16px;text-align:right;color:#39434f;user-select:none;white-space:pre;flex:none}
  pre{margin:0;padding:14px 18px 24px 8px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;tab-size:2;flex:1;min-width:0}
  .cursor{display:inline-block;width:7px;height:1.05em;vertical-align:text-bottom;background:var(--accent);animation:blink .9s steps(1) infinite}
  @keyframes blink{50%{opacity:0}}
  .kw{color:var(--kw)}.str{color:var(--str)}.com{color:var(--com);font-style:italic}.num{color:var(--num)}
  .typ{color:var(--typ)}.tag{color:var(--tag)}.fn{color:var(--fn)}.pun{color:var(--pun)}
  footer{display:flex;align-items:center;gap:14px;padding:9px 16px;background:var(--panel2);border-top:1px solid var(--line);
    font-family:ui-sans-serif,system-ui,sans-serif;font-size:.82rem;color:var(--dim)}
  .btn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:30px;background:#1b2636;color:var(--fg);
    border:1px solid #2a3a4f;border-radius:8px;cursor:pointer;font-size:.95rem}
  .btn:hover{background:#243349}
  .progress{flex:1;height:5px;background:var(--line);border-radius:4px;overflow:hidden}
  .progress>i{display:block;height:100%;width:0;background:var(--accent);transition:width .12s linear}
  .empty{padding:40px;color:var(--dim)}
</style>
</head>
<body>
  <header><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><b>${esc(title)}</b></header>
  <div class="body">
    <aside class="explorer"><h2>Explorer</h2><div id="ex"></div></aside>
    <div class="main">
      <div class="tabs" id="tabs"></div>
      <div class="codewrap"><div class="gutter" id="gutter">1</div><pre id="code"></pre></div>
    </div>
  </div>
  <footer>
    <button class="btn" id="pp" title="Play/Pause">⏸</button>
    <button class="btn" id="restart" title="Restart">↻</button>
    <div class="progress"><i id="fill"></i></div>
    <span id="counter"></span>
  </footer>
<script>
  var FILES = ${filesJson};
  var CPT = ${charsPerTick}, PAUSE = ${pauseBetweenMs};
  var fi = 0, ci = 0, playing = true, viewing = 0, raf = 0, advancing = false;
  var started = FILES.map(function(_, k){ return k === 0; });
  var codeEl = document.getElementById('code'), gutterEl = document.getElementById('gutter');
  var tabsEl = document.getElementById('tabs'), exEl = document.getElementById('ex');
  var fillEl = document.getElementById('fill'), counterEl = document.getElementById('counter');
  var ppEl = document.getElementById('pp');
  if (!FILES.length) { codeEl.innerHTML = '<span class="empty">No code edits in this run.</span>'; }

  var KW = /^(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|import|export|from|as|interface|type|class|extends|implements|new|async|await|try|catch|finally|throw|of|in|default|public|private|protected|static|readonly|enum|namespace|def|lambda|pragma|contract|mapping|require|emit|event|struct|memory|storage|external|internal|view|pure|payable|returns|true|false|null|undefined|None|True|False|void|this|self|super|yield|fn|let|use|pub|impl|mut)$/;
  function escc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function span(cls, txt){return '<span class="'+cls+'">'+escc(txt)+'</span>';}
  // Tiny tokenizer: walk the raw string, classify each token, escape every piece.
  function hl(src){
    var re = /(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*|#[^\\n]*)|(\`(?:\\\\[\\s\\S]|[^\`])*\`|"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*')|([A-Za-z_$][A-Za-z0-9_$]*)|(0x[0-9a-fA-F]+|\\d[\\d_]*\\.?\\d*)|(<\\/?[A-Za-z][\\w.-]*)/g;
    var out = '', last = 0, m;
    while ((m = re.exec(src))) {
      if (m.index > last) out += escc(src.slice(last, m.index));
      if (m[1]) out += span('com', m[1]);
      else if (m[2]) out += span('str', m[2]);
      else if (m[3]) {
        if (KW.test(m[3])) out += span('kw', m[3]);
        else if (/^[A-Z]/.test(m[3])) out += span('typ', m[3]);
        else if (src[re.lastIndex] === '(') out += span('fn', m[3]);
        else out += escc(m[3]);
      }
      else if (m[4]) out += span('num', m[4]);
      else if (m[5]) out += span('tag', m[5]);
      last = re.lastIndex;
    }
    if (last < src.length) out += escc(src.slice(last));
    return out;
  }

  function buildExplorer(){
    exEl.innerHTML = '';
    FILES.forEach(function(f, k){
      var done = k < fi || (k === fi && ci >= f.code.length);
      var typing = k === fi && ci < f.code.length;
      var div = document.createElement('div');
      div.className = 'ex-item' + (done ? ' done' : '') + (k === viewing ? ' active' : '');
      div.innerHTML = '<span class="st">' + (typing ? '✎' : done ? '✓' : '·') + '</span><span>' + escc(f.path) + '</span>';
      div.onclick = function(){ inspect(k); };
      exEl.appendChild(div);
    });
  }
  function buildTabs(){
    tabsEl.innerHTML = '';
    FILES.forEach(function(f, k){
      if (!started[k]) return;
      var typing = k === fi && ci < f.code.length;
      var div = document.createElement('div');
      div.className = 'tab' + (k === viewing ? ' active' : '');
      div.innerHTML = escc(f.path.split('/').pop()) + (typing ? '<span class="pulse"></span>' : '');
      div.onclick = function(){ inspect(k); };
      tabsEl.appendChild(div);
    });
  }
  function paint(){
    var f = FILES[viewing]; if (!f) return;
    var shown = (viewing === fi) ? f.code.slice(0, ci) : f.code;
    var lines = (shown.match(/\\n/g) || []).length + 1;
    var g = ''; for (var i = 1; i <= lines; i++) g += i + (i < lines ? '\\n' : '');
    gutterEl.textContent = g;
    codeEl.innerHTML = hl(shown) + (viewing === fi && playing ? '<span class="cursor"></span>' : '');
    var wrap = codeEl.parentElement; wrap.scrollTop = wrap.scrollHeight;
    var totalChars = FILES.reduce(function(s, x){ return s + x.code.length; }, 0);
    var doneChars = FILES.slice(0, fi).reduce(function(s, x){ return s + x.code.length; }, 0) + ci;
    fillEl.style.width = (totalChars ? (doneChars / totalChars * 100) : 100) + '%';
    counterEl.textContent = 'file ' + Math.min(fi + 1, FILES.length) + ' / ' + FILES.length;
  }
  function refresh(){ buildExplorer(); buildTabs(); paint(); }
  function inspect(k){ viewing = k; playing = false; ppEl.textContent = '▶ Play'; cancelAnimationFrame(raf); refresh(); }
  function tick(){
    if (!playing || advancing || !FILES.length) return;
    var f = FILES[fi];
    if (viewing !== fi) viewing = fi;
    if (ci < f.code.length) { ci = Math.min(f.code.length, ci + CPT); refresh(); raf = requestAnimationFrame(tick); }
    else if (fi < FILES.length - 1) {
      advancing = true; refresh();
      setTimeout(function(){ fi++; ci = 0; started[fi] = true; viewing = fi; advancing = false; refresh(); raf = requestAnimationFrame(tick); }, PAUSE);
    } else { playing = false; ppEl.textContent = '▶ Play'; refresh(); document.body.setAttribute('data-capsule-done','true'); }
  }
  ppEl.onclick = function(){
    if (!playing) { playing = true; ppEl.textContent = '⏸'; viewing = fi; tick(); }
    else { playing = false; ppEl.textContent = '▶ Play'; cancelAnimationFrame(raf); }
  };
  document.getElementById('restart').onclick = function(){
    cancelAnimationFrame(raf); fi = 0; ci = 0; viewing = 0; playing = true; advancing = false;
    started = FILES.map(function(_, k){ return k === 0; }); ppEl.textContent = '⏸'; document.body.removeAttribute('data-capsule-done'); refresh(); tick();
  };
  if (FILES.length) { refresh(); tick(); } else { document.body.setAttribute('data-capsule-done','true'); }
</script>
</body>
</html>
`
}
