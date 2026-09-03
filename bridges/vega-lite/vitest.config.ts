import { defineConfig } from 'vitest/config';
// The bridge reads the library's spec-shape gate through the `vizfootprint/renderer`
// door. In a test run that door resolves to SOURCE — the shared list, and why,
// live in ../../vitest.alias.mjs. Without this config `npm run test:vega-lite`
// would be the one runner in the repo that did not know the doors.
import { vizfootprintAliases } from '../../vitest.alias.mjs';

export default defineConfig({
  resolve: { alias: vizfootprintAliases },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], testTimeout: 30_000 },
});
