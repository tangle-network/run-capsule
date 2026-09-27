# run-capsule

`run-capsule` renders an agent run's trace (`Span[]`, the `@tangle-network/agent-eval` storyboard IR)
into shareable video capsules — code, terminal, screen, conversation, replay, and the heavier opt-in
studio/orbit/composed kinds. It is a renderer and an upload gate; it does not own trace analysis,
redaction rules, or the span contract itself — see Ownership.

## Read for the task

- For CLI flags, capsule kinds, and the library API, read [README.md](README.md) — it is the source
  of truth for both; `npx run-capsule --help` is the source of truth for flags specifically.
- Resolve current exports and signatures from [src/index.ts](src/index.ts), not from memory of an
  older version.

## Ownership

This package is a rendering and publishing surface. It does not reimplement logic another package
already owns:

- `@tangle-network/agent-eval` owns the `Span[]` trace contract, the storyboard/`CodeEdit` IR this
  package renders, and the one redaction/share-safety core (`redactForShare`, `assessShareSafety`).
  Every upload path calls that core; this package never carries its own credential or PII pattern
  list. If a value should be redacted and is not, fix `agent-eval`'s core and bump the dependency —
  do not patch it here.
- `@tangle-network/traces` is the sibling CLI/SDK surface that *analyzes* the same trace (contracts,
  diffs, facts, MCP). run-capsule *renders* it. Both consume the same span contract; neither owns it.
- `@tangle-network/browser-agent-driver` owns the cursor overlay baked into an ingested `--video`.
  run-capsule reuses that recording; it does not re-render a cursor.

## Invariants

- **Upload is opt-in and off by default.** `runToVideo`'s `upload` option (CLI `--upload`) defaults
  to `false`. A clip stays in `outDir` unless the caller explicitly asks to publish it.
- **Redact, then check the redacted copy, then decide.** Before anything renders, the trace, title,
  and result are redacted under the `share` profile. The redacted copy is then scored for share
  safety. An upload proceeds only on `SAFE` or `SAFE_WITH_WARNINGS`. `UNSAFE` or `UNKNOWN` keeps the
  clip local and reports why in `results[].error` — never uploaded "with a warning."
- **A kind that embeds unread pixels is never trusted as text-safe.** `composed`, `orbit`, `screen`,
  and `replay` (`MEDIA_GATED_KINDS` in `src/run-to-video.ts`) can carry frames no text detector reads.
  Each of those four gets its own media verdict; a `SAFE` text verdict on the trace does not imply the
  pixels are safe. An ingested `--video` is always `UNKNOWN` for this reason and is never uploaded.
- **`uploadToShareHost` is not exported.** It has no gate of its own. `runToVideo`'s internal
  `maybePublish()` is the only caller, and only after a passing verdict. A caller that needs to publish
  directly builds its own verdict with `assessShareSafety`/`redactForShare` first — never calls the
  raw upload function to route around the gate.

## What not to do

- Do not hand-write a credential or PII pattern here. Extend `agent-eval`'s redaction core
  ([its docs/redaction.md](https://github.com/tangle-network/agent-eval/blob/main/docs/redaction.md))
  and depend on the new version.
- Do not add `upload: true` as a default anywhere, including in an example or a wrapper script. The
  opt-in is the safety boundary, not a inconvenience to remove.
- Do not treat `SAFE_WITH_WARNINGS` as a reason to skip reading the warnings, and do not treat
  `UNKNOWN` as safe — both `UNSAFE` and `UNKNOWN` block upload for a reason, not by omission.
- Do not assume `@tangle-network/agent-eval`'s published version matches this package's declared
  range without checking; run `npm view @tangle-network/agent-eval version` before pinning a bump.

## Validation

Run from the package root:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm run check:cohort-ranges   # the rendered timing cohorts stay in their declared ranges
pnpm test
pnpm build                     # dist/index.js (SDK), dist/cli.js (bin), the bundled studio assets
```

`npx run-capsule --demo` renders the built-in sample end to end (no network required unless
`--upload` is also passed) and is the fastest real-run check that rendering and encoding both work.
