# Published dependency ownership sweep

Verified against main 2c4fbe498a55a5c22a58a8e861e2210684cef314.

## Result

One real ownership violation remains.

`src/audio.ts` hand-builds the OpenAI-compatible TTS HTTP request to `<routerBaseUrl>/audio/speech`. Published `@tangle-network/agent-integrations@0.55.0` owns OpenAI `audio.speech.create`, but its published `openaiConnector` is fixed to `https://api.openai.com`. It cannot target `https://router.tangle.tools/v1`.

Replacing the fetch today would therefore change providers instead of removing a wrapper. This is a real violation with a missing published-owner seam, not a safe consumer-only edit.

No other Tangle package is vendored in run-capsule. The package already consumes published `@tangle-network/agent-eval`; its UI dependencies are development-only registry packages.

## Exact GTR proof of the current violation

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build

export ROUTER_KEY='<real router key>'
export ROUTER_BASE='https://router.tangle.tools/v1'
node dist/cli.js <real-run-trace.json> --narrate --out /tmp/run-capsule-proof.mp4
test -s /tmp/run-capsule-proof.mp4
ffprobe -v error -show_streams /tmp/run-capsule-proof.mp4 | grep codec_type=audio
```

Retain:
1. registry install output,
2. successful build,
3. Router request evidence for `POST /v1/audio/speech`,
4. the produced MP4 path and ffprobe audio-stream line.

The consumer migration is blocked until agent-integrations publishes an OpenAI-compatible connector/client whose base URL is host-configurable. Once that exists, replace the fetch in `src/audio.ts` and pin that published version.