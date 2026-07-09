/**
 * Demo bundler — reuses the bench/x4 esbuild + DuckDB-stub trick (bench/x4/
 * runner.mjs:35-63). The demo runs the REAL landed layers (src/log, src/mosaic,
 * src/cause, src/analysis, src/fdr) INSIDE the browser over a real
 * @uwdata/mosaic-core Selection. That barrel statically imports the DuckDB-WASM
 * connector, which the demo never touches (it uses in-memory data, exactly the
 * D24 "memory" engine the bench proved works with the connector stubbed) — so
 * we alias @duckdb/duckdb-wasm to an empty module to keep the bundle lean and
 * browser-clean. footprintjs itself is pure ESM with no node builtins in its
 * runtime, so it bundles for the browser as-is.
 *
 * No framework, no watch — one esbuild call per page entry, bundled to an IIFE
 * on `globalThis` (VizDemoDashboard / VizDemoAnalyst).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The DuckDB-WASM stub plugin (verbatim shape from bench/x4/runner.mjs). */
const stubDuckDb = {
  name: 'stub-duckdb-wasm',
  setup(build) {
    build.onResolve({ filter: /^@duckdb\/duckdb-wasm$/ }, (args) => ({
      path: args.path,
      namespace: 'duckdb-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'duckdb-stub' }, () => ({
      contents: 'export default {};',
      loader: 'js',
    }));
  },
};

/** The two page entries and the global each exposes. */
export const ENTRIES = {
  dashboard: { entry: 'src/dashboard.ts', globalName: 'VizDemoDashboard' },
  analyst: { entry: 'src/analyst.ts', globalName: 'VizDemoAnalyst' },
};

/**
 * Bundle one page entry into a single browser IIFE string.
 * @param {'dashboard'|'analyst'} name
 * @returns {Promise<string>} the bundled JS
 */
export async function buildBundle(name) {
  const spec = ENTRIES[name];
  if (!spec) throw new Error(`unknown demo bundle "${name}"`);
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, spec.entry)],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: spec.globalName,
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
    plugins: [stubDuckDb],
  });
  const out = result.outputFiles?.[0];
  if (!out) throw new Error(`esbuild produced no output for "${name}"`);
  return out.text;
}

/** Build both bundles once. Returns `{ dashboard, analyst }` (JS strings). */
export async function buildAllBundles() {
  const [dashboard, analyst] = await Promise.all([buildBundle('dashboard'), buildBundle('analyst')]);
  return { dashboard, analyst };
}
