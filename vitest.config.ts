import { defineConfig } from 'vitest/config';
// The doors resolve to SOURCE in a test run and to dist everywhere else —
// vitest.alias.mjs says why, and is the one list all three configs share.
import { vizfootprintAliases } from './vitest.alias.mjs';

export default defineConfig({
  resolve: { alias: vizfootprintAliases },
  test: {
    // Q11 (docs/RESEARCH_STATE.md): the 10k-seeded-sim FDR tests
    // (spikes/x2-fdr/a2-batch-bh-wrong.test.ts) sit close enough to the 5s
    // vitest default under load to be the repo's one reproducible flake risk.
    // Codify a wider ceiling repo-wide. bench/x4/x4.test.ts already sets its
    // own much larger per-test timeout (240_000ms) and is unaffected.
    testTimeout: 30_000,
    // Coverage is enforced at 100% — a drop fails `npm run test:coverage`;
    // unreachable defensive arms carry documented `/* v8 ignore */` comments
    // at the site.
    coverage: {
      include: ['src/**', 'ui/src/**', 'demo/src/**', 'demo-agent/src/**', 'bridges/vega-lite/src/**'],
      // `include: ['src/**']` sweeps in the READMEs that sit beside the code
      // (this repo keeps a small one per feature folder). The v8 provider then
      // tries to parse each as JavaScript when it accounts for uncovered files
      // and prints a PARSE_ERROR stack per file — noise, never a failure. Only
      // source files can carry coverage, so name the ones that cannot.
      exclude: ['**/*.test.*', '**/*.coverage.helpers.*', '**/*.md'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
