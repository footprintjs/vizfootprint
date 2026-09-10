/**
 * THE BUILTIN ANALYSIS RECORD — an analysis named as data.
 *
 * `AnalysisDef` and `AnalysisModule` are both CODE: the first requires
 * `build`/`toRunInput`/`readOutput` functions, the second is detected by its
 * `run` function. So until this file existed, a def that wanted the built-in
 * analyses had to be written in TypeScript — nothing resolved a NAME
 * to a factory, and `JSON.parse(text)` could never produce an analysis.
 *
 * A builtin record closes that: `{ builtin: 'groupBy', by: 'disease',
 * measure: 'cases' }` is the factory's own options, as data. The record's keys
 * ARE the factory's parameters (minus the ones that are functions — see
 * `correlation` below), which is why there is one spec table here and no
 * second vocabulary to keep in step.
 *
 * R12 firewall, as everywhere else on this boundary: every field is inert
 * data, validated against a strict allowlist and echoed verbatim; an unknown
 * builtin name, a missing option and an option of the wrong type are each
 * refused in a sentence naming the analysis and the problem, before anything
 * is constructed.
 */

import {
  bringOverAnalysis,
  clusteringAnalysis,
  correlationAnalysis,
  formulaAnalysis,
  groupByAnalysis,
  layoutAnalysis,
  parseFormula,
  regressionAnalysis,
  LAYOUT_ALGORITHMS,
  type AnalysisModule,
  type AnalysisOutput,
  type BringOverJoin,
  type DataRow,
} from '../analysis/index.js';
import { aggregateAnalysis, deriveAnalysis, type DerivedColumnDecl, type Expr, type Measure } from '../derive/index.js';
import { relationsFrom } from './relations.js';
import type { AbsenceDecl, RelationEdge } from './types.js';

/** The builtin analyses a def may name. */
export const BUILTIN_ANALYSES = ['groupBy', 'correlation', 'regression', 'clustering', 'formula', 'layout', 'bringOver', 'derive', 'aggregate'] as const;
export type BuiltinAnalysisName = (typeof BUILTIN_ANALYSES)[number];

/** A group-by summary as a new queryable table (`groupByAnalysis`). */
export interface GroupByDecl {
  readonly builtin: 'groupBy';
  /** The column whose values become the groups. */
  readonly by: string;
  /** The column averaged per group. */
  readonly measure: string;
  /** The summary table's name. Default `by_<by>`. */
  readonly name?: string;
  /** The analysis id (also the hypothesis id). Default `groupby:<by>:<measure>`. */
  readonly id?: string;
}

/**
 * Pearson correlation as a scalar, with its p-value (`correlationAnalysis`).
 *
 * The factory's `pValue` judge is a FUNCTION and so has no spelling here: a
 * declared correlation takes the built-in normal-approximation judge. A
 * caller who wants their own judge is writing code, and passes the module.
 */
export interface CorrelationDecl {
  readonly builtin: 'correlation';
  readonly x: string;
  readonly y: string;
  /** Default `corr:<x>:<y>`. */
  readonly id?: string;
  /** Provenance branch stamped on the emitted hypothesis (R8). */
  readonly branchId?: string;
}

/** An OLS regression line as a geometry layer (`regressionAnalysis`). */
export interface RegressionDecl {
  readonly builtin: 'regression';
  readonly x: string;
  readonly y: string;
  /** The layer's name. Default `reg_<x>_<y>`. */
  readonly layer?: string;
  /** The honesty floor — below this row count no line is fitted. Default 10. */
  readonly minPoints?: number;
  /** Default `reg:<x>:<y>`. */
  readonly id?: string;
}

/** Deterministic quantile-bin clustering as a new int column (`clusteringAnalysis`). */
export interface ClusteringDecl {
  readonly builtin: 'clustering';
  /** The column the bins are cut from. */
  readonly column: string;
  /** How many bins. A whole number of at least 1. */
  readonly k: number;
  /** The table the column is written into. Default `data`. */
  readonly table?: string;
  /** The column written. Default `cluster_id`. */
  readonly outColumn?: string;
  /** Default `cluster:<column>:k<k>`. */
  readonly id?: string;
}

/**
 * An arithmetic expression over this table's number columns, as a new column
 * (`formulaAnalysis`).
 *
 * The only builtin whose whole content is a sentence a PERSON typed, which is
 * why `expression` is judged twice and both times before anything moves: the
 * grammar judges it here, at declaration (a token outside the grammar is a
 * sentence naming it and its position), and the session judges the columns it
 * names against the table it will read. See `../analysis/README.md`.
 */
export interface FormulaDecl {
  readonly builtin: 'formula';
  /** `cases / population * 1000` — arithmetic, column names, and abs/log/max/min/round. Nothing else. */
  readonly expression: string;
  /** The column it writes. */
  readonly name: string;
  /** The table the column is written into. Default `data`. */
  readonly table?: string;
  /** What the column is declared as — `int` or `float`. Default `float`. */
  readonly type?: 'int' | 'float';
  /** Default `formula:<name>`. */
  readonly id?: string;
}

/**
 * A seeded stress layout, as two derived columns on the nodes table
 * (`layoutAnalysis`).
 *
 * The only builtin that READS A SECOND TABLE: the ties live on the edges
 * table, and a declared relation between the two is the permission to read
 * them (`./README.md`, law 6). `algo` is required although there is one
 * algorithm today — the act must say what it did, not leave a reader to infer
 * it from the version of the library that happened to run.
 */
export interface LayoutDecl {
  readonly builtin: 'layout';
  /** Which algorithm. `stress` — seeded SGD stress majorization. */
  readonly algo: 'stress';
  /** The nodes table: read whole, and written back onto. Default `nodes`. */
  readonly table?: string;
  /** The related table holding the ties. Default `edges`. */
  readonly edges?: string;
  /** The nodes table's key column. Default `id`. */
  readonly key?: string;
  /** The edges table's endpoint columns. Default `source` / `target`. */
  readonly from?: string;
  readonly to?: string;
  /** The seed the positions come out of. Default 1. */
  readonly seed?: number;
  /** How many SGD passes. Default 30. */
  readonly iterations?: number;
  /** The columns written. Default `x` / `y`. */
  readonly xColumn?: string;
  readonly yColumn?: string;
  /** Default `layout:<algo>:<table>`. */
  readonly id?: string;
}

/**
 * Columns fetched from a related table, as new derived columns on this one
 * (`bringOverAnalysis`).
 *
 * The record names the two tables and WHAT to fetch — never HOW to join them.
 * That is read off the declared relations pointing from `table` at `from`, so
 * `edges.source → nodes.id` is what makes `source_x` exist and a record cannot
 * quietly invent a join nobody declared. See `./README.md` law 6.
 */
export interface BringOverDecl {
  readonly builtin: 'bringOver';
  /** The table WRITTEN — the one holding the pointing columns (e.g. `edges`). */
  readonly table: string;
  /** The related table READ (e.g. `nodes`). */
  readonly from: string;
  /** The columns fetched from it — one produced column per join × name, spelled `<relationColumn>_<column>`. */
  readonly columns: readonly string[];
  /** Default `bring:<table>:<from>`. */
  readonly id?: string;
}

/**
 * A DECLARED column — the closed grammar of `../derive/`, as a new column
 * (`deriveAnalysis`).
 *
 * The formula record beside it is the same act said as a SENTENCE somebody
 * typed; this one is the same act said as a TREE, which is what lets it hold
 * comparisons, conditionals, strings, dates and a calendar — none of which
 * arithmetic text can spell. Both land through `analyze`, because a computed
 * column is an analysis: it reads one table, produces the columns channel, and
 * carries its whole declaration on the commit.
 *
 * The record names no absence column and no join. The absence vocabulary is the
 * DEF's (`data[table].absence`) and arrives beside the record as context, for
 * the same reason `bringOver` names no join: a record that could name its own
 * would name one nobody declared. See `./README.md` law 6.
 */
export interface DeriveDecl {
  readonly builtin: 'derive';
  /** The column it writes. It may never take a source column's name — the session judges that. */
  readonly name: string;
  /**
   * The declaration: `{ ops, kind, expr, over? }`. Judged against the table it
   * reads at the door, in a sentence.
   *
   * `over` is what a reducer runs over — `{ groupBy, where? }` — so a share of a
   * total or a deviation from a group's mean is one record like any other.
   */
  readonly column: DerivedColumnDecl;
  /** The table the column is written into. Default `data`. */
  readonly table?: string;
  /** Default `derive:<table>:<name>` — TABLE-SCOPED, so two tables deriving `rate` are two acts and not one. */
  readonly id?: string;
}

/**
 * An AGGREGATE — a derived TABLE of one row per group, cut from the parent's
 * rows visible at the cursor (`../derive/aggregate.ts`).
 *
 * The derive record's twin: the same op grammar, the same absence context
 * riding beside it, the same judge — but it lands a table beside the parent
 * rather than a column on it. The measures ARE the derive reducers, so a
 * measure is `{ as, expr }` with a reducer tree and nothing else; the group
 * columns become the derived table's columns and, when there is exactly one,
 * its key — from which the session MINTS the relation back to the parent. A
 * record that could name its own relation could name one nobody declared.
 *
 * The rows are never on the record: a replay recomputes them from these bytes
 * over the parent as it stands, and labels the replay by the data version the
 * commit carries.
 */
export interface AggregateDecl {
  readonly builtin: 'aggregate';
  /** The derived table it lands. It may never take a declared table's name — the session judges that. */
  readonly name: string;
  /** The parent table it reads. Default `data`. */
  readonly table?: string;
  /** The op-vocabulary version the measures and the filter are written against. */
  readonly ops: number;
  /** The group columns, in order. `[]` is the whole table as one row, said out loud. */
  readonly groupBy: readonly string[];
  /** The measures — `{ as, expr }`, each `expr` a reducer tree — in the order they land as columns. */
  readonly measures: readonly Measure[];
  /** Which parent rows go in. Absent means every row visible at the cursor. */
  readonly where?: Expr;
  /** Default `aggregate:<table>:<name>` — TABLE-SCOPED, as the derive record's is. */
  readonly id?: string;
}

/** An analysis named as data — the third form of {@link import('./types.js').AnalysisSlot}. */
export type BuiltinAnalysisDecl =
  | GroupByDecl
  | CorrelationDecl
  | RegressionDecl
  | ClusteringDecl
  | FormulaDecl
  | LayoutDecl
  | BringOverDecl
  | DeriveDecl
  | AggregateDecl;

/** Thrown when a builtin record is malformed. Carries every problem at once. */
export class BuiltinAnalysisError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`invalid builtin analysis: ${problems.join('; ')}`);
    this.name = 'BuiltinAnalysisError';
    this.problems = problems;
  }
}

/** What an option must be. Ten kinds is all nine builtins need. */
type OptionType = 'string' | 'count' | 'whole' | 'columnType' | 'algorithm' | 'names' | 'tree' | 'node' | 'groupBy' | 'measures';

/** The values a `columnType` option may take — the columns channel's own vocabulary, narrowed to what arithmetic produces. */
const COLUMN_TYPES = new Set(['int', 'float']);

/** The values an `algorithm` option may take — read from the layout itself, so there is one list. */
const ALGORITHMS = new Set<string>(LAYOUT_ALGORITHMS);

interface BuiltinSpec {
  readonly required: Readonly<Record<string, OptionType>>;
  readonly optional: Readonly<Record<string, OptionType>>;
  /**
   * Anything about this builtin the type table cannot say. One builtin has
   * such a thing: a formula's `expression` must PARSE, and refusing it here —
   * with the same sentence the grammar would give — is what keeps a mistyped
   * formula a sentence rather than a throw from a factory.
   */
  readonly judge?: (decl: Record<string, unknown>, where: string, problems: string[]) => void;
}

/**
 * The ONE table: which options each builtin takes, and what each must be.
 * The validator and the constructor below both read it, so a record the
 * validator accepts is a record the constructor can build.
 */
const SPECS: Readonly<Record<BuiltinAnalysisName, BuiltinSpec>> = Object.freeze({
  groupBy: { required: { by: 'string', measure: 'string' }, optional: { name: 'string', id: 'string' } },
  correlation: { required: { x: 'string', y: 'string' }, optional: { id: 'string', branchId: 'string' } },
  regression: { required: { x: 'string', y: 'string' }, optional: { layer: 'string', minPoints: 'count', id: 'string' } },
  clustering: { required: { column: 'string', k: 'whole' }, optional: { table: 'string', outColumn: 'string', id: 'string' } },
  formula: {
    required: { expression: 'string', name: 'string' },
    optional: { table: 'string', type: 'columnType', id: 'string' },
    judge: (decl, where, problems) => {
      // Only when it IS a string: a missing or empty `expression` is already a
      // sentence from the table above, and a second one about the same field
      // would be noise.
      if (typeof decl['expression'] !== 'string' || decl['expression'].length === 0) return;
      const parsed = parseFormula(decl['expression']);
      if (!parsed.ok) problems.push(`${where}.expression is not a formula: ${parsed.problem}`);
    },
  },
  layout: {
    required: { algo: 'algorithm' },
    optional: {
      table: 'string',
      edges: 'string',
      key: 'string',
      from: 'string',
      to: 'string',
      seed: 'count',
      iterations: 'whole',
      xColumn: 'string',
      yColumn: 'string',
      id: 'string',
    },
  },
  derive: {
    // No `absence` option, for `bringOver`'s reason: the absence vocabulary is
    // the def's, and a record that could name its own would name one nobody
    // declared. The TREE is checked for shape here and judged against the
    // table's columns at the session's door, where the columns are known.
    // `column` carries the whole declaration, `over` included: the group is part
    // of what a column IS, not a second option beside it.
    required: { name: 'string', column: 'tree' },
    optional: { table: 'string', id: 'string' },
  },
  aggregate: {
    // The derive record's twin, and it names no absence and no relation for the
    // same reason: both are the def's to state. The measures and the filter are
    // checked for SHAPE here and judged against the parent's columns at the
    // session's door, where the columns are known.
    required: { name: 'string', ops: 'whole', groupBy: 'groupBy', measures: 'measures' },
    optional: { table: 'string', where: 'node', id: 'string' },
  },
  bringOver: {
    required: { table: 'string', from: 'string', columns: 'names' },
    // No `joins` option: which ties are followed is read off the declared
    // relations, never typed in. A record that could name its own join could
    // name one nobody declared, and the relation would stop being the permission.
    optional: { id: 'string' },
  },
});

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function holds(value: unknown, type: OptionType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string' && value.length > 0;
    case 'count':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    case 'whole':
      return typeof value === 'number' && Number.isInteger(value) && value >= 1;
    case 'columnType':
      return typeof value === 'string' && COLUMN_TYPES.has(value);
    case 'algorithm':
      return typeof value === 'string' && ALGORITHMS.has(value);
    case 'tree':
      // The DECLARATION's shape, and only its shape: an op the grammar does not
      // have, or one given the wrong arguments, is refused with the table in
      // hand (`../derive/judge.ts`) — a sentence naming the column it could not
      // read is worth more than one naming a node.
      return isObject(value) && typeof value['ops'] === 'number' && typeof value['kind'] === 'string' && isObject(value['expr']);
    case 'names':
      // A LIST of column names: non-empty (an empty one asks for nothing and
      // would land nothing), every entry a real name, and no repeat — a repeated
      // name would produce the same column twice and say nothing new.
      return Array.isArray(value) && value.length > 0 && holdsNames(value);
    case 'node':
      // One node of a tree — its shape only; the judge reads it against the table.
      return isObject(value);
    case 'groupBy':
      // The group columns: distinct real names, and the EMPTY list is legal — it
      // is how a declaration says the whole table, out loud.
      return Array.isArray(value) && holdsNames(value);
    case 'measures':
      // Measures: at least one (a table of group columns alone would be the
      // different values themselves — the set-valued op held for later), each
      // `{ as, expr }` with a name and a node, and no two under one name — the
      // derived table holds one column per name.
      return Array.isArray(value) && value.length > 0 && value.every(isMeasure) && new Set(value.map((m) => (m as Measure).as)).size === value.length;
  }
}

/** Distinct, non-empty column names — the shape `names` and `groupBy` share. */
function holdsNames(value: readonly unknown[]): boolean {
  return value.every((v) => typeof v === 'string' && v.length > 0) && new Set(value).size === value.length;
}

/** The shape of one measure: a non-empty name and a node. Its tree is judged at the session's door. */
function isMeasure(value: unknown): boolean {
  return isObject(value) && typeof value['as'] === 'string' && value['as'].length > 0 && isObject(value['expr']);
}

function mustBe(type: OptionType): string {
  switch (type) {
    case 'string':
      return 'must be a non-empty string';
    case 'count':
      return 'must be a non-negative finite number';
    case 'whole':
      return 'must be a whole number of at least 1';
    case 'columnType':
      return 'must be "int" or "float"';
    case 'algorithm':
      return `must name a layout algorithm — ${[...ALGORITHMS].map((a) => `"${a}"`).join(' | ')}`;
    case 'names':
      return 'must be a non-empty array of distinct, non-empty column names';
    case 'tree':
      return 'must be a derived-column declaration — { ops, kind, expr }';
    case 'node':
      return 'must be a tree — a { col }, { lit } or { op, args } node';
    case 'groupBy':
      return 'must be an array of distinct, non-empty column names — [] means the whole table';
    case 'measures':
      return 'must be a non-empty array of measures — { as, expr }, each under its own name';
  }
}

/** The options a builtin takes, listed for its refusal sentence. */
function optionNamesOf(spec: BuiltinSpec): string {
  return [...Object.keys(spec.required), ...Object.keys(spec.optional)].join(', ');
}

/** Every key but `builtin` — which is exactly the factory's own options. */
function optionsOf<T extends { readonly builtin: string }>(decl: T): Omit<T, 'builtin'> {
  const { builtin, ...options } = decl;
  void builtin;
  return options;
}

/**
 * True when a slot is a builtin RECORD rather than a def or a module: it
 * carries a `builtin` name and no `build` function. The def door and the
 * registry both route on this one predicate, so the shape that validates is
 * the shape that gets constructed.
 */
export function isBuiltinRecord(slot: unknown): slot is BuiltinAnalysisDecl {
  return isObject(slot) && typeof slot.build !== 'function' && typeof slot.builtin === 'string';
}

/**
 * Judge a builtin record. Total over `unknown` (it is a firewall, not a
 * convenience): collects every problem, never throws, never constructs.
 */
export function validateBuiltinAnalysis(decl: unknown, where: string, problems: string[]): void {
  if (!isObject(decl)) {
    problems.push(`${where} must be an object { builtin, … }`);
    return;
  }
  const name = decl['builtin'];
  if (typeof name !== 'string') {
    problems.push(`${where}.builtin must name a builtin analysis — one of ${BUILTIN_ANALYSES.join(' | ')}`);
    return;
  }
  const spec = SPECS[name as BuiltinAnalysisName] as BuiltinSpec | undefined;
  if (spec === undefined) {
    problems.push(`${where}.builtin "${name}" is not a builtin analysis — one of ${BUILTIN_ANALYSES.join(' | ')}`);
    return;
  }
  for (const key of Object.keys(decl)) {
    if (key !== 'builtin' && !(key in spec.required) && !(key in spec.optional)) {
      problems.push(`${where}.${key} is not an option of the "${name}" analysis — it takes ${optionNamesOf(spec)}`);
    }
  }
  for (const [key, type] of Object.entries(spec.required)) {
    if (!holds(decl[key], type)) problems.push(`${where}.${key} ${mustBe(type)} (the "${name}" analysis needs it)`);
  }
  for (const [key, type] of Object.entries(spec.optional)) {
    if (decl[key] !== undefined && !holds(decl[key], type)) problems.push(`${where}.${key}, if present, ${mustBe(type)}`);
  }
  spec.judge?.(decl, where, problems);
}

/**
 * What the DASHBOARD knows that a record does not say — everything a builtin
 * needs which is declared elsewhere in the def.
 *
 * One builtin needs such a thing today: `bringOver` follows the declared
 * relations, and a record may not name a join of its own (that is what keeps
 * the relation the permission). Absent means "none declared", which every
 * builtin but that one is indifferent to, and which that one refuses in a
 * sentence at the door.
 */
export interface BuiltinAnalysisContext {
  readonly relations?: readonly RelationEdge[];
  /**
   * Each table's declared absence vocabulary, by table name — the def's
   * `data[<table>].absence`, verbatim: the WHOLE declaration, one entry or a
   * list of them.
   *
   * A derived column has to keep the absence law of the table it reads (a cell
   * whose governing state column is not `present` is absent), and the law is
   * the DEF's to state. It rides beside the record for the same reason the
   * relations do. Verbatim and never narrowed to one entry, because silence
   * belongs to a COLUMN: a table with three state columns has three, and the
   * derive act adapts them to the port at its own door
   * (`../data/silence.ts` · `silenceOfDecl`).
   */
  readonly absence?: Readonly<Record<string, AbsenceDecl | readonly AbsenceDecl[]>>;
}

/**
 * Each table's declared absence vocabulary, by table name — the context field
 * {@link BuiltinAnalysisContext.absence} wants, read off the def's own
 * `data`.
 *
 * One reader, so the dashboard build and the session hand a record the SAME
 * law. A table that declares no state column contributes no entry, and the
 * walker's law is then the half every engine already keeps: `null` is absent.
 *
 * It carries the table's WHOLE declaration and not one entry of it — the defect
 * a per-table reading was: a `measurements` table declares one state column per
 * measured quantity, and a context that carried the first would have blanked
 * the other two columns on every row (`../data/silence.ts`).
 *
 * ```ts
 * absenceByTable({ cells: { absence: { field: 'report_state', states: ['present', 'unknown'] } }, pop: {} });
 * // { cells: { field: 'report_state', states: [...] } }
 * ```
 */
export function absenceByTable(data: Readonly<Record<string, { readonly absence?: AbsenceDecl | readonly AbsenceDecl[] }>>): Record<string, AbsenceDecl | readonly AbsenceDecl[]> {
  const out: Record<string, AbsenceDecl | readonly AbsenceDecl[]> = {};
  for (const [table, decl] of Object.entries(data)) {
    if (decl.absence !== undefined) out[table] = decl.absence;
  }
  return out;
}

/**
 * A TABLE AN ACT LANDS, as the DECLARATION already states it.
 *
 * An {@link AggregateDecl} names the table it lands (`name`), the group
 * columns that become its columns (`groupBy`, in order) and the measures that
 * follow them (`measures[].as`, in the order they land) — so a minted table's
 * name and its whole column list are known at declaration time, before a
 * single row is folded. Nothing here is guessed: the order is
 * `../derive/aggregate.ts` · `schemaOf`'s order, and the key is the one the
 * session mints the relation back to the parent from.
 *
 * What it does NOT carry: types and facets. A minted column's type is the
 * act's to answer when it runs (the judge computes it from the parent's own
 * columns), so a reader of this map judges a field for EXISTENCE only.
 */
export interface MintedTable {
  /** The analysis id under `def.analyses` whose act lands the table. */
  readonly analysisId: string;
  /** Its columns: the group columns in declared order, then the measures' `as` names. */
  readonly columns: readonly string[];
  /** Its key — the one group column, when there is exactly one. Absent for a grouped-by-many or whole-table aggregate. */
  readonly key?: string;
}

/**
 * Every table this definition's declared analyses MINT, by name.
 *
 * THE ONE OWNER of "which table names an act lands", so the def door (a
 * layer's table), the field judge (its columns) and the probe door (which act
 * to name when it has not landed) can never disagree about what the same
 * definition says. It lives beside {@link absenceByTable} because this is
 * where a def's analyses are already read as data.
 *
 * Total over `unknown`, like every reader on this boundary: a malformed
 * aggregate is refused on its own line by {@link validateBuiltinAnalysis}, and
 * is read here for whatever it does state (a record with no usable `name`
 * mints nothing).
 *
 * ```ts
 * mintedTables({ analyses: { radiiPerPlanet: { builtin: 'aggregate', name: 'radii_per_planet', ops: 1, groupBy: ['planet'], measures: [{ as: 'radius', expr: … }] } } });
 * // Map { 'radii_per_planet' => { analysisId: 'radiiPerPlanet', columns: ['planet', 'radius'], key: 'planet' } }
 * ```
 */
export function mintedTables(def: unknown): ReadonlyMap<string, MintedTable> {
  const out = new Map<string, MintedTable>();
  if (!isObject(def) || !isObject(def.analyses)) return out;
  for (const [analysisId, slot] of Object.entries(def.analyses)) {
    const minted = mintedBy(analysisId, slot);
    // WHY first-declared wins: two acts claiming one name is a question for the act door (the
    // session refuses landing a table whose name is already taken), not for a reader of the def
    if (minted !== undefined && !out.has(minted.name)) out.set(minted.name, minted.table);
  }
  return out;
}

/** A usable name in a raw record — the guard every list read here shares. */
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** The one analysis form that lands a table, read for the three things a reader needs. An aggregate whose `name` is unusable mints nothing nameable. */
function mintedBy(analysisId: string, slot: unknown): { readonly name: string; readonly table: MintedTable } | undefined {
  if (!isBuiltinRecord(slot) || slot.builtin !== 'aggregate') return undefined;
  const decl = slot as unknown as Record<string, unknown>;
  const name = decl['name'];
  if (typeof name !== 'string' || name.length === 0) return undefined;
  const groupBy = Array.isArray(decl['groupBy']) ? decl['groupBy'].filter(isNonEmpty) : [];
  const measures = Array.isArray(decl['measures']) ? decl['measures'] : [];
  const landed = measures.map((measure) => (isObject(measure) ? measure['as'] : undefined)).filter(isNonEmpty);
  return {
    name,
    table: {
      analysisId,
      columns: [...groupBy, ...landed],
      // the session mints the relation back to the parent from a SINGLE group column; two group columns are a compound nobody declared a key for
      ...(groupBy.length === 1 ? { key: groupBy[0]! } : {}),
    },
  };
}

/** The ties a `bringOver` record follows: one per declared relation pointing from its table at the related one. */
function joinsFor(decl: BringOverDecl, relations: readonly RelationEdge[]): BringOverJoin[] {
  return relationsFrom(relations, decl.table, decl.from).map((r) => ({ column: r.from.column, key: r.to.column }));
}

/**
 * Resolve a builtin record to its factory. Judged first — a malformed record
 * throws {@link BuiltinAnalysisError} with every problem, rather than reaching
 * a factory that would throw something less specific (or nothing at all until
 * the analysis ran).
 *
 * `context` carries what the record cannot say (the def's relations). It is
 * optional because most builtins never look at it, and because a caller
 * building one analysis by hand has no dashboard to take it from.
 */
export function buildBuiltinAnalysis(decl: BuiltinAnalysisDecl, context: BuiltinAnalysisContext = {}): AnalysisModule<readonly DataRow[], AnalysisOutput> {
  const problems: string[] = [];
  validateBuiltinAnalysis(decl, 'builtin analysis', problems);
  if (problems.length > 0) throw new BuiltinAnalysisError(problems);
  // `builtin` names the factory; every OTHER key is that factory's own option,
  // which is what makes this a rest-spread rather than a per-field copy.
  switch (decl.builtin) {
    case 'groupBy':
      return groupByAnalysis(optionsOf(decl));
    case 'correlation':
      return correlationAnalysis(optionsOf(decl));
    case 'regression':
      return regressionAnalysis(optionsOf(decl));
    case 'clustering':
      return clusteringAnalysis(optionsOf(decl));
    case 'formula':
      return formulaAnalysis(optionsOf(decl));
    // The second builtin whose options are NOT the record alone: the absence
    // vocabulary comes from the def's own table declaration. A table that
    // declares none passes none, and the walker's law is then the first half of
    // itself — `null` is absent, and nothing else is.
    case 'derive': {
      const absence = context.absence?.[decl.table ?? 'data'];
      return deriveAnalysis({ ...optionsOf(decl), ...(absence !== undefined ? { absence } : {}) });
    }
    case 'aggregate': {
      const absence = context.absence?.[decl.table ?? 'data'];
      return aggregateAnalysis({ ...optionsOf(decl), ...(absence !== undefined ? { absence } : {}) });
    }
    case 'layout':
      return layoutAnalysis(optionsOf(decl));
    // The one builtin whose options are NOT the record alone: the joins come
    // from the def's relations, and an empty list is a refusal the analysis
    // itself makes, in a sentence, when the act is declared.
    case 'bringOver':
      return bringOverAnalysis({ ...optionsOf(decl), joins: joinsFor(decl, context.relations ?? []) });
  }
}
