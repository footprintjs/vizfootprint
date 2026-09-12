/**
 * VIA BENCH CLI — `node bench/via/run.mjs [outDir]` (`npm run bench:via`).
 *
 * Bundles `bench-entry.ts` with esbuild (the trick every runner in this folder
 * uses), runs it in a child node with --expose-gc and a big heap (1,000,000
 * row objects, cloned once by the memory engine and landed once in DuckDB),
 * and writes `results.json` + `table.md` to outDir (default: this folder).
 *
 * The bundle stays in THIS folder (`via-bench.bundle.mjs`, gitignored by the
 * root `.gitignore`'s bundle rule): the node arm resolves DuckDB-WASM's own
 * files from the running module's location (`src/data/duckdbConnection.ts`),
 * so a bundle written outside the repo cannot find the peer — the
 * `bench/step0-wasm` finding. A report may live anywhere; the executable may not.
 *
 * `head` is stamped from a READ-ONLY `git rev-parse`, with `+dirty` when the
 * session or links source differs from it: a number is quotable only against
 * the code that produced it.
 *
 * VIA_REPS_EXO / VIA_REPS_1M override the repetition budgets.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const outDir = process.argv[2] ?? here;
mkdirSync(outDir, { recursive: true });

const bundle = path.join(here, 'via-bench.bundle.mjs');
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

const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
const head = git(['rev-parse', '--short', 'HEAD']);
const dirty = git(['status', '--porcelain', 'src/session', 'src/links']).length > 0 ? '+dirty' : '';

const child = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=8192', bundle], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'inherit'],
  maxBuffer: 64 * 1024 * 1024,
});
if (child.status !== 0) {
  console.error(`bench exited ${child.status}`);
  process.exit(child.status ?? 1);
}

const json = { head: `${head}${dirty}`, ranAt: new Date().toISOString(), ...JSON.parse(child.stdout.toString()) };
writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(json, null, 1));

/** The MAX under 20 samples, the p95 above it — `bench/step0-wasm/measure.ts` · `spreadOf`, restated for the table only. */
const spread = (m) => (m.n < 20 ? `max ${m.max.toFixed(1)}` : `p95 ${m.p95.toFixed(1)}`);
const ms = (x) => x.toFixed(1);
const lines = [
  `# via bench — ${json.head}, node ${json.node}, ${json.ranAt}`,
  '',
  '## Dispatch latency (ms): the same gesture with the relation declared (the clause travels) and without (nothing travels)',
  '',
  '| engine | rows | arm | median | spread | n |',
  '|---|---|---|---|---|---|',
  ...json.measures.map((m) => `| ${m.engine} | ${m.size} | ${m.arm} | ${ms(m.median)} | ${spread(m)} | ${m.n} |`),
  '',
  '## The set on the wire: `JSON.stringify(activeSelections[0].travelled).length`',
  '',
  '| engine | rows | arm | far values | bytes |',
  '|---|---|---|---|---|',
  ...json.wire.map((w) => `| ${w.engine} | ${w.size} | ${w.arm} | ${w.values.toLocaleString('en-US')} | ${w.bytes.toLocaleString('en-US')} |`),
  '',
  ...(json.failures.length > 0 ? ['## Failures (a failure is a measurement)', '', ...json.failures.map((f) => `- ${f.engine} · ${f.size} · ${f.arm}: ${f.cause}`), ''] : []),
];
const table = lines.join('\n');
writeFileSync(path.join(outDir, 'table.md'), `${table}\n`);
console.log(table);
