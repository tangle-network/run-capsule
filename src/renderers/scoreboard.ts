/**
 * Scoreboard — the verdict shot. A design/eval run ends in a gate decision; this
 * reveals it cinematically: each geometric check animates in one-by-one with a
 * green ✓, a count-up tallies them, and the film lands on a big
 * "N/N — RESOLVED · score X.XX" with the measured bounding-box readout.
 *
 * Self-contained (no external assets); sets `data-capsule-done` on <body> after
 * the verdict has held, which is the recorder's stop signal.
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The eval verdict a run was scored against — the shape `autoCompose`'s
 *  `opts.result` accepts. `checks` is an ordered map of named boolean gates;
 *  `geo` (optional) carries the measured geometry that backs the verdict. */
export interface EvalResult {
  task: string
  resolved: boolean
  score: number
  checks: Record<string, boolean>
  geo?: {
    triangles?: number
    volumes?: number
    bbox?: { x: number; y: number; z: number }
  }
}

/** Human label for a raw check key (camelCase / snake_case → Title Case-ish). */
function checkLabel(key: string): string {
  const map: Record<string, string> = {
    volumes: 'Single watertight volume',
    detail: 'Detail (door + windows)',
    bboxX: 'Footprint width (X)',
    bboxY: 'Footprint depth (Y)',
    bboxZ: 'Total height (Z)',
    pitchedRoof: 'Pitched / gabled roof',
    hollow: 'Hollow shell (interior cavity)',
  }
  if (map[key]) return map[key] as string
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
}

export interface ScoreboardOptions {
  /** ms each check waits before the next reveals. Default 520. */
  stepMs?: number
  accent?: string
}

/**
 * Render the verdict scoreboard. Checks fade+slide in sequentially (each with a
 * stroke-drawn ✓), a tally counts up, then the big verdict and bbox readout land
 * with an easing pop. The whole shot's runtime is derived from the check count
 * so the composition can size the slot exactly.
 */
export function renderScoreboardHtml(result: EvalResult, opts: ScoreboardOptions = {}): string {
  const stepMs = opts.stepMs ?? 520
  const accent = opts.accent ?? '#34d399'
  const entries = Object.entries(result.checks)
  const passed = entries.filter(([, v]) => v).length
  const total = entries.length
  const verdict = result.resolved ? 'RESOLVED' : 'UNRESOLVED'
  const scoreStr = result.score.toFixed(2)
  const bbox = result.geo?.bbox
  const tris = result.geo?.triangles

  // Timeline (ms): checks stream in, then the verdict lands and holds.
  const introMs = 700
  const checksMs = entries.length * stepMs
  const tallyMs = 900
  const verdictHoldMs = 3200
  const totalMs = introMs + checksMs + tallyMs + verdictHoldMs

  const rowsHtml = entries
    .map(
      ([k, v], i) => `
    <div class="row" data-i="${i}" data-pass="${v ? '1' : '0'}">
      <span class="mark">${v
        ? `<svg viewBox="0 0 24 24" class="tick"><path d="M4 12.5l5 5L20 6"/></svg>`
        : `<svg viewBox="0 0 24 24" class="cross"><path d="M6 6l12 12M18 6L6 18"/></svg>`}</span>
      <span class="label">${esc(checkLabel(k))}</span>
    </div>`,
    )
    .join('')

  const json = JSON.stringify({
    introMs,
    stepMs,
    checksMs,
    tallyMs,
    total,
    passed,
    score: result.score,
    totalMs,
  })

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><title>Verdict</title><style>
  :root{color-scheme:dark;--accent:${accent}}*{box-sizing:border-box}
  html,body{margin:0;height:100%;overflow:hidden}
  body{height:100vh;background:radial-gradient(1200px 700px at 50% 30%, #16203a 0%, #0a0e1c 55%, #05070e 100%);
    color:#e9eefb;font:16px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:18px 6%;position:relative}
  body::after{content:"";position:fixed;inset:0;pointer-events:none;
    background:radial-gradient(120% 120% at 50% 50%, transparent 58%, rgba(0,0,0,.55) 100%)}
  .eyebrow{font-size:.72rem;letter-spacing:.32em;text-transform:uppercase;color:#8ea0c8;font-weight:700;
    opacity:0;transform:translateY(8px);transition:opacity .5s ease,transform .5s ease}
  .eyebrow.show{opacity:1;transform:none}
  .task{font-size:1rem;color:#aab6d4;margin:-8px 0 2px;opacity:0;transform:translateY(8px);
    transition:opacity .5s ease,transform .5s ease;font-weight:600}
  .task.show{opacity:1;transform:none}
  .checks{display:flex;flex-direction:column;gap:8px;width:min(560px,86vw)}
  .row{display:flex;align-items:center;gap:14px;padding:9px 16px;border-radius:12px;
    background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.02));
    border:1px solid rgba(255,255,255,.07);
    opacity:0;transform:translateX(-18px) scale(.98);
    transition:opacity .42s cubic-bezier(.2,.7,.2,1),transform .42s cubic-bezier(.2,.7,.2,1),border-color .4s ease,box-shadow .4s ease}
  .row.show{opacity:1;transform:none}
  .row.pass.show{border-color:rgba(52,211,153,.32);box-shadow:0 0 0 1px rgba(52,211,153,.12),0 10px 30px -16px rgba(52,211,153,.5)}
  .mark{flex:0 0 26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:50%}
  .row.pass .mark{background:radial-gradient(circle at 38% 32%,rgba(52,211,153,.28),rgba(52,211,153,.08))}
  .row:not(.pass) .mark{background:radial-gradient(circle at 38% 32%,rgba(248,113,113,.26),rgba(248,113,113,.08))}
  svg{width:17px;height:17px;fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
  .tick{stroke:var(--accent)} .cross{stroke:#f87171}
  .tick path,.cross path{stroke-dasharray:40;stroke-dashoffset:40;transition:stroke-dashoffset .5s ease .12s}
  .row.show .tick path,.row.show .cross path{stroke-dashoffset:0}
  .label{font-size:1.02rem;font-weight:560;color:#dfe6f7;letter-spacing:.01em}
  .verdict{display:flex;flex-direction:column;align-items:center;gap:10px;
    opacity:0;transform:translateY(16px) scale(.96);transition:opacity .6s ease,transform .6s cubic-bezier(.2,.8,.25,1.3)}
  .verdict.show{opacity:1;transform:none}
  .tally{font-variant-numeric:tabular-nums;font-weight:820;letter-spacing:-.02em;
    font-size:clamp(2.2rem,5.5vw,3.4rem);line-height:1;
    background:linear-gradient(180deg,#f4fffb,#9bf3cf 55%,#34d399);
    -webkit-background-clip:text;background-clip:text;color:transparent;
    text-shadow:0 0 40px rgba(52,211,153,.18)}
  .pill{display:inline-flex;align-items:center;gap:10px;padding:9px 20px;border-radius:999px;
    font-weight:760;letter-spacing:.12em;font-size:1.02rem;text-transform:uppercase;
    background:linear-gradient(90deg,rgba(52,211,153,.16),rgba(52,211,153,.06));
    border:1px solid rgba(52,211,153,.4);color:#bff3dc;box-shadow:0 8px 30px -10px rgba(52,211,153,.6)}
  .pill .dot{width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent);
    animation:pulse 1.6s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:1;transform:scale(1.25)}}
  .score{font-size:1.02rem;color:#aab6d4;font-weight:600;letter-spacing:.02em}
  .score b{color:#e9eefb;font-variant-numeric:tabular-nums}
  .geo{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:2px;
    opacity:0;transform:translateY(8px);transition:opacity .5s ease .15s,transform .5s ease .15s}
  .geo.show{opacity:1;transform:none}
  .chip{font-size:.82rem;color:#9fb0d4;padding:6px 12px;border-radius:9px;
    background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);font-variant-numeric:tabular-nums}
  .chip b{color:#dbe6ff;font-weight:680}
</style></head><body>
  <div class="eyebrow" id="eyebrow">Geometry gate · verdict</div>
  <div class="task" id="task">${esc(result.task)}</div>
  <div class="checks" id="checks">${rowsHtml}</div>
  <div class="verdict" id="verdict">
    <div class="tally" id="tally">0/${total}</div>
    <div class="pill"><span class="dot"></span>${verdict}</div>
    <div class="score">score <b id="scoreVal">0.00</b></div>
    <div class="geo" id="geo">
      ${bbox ? `<span class="chip">bbox <b>${bbox.x} × ${bbox.y} × ${bbox.z}</b></span>` : ''}
      ${typeof tris === 'number' ? `<span class="chip">triangles <b>${tris}</b></span>` : ''}
      ${typeof result.geo?.volumes === 'number' ? `<span class="chip">volumes <b>${result.geo.volumes}</b></span>` : ''}
    </div>
  </div>
  <script>
    var M=${json};
    var done=function(){document.body.setAttribute('data-capsule-done','true');};
    var eyebrow=document.getElementById('eyebrow'), task=document.getElementById('task');
    var rows=Array.prototype.slice.call(document.querySelectorAll('.row'));
    var verdict=document.getElementById('verdict'), tally=document.getElementById('tally');
    var scoreVal=document.getElementById('scoreVal'), geo=document.getElementById('geo');
    function ease(t){return 1-Math.pow(1-t,3);} // easeOutCubic
    setTimeout(function(){eyebrow.classList.add('show');},120);
    setTimeout(function(){task.classList.add('show');},300);
    // Checks stream in one-by-one, tallying as the passing ones land.
    var landed=0;
    rows.forEach(function(r,i){
      var pass=r.getAttribute('data-pass')==='1';
      if(pass) r.classList.add('pass');
      setTimeout(function(){
        r.classList.add('show');
        if(pass){landed++; tally.textContent=landed+'/'+M.total;}
      }, M.introMs + i*M.stepMs);
    });
    // Verdict lands after the last check; tally count-up + score count-up.
    var verdictAt = M.introMs + M.checksMs + 220;
    setTimeout(function(){
      verdict.classList.add('show');
      tally.textContent=M.passed+'/'+M.total;
      geo.classList.add('show');
      var startTs=null, dur=900;
      function step(ts){
        if(startTs===null) startTs=ts;
        var k=Math.min(1,(ts-startTs)/dur), e=ease(k);
        scoreVal.textContent=(M.score*e).toFixed(2);
        if(k<1) requestAnimationFrame(step); else scoreVal.textContent=M.score.toFixed(2);
      }
      requestAnimationFrame(step);
    }, verdictAt);
    setTimeout(done, M.totalMs);
  </script>
</body></html>`
}

/** Total runtime (ms) of the scoreboard for a given result — lets the
 *  composition allocate the shot's slot without re-deriving the timeline. */
export function scoreboardDurationMs(result: EvalResult, opts: ScoreboardOptions = {}): number {
  const stepMs = opts.stepMs ?? 520
  const introMs = 700
  const checksMs = Object.keys(result.checks).length * stepMs
  const tallyMs = 900
  const verdictHoldMs = 3200
  return introMs + checksMs + tallyMs + verdictHoldMs
}
