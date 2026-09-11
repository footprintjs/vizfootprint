/**
 * STEP-0-WASM — THE TABLE. `wasm-results.json` in, one markdown report out.
 *
 * Its own module for `bench/layout/table.mjs`'s reason: a renderer that only
 * ever runs at the end of a long bench is a renderer nobody exercises. This one
 * can be handed a results object and checked in a second (`wasm.test.ts`).
 *
 * The order is the order a reader needs: the CONTROLS first — a table whose
 * clock was dead is not a table of small numbers, it is a table of no numbers,
 * and a table whose two engines disagreed about how many rows match is not a
 * comparison at all — then one section per size, each with the two engines side
 * by side and the ratio between them, which is the only number `chooseEngine`
 * may be set from.
 */

/** `wasm ÷ memory`, the way a reader reads it: above 1, DuckDB is the slower one. */
function ratioOf(memory, wasm) {
  if (!memory || !wasm) return '—';
  const r = wasm.median / memory.median;
  return `${r >= 100 ? r.toFixed(0) : r >= 10 ? r.toFixed(1) : r.toFixed(2)}×`;
}

/**
 * One cell: the median, and the SPREAD under the name it deserves — the max
 * when the arm has fewer than 20 samples (where a p95 lands on the largest
 * observation anyway), the p95 when it has more. `measure.ts` owns that rule;
 * this is its reading, with the fallback a results file written before `max`
 * existed needs.
 */
function pair(m) {
  if (!m) return '—';
  const f = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
  const spread = m.n < 20 ? (m.max ?? m.p95) : m.p95;
  return `${f(m.median)} / ${f(spread)}`;
}

/** What the second number in every cell IS — read off the run, because a report written before `max` was recorded cannot claim to show one. */
function spreadNote(results) {
  return results.some((r) => r.max !== undefined)
    ? 'the spread is the MAX for an arm with fewer than 20 samples (a p95 there is the largest sample under another name) and the p95 above that.'
    : 'the spread is the p95 — this run predates the max being recorded, and at these sample counts a p95 IS the largest sample, under another name.';
}

/**
 * The warm-ups the run ACTUALLY discarded, arm by arm.
 *
 * WHY it is not one number: the load arms carry their own budget (`SIZES`:
 * `loadWarmup` is 1 at 90k/300k and 0 at 1M, because a fresh database per
 * repetition is seconds), so printing the run-wide default beside every arm
 * said something untrue about the two arms it mattered most for.
 */
function warmupLine(results) {
  const byArm = new Map();
  for (const r of results) {
    if (r.warmup === undefined) continue;
    byArm.set(r.arm, (byArm.get(r.arm) ?? new Set()).add(r.warmup));
  }
  if (byArm.size === 0) return 'warm-up per arm not recorded (a results file written before it was)';
  const each = [...byArm].map(([arm, seen]) => `${arm} = ${[...seen].sort((a, b) => a - b).join('/')}`);
  return `warm-up discarded, per arm: ${each.join(' · ')}`;
}

/** Every arm, in the order it was first measured — the order the bench asks them in, which is the order they happen in a session. */
function armsOf(results) {
  const arms = [];
  for (const r of results) if (!arms.includes(r.arm)) arms.push(r.arm);
  return arms;
}

function sizesOf(results) {
  const sizes = [];
  for (const r of results) if (!sizes.includes(r.size)) sizes.push(r.size);
  return sizes;
}

const find = (results, size, arm, engine) => results.find((r) => r.size === size && r.arm === arm && r.engine === engine);

/** `a ÷ b` of two medians as the table prints a ratio, or an em dash when one side is absent. */
function ratioText(a, b) {
  if (!a || !b) return '—';
  const r = a.median / b.median;
  return `${r >= 100 ? r.toFixed(0) : r >= 10 ? r.toFixed(1) : r.toFixed(2)}×`;
}

/**
 * The wide arm's OWN ratio, per engine: its median over the `window` arm's, on
 * the same size — the price of the other twenty-four columns and nothing else.
 *
 * WHY a sentence under the table and not a fifth column: every other arm's
 * ratio is wasm ÷ memory, and a column that meant something else on one row
 * would be read as that on every row. `null` when a size has no wide arm at
 * all (a results file written before it existed).
 *
 * WHY the arm names are read off the run (`json.arms`, the `ARMS` contract as
 * the bench wrote it) and not spelled here: this renderer is plain `.mjs` and
 * cannot import `measure.ts`, and a literal copied from it would silently stop
 * matching the day the contract's wording moved.
 */
function wideOverWindow(results, size, arms) {
  if (!arms?.wide || !arms?.window) return null;
  const memory = ratioText(find(results, size, arms.wide, 'memory'), find(results, size, arms.window, 'memory'));
  const wasm = ratioText(find(results, size, arms.wide, 'wasm'), find(results, size, arms.window, 'wasm'));
  if (memory === '—' && wasm === '—') return null;
  return `*wide ÷ window, per engine — the same clause and the same 100 rows, thirty columns against six: memory ${memory} · wasm ${wasm}*`;
}

/**
 * One line naming what the wide table's columns ARE in DuckDB's own words,
 * grouped by type — so a reader of the wide arm knows which conversions its
 * number contains (`DESCRIBE`, recorded by the run). Absent from a results file
 * written before the wide arm existed.
 */
function wideWireLine(wide) {
  if (!wide) return null;
  const byType = new Map();
  for (const [name, type] of Object.entries(wide.types)) byType.set(type, [...(byType.get(type) ?? []), name]);
  const each = [...byType].map(([type, names]) => `${type} ×${String(names.length)}`);
  return `| wide table — what DuckDB says its ${String(wide.columns)} columns are | DESCRIBE | ${each.join(' · ')} | — |`;
}

export function tableOf(json) {
  const out = [];
  const results = json.results ?? [];
  out.push(`node ${json.node} · ${json.platform} · ${json.generatedAt}`);
  out.push('');
  out.push(`**Units.** every cell is the wall time of ONE call: median / spread in ms, \`performance.now()\` around it — ${spreadNote(results)}`);
  out.push(
    `Repetitions ${JSON.stringify(json.reps)} · ${warmupLine(results)} · gc between samples ${json.gcExposed ? 'EXPOSED' : 'NOT exposed (numbers include collections the previous sample earned)'}.`,
  );
  out.push('');

  out.push('### 0 · controls — is the instrument alive?');
  out.push('');
  out.push('| control | asked | read | live |');
  out.push('|---|---:|---:|---|');
  const clock = json.controls?.clock;
  out.push(`| clock — a deliberate block | ${clock ? `${String(clock.askedMs)} ms` : '—'} | ${clock ? `${clock.readMs.toFixed(1)} ms` : '—'} | ${clock?.live ? 'YES' : 'NO'} |`);
  for (const a of json.controls?.agreement ?? []) {
    // WHY this is a CONTROL and not a footnote: an engine that answered zero rows
    // would post the best number in every arm below it.
    out.push(
      `| both engines counted the same rows — ${a.size} ${a.clause} | memory = wasm | ${a.memory.toLocaleString('en-US')} vs ${a.wasm.toLocaleString('en-US')} | ${a.agree ? 'YES' : 'NO — every number below is void'} |`,
    );
  }
  const wire = wideWireLine(json.controls?.wide);
  if (wire) out.push(wire);
  out.push('');

  // A ceiling is a measurement (law 3): every arm an engine could not run is named here, in the backend's words, before its em dashes.
  const failures = json.failures ?? [];
  if (failures.length > 0) {
    out.push('| ceiling — an arm an engine could not run | engine | size | the backend said |');
    out.push('|---|---|---|---|');
    for (const f of failures) out.push(`| ${f.stage} | ${f.engine} | ${f.size} | ${f.cause} |`);
    out.push('');
  }

  let section = 0;
  for (const size of sizesOf(results)) {
    section += 1;
    const rows = results.find((r) => r.size === size)?.rows ?? 0;
    out.push(`### ${String(section)} · ${size} — ${rows.toLocaleString('en-US')} rows`);
    out.push('');
    out.push('| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |');
    out.push('|---|---:|---:|---:|');
    for (const arm of armsOf(results.filter((r) => r.size === size))) {
      const memory = find(results, size, arm, 'memory');
      const wasm = find(results, size, arm, 'wasm');
      const note = memory?.note ?? wasm?.note;
      out.push(`| ${arm}${note ? ` <br/>*${note}*` : ''} | ${pair(memory)} | ${pair(wasm)} | ${ratioOf(memory, wasm)} |`);
    }
    out.push('');
    const wide = wideOverWindow(results, size, json.arms);
    if (wide) {
      out.push(wide);
      out.push('');
    }
  }
  return out.join('\n');
}
