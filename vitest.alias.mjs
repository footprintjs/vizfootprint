/**
 * ONE list: how `vizfootprint/<door>` resolves INSIDE this checkout.
 *
 * The exports map in `package.json` points every door at `dist/` — built JS
 * beside built `.d.ts` — because that is what a consumer outside this checkout
 * resolves, and what `tsc` must read for the ui package to stop emitting the
 * library's own types under its name. See PACKAGING.md.
 *
 * A TEST run may not resolve there, for two reasons that are both load-bearing:
 *
 *   - coverage is enforced at 100% over `src/**`, and a test that loaded
 *     `dist/` would credit none of it;
 *   - `dist/` is a SECOND copy of every module. A test file that imported the
 *     fixture from `src` and the builder from `dist` would be holding two
 *     libraries — two commit-id counters, two registries — and the failure
 *     would read as a bug in the library rather than in the resolution.
 *
 * So every vitest config in this repo (root, ui, vega-lite) resolves the doors
 * back to source through this list. It is the SAME list as the exports map, and
 * a door added to one and not the other is the drift to watch for.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src');

/** Door → the source module the exports map's `dist/` twin is built from. */
const DOORS = {
  '.': 'agent/index.ts',
  agent: 'agent/index.ts',
  session: 'session/index.ts',
  def: 'def/index.ts',
  analysis: 'analysis/index.ts',
  source: 'source/index.ts',
  'source/file': 'source/file.ts',
  data: 'data/index.ts',
  cause: 'cause/index.ts',
  mosaic: 'mosaic/index.ts',
  prose: 'prose/index.ts',
  log: 'log/index.ts',
  branches: 'branches/index.ts',
  renderer: 'renderer/index.ts',
  mcp: 'mcp/index.ts',
};

// Anchored, and specific-before-general: a bare prefix alias would rewrite
// `vizfootprint/source/file` through the `vizfootprint/source` entry.
export const vizfootprintAliases = Object.entries(DOORS).map(([door, file]) => ({
  find: door === '.' ? /^vizfootprint$/ : new RegExp(`^vizfootprint/${door}$`),
  replacement: path.join(SRC, file),
}));

export default vizfootprintAliases;
