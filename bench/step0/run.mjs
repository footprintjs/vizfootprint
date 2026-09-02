/**
 * Step-0 CLI — `node bench/step0/run.mjs [outDir]`
 * Bundles bench-entry.ts with esbuild (platform node, the same trick bench/x4
 * uses for the browser), runs it in a child node with --expose-gc and a big
 * heap (1M row objects, cloned once by the row store), and writes
 * `step0-results.json` + `step0-table.md` to outDir (default: this folder).
 * Set STEP0_SNAPSHOT to the demo's data/nndss/snapshot.csv to add the
 * 90k-real arm; STEP0_REPS_90K / STEP0_REPS_1M override repetitions.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? here;
mkdirSync(outDir, { recursive: true });

const bundle = path.join(outDir, 'step0-bench.bundle.mjs');
await esbuild.build({
  entryPoints: [path.join(here, 'bench-entry.ts')],
  bundle: true,
  outfile: bundle,
  format: 'esm',
  platform: 'node',
  target: 'node22',
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
writeFileSync(path.join(outDir, 'step0-results.json'), JSON.stringify(json, null, 1));

// markdown table: one row per (group, name); one median/p95 pair per size
const sizes = [...new Set(json.results.map((r) => r.size))];
const byKey = new Map();
for (const r of json.results) {
  const k = `${r.group}|${r.name}`;
  if (!byKey.has(k)) byKey.set(k, { group: r.group, name: r.name, note: r.note, per: {} });
  byKey.get(k).per[r.size] = r;
}
const f = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
const lines = [];
lines.push(`| group | measurement | ${sizes.map((s) => `${s} median / p95 (ms)`).join(' | ')} |`);
lines.push(`|---|---|${sizes.map(() => '---:').join('|')}|`);
for (const row of byKey.values()) {
  lines.push(`| ${row.group} | ${row.name} | ${sizes.map((s) => (row.per[s] ? `${f(row.per[s].median)} / ${f(row.per[s].p95)}` : '—')).join(' | ')} |`);
}
const table = lines.join('\n');
writeFileSync(path.join(outDir, 'step0-table.md'), `node ${json.node} · ${json.platform} · shape ${JSON.stringify(json.shape)} · reps ${JSON.stringify(json.reps)} · warm-up ${json.warmup}\n\n${table}\n`);
console.log(table);
