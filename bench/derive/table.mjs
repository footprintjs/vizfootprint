/**
 * DERIVE BENCH — THE TABLE. `results.json` in, one markdown report out.
 *
 * Its own module for `bench/step0-wasm/table.mjs`'s reason: a renderer that
 * only ever runs at the end of a long bench is a renderer nobody exercises.
 * This one can be handed a results object and checked in a second
 * (`derive.test.ts`).
 *
 * The order is the order a reader needs: the CONTROLS first — a dead clock, a
 * refused tree or four paths that disagreed make a table of no numbers — then
 * one section per size with the four arms side by side per expression and the
 * two ratios a reader came for: how far today's walk is from a closure over
 * the same reader (what a compiled tree could reach), and from the raw floor.
 */

/** `walk ÷ floor`, the way a reader reads it: above 1, the walk is the slower one. Read off BEST, the headline. */
function ratioOf(walk, floor) {
  if (!walk || !floor) return '—';
  const r = walk.best / floor.best;
  return `${r >= 100 ? r.toFixed(0) : r >= 10 ? r.toFixed(1) : r.toFixed(2)}×`;
}

const f = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));

/** One cell: BEST first (the headline), then the noise — median / max — so a reader sees both the number and how much the machine added. */
function cell(m) {
  return m ? `**${f(m.best)}** · ${f(m.median)} / ${f(m.max)}` : '—';
}

/** Nanoseconds per row of the best sample — the unit a per-row cost is actually paid in. */
function perRow(m) {
  return m ? `${((m.best * 1e6) / m.rows).toFixed(0)} ns` : '—';
}

const find = (results, size, expr, arm) => results.find((r) => r.size === size && r.expr === expr && r.arm === arm);

function sizesOf(results) {
  const sizes = [];
  for (const r of results) if (!sizes.includes(r.size)) sizes.push(r.size);
  return sizes;
}

function exprsOf(results) {
  const exprs = [];
  for (const r of results) if (!exprs.includes(r.expr)) exprs.push(r.expr);
  return exprs;
}

/** The arm names the table pairs by — the SAME strings `measure.ts` · `ARMS` holds; a results file names them, so they are read off it and not retyped. */
const ARM = {
  walkColumnar: 'walk · columnar door',
  walkRows: 'walk · rowsOver door',
  floorReader: 'floor · closure over the reader',
  floorRaw: 'floor · closure over raw columns',
};

export function tableOf(json) {
  const out = [];
  const results = json.results ?? [];
  out.push(`node ${json.node} · ${json.platform} · ${json.generatedAt}${json.head ? ` · ${json.head}` : ''}`);
  out.push('');
  out.push(
    '**Units.** every cell is the wall time of ONE whole column (`valuesOf`, every row) in ms: **best** · median / max over the repetitions, `performance.now()` around it, warm-ups discarded. The best is the headline (the sample with the least of anything else charged to it); the median and the max are the noise.',
  );
  out.push(`Repetitions ${JSON.stringify(json.reps)} · gc between samples ${json.gcExposed ? 'EXPOSED' : 'NOT exposed (numbers include collections the previous sample earned)'}.`);
  out.push('');

  out.push('### 0 · controls — is the instrument alive?');
  out.push('');
  out.push('| control | asked | read | live |');
  out.push('|---|---:|---:|---|');
  const clock = json.controls?.clock;
  out.push(`| clock — a deliberate block | ${clock ? `${String(clock.askedMs)} ms` : '—'} | ${clock ? `${clock.readMs.toFixed(1)} ms` : '—'} | ${clock?.live ? 'YES' : 'NO'} |`);
  for (const j of json.controls?.judged ?? []) {
    out.push(`| the judge accepts \`${j.expr}\` (${String(j.ops)} op nodes, ${String(j.leaves)} leaves) | ok | ${j.type} | ${j.ok ? 'YES' : 'NO — refused; its rows below are void'} |`);
  }
  for (const a of json.controls?.agreement ?? []) {
    // WHY a CONTROL and not a footnote: a path that answered absent everywhere posts the best time in every arm below it.
    out.push(
      `| four paths, one answer — ${a.size} \`${a.expr}\` | 0 cells differ, 0 < present < 1 | ${String(a.mismatches)} differ · present ${a.present.toFixed(3)} | ${a.agree ? 'YES' : 'NO — every number below for it is void'} |`,
    );
  }
  out.push('');

  let section = 0;
  for (const size of sizesOf(results)) {
    section += 1;
    const rows = results.find((r) => r.size === size)?.rows ?? 0;
    out.push(`### ${String(section)} · ${size} — ${rows.toLocaleString('en-US')} rows`);
    out.push('');
    out.push('| expression | walk · columnar door | walk · rowsOver door | floor · over the reader | floor · over raw columns | walk ÷ floor(reader) | walk ÷ floor(raw) | walk, per row |');
    out.push('|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const expr of exprsOf(results.filter((r) => r.size === size))) {
      const walk = find(results, size, expr, ARM.walkColumnar);
      const walkRows = find(results, size, expr, ARM.walkRows);
      const reader = find(results, size, expr, ARM.floorReader);
      const raw = find(results, size, expr, ARM.floorRaw);
      out.push(`| \`${expr}\` | ${cell(walk)} | ${cell(walkRows)} | ${cell(reader)} | ${cell(raw)} | ${ratioOf(walk, reader)} | ${ratioOf(walk, raw)} | ${perRow(walk)} |`);
    }
    out.push('');
  }
  return out.join('\n');
}
