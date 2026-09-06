import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
// The library's doors resolve to SOURCE in a test run (and to dist everywhere
// else) — the shared list, and why, live in ../vitest.alias.mjs.
import { vizfootprintAliases } from '../vitest.alias.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The desk is React; its tests need a DOM. jsdom is the default here, and every
// *.test.tsx ALSO carries a `// @vitest-environment jsdom` docblock so the
// repo-root `vitest run` (which globs every subdir and knows nothing about this
// workspace) runs them in jsdom too — this suite therefore ADDS to the root
// count instead of breaking it, exactly as `ui/vitest.config.ts` explains.
//
// `vizfootprint-ui` is NOT aliased to source. It is a dependency of this
// package, resolved through its own exports map to `ui/dist` — which is the
// point: the desk is the first consumer of that surface outside the checkout's
// own component tree, and a test that reached into `ui/src` would prove the
// composition works against files no installed consumer can see. Run
// `npm run build -w vizfootprint-ui` before this suite.
export default defineConfig({
  // `dedupe`: storydeck is a LINKED package and keeps its own React for its own
  // suite; the story stage renders its components inside ours. One copy of
  // React or the hooks break — the classic two-copies failure.
  resolve: { alias: vizfootprintAliases, dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 30_000,
    // THIS WORKSPACE'S OWN GATE, at the library's own standard. A workspace
    // whose coverage is weaker than the library's is where the next silent
    // defect lives — and the root config measures the five trees it NAMES, so
    // nothing else is measuring this one. The include is anchored here for the
    // same reason it is anchored there: a bare `src/**` is matched loosely and
    // would sweep in any workspace that ever nests under this one.
    coverage: {
      include: [path.join(HERE, 'src/**')],
      // `src/**` sweeps in the READMEs that sit beside the code; the v8 provider
      // then tries to parse each as JavaScript and prints a stack per file —
      // noise, never a failure. Only source files can carry coverage.
      exclude: ['**/*.test.*', '**/*.md'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
