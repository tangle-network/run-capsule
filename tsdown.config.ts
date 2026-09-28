import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  platform: 'node',
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  fixedExtension: false,
  // Build-time-only deps: the studio app (app.tsx) is pre-bundled separately by
  // scripts/build-studio.mjs into dist/studio/assets.json, and esbuild loads
  // dynamically only on the dev fallback path — keep them out of the lib.
  deps: {
    neverBundle: [
      /^esbuild(\/|$)/,
      /^@tangle-network\/(sandbox-ui|ui|brand)(\/|$)/,
      /^react(-dom)?(\/|$)/,
    ],
  },
})
