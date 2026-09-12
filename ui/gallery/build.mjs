/**
 * Bundles the gallery page (esbuild, no framework tooling): entry.tsx + the
 * library SOURCE + React → one IIFE, plus the stylesheet, into gallery/dist/.
 * The DuckDB-WASM stub mirrors the repo demos' trick — footprintjs's data layer
 * only lazily imports it (the memory engine never touches it), the stub just
 * keeps the browser bundle clean. ONE page is built without it: the WASM page,
 * whose whole point is the real package — see `localDuckDb` below.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, copyFileSync } from 'node:fs';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'dist');

/** The stub: every page whose engine is memory gets `{}` for the package, and a bundle that never carries DuckDB. */
const stubDuckDb = {
  name: 'stub-duckdb-wasm',
  setup(build) {
    build.onResolve({ filter: /^@duckdb\/duckdb-wasm$/ }, (args) => ({ path: args.path, namespace: 'duckdb-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'duckdb-stub' }, () => ({ contents: 'export default {};', loader: 'js' }));
  },
};

/**
 * The WASM page's twin of the stub: the bare specifier resolves to
 * `duckdbLocal.ts`, which re-exports the REAL package and answers its bundle
 * map from this server's `/duckdb/*` route instead of a CDN. The wrapper's own
 * import of the package is let through to the real file (an importer check, or
 * the wrapper would resolve to itself forever).
 */
const LOCAL_DUCKDB = path.join(__dirname, 'duckdbLocal.ts');
const localDuckDb = {
  name: 'local-duckdb-wasm',
  setup(build) {
    build.onResolve({ filter: /^@duckdb\/duckdb-wasm$/ }, (args) => (args.importer === LOCAL_DUCKDB ? undefined : { path: LOCAL_DUCKDB }));
  },
};

export async function buildGallery() {
  mkdirSync(OUT, { recursive: true });
  copyFileSync(path.join(__dirname, '..', 'src', 'styles.css'), path.join(OUT, 'vizfootprint-ui.css'));
  // four pages: the cockpit gallery, the Sheet over 90,300 rows, the FRAME (two layers
  // on one frame) and the WASM page — each of the last three its own page, because any
  // one of them in the cockpit's document would change assertions the cockpit's smoke makes
  await bundle('entry.tsx', 'gallery.js', 'production');
  // the SHEET page is built in DEVELOPMENT mode on purpose: React's dev build is the
  // only thing that warns about a duplicate key or a bad prop, and the sheet's smoke
  // asserts that nothing is warned. It costs a bigger bundle on one test page.
  await bundle('sheet.tsx', 'sheet.js', 'development');
  // the FRAME page: two layers of marks on one frame, for the same reason the sheet is
  // its own page — a second bar chart in the cockpit's document would change every
  // chart-count assertion its smoke makes. Development mode, for the same warnings.
  await bundle('frame.tsx', 'frame.js', 'development');
  // the WASM page: DuckDB-WASM opened in the browser over a Worker, the one page built
  // with the real package (the stub would hand the opener `{}`). Its own page for the
  // same reason as the two above, and also because its bundle carries the engine: the
  // other three stay stub-built and their sizes stay what they were.
  await bundle('wasm.tsx', 'wasm.js', 'development', [localDuckDb]);
  return OUT;
}

async function bundle(entry, outfile, mode, plugins = [stubDuckDb]) {
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
    plugins,
  });
}
