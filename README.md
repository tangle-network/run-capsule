# @tangle-network/run-capsule

Turn any agent run's **trace** into a **shareable video**.

`run-capsule` consumes a run's `Span[]` trace (the [`@tangle-network/agent-eval`](https://www.npmjs.com/package/@tangle-network/agent-eval) `storyboard` IR), renders modality-typed **capsule** animations — code, terminal, screen, conversation, and a unified replay — records each headless to MP4, and uploads to a temporary public link. Secrets are **redacted before anything is rendered or uploaded**.

> The trace is the source of truth; the storyboard is the IR; the video is just one compiled target. Capture once, render many views.

```ts
import { runToVideo } from '@tangle-network/run-capsule'

const { results } = await runToVideo(spans, { title: 'Agent builds a DEX', outDir: 'out' })
for (const r of results) console.log(r.kind, r.url) // → shareable links
```

```
npx run-capsule --workdir ./generated-project      # code capsule from real files
npx run-capsule --playwright agent-result.json     # browser/screen from a Playwright run
npx run-capsule --claude stream.jsonl              # any Claude Messages stream
npx run-capsule --demo                             # built-in sample
```

## What it renders

`runToVideo` **auto-detects** which capsules a trace supports and renders only those:

| Capsule | Built from | Shows |
|---|---|---|
| `code` | edit/write tool spans | the agent typing each file (themed, file tabs + explorer) |
| `terminal` | shell/sandbox spans | commands typing out with their output |
| `screen` | browser/computer-use spans | real screenshots replayed with action captions |
| `conversation` | llm messages | the back-and-forth reasoning |
| `replay` | the whole trace | the unified storyboard (title → moments → summary) |

## Adapters — one per surface

Map your agent surface into `Span[]` once, then everything downstream is uniform:

| Adapter | Surface |
|---|---|
| `spansFromPlaywrightResult` | `@tangle-network/agent-browser-driver` `TestResult` (browser, with screenshots) |
| `spansFromComputerUse` | computer-use loops (Anthropic computer-use, CUA, desktop drivers) |
| `spansFromClaudeMessages` | any Anthropic Messages stream (e.g. sandbox-driver `stream-shot-*.jsonl`) |
| `spansFromRuntimeEvents` | agent-eval `RuntimeEventLike[]` |
| `spansFromWorkdir` | a generated project directory |

The output is only as rich as the trace: a `screen` capsule shows real frames when the trace carries `attributes.screenshot`; a `code` capsule shows real code when edits carry their content.

## Privacy

The clip is **published to a public host** (litterbox by default, temporary; or catbox, permanent). `runToVideo` runs `redactSpans` first, which strips high-confidence credential shapes (provider tokens, JWTs, PEM keys, `key=value` secrets) from every string in the trace. It is fail-closed (over-redacts rather than leak), and leaves `data:` URIs (screenshots) intact. Still: only render runs you're comfortable sharing.

## System dependencies

Recording needs a browser and (for MP4) ffmpeg:

- **Chromium** — `npx playwright install chromium` (or use the Docker image / Nix flake below).
- **ffmpeg** — on `PATH`. Without it, output stays `.webm` (still playable/uploadable).

### Docker (everything bundled)

```
docker build -t run-capsule .
docker run --rm -v "$PWD/out:/out" run-capsule --demo --out /out
```

The image is based on the official Playwright image (Chromium + system libs preinstalled) plus ffmpeg.

### Nix

```
nix develop          # devShell with node, pnpm, ffmpeg, and Chromium wired for Playwright
```

## API

- `runToVideo(spans, { title, kinds?, outDir, upload?, host?, expiry?, toMp4? })` → `{ runDir, results }`
- `supportedKinds(spans)` → which capsules the trace supports
- `renderCodeCapsuleHtml` / `renderTerminalCapsuleHtml` / `renderScreenCapsuleHtml` / `renderConversationCapsuleHtml`
- `recordHtmlToVideo(htmlPath, outDir, opts)` → `{ webm, mp4? }`
- `uploadToShareHost(file, { host, expiry })` → URL
- the adapters above, and `redactSpans`

## License

MIT
