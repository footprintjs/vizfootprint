import { defineConfig } from 'vitest/config';

export default defineConfig({
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
      include: ['src/**', 'ui/src/**', 'demo/src/**', 'demo-agent/src/**'],
      exclude: ['**/*.test.*', '**/*.coverage.helpers.*'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
