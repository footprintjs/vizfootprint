/**
 * THE ACT — a declared column, landed.
 *
 * The grammar beside this file says what a derived column IS ({@link
 * ./types.ts}), whether a declaration is one ({@link ./judge.ts}), what one row
 * of it comes to ({@link ./walk.ts}) and how to say it out loud ({@link
 * ./words.ts}). None of that lands anything. This file is the door where a
 * person's declaration becomes a column on a table, under a commit, with a
 * cause — and it lands through the door the library already has.
 *
 * ## The law it follows: the ten verbs are frozen
 *
 * The design this grew from asks for an eleventh verb, `column`. There are ten
 * (`../def/types.ts`, `DISPATCH_VERBS`) and the eleventh is reserved, so this
 * step does not mint one — and it does not need one. A derived column is an
 * ANALYSIS in every sense the session already means: it reads one table, it
 * produces the `columns` channel, it lands one commit whose value carries the
 * whole declaration, and it re-enters the data space as an ordinary filterable
 * column at the act's own slot (`../data/derivedColumns.ts`). `analyze` is not
 * a near-enough door — it is the door, and `formulaAnalysis` has been standing
 * in it since the formula shipped. What the eleventh verb was really wanted for
 * is the OTHER eleven slots of a column (label, unit, format, aliases, parse,
 * order, …), and none of those is a computation; see `./README.md`.
 *
 * ## What makes it replayable
 *
 * The record is data all the way down: `{ builtin: 'derive', name, table,
 * column: { ops, kind, expr } }` rides on the commit's own value slot
 * (`AnalysisAct.def`), so a replay rebuilds the module from the bytes with
 * nothing registered on the session first. That is the whole reason the tree is
 * a tree and never an expression string, a closure or a compiled plan.
 *
 * ## The absence law, end to end
 *
 * The walker keeps it ({@link ./walk.ts}); this file is what carries the
 * table's declared `AbsenceDecl` to it, because the declaration is the DEF's
 * and a record may not name its own. It arrives beside the record as context,
 * exactly as a relation does for `bringOver` — a record that could name its own
 * absence column could name one nobody declared.
 *
 * ```ts
 * deriveAnalysis({
 *   name: 'rate',
 *   table: 'cells',
 *   column: { ops: 1, kind: 'row', expr: { op: 'div', args: [{ col: 'cases' }, { col: 'population' }] } },
 *   absence: { field: 'report_state', states: ['present', 'unavailable', 'unknown'] },
 * });
 * ```
 *
 * The first customers are `../def/builtinAnalyses.ts` (the `derive` record) and
 * the session's `declareAnalysis`; the sheet's add-a-column panel reaches both
 * through the adapter. `./aggregate.ts` is the second customer, of the four
 * pieces this file owns for BOTH acts — {@link OUTPUT_TYPE}, {@link readsOf},
 * {@link chartKeys} and {@link absenceRefusal} — so a change to any of them is
 * a change to the derived TABLE as much as to the derived column.
 */

import { flowChart } from 'footprintjs';
import type { FlowChart } from 'footprintjs';
import { defineAnalysis } from '../analysis/defineAnalysis.js';
import type { DataRow } from '../analysis/builtins.js';
import type { AnalysisModule, ColumnsOutput, InputBinding } from '../analysis/types.js';
import type { ColumnInfo } from '../data/types.js';
import { columnar, foldOnce } from '../data/fold.js';
import type { AbsenceDecl } from '../def/types.js';
import { valuesOf, type Rows } from './groups.js';
import { columnsHave, judgeDerivedColumn } from './judge.js';
import { readerOver } from './walk.js';
import { wordsForColumn } from './words.js';
import { OPS_VERSION, type CellReader, type DeriveType, type DerivedColumnDecl } from './types.js';

// ── what the caller says ─────────────────────────────────────────────────────

export interface DeriveOptions {
  /** The column it writes. A derived column may never take a source column's name — the session's own law judges that. */
  readonly name: string;
  /** The declaration: `{ ops, kind, expr }`. Judged against the table at the door, never here. */
  readonly column: DerivedColumnDecl;
  /** The table the column is written into. Default `data`. */
  readonly table?: string;
  /**
   * The table's declared absence vocabulary, when it has one.
   *
   * Passed IN rather than read: the decl belongs to the def, and this folder
   * has no dashboard to ask. `../def/builtinAnalyses.ts` supplies it from the
   * def's own `data[table].absence`.
   */
  readonly absence?: AbsenceDecl;
  /** Default `derive:<table>:<name>`. */
  readonly id?: string;
}

/**
 * The output vocabulary a computed type lands as.
 *
 * `number` becomes `float` because a derived number is a quotient until proven
 * otherwise — the formula door's own default, for the same reason.
 */
export const OUTPUT_TYPE: Readonly<Record<DeriveType, ColumnsOutput['columns'][string]['type']>> = Object.freeze({
  number: 'float',
  string: 'string',
  boolean: 'boolean',
  date: 'date',
});

// ── the columns a tree reads, without a table ────────────────────────────────

/**
 * Every column the tree names, first-seen order.
 *
 * The judge collects the same list WHILE judging, and only the names it could
 * check against a real table. This one needs no table, which is exactly why it
 * exists: a replay re-performs an act that already happened without re-judging
 * it, and still has to know which columns to fold out of the rows.
 *
 * It ACCUMULATES into `into` and hands the same array back — one list across
 * several trees, which is how the aggregate act folds its group columns, its
 * measures and its filter into a single fold list (`./aggregate.ts`,
 * `columnsOf`).
 *
 * WHY total over any value: it runs at construction, before `judgeTable` has
 * seen the declaration, and the judge owns the sentence for a node that is not
 * one — a reader that threw ahead of it would turn that sentence into a stack.
 * It answers "the names I can see"; what those names mean is judged later. WHY
 * a worklist and a seen-set rather than recursion: this is the FIRST walker
 * over unjudged bytes, so it meets the trees the judge's own two ceilings
 * (`./judge.ts`) exist to refuse — a node shared by both arms of its parent is
 * a billion visits at depth thirty, and a chain deeper than the JS stack is a
 * RangeError. Neither may happen before the judge has said its sentence, and a
 * node walked twice can only repeat names it has already pushed.
 */
export function readsOf(node: unknown, into: string[]): string[] {
  const seen = new Set<object>();
  const stack: unknown[] = [node];
  while (stack.length > 0) {
    const at: unknown = stack.pop();
    if (typeof at !== 'object' || at === null || seen.has(at)) continue;
    seen.add(at);
    const { col, args } = at as { readonly col?: unknown; readonly args?: unknown };
    if (typeof col === 'string') {
      if (!into.includes(col)) into.push(col);
    } else if (Array.isArray(args)) {
      // Pushed back to front so the pops come out front to back — the first-seen order a caller reads.
      for (let which = args.length - 1; which >= 0; which -= 1) stack.push(args[which]);
    }
  }
  return into;
}

/** What the whole declaration needs loaded, and which of those names are its groups. */
interface Declared {
  readonly reads: readonly string[];
  readonly grouping: ReadonlySet<string>;
}

/**
 * Every column the whole DECLARATION needs loaded: the tree's, the grouping
 * columns, and the group filter's.
 *
 * The last two are read by the fold and never by the expression, which is
 * exactly why they have to be listed here — a walk that folded out only what
 * the tree names would group every row into the same silent group. Total over
 * an unjudged `over` for {@link readsOf}'s reason.
 */
function columnsOf(column: DerivedColumnDecl): Declared {
  const reads = readsOf(column.expr, []);
  const grouping = new Set<string>();
  const over: unknown = column.over;
  if (typeof over !== 'object' || over === null) return { reads, grouping };
  const { groupBy, where } = over as { readonly groupBy?: unknown; readonly where?: unknown };
  if (Array.isArray(groupBy)) {
    for (const name of groupBy) {
      if (typeof name !== 'string') continue;
      grouping.add(name);
      if (!reads.includes(name)) reads.push(name);
    }
  }
  return { reads: readsOf(where, reads), grouping };
}

// ── the chart ────────────────────────────────────────────────────────────────

/** What the chart is handed: the columns the tree reads, and how many rows there are. */
interface DeriveInput {
  readonly columns: Readonly<Record<string, readonly unknown[]>>;
  readonly rows: number;
}

/**
 * The two keys this chart uses beside the landed thing's own, both DERIVED from
 * the name the act commits under — the derive act's COLUMN, the aggregate act's
 * TABLE ({@link ./aggregate.ts}) — so neither can collide with it: footprintjs
 * guards an input key as readonly and throws on a colliding write. The
 * committed key has to BE that name, because the act's own reader reads the
 * values back off it (`writeColumns` for a column, `readOutput` for a table).
 * The formula chart states the argument in full; this is the same one.
 */
export function chartKeys(landed: string): { readonly arg: string; readonly held: string } {
  return { arg: `${landed} input`, held: `${landed} loaded` };
}

/**
 * Two stages: load the columns it reads, then walk them.
 *
 * What it loads is COLUMNS, not rows — arrays folded out of the table in one
 * walk. Handing the provider's own row objects to the engine would freeze the
 * table itself (a committed value is frozen), and the next act to materialize a
 * column into it would find the rows unextensible.
 */
function buildDeriveChart(declared: DerivedColumnDecl, column: string, absence: AbsenceDecl | undefined): FlowChart {
  const { arg, held } = chartKeys(column);
  return flowChart<Record<string, unknown>>(
    'load the columns it reads',
    (scope) => {
      const args = scope.$getArgs<Record<string, DeriveInput>>();
      scope.$setValue(held, args[arg]!);
    },
    'load',
  )
    .addFunction(
      'evaluate the declaration',
      (scope) => {
        const input = scope.$getValue(held) as DeriveInput;
        // ONE closure over a moving index, wrapped in the absence law's own
        // reader: the row door and this columnar walk are the same evaluation,
        // and neither may hold a second opinion about what a declaration means.
        // The cursor moves and the reader does not, so a million rows cost one
        // closure — which is the whole reason `Rows.at` hands one back.
        let at = 0;
        const cells: CellReader = (name) => input.columns[name]?.[at];
        const read = readerOver(cells, absence);
        const rows: Rows = {
          count: input.rows,
          at: (which) => {
            at = which;
            return read;
          },
        };
        // ONE door for a row column and a grouped one: the DECLARATION says
        // which walk it needs, and it says it where a reader can check.
        scope.$setValue(column, valuesOf(declared, rows));
      },
      'derive',
    )
    .build();
}

// ── the act ──────────────────────────────────────────────────────────────────

/**
 * The refusal for an absence column the table does not hold — the read refusal's
 * shape, about the one column the tree never names.
 *
 * `subject` is what the act calls ITSELF (`this column`, `this aggregate`),
 * because this sentence is shared with the aggregate act and a person who
 * declared a derived TABLE would go looking for a column they never wrote. The
 * sentence-ending stays `columnsHave`'s, so every missing-column refusal in the
 * folder still ends the same way.
 */
export function absenceRefusal(subject: string, field: string, table: string, columns: readonly ColumnInfo[]): string {
  return `${subject} keeps the absence law of "${field}", which table "${table}" does not have — ${columnsHave(columns)}`;
}

/**
 * A declared column as an analysis: `produces: 'columns'`, run over the whole
 * table it reads, landing ONE column at the act's own slot.
 *
 * The type is COMPUTED, at declaration, by the judge — the one door that sees
 * both the tree and the table's columns — and remembered for the write. A
 * replay re-performs the act rather than re-deciding it (it never calls
 * `judgeTable`), so a column rebuilt from the record's bytes in a fresh session
 * carries its values and says `unknown` for its type rather than tallying one
 * from them: a tallied type is the thing this whole folder exists to avoid.
 */
export function deriveAnalysis(opts: DeriveOptions): AnalysisModule<readonly DataRow[], ColumnsOutput> {
  const column = opts.name;
  const table = opts.table ?? 'data';
  const declared = opts.column;
  const absence = opts.absence;
  const { reads, grouping } = columnsOf(declared);
  // The absence column is folded out beside them: the walker has to ask what
  // this row's state is before it may answer for any other column of it.
  // ONE decision, named once and spent twice below — folded out of the rows, and bound as an input.
  const foldsAbsence = absence !== undefined && !reads.includes(absence.field);
  const folded = foldsAbsence ? [...reads, absence.field] : reads;
  /**
   * What the judge computed, kept for the write. Set at declaration, by the
   * only door that judges — so ANY replay of a record-declared act has none: the
   * replay rebuilds the module from the commit's own record (`actToReperform`,
   * `../session/session.ts`) and re-performs it without ever calling
   * `judgeTable`. A replayed derive column therefore reports `unknown` for its
   * type, in the same session as much as a fresh one. Making the type survive a
   * replay is a SESSION change — judge before re-performing — not a change here.
   */
  let computed: DeriveType | undefined;
  // The grouping columns are declared as such: what a column is grouped BY is
  // a different fact about it from what it is computed FROM, and a slice that
  // could not tell them apart would name the wrong cause. The absence column
  // is declared too, with NO role — it is read on every row and is the sole
  // cause of every blank, and `INPUT_ROLES` has no word for the column that
  // decides whether the others are readable.
  const inputs: InputBinding[] = reads.map((name) => ({ column: name, role: grouping.has(name) ? 'group' : 'value' }));
  if (absence !== undefined && foldsAbsence) inputs.push({ column: absence.field });
  return defineAnalysis<readonly DataRow[], ColumnsOutput>({
    id: opts.id ?? `derive:${table}:${column}`,
    kind: 'transform',
    produces: 'columns',
    inputs,
    // The refusals about this act are the DERIVE taxonomy's, not the general
    // one: an agent must be able to tell a tree it can repair from a source it
    // cannot reach without reading the sentence.
    refusalTaxonomy: 'derive',
    // JUDGE BEFORE ANYTHING MOVES: the session asks this the moment the act is
    // declared, with the columns visible AT THE CURSOR — so a declaration over
    // a column an earlier act derived is judged against what that act actually
    // left there, and one over a column that is not there is a sentence and no
    // commit rather than a column of silences somebody has to explain later.
    judgeTable: (readTable, columns) => {
      const judged = judgeDerivedColumn(opts.column, readTable, columns);
      if (!judged.ok) return [judged.problem];
      // WHY judged here and not by the tree walk: the absence column is the DEF's and the tree never
      // names it, so nothing else checks it — and a name the table does not have would read every
      // row as absent, with no sentence anywhere.
      if (absence !== undefined && !columns.some((known) => known.name === absence.field)) return [absenceRefusal('this column', absence.field, readTable, columns)];
      computed = judged.type;
      return [];
    },
    build: () => {
      // WHY here as well as in the judge: a replay re-performs without judging, so this is the one
      // door a declaration written against another vocabulary would otherwise walk through — under
      // this build's op table, with this build's meanings.
      if (declared.ops !== OPS_VERSION) throw new Error(`this column is written against ops ${String(declared.ops)}, and this build knows ops ${String(OPS_VERSION)}`);
      return buildDeriveChart(declared, column, absence);
    },
    // ONE walk of the table, folding out only the columns the tree names.
    toRunInput: (rows) => ({
      [chartKeys(column).arg]: { columns: foldOnce(rows, { c: columnar(folded) }).c, rows: rows.length } satisfies DeriveInput,
    }),
    readOutput: () => ({
      ok: true,
      output: { as: 'columns', table, columns: { [column]: { type: computed === undefined ? 'unknown' : OUTPUT_TYPE[computed] } } },
    }),
  });
}

/**
 * The why-sentence for a declaration, as a caption quotes it.
 *
 * Re-exported from here so the one door that lands a column and the one that
 * describes it are the same import — the words come from the op table, so the
 * sentence cannot drift from what ran ({@link ./words.ts}).
 */
export function deriveWords(column: DerivedColumnDecl): string {
  return wordsForColumn(column);
}
