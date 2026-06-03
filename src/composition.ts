/**
 * Composition — sequence the per-capsule clips of a run into ONE cohesive,
 * creatively-edited film. The substrate's storyboard gives the ordered semantic
 * scenes (the edit-decision-list skeleton); this turns them into shots with
 * layouts (full / split / picture-in-picture) and transitions, rendered as a
 * single self-contained HTML "stage" that plays the shots on a timeline and is
 * recorded once → one MP4.
 *
 * The declarative model is the whole point — `autoCompose(spans)` derives a good
 * default film for free (intro → run timeline → spinning render → outro), and
 * any shot can be overridden or hand-authored.
 */

import type { Span } from '@tangle-network/agent-eval'
import { reduceToSemanticEvents } from '@tangle-network/agent-eval/storyboard'
import { extractArtifacts } from './artifacts.js'
import { renderDocLayerHtml, renderImageRevealHtml, renderVideoLayerHtml } from './renderers/media-layer.js'
import { renderRunStudioHtml } from './studio/render.js'
import { renderOrbitCapsuleHtml } from './renderers/orbit-capsule.js'
import { type EvalResult, renderScoreboardHtml, scoreboardDurationMs } from './renderers/scoreboard.js'
import { renderIntroHtml, renderOutroHtml } from './renderers/title-cards.js'

/** Where a layer sits within a shot's frame. */
export type LayerFrame = 'full' | 'left' | 'right' | 'pip-br' | 'pip-bl' | 'pip-tr' | 'pip-tl'
export type Transition = 'cut' | 'fade' | 'slide'

export interface ShotLayer {
  /** Self-contained HTML for this layer (a capsule / studio page). */
  html: string
  frame: LayerFrame
}
export interface Shot {
  id: string
  startMs: number
  durationMs: number
  transition: Transition
  layers: ShotLayer[]
  caption?: string
}
export interface Composition {
  title: string
  shots: Shot[]
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The mission line for the intro: the brief's lead sentence (before the first
 *  newline / bullet / sentence break), trimmed of a trailing colon, capped. */
function condenseBrief(brief: string): string {
  const firstLine = brief.split('\n')[0]?.trim() ?? ''
  const lead = (/^(.*?[.!?])(\s|$)/.exec(firstLine)?.[1] ?? firstLine).replace(/[:\s]+$/, '').trim()
  return lead.length > 132 ? `${lead.slice(0, 129).trimEnd()}…` : lead
}

/** A simple branded title/summary card (its own self-contained layer). */
export function renderCardHtml(opts: { eyebrow?: string; title: string; subtitle?: string; accent?: string }): string {
  const accent = opts.accent ?? '#6366F1'
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  body{margin:0;height:100vh;background:radial-gradient(circle at 50% 35%, #15182b 0%, #07070d 72%);color:#e6edf3;
    font:16px/1.6 ui-sans-serif,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:0 8%}
  .eyebrow{font-size:.8rem;letter-spacing:.18em;text-transform:uppercase;color:${accent};font-weight:600}
  h1{font-size:2.2rem;font-weight:680;margin:0;max-width:18ch;background:linear-gradient(90deg,#e6edf3,#a5aafc);-webkit-background-clip:text;background-clip:text;color:transparent}
  p{color:#9aa7b5;font-size:1.05rem;max-width:46ch;margin:0;white-space:pre-wrap}
  .bar{width:60px;height:4px;border-radius:3px;background:${accent};animation:grow .8s cubic-bezier(.2,.7,.3,1.2)}
  @keyframes grow{from{width:0;opacity:0}to{width:60px;opacity:1}}
  body{animation:fade .6s ease}@keyframes fade{from{opacity:0}to{opacity:1}}
  </style></head><body>
  ${opts.eyebrow ? `<div class="eyebrow">${esc(opts.eyebrow)}</div>` : ''}
  <div class="bar"></div>
  <h1>${esc(opts.title)}</h1>
  ${opts.subtitle ? `<p>${esc(opts.subtitle)}</p>` : ''}
  <script>document.body.setAttribute('data-capsule-done','true')</script>
  </body></html>`
}

const FRAME_CSS: Record<LayerFrame, string> = {
  full: 'inset:0;',
  left: 'left:0;top:0;width:50%;height:100%;border-right:1px solid #1e2a3a;',
  right: 'right:0;top:0;width:50%;height:100%;',
  'pip-br': 'right:3%;bottom:5%;width:32%;height:38%;border-radius:14px;box-shadow:0 16px 50px rgba(0,0,0,.6);border:1px solid #2a3a4f;overflow:hidden;',
  'pip-bl': 'left:3%;bottom:5%;width:32%;height:38%;border-radius:14px;box-shadow:0 16px 50px rgba(0,0,0,.6);border:1px solid #2a3a4f;overflow:hidden;',
  'pip-tr': 'right:3%;top:5%;width:32%;height:38%;border-radius:14px;box-shadow:0 16px 50px rgba(0,0,0,.6);border:1px solid #2a3a4f;overflow:hidden;',
  'pip-tl': 'left:3%;top:5%;width:32%;height:38%;border-radius:14px;box-shadow:0 16px 50px rgba(0,0,0,.6);border:1px solid #2a3a4f;overflow:hidden;',
}

/** Render the composition to one self-contained HTML stage. Each shot's layers
 *  are lazy-mounted as iframes when the shot begins (so their internal
 *  animations start at the shot's in-point), shown/hidden per the timeline with
 *  the chosen transition, and a caption lower-third overlays if set. */
export function renderCompositionHtml(comp: Composition): string {
  const totalMs = comp.shots.reduce((m, s) => Math.max(m, s.startMs + s.durationMs), 0)
  const shotsJson = JSON.stringify(
    comp.shots.map((s) => ({
      id: s.id,
      startMs: s.startMs,
      durationMs: s.durationMs,
      transition: s.transition,
      caption: s.caption ?? '',
      layers: s.layers.map((l) => ({ html: l.html, css: FRAME_CSS[l.frame] })),
    })),
  ).replace(/</g, '\\u003c')

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><title>${esc(comp.title)}</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  html,body{margin:0;height:100%;background:#07070d;overflow:hidden}
  .stage{position:fixed;inset:0}
  .shot{position:absolute;inset:0;opacity:0;transition:opacity .5s ease, transform .5s ease}
  .shot.show{opacity:1;transform:none}
  .shot.slidein{transform:translateX(4%)}
  .layer{position:absolute;border:0;background:#07070d}
  iframe.layer{width:100%;height:100%}
  .lower-third{position:fixed;left:0;right:0;bottom:0;padding:40px 6% 26px;
    background:linear-gradient(transparent,rgba(7,7,13,.92));color:#e6edf3;
    font:600 1.15rem/1.4 ui-sans-serif,system-ui,sans-serif;opacity:0;transition:opacity .4s ease;pointer-events:none}
  .lower-third.show{opacity:1}
  .lower-third small{display:block;font-weight:400;color:#9aa7b5;font-size:.85rem;letter-spacing:.14em;text-transform:uppercase;margin-bottom:4px}
</style></head>
<body>
<div class="stage" id="stage"></div>
<div class="lower-third" id="cap"><small>Tangle · agent run</small><span id="capt"></span></div>
<script>
  var SHOTS=${shotsJson}, TOTAL=${totalMs};
  var stage=document.getElementById('stage'), capEl=document.getElementById('cap'), captEl=document.getElementById('capt');
  var LAST=SHOTS.length-1, lastFrame=null, done=false;
  function finish(){ if(done) return; done=true; document.body.setAttribute('data-capsule-done','true'); }
  function mount(shot){
    var d=document.createElement('div'); d.className='shot'+(shot.transition==='slide'?' slidein':''); d.id='shot-'+shot.id;
    var frames=[];
    shot.layers.forEach(function(l){
      var f=document.createElement('iframe'); f.className='layer'; f.style.cssText='position:absolute;'+l.css;
      // allow-same-origin is required: a pure allow-scripts iframe has an opaque
      // origin where data: image loads hang, blanking screenshot/render layers.
      // Safe here — every layer is self-generated, redacted, local file:// HTML.
      f.setAttribute('sandbox','allow-scripts allow-same-origin'); f.srcdoc=l.html; d.appendChild(f); frames.push(f);
    });
    stage.appendChild(d); d._frames=frames; return d;
  }
  // Schedule each shot: mount + show at startMs, hide at end. The final shot is
  // never auto-hidden — the film ends when that shot's own iframe reports done
  // (so the outro fully lands regardless of timer drift), with TOTAL as a
  // ceiling. Every other shot fades out at its end so the next can crossfade in.
  SHOTS.forEach(function(shot, idx){
    setTimeout(function(){
      var d=mount(shot);
      requestAnimationFrame(function(){ d.classList.add('show'); });
      if(shot.caption){ captEl.textContent=shot.caption; capEl.classList.add('show'); }
      else { capEl.classList.remove('show'); }
      if(idx===LAST){ lastFrame=d._frames[0]; return; }
      setTimeout(function(){
        d.classList.remove('show');
        if(shot.caption) capEl.classList.remove('show');
        setTimeout(function(){ d.remove(); }, 600);
      }, shot.durationMs);
    }, shot.startMs);
  });
  // Poll the final shot's iframe for its done-signal; end the film a beat after.
  var poll=setInterval(function(){
    if(lastFrame){
      try{
        var doc=lastFrame.contentDocument;
        if(doc && doc.body && doc.body.getAttribute('data-capsule-done')==='true'){
          clearInterval(poll); setTimeout(finish, 500);
        }
      }catch(e){}
    }
  }, 120);
  // Ceiling: never run past the scheduled total + a margin even if a signal stalls.
  setTimeout(function(){ clearInterval(poll); finish(); }, TOTAL+2500);
</script>
</body></html>`
}

export interface AutoComposeOptions {
  title?: string
  /** Ordered rendered-model frames (data URIs) for the orbit/spin shot. */
  orbitFrames?: readonly string[]
  /** ms between revealing each run part in the timeline shot. Default 900. */
  stepMs?: number
  /** The eval verdict this run was scored against. When present, an animated
   *  scoreboard shot is pushed as the payoff (after the render reveal). */
  result?: EvalResult
}

/**
 * Derive a good default film from a run's trace + (optional) rendered frames:
 *   cinematic intro → the 1:1 run timeline (real RunGroup, streamed) → the
 *   full-frame render reveal → a real orbit of the finished model → the animated
 *   verdict scoreboard (if a result is given) → cinematic outro.
 * Override the returned Composition.shots to re-cut creatively.
 */
export async function autoCompose(spans: readonly Span[], opts: AutoComposeOptions = {}): Promise<Composition> {
  const title = opts.title ?? 'Agent run'
  const stepMs = opts.stepMs ?? 900
  const events = reduceToSemanticEvents(spans)
  const brief = events.find((e) => e.kind === 'understood_task')?.summary ?? ''
  const finalReply = [...events].reverse().find((e) => e.kind === 'agent_reply')?.summary ?? ''
  // The intro frames the mission, not the full spec — take the lead sentence/line
  // of the brief so a verbose requirements list doesn't crowd the title card.
  const missionLine = condenseBrief(brief)

  // Timeline shot length tracks the parts the studio actually reveals (mirrors
  // trace-to-run: llm turns with output + non-screenshot tool calls) so the shot
  // doesn't sit on a static final frame after the reveal finishes.
  const inlineParts = spans.filter((s) => {
    if (s.kind === 'llm') return typeof (s as { output?: unknown }).output === 'string' && ((s as { output?: string }).output ?? '').length > 0
    if (s.kind === 'tool' || s.kind === 'sandbox') {
      const at = (s as { attributes?: Record<string, unknown> }).attributes
      const tn = ((s as { toolName?: string }).toolName ?? s.name) || ''
      return !(typeof at?.screenshot === 'string' || /screenshot|\brender\b|render\./i.test(tn))
    }
    return false
  }).length
  const timelineMs = Math.min(20_000, 2600 + inlineParts * stepMs + 1200)

  const studioHtml = await renderRunStudioHtml(spans, { title, stepMs })
  const artifacts = extractArtifacts(spans)
  const hasOrbit = !!(opts.orbitFrames && opts.orbitFrames.length > 0)
  const shots: Shot[] = []
  let t = 0
  // Shots share the stage and crossfade — overlap each new shot's in-point a beat
  // (≈420ms) into the prior shot's tail so the cut breathes instead of cutting to
  // a black gap while the next iframe mounts. Never sit static.
  const OVERLAP = 420
  const push = (durationMs: number, layers: ShotLayer[], caption?: string, transition: Transition = 'fade') => {
    shots.push({ id: `s${shots.length}`, startMs: t, durationMs, transition, layers, caption })
    t += Math.max(0, durationMs - OVERLAP)
  }

  // 1. Cinematic intro — the task framed as a mission.
  push(4200, [{ html: renderIntroHtml(title, { eyebrow: 'Agent mission', subtitle: missionLine }), frame: 'full' }])

  // 2. The 1:1 run timeline is the spine; if we have a spin, PiP it bottom-right.
  const timelineLayers: ShotLayer[] = [{ html: studioHtml, frame: 'full' }]
  if (hasOrbit) {
    timelineLayers.push({
      html: renderOrbitCapsuleHtml(opts.orbitFrames as readonly string[], { title: '', fps: 24, revolutions: 999 }),
      frame: 'pip-br',
    })
  }
  push(timelineMs, timelineLayers, 'The agent works the task', 'fade')

  // 3. The visual payoff: the actual rendered output, full-frame, round-by-round.
  // sandbox-ui's run view renders no images, so this is the ONLY place the
  // agent's rendered artifact is seen — make it the hero, not a buried tool call.
  if (artifacts.renders.length > 0) {
    const perMs = 3000
    const n = artifacts.renders.length
    const imgs = artifacts.renders.map((r, idx) => ({
      src: r.src,
      caption: n > 1 ? (idx === n - 1 ? 'Final render' : `Iteration ${idx + 1}`) : 'Rendered output',
    }))
    push(
      n * perMs + 1600,
      [{ html: renderImageRevealHtml(imgs, { title: 'The rendered design', perMs }), frame: 'full' }],
      'The rendered design',
      'fade',
    )
  }

  // 4. The hero: a real 360° orbit of the finished model.
  if (hasOrbit) {
    push(
      7000,
      [{ html: renderOrbitCapsuleHtml(opts.orbitFrames as readonly string[], { title: 'The finished model', fps: 30, revolutions: 3 }), frame: 'full' }],
      'A full turn around the result',
      'fade',
    )
  }

  // 5. Agent-generated media artifacts each get their own shot.
  for (const v of artifacts.videos) {
    push(9000, [{ html: renderVideoLayerHtml(v.src, { title: 'Generated video', maxMs: 9000 }), frame: 'full' }], `Output: ${v.label}`, 'fade')
  }
  for (const d of artifacts.docs) {
    push(6000, [{ html: renderDocLayerHtml(d.src, { title: 'Generated document', maxMs: 6000 }), frame: 'full' }], `Output: ${d.label}`, 'fade')
  }

  // 6. The verdict scoreboard — the payoff. Each check lands, then the big tally.
  if (opts.result) {
    push(
      scoreboardDurationMs(opts.result) + 700,
      [{ html: renderScoreboardHtml(opts.result), frame: 'full' }],
      'Scored by the geometry gate',
      'fade',
    )
  }

  // 7. Cinematic outro — outcome + sign-off. With a verdict, the outcome is
  // stated cleanly (the raw final reply is often the artifact itself, e.g. the
  // .scad source — not subtitle material), with the gate result as stat chips.
  const r = opts.result
  const stats = r
    ? [
        `${Object.values(r.checks).filter(Boolean).length}/${Object.keys(r.checks).length} checks`,
        `score ${r.score.toFixed(2)}`,
      ]
    : undefined
  const outroSubtitle = r
    ? r.resolved
      ? 'Authored, compiled, rendered — and cleared every geometry check.'
      : 'The run completed; the verdict is in.'
    : condenseBrief(finalReply)
  push(
    4800,
    [
      {
        html: renderOutroHtml(r ? (r.resolved ? 'Verified by the real engine' : 'Run complete') : 'Run complete', {
          eyebrow: r?.resolved ? 'Resolved' : 'Done',
          subtitle: outroSubtitle,
          stats,
        }),
        frame: 'full',
      },
    ],
    undefined,
    'fade',
  )
  return { title, shots }
}
