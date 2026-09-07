/**
 * Layout-bench CLI — `node bench/layout/run.mjs [outDir]`
 *
 * Bundles `layout-entry.ts` with esbuild (platform node, the same trick
 * bench/step0 and bench/surface use), runs it in a child node with headroom for
 * the JS-heap side of the big arm (the rows and the neighbour arrays; the
 * distance matrix is a typed array, so its bytes are EXTERNAL memory and this
 * flag does not govern them), and writes `layout-results.json` +
 * `layout-table.md` to outDir (default: this folder).
 *
 * BENCH FIRST, so this harness has a state its siblings do not: the thing it
 * measures may not exist yet. When `src/analysis/layout.ts` is absent it says
 * so in one sentence and exits 2 — it does NOT write an empty results file,
 * because a results file with no results is the one artefact a later reader
 * could mistake for a measurement.
 *
 * Knobs, all read by the child:
 *   LAYOUT_BENCH_PLAN     `nodes:reps:iterations,...`  default `1000:3:30,10000:1:30`
 *   LAYOUT_BENCH_SEED     the graph + layout seed      default 42
 *   LAYOUT_BENCH_SOURCES  BFS sources the stress metric samples   default 64
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import esbuild from 'esbuild';
import { tableOf } from './table.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? here;
mkdirSync(outDir, { recursive: true });

// ── has the layout landed? ────────────────────────────────────────────────────
// `contract.ts` OWNS the path and the sentence. Bundling it rather than
// restating it here is what keeps the harness and the acceptance test from
// drifting into two different ideas of where the layout lives.
// WHY the probe is written HERE and not into outDir: it is a throwaway, and
// `import(...)` needs a real file URL. `pathToFileURL` also absolutizes and
// escapes, which plain `file://` + a relative or `#`-bearing path does not.
const probeFile = path.join(here, 'layout-probe.bundle.mjs');
await esbuild.build({
  entryPoints: [path.join(here, 'contract.ts')],
  bundle: true,
  outfile: probeFile,
  format: 'esm',
  platform: 'node',
  target: 'node22',
});
const probe = await import(pathToFileURL(probeFile).href);
rmSync(probeFile, { force: true });

if (!probe.layoutHasLanded()) {
  console.error(probe.notLandedSentence());
  console.error('');
  console.error('The acceptance is already written and already runs: `npx vitest run bench/layout/layout.test.ts`');
  console.error('proves the instruments today and arms the layout half the moment that file exists.');
  process.exit(2);
}

// The contract names the exports, so a rename is a sentence and not
// `undefined is not a function` twenty seconds into the 1,000-node arm. A
// synthetic entry pulls the landed module in beside `missingExportsOf`, because
// node cannot import the TypeScript file directly.
const namesFile = path.join(here, 'layout-names.bundle.mjs');
await esbuild.build({
  stdin: {
    contents: "export { missingExportsOf } from './contract.ts';\nexport * as layout from '../../src/analysis/layout.ts';\n",
    resolveDir: here,
    loader: 'ts',
    sourcefile: 'names.ts',
  },
  bundle: true,
  outfile: namesFile,
  format: 'esm',
  platform: 'node',
  target: 'node22',
});
const names = await import(pathToFileURL(namesFile).href);
rmSync(namesFile, { force: true });
const missing = names.missingExportsOf(names.layout);
if (missing.length > 0) {
  console.error(
    `"${probe.LAYOUT_SOURCE}" exists but does not export ${missing.join(', ')} — ` +
      `the bench measures the contract in bench/layout/contract.ts, so a rename has to change that file too`,
  );
  process.exit(2);
}

// ── measure ───────────────────────────────────────────────────────────────────
const bundle = path.join(outDir, 'layout-bench.bundle.mjs');
await esbuild.build({
  entryPoints: [path.join(here, 'layout-entry.ts')],
  bundle: true,
  outfile: bundle,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: 'inline',
});

const child = spawnSync(process.execPath, ['--max-old-space-size=8192', bundle], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'inherit'],
  maxBuffer: 64 * 1024 * 1024,
});
if (child.status !== 0) {
  // `status` is null when the child was killed by a signal or never started —
  // an OOM kill and a Ctrl-C both land here, and "exited null" names neither.
  const how = child.signal
    ? `was killed by ${child.signal}`
    : child.error
      ? `could not run: ${child.error.message}`
      : `exited ${child.status}`;
  console.error(`bench ${how} — the bundle is kept at ${bundle} so the failure stays debuggable`);
  process.exit(child.status ?? 1);
}
const raw = child.stdout.toString();
let json;
try {
  json = JSON.parse(raw);
} catch {
  // The child's contract is one JSON object and nothing else, so a stray
  // console.log anywhere under `src/analysis/layout.ts` lands ahead of it. Keep
  // the evidence rather than losing a multi-minute run to a bare SyntaxError.
  const dump = path.join(outDir, 'layout-stdout.txt');
  writeFileSync(dump, raw);
  console.error(
    `the bench exited 0 but its stdout is not one JSON object — something printed on stdout. ` +
      `The raw output is kept at ${dump}; it starts: ${JSON.stringify(raw.slice(0, 200))}`,
  );
  process.exit(1);
}
writeFileSync(path.join(outDir, 'layout-results.json'), JSON.stringify(json, null, 1));
// a build artefact, regenerated every run; kept only when the child failed
rmSync(bundle, { force: true });

// ── the table ─────────────────────────────────────────────────────────────────
const table = tableOf(json);
writeFileSync(path.join(outDir, 'layout-table.md'), `${table}\n`);
console.log(table);

// WHY the artefacts are written FIRST and the run fails after: dead controls
// void every number in the report, and a chained caller (`npm run bench:layout
// && cp …`) reads the exit status, not a line of markdown. Keeping both files
// keeps the failure debuggable; the non-zero status stops the chain.
if (!json.controls.live) {
  console.error(`controls did not fire — ${json.controls.note}`);
  console.error('layout-table.md was written, but no number in it may be quoted.');
  process.exit(3);
}
