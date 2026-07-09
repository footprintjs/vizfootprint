/**
 * Bundler for the mixed-principal demo — reuses the demo's esbuild + DuckDB-stub
 * trick (demo/build.mjs). Two outputs:
 *
 *   1. the SERVER CORE (src/core.ts) → a node ESM module written to `.cache/`,
 *      dynamic-imported by server.mjs. `packages: 'external'` keeps agentfootprint
 *      / footprintjs / node builtins as real runtime imports (fast, safe) and
 *      bundles only our TypeScript (esbuild resolves the `.js` import specifiers
 *      to their `.ts` sources, the same convention src/** uses).
 *
 *   2. the BROWSER APP (src/app.ts) → a single IIFE on `globalThis.VizAgentApp`,
 *      the combined dashboard + chat page. footprintjs's data layer only lazily
 *      imports @duckdb/duckdb-wasm (memory engine never touches it), but the stub
 *      keeps the browser bundle clean regardless.
 */
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(__dirname, '.cache');

/** The DuckDB-WASM stub plugin (verbatim shape from demo/build.mjs). */
const stubDuckDb = {
  name: 'stub-duckdb-wasm',
  setup(build) {
    build.onResolve({ filter: /^@duckdb\/duckdb-wasm$/ }, (args) => ({ path: args.path, namespace: 'duckdb-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'duckdb-stub' }, () => ({ contents: 'export default {};', loader: 'js' }));
  },
};

/**
 * Bundle the server core to a node ESM module and return its absolute path.
 * @returns {Promise<string>} the written `.cache/core.mjs` path
 */
export async function buildCoreModule() {
  mkdirSync(CACHE, { recursive: true });
  const outfile = path.join(CACHE, 'core.mjs');
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'src', 'core.ts')],
    bundle: true,
    outfile,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    packages: 'external', // agentfootprint / footprintjs / node builtins stay real imports
    logLevel: 'silent',
    plugins: [stubDuckDb],
  });
  return outfile;
}

/**
 * Bundle the combined browser page into one IIFE string.
 * @returns {Promise<string>} the bundled JS
 */
export async function buildAppBundle() {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'src', 'app.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'VizAgentApp',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
    plugins: [stubDuckDb],
  });
  const out = result.outputFiles?.[0];
  if (!out) throw new Error('esbuild produced no output for the app bundle');
  return out.text;
}
