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
  // two pages: the cockpit gallery, and the Sheet over 90,300 rows (its own page,
  // because 90k rows in the cockpit's document would change every no-scroll assertion)
  await bundle('entry.tsx', 'gallery.js', 'production');
  // the SHEET page is built in DEVELOPMENT mode on purpose: React's dev build is the
  // only thing that warns about a duplicate key or a bad prop, and the sheet's smoke
  // asserts that nothing is warned. It costs a bigger bundle on one test page.
  await bundle('sheet.tsx', 'sheet.js', 'development');
  return OUT;
}

async function bundle(entry, outfile, mode) {
  await esbuild.build({
    entryPoints: [path.join(__dirname, entry)],
    bundle: true,
    outfile: path.join(OUT, outfile),
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    jsxDev: mode === 'development',
    define: { 'process.env.NODE_ENV': `"${mode}"` }, // no `process` crash either way
    logLevel: 'silent',
    plugins: [stubDuckDb],
  });
}
