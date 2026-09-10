/**
 * STEP-0-WASM CLI — `node bench/step0-wasm/run.mjs [outDir]`
 *
 * Bundles `bench-entry.ts` with esbuild (platform node, the trick `bench/step0`
 * and `bench/x4` both use), runs it in a child node with --expose-gc and a big
 * heap (1,000,000 row objects, cloned once by the memory engine and serialised
 * once for DuckDB), and writes `wasm-results.json` + `wasm-table.md` to outDir
 * (default: this folder).
 *
 * WHY `packages: 'external'`: the entry's node arm imports DuckDB-WASM's node
 * bundle at RUN time (`src/data/duckdbConnection.ts` keeps that specifier out of
 * every bundler's sight on purpose). Bundling node_modules would drag a WASM glue
 * file through esbuild for no reason; leaving them external is also what proves
 * the shipped opener resolves its own peer from wherever it is installed.
 *
 * STEP0W_REPS_90K / STEP0W_REPS_1M / STEP0W_REPS_LOAD_90K / STEP0W_REPS_LOAD_1M
 * override the repetition budgets.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import esbuild from 'esbuild';
import { tableOf } from './table.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? here;
mkdirSync(outDir, { recursive: true });

// WHY the bundle stays in THIS folder while the report goes to `outDir`: the node
// arm resolves DuckDB-WASM's own files from the running module's location
// (`src/data/duckdbConnection.ts`), so a bundle written outside the repo cannot
// find the peer and the whole wasm half of the table silently becomes a ceiling.
// A report may live anywhere; the executable may not.
const bundle = path.join(here, 'wasm-bench.bundle.mjs');
await esbuild.build({
  entryPoints: [path.join(here, 'bench-entry.ts')],
  bundle: true,
  outfile: bundle,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  sourcemap: 'inline',
});

const child = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=8192', bundle], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'inherit'],
  maxBuffer: 64 * 1024 * 1024,
});
if (child.status !== 0) {
  console.error(`bench exited ${child.status}`);
  process.exit(child.status ?? 1);
}

const json = JSON.parse(child.stdout.toString());
writeFileSync(path.join(outDir, 'wasm-results.json'), JSON.stringify(json, null, 1));
const table = tableOf(json);
writeFileSync(path.join(outDir, 'wasm-table.md'), `${table}\n`);
console.log(table);
