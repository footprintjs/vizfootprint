/**
 * DERIVE BENCH CLI — `node bench/derive/run.mjs [outDir]` (`npm run bench:derive`).
 *
 * Bundles `bench-entry.ts` with esbuild (the trick every runner in this folder
 * uses), runs it in a child node with --expose-gc and a big heap (1,000,000 row
 * objects plus their columns, held twice while the four paths are compared),
 * and writes `results.json` + `table.md` to outDir (default: this folder).
 *
 * The bundle stays in THIS folder (`derive-bench.bundle.mjs`, gitignored by
 * the root `.gitignore`'s bundle rule): a generated executable, never a report.
 *
 * `head` is stamped on the report from a READ-ONLY `git rev-parse`, with a
 * `+dirty` mark when `src/derive` differs from it: a number is quotable only
 * against the code that produced it, and this bench is meant to be run before
 * AND after a change to the walker.
 *
 * DERIVE_REPS_100K / DERIVE_REPS_1M override the repetition budgets.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import esbuild from 'esbuild';
import { tableOf } from './table.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const outDir = process.argv[2] ?? here;
mkdirSync(outDir, { recursive: true });

const bundle = path.join(here, 'derive-bench.bundle.mjs');
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

/** The commit the numbers belong to, read and never written; '' when this is not a checkout. */
function headOf() {
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const rev = git(['rev-parse', '--short', 'HEAD']);
  if (rev.status !== 0) return '';
  const dirty = git(['status', '--porcelain', 'src/derive']);
  return `${rev.stdout.trim()}${dirty.stdout.trim() === '' ? '' : '+dirty'}`;
}

const child = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=8192', bundle], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'inherit'],
  maxBuffer: 64 * 1024 * 1024,
});
if (child.status !== 0) {
  console.error(`bench exited ${child.status}`);
  process.exit(child.status ?? 1);
}

const json = { ...JSON.parse(child.stdout.toString()), head: headOf() };
writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(json, null, 1));
const table = tableOf(json);
writeFileSync(path.join(outDir, 'table.md'), `${table}\n`);
console.log(table);
