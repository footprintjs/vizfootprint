/**
 * MATCH MICRO — the IN-list predicate on its own: `node bench/via/match-micro.mjs`.
 *
 * `bench/via` measures a dispatch whose travel judges a wide match on the source
 * engine, and cannot separate the predicate from the projection around it. This
 * isolates it: 20,598 rows (the exoplanet desk's size) filtered by ONE match
 * clause holding 10,000 values, with the shipped memory-engine filter
 * (`dist/data` · `matchesClause`, whose match arm asks `membershipOf` — one
 * Set per list) beside the list scan it replaced (`values.some(=== v)`),
 * written out here so the two are timed by the same loop in the same process.
 * The rows and the list are the bench's own (`bench-entry.ts` · `exoRows`'s
 * shape: `p0…p20597`, the first 10,000 picked), so half the rows match.
 *
 * The list is minted PER SAMPLE, as a chart mints one per click, so the set's
 * build is inside the number; the spread is the max over 7 samples after one
 * warm-up (`bench/step0-wasm/README.md`, law 6). Requires `npm run build`.
 */
import { matchesClause } from '../../dist/data/index.js';

const ROWS = 20_598;
const PICKED = 10_000;
const REPS = Number(process.env.MICRO_REPS ?? 7);

const rows = Array.from({ length: ROWS }, (_, i) => ({ pl_name: `p${i}` }));
const fresh = () => Array.from({ length: PICKED }, (_, i) => `p${i}`);

/** The list scan the memory engine's match arm used to be — kept here as the control, not in the library. */
function scanMatches(row, values) {
  const v = row.pl_name;
  return values.some((candidate) => candidate === v);
}

function sample(run) {
  const values = fresh();
  const t0 = performance.now();
  let kept = 0;
  for (const row of rows) if (run(row, values)) kept++;
  const ms = performance.now() - t0;
  if (kept !== PICKED) throw new Error(`kept ${kept}, expected ${PICKED}`);
  return ms;
}

function measure(name, run) {
  sample(run); // warm-up, never a sample
  const samples = Array.from({ length: REPS }, () => sample(run)).sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const max = samples[samples.length - 1];
  return { name, median, max, n: REPS };
}

const results = [
  measure('values.some (the scan the arm replaced)', (row, values) => scanMatches(row, values)),
  measure('matchesClause (membershipOf — one Set per list)', (row, values) => matchesClause(row, { kind: 'match', field: 'pl_name', values })),
];
console.log(`match micro — node ${process.version}, ${ROWS.toLocaleString('en-US')} rows × ${PICKED.toLocaleString('en-US')} values, n = ${REPS}`);
console.log('');
console.log('| arm | median (ms) | max (ms) |');
console.log('|---|---|---|');
for (const r of results) console.log(`| ${r.name} | ${r.median.toFixed(2)} | ${r.max.toFixed(2)} |`);
