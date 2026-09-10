/**
 * THE AGGREGATE — a derived TABLE, landed: one row per group, cut from the
 * rows visible at its cursor.
 *
 * The twin of {@link ./analysis.ts}. That act lands a COLUMN on the table it
 * reads; this one lands a TABLE beside it — `produces: 'table'`, reads nothing
 * beyond its own table, and carries its whole declaration on the commit so a
 * replay rebuilds it from the bytes. The measures ARE the derive reducers
 * ({@link Measure}): `sum`, `mean`, `countDistinct` and the rest, judged by the
 * one judge under the kind law's aggregate half, so a measure and a grouped
 * column say the same thing in the same words and there is no second
 * vocabulary to keep in step.
 *
 * ## The law: an aggregate is an act AND a derived dataset
 *
 * Computed ONCE, over the rows the session hands in — the selection folded at
 * the cursor when the act was declared — and recorded as one commit. A later
 * selection does not recompute it; a new act does. The rows live in the store
 * under the act's own slot (`../data/derivedTables.ts`) and are recomputed on
 * replay from the record, never serialised.
 *
 * ## Three outcomes, distinct
 *
 *   - **EMPTY** — zero groups. An honest table that LANDS: `{ ok: true,
 *     output: { rows: [] } }`. A degenerate result means no honest fit, not
 *     zero rows, and zero rows is exactly what "no row folded in" means. The
 *     one shape that always lands a row is `groupBy: []`: the whole table is a
 *     group the DECLARATION names, so it exists whether or not a row reached
 *     it, answering what an empty tally comes to (`0` for a count).
 *   - **UNAVAILABLE** — the parent's engine refused the read. The act was never
 *     performed; the session answers `{ ok: false, reason: 'unavailable' }`
 *     carrying the engine's own rejection (`../analysis/types.ts`).
 *   - **REFUSED** — the judge's sentence, before anything moves: a group or
 *     measure column the table lacks, a measure that is not an aggregate, a
 *     name taken twice. Nothing lands.
 *
 * ```ts
 * aggregateAnalysis({
 *   name: 'by_disease',
 *   table: 'cells',
 *   ops: 1,
 *   groupBy: ['disease'],
 *   measures: [{ as: 'total', expr: { op: 'sum', args: [{ col: 'cases' }] } }],
 *   where: { op: 'eq', args: [{ col: 'kind' }, { lit: 'state' }] },
 *   absence: { field: 'report_state', states: ['present', 'unavailable', 'unknown'] },
 * });
 * ```
 *
 * The first customers are `../def/builtinAnalyses.ts` (the `aggregate` record)
 * and the session's `declareAnalysis`, which mints the table's slot and
 * relation from what this module answers.
 */

import { flowChart } from 'footprintjs';
import type { FlowChart } from 'footprintjs';
import { defineAnalysis } from '../analysis/defineAnalysis.js';
import type { DataRow } from '../analysis/builtins.js';
import type { AnalysisModule, InputBinding, OutputColumnType, TableOutput } from '../analysis/types.js';
import type { ColumnInfo } from '../data/types.js';
import { columnar, foldOnce } from '../data/fold.js';
import { silenceOfDecl, silenceOfNothing, type TableSilence } from '../data/silence.js';
import type { AbsenceDecl } from '../def/types.js';
import { absenceRefusal, chartKeys, OUTPUT_TYPE, readsOf } from './analysis.js';
import { groupRowsOf, type Rows } from './groups.js';
import { columnsHave, judgeDerivedColumn, judgeGroupFilter } from './judge.js';
import { readerOver } from './walk.js';
import { groupWords, wordsFor } from './words.js';
import { OPS_VERSION, type Cell, type CellReader, type DeriveType, type Expr, type Measure, type Over } from './types.js';

// ── what the caller says ─────────────────────────────────────────────────────

export interface AggregateOptions {
  /** The derived table it lands. May never take a declared table's name — the session's own law judges that. */
  readonly name: string;
  /** The parent table it reads. Default `data`. */
  readonly table?: string;
  /** The op-vocabulary version the measures and the filter are written against — {@link OPS_VERSION} for anything this build writes. */
  readonly ops: number;
  /** The group columns, in order. `[]` is the whole table as one row, said out loud. */
  readonly groupBy: readonly string[];
  /** The measures, in the order they land as columns. */
  readonly measures: readonly Measure[];
  /** Which parent rows go in. Absent means every row handed in. */
  readonly where?: Expr;
  /** The parent's declared absence vocabulary — one entry, or a LIST when silence belongs to a column — passed IN for the derive act's reason: the decl belongs to the def. */
  readonly absence?: AbsenceDecl | readonly AbsenceDecl[];
  /** Default `aggregate:<table>:<name>`. */
  readonly id?: string;
}

// ── what the whole declaration reads ─────────────────────────────────────────

/** The columns the act needs loaded, and which of them are its groups. */
interface Declared {
  readonly reads: readonly string[];
  readonly grouping: ReadonlySet<string>;
}

/**
 * Every column the declaration needs loaded: the group columns first, then
 * what the measures and the filter read. Total over unjudged bytes for the
 * derive act's reason — a replay re-performs without judging.
 */
function columnsOf(opts: AggregateOptions): Declared {
  const reads: string[] = [];
  const grouping = new Set<string>();
  for (const name of opts.groupBy) {
    grouping.add(name);
    if (!reads.includes(name)) reads.push(name);
  }
  for (const measure of opts.measures) readsOf(measure.expr, reads);
  return { reads: readsOf(opts.where, reads), grouping };
}

/** The group a measure runs over, as the fold reads it. */
const overOf = (opts: AggregateOptions): Over => ({ groupBy: opts.groupBy, ...(opts.where === undefined ? {} : { where: opts.where }) });

/**
 * The group as the JUDGE reads it while judging a measure: the group columns
 * the table has, once each — and NO filter.
 *
 * WHY narrowed: the group columns and the filter belong to the ACT, are judged
 * first in the aggregate's own words, and a measure judged over either would
 * repeat those sentences once per measure — each blaming a measure for
 * something it does not own. The filter is dropped whole rather than when it is
 * broken, because nothing it reads is part of a measure's value: a sound one
 * judged again per measure would only be judged again.
 */
function judgedOverOf(opts: AggregateOptions, columns: readonly ColumnInfo[]): Over {
  const known = new Set(columns.filter((column) => column.type !== 'unknown').map((column) => column.name));
  return { groupBy: [...new Set(opts.groupBy.filter((name) => known.has(name)))] };
}

// ── the judge ────────────────────────────────────────────────────────────────

/** The ACT's version sentence — one wording, said by the judge and thrown by the build. */
const opsRefusal = (ops: number): string => `this aggregate is written against ops ${String(ops)}, and this build knows ops ${String(OPS_VERSION)}`;

/**
 * The filter, judged ONCE against the parent — it picks the rows the whole act
 * folds in, so it is the act's and no measure's. Answers the sentence under the
 * key the record spells it with (`where`), or undefined when there is nothing
 * to say.
 */
function filterProblemOf(opts: AggregateOptions, table: string, columns: readonly ColumnInfo[]): string | undefined {
  if (opts.where === undefined) return undefined;
  const judged = judgeGroupFilter(opts.where, table, columns, 'where');
  return judged.ok ? undefined : judged.problem;
}

/** The group columns, each against the table: present, of a known type, and named once. */
function groupProblemsOf(opts: AggregateOptions, table: string, columns: readonly ColumnInfo[]): string[] {
  const problems: string[] = [];
  const types = new Map(columns.map((column) => [column.name, column.type] as const));
  const seen = new Set<string>();
  for (const name of opts.groupBy) {
    // A repeat is the SAME column, already judged on its first occurrence — judging it again would say
    // one missing-column sentence twice and read as two missing columns.
    if (seen.has(name)) {
      problems.push(`this aggregate groups by "${name}" twice, and a table can only group by it once`);
      continue;
    }
    seen.add(name);
    const type = types.get(name);
    if (type === undefined) problems.push(`this aggregate groups by "${name}", which table "${table}" does not have — ${columnsHave(columns)}`);
    else if (type === 'unknown') problems.push(`this aggregate groups by "${name}", which table "${table}" holds as unknown — a table groups by columns whose type is known`);
  }
  return problems;
}

/** A measure's name: a column of the derived table, so it may be neither empty, nor a group column, nor another measure's. */
function nameProblemOf(measure: Measure, opts: AggregateOptions, named: Set<string>): string | undefined {
  if (measure.as.length === 0) return 'a measure lands as a column, so it needs a name — and this one is ""';
  if (opts.groupBy.includes(measure.as)) return `the measure "${measure.as}" takes the name of a group column — the derived table already has a column called that`;
  if (named.has(measure.as)) return `two measures are called "${measure.as}", and the derived table can only hold one column of that name`;
  named.add(measure.as);
  return undefined;
}

/**
 * The measures, each judged by the ONE judge as an aggregate column over the
 * declared group — which is what refuses a measure that reads a non-group
 * column outside its reducers, a reducer inside a reducer, an op the grammar
 * lacks, and a column the table lacks, in the judge's own sentences. The
 * measure's name leads each sentence, so a person knows WHICH.
 */
function measureProblemsOf(opts: AggregateOptions, table: string, columns: readonly ColumnInfo[], types: Map<string, DeriveType>): string[] {
  if (opts.measures.length === 0) return ['an aggregate lands one column per measure, and this one declares none'];
  const problems: string[] = [];
  const named = new Set<string>();
  const over = judgedOverOf(opts, columns);
  for (const measure of opts.measures) {
    const naming = nameProblemOf(measure, opts, named);
    if (naming !== undefined) problems.push(naming);
    // WHY this build's version and not the act's: `judgeTable` refused a mismatch before any measure
    // was reached, so passing the act's here would only say the act's own fact once per measure.
    const judged = judgeDerivedColumn({ ops: OPS_VERSION, kind: 'aggregate', expr: measure.expr, over }, table, columns);
    if (judged.ok) types.set(measure.as, judged.type);
    else problems.push(`measure "${measure.as}": ${judged.problem}`);
  }
  return problems;
}

// ── the chart ────────────────────────────────────────────────────────────────

/** What the chart is handed: the columns the declaration reads, and how many rows there are. */
interface AggregateInput {
  readonly columns: Readonly<Record<string, readonly unknown[]>>;
  readonly rows: number;
}

/** One group as a row of the derived table: the group columns, then the measures, in declared order. */
function rowOf(opts: AggregateOptions, key: readonly Cell[], values: readonly Cell[]): Record<string, Cell> {
  // WHY `fromEntries`: assigning to the key `__proto__` runs Object.prototype's setter instead of
  // creating an own property — a column named that would vanish (the row renamer's own reason).
  return Object.fromEntries([...opts.groupBy.map((name, at) => [name, key[at]!] as const), ...opts.measures.map((measure, at) => [measure.as, values[at]!] as const)]);
}

/**
 * Two stages: load the columns it reads, then fold the groups. Columns and not
 * rows, for the derive act's reason: a committed value is frozen, and the
 * provider's own row objects must never be.
 */
function buildAggregateChart(opts: AggregateOptions, silence: TableSilence): FlowChart {
  const { arg, held } = chartKeys(opts.name);
  const exprs = opts.measures.map((measure) => measure.expr);
  const over = overOf(opts);
  return flowChart<Record<string, unknown>>(
    'load the columns it reads',
    (scope) => {
      const args = scope.$getArgs<Record<string, AggregateInput>>();
      scope.$setValue(held, args[arg]!);
    },
    'load',
  )
    .addFunction(
      'fold the groups',
      (scope) => {
        const input = scope.$getValue(held) as AggregateInput;
        // ONE closure over a moving index under the absence law's reader — the same walk the
        // derive act runs, so the two acts cannot hold two opinions about what a row is.
        let at = 0;
        const cells: CellReader = (name) => input.columns[name]?.[at];
        const read = readerOver(cells, silence);
        const rows: Rows = {
          count: input.rows,
          at: (which) => {
            at = which;
            return read;
          },
        };
        scope.$setValue(
          opts.name,
          groupRowsOf(exprs, over, rows).map((group) => rowOf(opts, group.key, group.values)),
        );
      },
      'aggregate',
    )
    .build();
}

// ── the act ──────────────────────────────────────────────────────────────────

/**
 * The derived table's schema, as the judge computed it: the group columns as
 * the parent holds them, the measures as their trees yield — or `unknown` for
 * every column when nobody judged (a replay in a fresh session), for the
 * derive act's reason: a tallied type is the thing this folder exists to avoid.
 */
function schemaOf(opts: AggregateOptions, types: ReadonlyMap<string, DeriveType> | undefined): Record<string, OutputColumnType> {
  const names = [...opts.groupBy, ...opts.measures.map((measure) => measure.as)];
  return Object.fromEntries(
    names.map((name) => {
      const type = types?.get(name);
      return [name, type === undefined ? 'unknown' : OUTPUT_TYPE[type]] as const;
    }),
  );
}

/**
 * An aggregate as an analysis: `produces: 'table'`, run over the rows it is
 * handed, landing one table of one row per group at the act's own slot.
 *
 * `reads` is deliberately absent: the act reads its own table and nothing
 * beside it. Its relation back to the parent is minted by the session from
 * the record, never declared here.
 */
export function aggregateAnalysis(opts: AggregateOptions): AnalysisModule<readonly DataRow[], TableOutput> {
  const table = opts.table ?? 'data';
  const absence = opts.absence;
  // ONE reading of the parent's silences, per column (`../data/silence.ts`) — the derive act's reason,
  // and the same port, so the two acts cannot hold two opinions about what a row reported.
  const silence = absence === undefined ? silenceOfNothing() : silenceOfDecl(absence);
  const { reads, grouping } = columnsOf(opts);
  // ONE decision, named once and spent twice: the state columns are folded in and bound as inputs
  // together, so neither can be recovered from whether `folded` is the same array as `reads`.
  const foldedStates = silence.stateColumns.filter((field) => !reads.includes(field));
  const folded = foldedStates.length === 0 ? reads : [...reads, ...foldedStates];
  /** What the judge computed, kept for the output — set at declaration, absent on a fresh-session replay. */
  let computed: Map<string, DeriveType> | undefined;
  const inputs: InputBinding[] = reads.map((name) => ({ column: name, role: grouping.has(name) ? 'group' : 'value' }));
  for (const field of foldedStates) inputs.push({ column: field });
  return defineAnalysis<readonly DataRow[], TableOutput>({
    id: opts.id ?? `aggregate:${table}:${opts.name}`,
    kind: 'transform',
    produces: 'table',
    inputs,
    refusalTaxonomy: 'derive',
    // JUDGE BEFORE ANYTHING MOVES, with the columns visible at the cursor — every problem at once,
    // each a sentence, so a person fixes the declaration in one pass.
    judgeTable: (readTable, columns) => {
      // FIRST and alone: `ops` belongs to the ACT, so it is said once in the aggregate's own words and
      // never blamed on a measure — and measures written against a vocabulary this build does not have
      // cannot be judged by its op table at all, so nothing below could say anything true about them.
      if (opts.ops !== OPS_VERSION) return [opsRefusal(opts.ops)];
      const types = new Map<string, DeriveType>();
      const filter = filterProblemOf(opts, readTable, columns);
      const problems = [
        ...groupProblemsOf(opts, readTable, columns),
        ...(filter === undefined ? [] : [filter]),
        ...measureProblemsOf(opts, readTable, columns, types),
      ];
      // Every missing state column earns its OWN sentence: a table missing one of three says which.
      for (const field of silence.stateColumns) if (!columns.some((known) => known.name === field)) problems.push(absenceRefusal('this aggregate', field, readTable, columns));
      if (problems.length > 0) return problems;
      // The group columns' types are the parent's own — and known, because `groupProblemsOf` refused an unknown one above.
      for (const column of columns) if (grouping.has(column.name)) types.set(column.name, column.type as DeriveType);
      computed = types;
      return [];
    },
    build: () => {
      // WHY here as well as in the judge: a replay re-performs without judging (the derive act's reason).
      if (opts.ops !== OPS_VERSION) throw new Error(opsRefusal(opts.ops));
      return buildAggregateChart(opts, silence);
    },
    toRunInput: (rows) => ({
      [chartKeys(opts.name).arg]: { columns: foldOnce(rows, { c: columnar(folded) }).c, rows: rows.length } satisfies AggregateInput,
    }),
    // EMPTY lands: zero groups is `rows: []` under `ok: true`, never a degenerate flag.
    readOutput: ({ snapshot }) => ({
      ok: true,
      output: { as: 'table', name: opts.name, schema: schemaOf(opts, computed), rows: snapshot.sharedState[opts.name] as Record<string, Cell>[] },
    }),
  });
}

/**
 * The why-sentence for an aggregate, as a caption quotes it: one clause per
 * measure in the table's own words, then the group. The words come from the
 * op table, so the sentence cannot drift from what ran.
 *
 * ```ts
 * aggregateWords({
 *   groupBy: ['disease'],
 *   measures: [{ as: 'total', expr: { op: 'sum', args: [{ col: 'cases' }] } }],
 *   where: { op: 'eq', args: [{ col: 'kind' }, { lit: 'state' }] },
 * });
 * // 'total = the total of cases, over each disease, counting only rows where kind is "state"'
 * ```
 */
export function aggregateWords(opts: Pick<AggregateOptions, 'groupBy' | 'measures' | 'where'>): string {
  const said = opts.measures.map((measure) => `${measure.as} = ${wordsFor(measure.expr)}`).join('; ');
  return `${said}, ${groupWords({ groupBy: opts.groupBy, ...(opts.where === undefined ? {} : { where: opts.where }) })}`;
}
