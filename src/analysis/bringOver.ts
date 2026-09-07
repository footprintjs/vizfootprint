/**
 * L3 — BRING A RELATED TABLE'S COLUMNS OVER, ACROSS A DECLARED RELATION.
 *
 * An edge row says `source: 'flu'` and `target: 'cold'`. A mark that draws it
 * needs four numbers — where `flu` is and where `cold` is — and those numbers
 * live on the OTHER table. Until this file, the only way to get them was a
 * lookup at read time, inside a renderer, off the trace: exactly the thing the
 * layout was written to stop.
 *
 * So bringing them over is an ACT. `{ builtin: 'bringOver', table: 'edges',
 * from: 'nodes', columns: ['x', 'y'] }` writes `source_x`, `source_y`,
 * `target_x`, `target_y` onto the edges table at the act's own slot, through
 * the ordinary derived-column path. They are then plain columns: filterable,
 * visible at the cursor, carrying the act that made them, and rebuilt by a
 * replay from the record's bytes.
 *
 * THE LAW IT FOLLOWS: the relation is the permission AND the join
 * (`../def/README.md`, law 6). Which columns this writes is not typed in by a
 * person — it is read off the DECLARED relations whose from-end is on the
 * written table and whose to-end is on the related one. `edges.source →
 * nodes.id` is what makes `source_x` exist; declare no relation and the act
 * does not happen, in a sentence naming what to declare.
 *
 * THIS IS A GENERAL DOOR, not a network special case: any column, across any
 * declared relation. A sales table can bring its customer's `region` over the
 * same way, and nothing here knows what a node is.
 *
 * HONESTY: a row whose endpoint names nothing in the related table gets `null`
 * — and is COUNTED. The counters ride the analysis's own committed state under
 * {@link COUNTS_SUFFIX}, in `../data/fold.ts`'s shape (`{ total, counted,
 * skipped }`), one entry per join column. A silent null is a lie about how many
 * rows the answer really covers.
 *
 * First customers: `../def/builtinAnalyses.ts` (the `bringOver` record, which
 * resolves the joins from the def's relations) and the edge marks that will
 * read `source_x`/`source_y` without a lookup.
 */

import { flowChart } from 'footprintjs';
import type { FlowChart } from 'footprintjs';
import type { ColumnInfo, Row } from '../data/types.js';
import { defineAnalysis } from './defineAnalysis.js';
import type { DataRow } from './builtins.js';
import type { AnalysisModule, ColumnsOutput, ReadContext, RelatedRows } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// The vocabulary — data before code.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One tie between the written table and the related one, as this file needs it:
 * which column over here names a row over there, and which key it names it BY.
 *
 * A relation says the same thing, but a `RelationEdge` is `../def`'s type and
 * L3 never imports L4. The def layer translates one into the other — which is
 * also why this stays a general door: a caller with no dashboard at all can
 * write the join down by hand.
 */
export interface BringOverJoin {
  /** The column on the written table holding the other table's key. */
  readonly column: string;
  /** The related table's key column that value is looked up in. */
  readonly key: string;
}

/** How many rows a join could follow, and how many it could not — `../data/fold.ts`'s own shape. */
export interface BringOverCounts {
  readonly total: number;
  readonly counted: number;
  readonly skipped: number;
}

/** What one fold produced: the columns, and what it had to skip to produce them. */
export interface BroughtColumns {
  /** Produced name → one cell per row of the written table, in row order; `null` where the endpoint was not found. */
  readonly values: Readonly<Record<string, readonly unknown[]>>;
  /** Join column → what the fold saw. Never absent for a declared join, even when every row missed. */
  readonly counts: Readonly<Record<string, BringOverCounts>>;
}

/** Everything one fold works over. Plain data — it is committed, and a commit is frozen. */
export interface BringOverWork {
  /** The declared joins, in declaration order. */
  readonly joins: readonly BringOverJoin[];
  /** The columns fetched from the related table, in order. */
  readonly columns: readonly string[];
  /** The written table's rows, narrowed to the join columns. */
  readonly rows: readonly Row[];
  /** The related table's rows, narrowed to the key columns and the fetched ones. */
  readonly related: readonly Row[];
}

/** Thrown when columns cannot honestly be brought over. The message is the sentence. */
export class BringOverError extends Error {
  constructor(problem: string) {
    super(problem);
    this.name = 'BringOverError';
  }
}

/** The one spelling of a brought column — `source` + `x` is `source_x`. Every reader of these names goes through here. */
export function broughtColumnName(join: string, column: string): string {
  return `${join}_${column}`;
}

/** Every name one plan produces, in join-then-column order — the order the chart writes them in and `materialized` reports them in. */
export function broughtColumnNames(joins: readonly BringOverJoin[], columns: readonly string[]): string[] {
  return joins.flatMap((join) => columns.map((column) => broughtColumnName(join.column, column)));
}

// ─────────────────────────────────────────────────────────────────────────────
// The fold — the whole computation, and the only place a cell is copied.
// ─────────────────────────────────────────────────────────────────────────────

/** A cell as a lookup key: absent and null name no row, and no other value is coerced into naming one. */
function keyOf(cell: unknown): string | undefined {
  return cell === null || cell === undefined ? undefined : String(cell);
}

/**
 * The related table, once, as one index per DISTINCT key column: key → the
 * fetched cells in `columns` order.
 *
 * FIRST ROW WINS on a repeated key, the rule `adjacencyOf` already follows: a
 * key that names two rows names neither, and picking the later one would make
 * the answer depend on the order a backend happened to return.
 */
function indexOf(related: readonly Row[], joins: readonly BringOverJoin[], columns: readonly string[]): Map<string, Map<string, readonly unknown[]>> {
  const byKey = new Map<string, Map<string, readonly unknown[]>>();
  for (const join of joins) {
    if (byKey.has(join.key)) continue;
    const index = new Map<string, readonly unknown[]>();
    for (const row of related) {
      const key = keyOf(row[join.key]);
      if (key === undefined || index.has(key)) continue;
      index.set(
        key,
        columns.map((column) => row[column] ?? null),
      );
    }
    byKey.set(join.key, index);
  }
  return byKey;
}

/**
 * Bring the fetched columns over, one column per join × fetched pair.
 *
 * Pure and total: it never throws, and a row it cannot follow gets `null` and a
 * tick on the skipped counter. The refusals live at the doors above, where a
 * sentence can still stop the act.
 */
export function bringOverColumns(work: BringOverWork): BroughtColumns {
  const { joins, columns, rows, related } = work;
  const indexes = indexOf(related, joins, columns);
  const values: Record<string, unknown[]> = {};
  const counts: Record<string, BringOverCounts> = {};
  for (const join of joins) {
    const index = indexes.get(join.key)!;
    const names = columns.map((column) => broughtColumnName(join.column, column));
    const lanes: unknown[][] = names.map((name) => {
      const lane: unknown[] = [];
      values[name] = lane;
      return lane;
    });
    let counted = 0;
    for (const row of rows) {
      const key = keyOf(row[join.column]);
      const found = key === undefined ? undefined : index.get(key);
      if (found === undefined) {
        for (const lane of lanes) lane.push(null);
        continue;
      }
      counted += 1;
      found.forEach((cell, i) => lanes[i]!.push(cell));
    }
    counts[join.column] = { total: rows.length, counted, skipped: rows.length - counted };
  }
  return { values, counts };
}

// ─────────────────────────────────────────────────────────────────────────────
// The doors — every refusal, in the house voice.
// ─────────────────────────────────────────────────────────────────────────────

/** A list of names as a reader would say it. Empty is said as such, never as an empty gap in a sentence. */
function listOf(names: readonly string[]): string {
  return names.length === 0 ? 'none' : names.join(', ');
}

/**
 * Judge a bringOver act against the table it is about to write, before a row
 * moves — the `judgeTable` hook `formulaAnalysis` established. Three things can
 * be wrong, and all three are visible from the declaration and this table's own
 * columns:
 *
 *  · the act was declared on a DIFFERENT table than the one it writes;
 *  · no declared relation points from here at the related table (the joins are
 *    empty, which is the def layer saying it found none);
 *  · a join column is not one this table holds.
 *
 * TWO THINGS ARE DELIBERATELY NOT JUDGED HERE. A produced name landing on a
 * DECLARED source column is the session's own law and the session's own
 * sentence (`writeColumns`, "a computed column may not take a source column's
 * name") — and it is the only judge that can tell a declared column from one an
 * earlier act derived, which is what lets this analysis be re-run over its own
 * output. And the related table's columns are not visible to any hook this
 * library has, so "that table has no `x`" is judged at run time, below.
 */
export function bringOverProblems(
  id: string,
  written: string,
  from: string,
  joins: readonly BringOverJoin[],
  columns: readonly string[],
  readTable: string,
  tableColumns: readonly ColumnInfo[],
): string[] {
  const problems: string[] = [];
  if (readTable !== written) {
    problems.push(`analysis "${id}" writes onto table "${written}", but this act reads table "${readTable}" — declare it on "${written}"`);
    // WHY stop: every sentence below quotes THIS table's columns, and quoting
    // the wrong table's columns at someone would send them to fix the wrong thing.
    return problems;
  }
  const held = new Set(tableColumns.map((c) => c.name));
  if (joins.length === 0) {
    problems.push(
      `analysis "${id}" brings ${listOf(columns)} over from "${from}", ` +
        `but no declared relation points from "${written}" at "${from}" — declare the relation first`,
    );
    return problems;
  }
  for (const join of joins) {
    if (!held.has(join.column)) {
      problems.push(`analysis "${id}" follows column "${join.column}", which table "${written}" does not have — the columns are ${listOf([...held])}`);
    }
  }
  return problems;
}

/**
 * The run-time refusal: the related table has rows, and not one of them carries
 * a column this was told to fetch.
 *
 * WHY a throw and not a gap: nothing between the door and here can see the
 * related table's columns, and the two honest alternatives are worse. Landing a
 * column of nulls would say "every endpoint missed" about a column that was
 * never there — the silent lie the counters exist to prevent. It is raised
 * before the chart runs and therefore before the commit, so the act does not
 * happen (law 1), exactly like the layout's own cap.
 *
 * An EMPTY related table is not this: it is honest emptiness, and the counters
 * report it as every row skipped.
 */
function refuseMissingColumns(id: string, from: string, columns: readonly string[], related: readonly Row[]): void {
  if (related.length === 0) return;
  const absent = columns.filter((column) => !related.some((row) => Object.prototype.hasOwnProperty.call(row, column)));
  if (absent.length === 0) return;
  throw new BringOverError(`analysis "${id}" brings ${listOf(absent)} over from "${from}", which has no such column — compute it there first`);
}

// ─────────────────────────────────────────────────────────────────────────────
// The chart — the two stages every analysis here has.
// ─────────────────────────────────────────────────────────────────────────────

/** The suffix on the key the counters are committed under. Named once: a test and a reader both look for it. */
export const COUNTS_SUFFIX = ' brought';

/**
 * The three keys the chart uses beside the columns it writes, DERIVED from
 * those column names so none of them can collide with one.
 *
 * footprintjs guards an input key as readonly and throws on a colliding write,
 * and the committed keys here have to BE the column names — that is what
 * `writeColumns` reads the values back off. Deriving the rest from the whole
 * list is the trick `formula.ts` and `layout.ts` both use, for the same reason.
 */
function chartKeys(produced: readonly string[]): { arg: string; held: string; counts: string } {
  const stem = produced.join(' ');
  return { arg: `${stem} input`, held: `${stem} loaded`, counts: `${stem}${COUNTS_SUFFIX}` };
}

/** The type a brought column is DECLARED as: numbers where every cell is one, text otherwise. Sniffed, because the cells came from another table. */
function broughtType(cells: readonly unknown[]): 'float' | 'string' {
  return cells.every((cell) => cell === null || (typeof cell === 'number' && Number.isFinite(cell))) ? 'float' : 'string';
}

function buildBringOverChart(produced: readonly string[]): FlowChart {
  const { arg, held, counts } = chartKeys(produced);
  return flowChart<Record<string, unknown>>(
    'load the rows and the table they point at',
    (scope) => {
      const args = scope.$getArgs<Record<string, BringOverWork>>();
      scope.$setValue(held, args[arg]!);
    },
    'load',
  )
    .addFunction(
      'bring the columns over',
      (scope) => {
        const brought = bringOverColumns(scope.$getValue(held) as BringOverWork);
        // Plain arrays: `writeColumns` lands what `Array.isArray` accepts.
        for (const name of produced) scope.$setValue(name, [...brought.values[name]!]);
        // THE COUNTERS RIDE THE TRACE, not a console line: how many rows the
        // answer really covers is part of the answer.
        scope.$setValue(counts, brought.counts);
      },
      'bringOver',
    )
    .build();
}

// ─────────────────────────────────────────────────────────────────────────────
// The analysis.
// ─────────────────────────────────────────────────────────────────────────────

/** Everything a declared bringOver may say, plus the joins the def layer resolves for it. */
export interface BringOverOptions {
  /** The table WRITTEN — the one holding the pointing columns. Default `edges`. */
  readonly table?: string;
  /** The related table READ. Default `nodes`. */
  readonly from?: string;
  /** The columns fetched from it. Default `x` / `y`. */
  readonly columns?: readonly string[];
  /**
   * The ties to follow. NOT part of the record: the def layer reads them off
   * the declared relations, so what is brought over is what was declared.
   * Empty is a real answer — "no relation points that way" — and is refused in
   * a sentence at the door rather than by producing nothing.
   */
  readonly joins?: readonly BringOverJoin[];
  /** Default `bring:<table>:<from>`. */
  readonly id?: string;
}

/**
 * Columns fetched across a declared relation, as a declared analysis:
 * `produces: 'columns'`, `reads` the related table, and lands one column per
 * join × fetched pair on the written table.
 *
 * ```ts
 * relations: [
 *   { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' } },
 *   { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'id' } },
 * ],
 * analyses: { ends: { builtin: 'bringOver', table: 'edges', from: 'nodes', columns: ['x', 'y'] } },
 * ```
 *
 * lands `source_x`, `source_y`, `target_x` and `target_y` — so an edge mark
 * finds both of its endpoints in its own row, with no lookup at read time.
 */
export function bringOverAnalysis(opts: BringOverOptions = {}): AnalysisModule<readonly DataRow[], ColumnsOutput> {
  const table = opts.table ?? 'edges';
  const from = opts.from ?? 'nodes';
  const columns = opts.columns ?? ['x', 'y'];
  const joins = opts.joins ?? [];
  const id = opts.id ?? `bring:${table}:${from}`;
  const produced = broughtColumnNames(joins, columns);
  const { arg } = chartKeys(produced);

  return defineAnalysis<readonly DataRow[], ColumnsOutput>({
    id,
    kind: 'transform',
    produces: 'columns',
    // The columns READ on this table are the ones that point across; the
    // fetched ones belong to the other table and are named by `reads`.
    // `identifier`: these are the FOREIGN KEYS, the columns that point across
    // to the other table's identity. Nothing is grouped by them.
    inputs: joins.map((join) => ({ column: join.column, role: 'identifier' as const })),
    reads: [from],
    judgeTable: (readTable, tableColumns) => bringOverProblems(id, table, from, joins, columns, readTable, tableColumns),
    build: () => buildBringOverChart(produced),
    toRunInput: (rows, related: RelatedRows) => {
      // WHY `?? []`: the session guarantees the key is here (that is what
      // `reads` is), and a table it read as empty arrives as an empty array —
      // so "nothing over there" is one case, and the counters are where it shows.
      const source = related[from] ?? [];
      refuseMissingColumns(id, from, columns, source);
      const keys = [...new Set(joins.map((join) => join.key))];
      const work: BringOverWork = {
        joins,
        columns,
        // Narrowed on the way in: what is committed is what the fold reads, and
        // no more — a commit is a copy, and copying two whole tables to read
        // four columns of them is a cost nobody asked for.
        rows: rows.map((row) => Object.fromEntries(joins.map((join) => [join.column, row[join.column] ?? null]))),
        related: source.map((row) => Object.fromEntries([...keys, ...columns].map((name) => [name, row[name] ?? null]))),
      };
      return { [arg]: work };
    },
    readOutput: ({ snapshot }: ReadContext<readonly DataRow[]>) => ({
      ok: true,
      output: {
        as: 'columns',
        table,
        columns: Object.fromEntries(produced.map((name) => [name, { type: broughtType(snapshot.sharedState[name] as readonly unknown[]) }])),
      },
    }),
  });
}
