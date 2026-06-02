/**
 * Directing pass — re-time a Storyboard so the replay reads like an edit, not a
 * slideshow. The substrate assigns neutral per-importance durations; this pass
 * adds narrative rhythm on top, purely consumer-side (it only adjusts
 * `scene.durationMs`, which the storyboard HTML player already honors — no
 * substrate change, no new renderer).
 *
 * The one beat that matters most: failure → fix. When a failure is resolved by
 * the work that follows, hold ON the failure (let the stakes land) and then
 * punch the resolving shot. Openings and the closing summary get a touch more
 * room; long runs of low-stakes shots tighten so momentum never sags.
 */

import type { Scene, Storyboard } from '@tangle-network/agent-eval/storyboard'

export interface DirectOptions {
  /** Multiplier applied to a failure shot that gets resolved later. Default 1.6. */
  failureHold?: number
  /** Multiplier applied to the shot that resolves a failure. Default 1.3. */
  resolvePunch?: number
  /** Multiplier applied to title + summary cards. Default 1.25. */
  bookendStretch?: number
  /** Shots of these scene types tighten when they run consecutively. */
  tighten?: number
}

const RESOLVING: ReadonlySet<Scene['sceneType']> = new Set(['diff', 'terminal', 'reply', 'summary'])
const LOW_STAKES: ReadonlySet<Scene['sceneType']> = new Set(['reasoning', 'search', 'file'])

/** Return a new Storyboard with narrative-aware shot durations. Pure. */
export function directStoryboard(storyboard: Storyboard, opts: DirectOptions = {}): Storyboard {
  const failureHold = opts.failureHold ?? 1.6
  const resolvePunch = opts.resolvePunch ?? 1.3
  const bookend = opts.bookendStretch ?? 1.25
  const tighten = opts.tighten ?? 0.8

  const scenes = storyboard.scenes.map((s) => ({ ...s }))
  let lowStreak = 0

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]!
    if (s.sceneType === 'title_card' || s.sceneType === 'summary') {
      s.durationMs = Math.round(s.durationMs * bookend)
      lowStreak = 0
      continue
    }
    if (s.sceneType === 'error') {
      // Is this failure resolved by a later shot? If so, hold on it.
      const resolvedLater = scenes.slice(i + 1).some((n) => RESOLVING.has(n.sceneType))
      if (resolvedLater) {
        s.durationMs = Math.round(s.durationMs * failureHold)
        // Punch the first resolving shot that follows.
        const fix = scenes.slice(i + 1).find((n) => RESOLVING.has(n.sceneType))
        if (fix) fix.durationMs = Math.round(fix.durationMs * resolvePunch)
      }
      lowStreak = 0
      continue
    }
    // Tighten a sustained run of low-stakes shots so momentum holds — but never
    // below a readable floor, and never the first of a run.
    if (LOW_STAKES.has(s.sceneType)) {
      lowStreak++
      if (lowStreak >= 2) s.durationMs = Math.max(1800, Math.round(s.durationMs * tighten))
    } else {
      lowStreak = 0
    }
  }

  return { ...storyboard, scenes, totalMs: scenes.reduce((sum, s) => sum + s.durationMs, 0) }
}
