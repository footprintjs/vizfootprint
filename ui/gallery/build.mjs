/**
 * Bundles the gallery page (esbuild, no framework tooling): entry.tsx + the
 * library SOURCE + React → one IIFE, plus the stylesheet, into gallery/dist/.
 * The DuckDB-WASM stub mirrors the repo demos' trick — footprintjs's data layer
 * only lazily imports it (the memory engine never touches it), the stub just
 * keeps the browser bundle clean.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, copyFileSync } from 'node:fs';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'dist');

const stubDuckDb = {
  name: 'stub-duckdb-wasm',
  setup(build) {
    build.onResolve({ filter: /^@duckdb\/duckdb-wasm$/ }, (args) => ({ path: args.path, namespace: 'duckdb-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'duckdb-stub' }, () => ({ contents: 'export default {};', loader: 'js' }));
  },
};

export async function buildGallery() {
  mkdirSync(OUT, { recursive: true });
  copyFileSync(path.join(__dirname, '..', 'src', 'styles.css'), path.join(OUT, 'vizfootprint-ui.css'));
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'entry.tsx')],
    bundle: true,
    outfile: path.join(OUT, 'gallery.js'),
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    jsxDev: false,
    define: { 'process.env.NODE_ENV': '"production"' }, // prod React, no `process` crash
    logLevel: 'silent',
    plugins: [stubDuckDb],
  });
  return OUT;
}
