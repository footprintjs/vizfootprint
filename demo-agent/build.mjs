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
import { mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(__dirname, '.cache');
const VENDOR = path.join(__dirname, 'vendor');
const require2 = createRequire(import.meta.url);

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
 * Vendor the AgentThinkingUI debugger's browser assets into `demo-agent/vendor/`
 * so the /debug page loads them LOCALLY — never a CDN (hardened + works offline).
 * Mirrors the dress-shop's local-atui serving (dress-shop/src/web/server.ts:39-41
 * reads `agentthinkingui/umd` + `agentthinkingui/styles.css`), and goes one step
 * further: React + ReactDOM are vendored too (the dress-shop debug page pulled
 * those from unpkg), so the debugger has ZERO external requests and the Playwright
 * smoke's iframe-isolation check renders with no network.
 *
 * Copies once at boot; returns the route→file map the server serves from.
 * @returns {Record<string,string>} route path → absolute vendored file path
 */
export function vendorDebuggerAssets() {
  mkdirSync(VENDOR, { recursive: true });
  // React 18's `exports` field doesn't expose its UMD subpaths, so resolve each
  // package's package.json (always exported) and join the UMD file beside it.
  const pkgDir = (name) => path.dirname(require2.resolve(`${name}/package.json`));
  const sources = {
    '/vendor/atui.umd.js': require2.resolve('agentthinkingui/umd'),
    '/vendor/atui.css': require2.resolve('agentthinkingui/styles.css'),
    '/vendor/react.js': path.join(pkgDir('react'), 'umd', 'react.production.min.js'),
    '/vendor/react-dom.js': path.join(pkgDir('react-dom'), 'umd', 'react-dom.production.min.js'),
  };
  /** @type {Record<string,string>} */
  const routes = {};
  for (const [route, src] of Object.entries(sources)) {
    const dest = path.join(VENDOR, path.basename(route));
    copyFileSync(src, dest);
    routes[route] = dest;
  }
  return routes;
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
