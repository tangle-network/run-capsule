import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  // Build-time-only deps: the studio app (app.tsx) is pre-bundled separately by
  // scripts/build-studio.mjs into dist/studio/assets.json, and esbuild loads
  // dynamically only on the dev fallback path — keep them out of the lib.
  external: ['esbuild', '@tangle-network/sandbox-ui', '@tangle-network/ui', '@tangle-network/brand', 'react', 'react-dom'],
})
