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
  // `dedupe`: storydeck keeps its own React in its
  // own node_modules for its own suite. Without this, its components would render with a second
  // React while the stage around them uses ours — "Cannot read properties of null (reading
  // 'useState')", the classic two-copies failure. React is a peer of both packages; one copy is
  // the contract, and this is where a linked checkout has to be told so.
  resolve: { alias: vizfootprintAliases, dedupe: ['react', 'react-dom'] },
  test: {
    // storydeck ships its React components as SOURCE (.jsx, extensionless imports) for the
    // consumer's bundler to compile. Node cannot load that, so a test run must transform it
    // like our own source instead of externalising it from node_modules.
    server: { deps: { inline: ['storydeck'] } },
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'gallery/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
