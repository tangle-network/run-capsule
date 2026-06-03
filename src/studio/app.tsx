/**
 * Studio player — renders an agent run 1:1 with the product by mounting the REAL
 * sandbox-ui components (`RunGroup`, which composes `InlineToolItem` /
 * `InlineThinkingItem` / `ExpandedToolDetail`). It reads the run bundle injected
 * as `window.__RUN__` ({ run, partMap }) and STREAMS the assistant's parts in
 * over time, so the recording looks like a live agent working — tool calls
 * appearing, thinking blocks expanding — not a static dump.
 *
 * Bundled to a single self-contained page by studio/render.ts (esbuild) and
 * recorded by record.ts; it sets `data-capsule-done` on <body> when the reveal
 * finishes (the recorder's done-signal).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RunGroup } from '@tangle-network/sandbox-ui/run'

interface Bundle {
  run: any
  partMap: Record<string, any[]>
  title?: string
  /** ms between revealing each assistant part. */
  stepMs?: number
}

declare global {
  interface Window {
    __RUN__: Bundle
  }
}

function App({ bundle }: { bundle: Bundle }) {
  const { run, partMap } = bundle
  const stepMs = bundle.stepMs ?? 1100

  const userMsg = run.messages.find((m: any) => m.role === 'user')
  const asstMsg = run.messages.find((m: any) => m.role === 'assistant')
  const userText: string = userMsg
    ? (partMap[userMsg.id] ?? []).map((p: any) => p.text).filter(Boolean).join('\n')
    : ''
  const asstParts: any[] = asstMsg ? partMap[asstMsg.id] ?? [] : []

  // Rebuild the toolCategories Set (serialized as an array across the wire).
  const runForGroup = useMemo(() => {
    const cats = Array.isArray(run.stats?.toolCategories) ? run.stats.toolCategories : []
    return {
      ...run,
      messages: asstMsg ? [asstMsg] : [],
      stats: { ...run.stats, toolCategories: new Set(cats) },
    }
  }, [run, asstMsg])

  // Stream the assistant parts in.
  const [revealed, setRevealed] = useState(0)
  useEffect(() => {
    if (revealed >= asstParts.length) {
      const t = setTimeout(() => document.body.setAttribute('data-capsule-done', 'true'), 1400)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setRevealed((n) => n + 1), revealed === 0 ? 600 : stepMs)
    return () => clearTimeout(t)
  }, [revealed, asstParts.length, stepMs])

  const livePartMap = useMemo(
    () => (asstMsg ? { [asstMsg.id]: asstParts.slice(0, revealed) } : {}),
    [asstMsg, asstParts, revealed],
  )

  // Stick-to-bottom for the recording: as parts stream in the RunGroup grows
  // past the viewport, so keep the newest content in frame. A headless capture
  // has no user, so we pin unconditionally (the product's useAutoScroll defers
  // to user scroll-up, which would freeze the view mid-recording) and re-pin
  // across a few frames to absorb late growth — thinking blocks expanding after
  // a part is revealed.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const pin = () => {
      el.scrollTop = el.scrollHeight
    }
    pin()
    const raf = requestAnimationFrame(pin)
    const ts = [160, 420, 800].map((ms) => setTimeout(pin, ms))
    return () => {
      cancelAnimationFrame(raf)
      for (const t of ts) clearTimeout(t)
    }
  }, [revealed])

  return (
    <div
      data-sandbox-ui
      style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--md3-surface, #0a0a14)', overflow: 'hidden' }}
    >
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '28px 0' }}>
        <div style={{ width: 'min(880px, 94vw)', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {userText ? (
            <div
              style={{
                alignSelf: 'flex-start',
                maxWidth: '85%',
                background: 'var(--depth-2, #141328)',
                border: '1px solid var(--border-default, rgba(100,100,148,.18))',
                borderRadius: 16,
                borderBottomLeftRadius: 4,
                padding: '12px 16px',
                color: 'var(--text-primary, #e6edf3)',
                font: '15px/1.5 ui-sans-serif, system-ui, sans-serif',
                whiteSpace: 'pre-wrap',
              }}
            >
              {userText}
            </div>
          ) : null}
          <RunGroup run={runForGroup} partMap={livePartMap} collapsed={false} onToggle={() => {}} />
          <div style={{ height: 48 }} />
        </div>
      </div>
    </div>
  )
}

const bundle = window.__RUN__
const el = document.getElementById('root')
if (el && bundle) createRoot(el).render(<App bundle={bundle} />)
