/**
 * DERIVE BENCH — THE TABLE. Synthetic rows in the demo's `cells` shape, plus
 * the ONE thing a derived column needs beside them: which column speaks for
 * which (`../../src/data/silence.ts`).
 *
 * Seeded (mulberry32, the generator `bench/step0/gen.ts` and `bench/x4` share)
 * so a run is reproducible, and shaped like the real NNDSS slice where the
 * shape matters to a walk: the SAME `report_state` mix, so the share of rows
 * the absence law turns to silence is the real one, and a `cases` that is
 * `null` on every silent row — the library's own law (`absenceContradiction.ts`
 * refuses a silent row that holds a number), so the bench walks a table the
 * data door would accept.
 *
 * `population` is what `bench/step0/gen.ts` does not have and the brief's
 * `div(cases, population)` needs: a per-jurisdiction constant, never zero, so
 * the ratio is a finite number on every present row and the walk's
 * `Infinity → absent` arm is not what a size is measuring.
 */
import type { ColumnInfo, Row } from '../../src/data/types.js';
import type { Rows } from '../../src/derive/groups.js';
import type { CellReader } from '../../src/derive/types.js';
import { readerOver } from '../../src/derive/walk.js';
import type { AbsenceDecl } from '../../src/def/types.js';
import { silenceOfDecl, type TableSilence } from '../../src/data/silence.js';
import { FALLBACK_SHAPE, mulberry32 } from '../step0/gen.js';

/** The columns of the bench table, as the judge is told them. */
export const COLUMNS: readonly ColumnInfo[] = Object.freeze([
  { name: 'disease', type: 'string' },
  { name: 'jurisdiction', type: 'string' },
  { name: 'kind', type: 'string' },
  { name: 'cases', type: 'number' },
  { name: 'population', type: 'number' },
  { name: 'report_state', type: 'string' },
] as const);

/**
 * The absence declaration: `report_state` governs `cases` and nothing else.
 *
 * WHY the `governs` form and not the bare one: the walk's reader has two arms —
 * a governed column pays a state read and a test, an ungoverned one is a bare
 * read — and `div(cases, population)` should exercise BOTH, the way a real table
 * with a state column and an identifier column does.
 */
export const ABSENCE: AbsenceDecl = Object.freeze({
  field: 'report_state',
  states: Object.freeze(Object.keys(FALLBACK_SHAPE.reportStates)),
  governs: Object.freeze(['cases']),
});

/** The table's reading of its own silence — the one every walk in this bench takes. */
export function benchSilence(): TableSilence {
  return silenceOfDecl(ABSENCE);
}

/** The rows, and the same values column by column — the shape `deriveAnalysis` walks (`src/derive/analysis.ts` · `DeriveInput.columns`). */
export interface BenchTable {
  readonly rows: readonly Row[];
  readonly columns: Readonly<Record<string, readonly unknown[]>>;
  readonly count: number;
}

/** `n` rows, seeded; the report_state mix drawn the way `bench/step0/gen.ts` draws it. */
export function benchTable(n: number, seed = 42): BenchTable {
  const rnd = mulberry32(seed);
  const states = Object.entries(FALLBACK_SHAPE.reportStates);
  const cum: [string, number][] = [];
  let acc = 0;
  for (const [state, share] of states) cum.push([state, (acc += share)]);
  const jurisdictions = 70;
  const population = Array.from({ length: jurisdictions }, (_, at) => 100_000 + Math.floor(rnd() * 9_900_000) + at);
  const rows: Row[] = new Array<Row>(n);
  for (let at = 0; at < n; at += 1) {
    const draw = rnd();
    let report_state = cum[cum.length - 1]![0];
    for (const [state, edge] of cum) {
      if (draw < edge) {
        report_state = state;
        break;
      }
    }
    const j = at % jurisdictions;
    rows[at] = {
      disease: `Disease ${String(Math.floor(at / (jurisdictions * 86)) + 1)}`,
      jurisdiction: `Jurisdiction ${String(j + 1)}`,
      kind: j < 58 ? 'state' : j < 67 ? 'region' : 'total',
      cases: report_state === 'present' ? Math.floor(Math.pow(rnd(), 3) * 200) : null,
      population: population[j]!,
      report_state,
    };
  }
  const columns: Record<string, unknown[]> = {};
  for (const { name } of COLUMNS) columns[name] = rows.map((row) => row[name]);
  return { rows, columns, count: n };
}

/**
 * The table as the Rows shape `deriveAnalysis` walks (`src/derive/analysis.ts`
 * · 'evaluate the declaration'): ONE reader over a moving index, wrapped once
 * in the absence law's reader. Copied here and not imported because it is
 * built inline inside a stage function there — the bench measures the same
 * shape, and `derive.test.ts` pins that this one answers what `rowsOver` and
 * `evaluateRow` answer.
 */
export function columnarRowsOf(table: BenchTable): Rows {
  let at = 0;
  const cells: CellReader = (name) => table.columns[name]?.[at];
  const read = readerOver(cells, benchSilence());
  return {
    count: table.count,
    at: (which) => {
      at = which;
      return read;
    },
  };
}
