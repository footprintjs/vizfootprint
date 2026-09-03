import { defineConfig } from 'vitest/config';
// The library's doors resolve to SOURCE in a test run (and to dist everywhere
// else) — the shared list, and why, live in ../vitest.alias.mjs.
import { vizfootprintAliases } from '../vitest.alias.mjs';

// The component library is React; its unit tests need a DOM. jsdom is the
// default environment here, but every *.test.tsx ALSO carries a
// `// @vitest-environment jsdom` docblock so the repo-root `vitest run` (which
// globs every subdir and knows nothing about this workspace) runs them in jsdom
// too — the ui suite therefore ADDS to the root count instead of breaking it.
// The Playwright gallery smoke opts back out with `// @vitest-environment node`.
// JSX uses the AUTOMATIC runtime everywhere (oxc default in vitest 4, esbuild
// `jsx: automatic` in build.mjs) so component source needs no `import React`;
// the UMD build shims `react/jsx-runtime` from `window.React`.
export default defineConfig({
  resolve: { alias: vizfootprintAliases },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'gallery/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
