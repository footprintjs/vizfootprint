/**
 * L3 — analysis (`vizfootprint/analysis`) · shared types.
 *
 * Declared analyses executed AS footprintjs flowcharts, whose outputs EXTEND the
 * data space (R11): the agent (L5) and the log (L1) treat a result as just more
 * columns / geometry / scalars / tables — filterable through the ordinary L2
 * predicate path, with ZERO new dispatch verbs. Validated by the C3 mini-spike
 * (`spikes/l3-channels/`); this promotes the four proven channels into a
 * declarative, schema-validated `defineAnalysis` surface.
 *
 * An analysis is `computedBy: 'system'` BY CONSTRUCTION — the flowchart engine
 * computes it, never a human or an agent. `defineAnalysis` never accepts a code
 * STRING (R12): the executable parts (`build`/`readOutput`/`test.pValue`) are
 * developer-authored functions; every DECLARATIVE field (`id`, `produces`,
 * input column names, `test.statistic`, honesty notes) is inert data.
 */

import type { RuntimeSnapshot } from 'footprintjs';
import type { ColumnInfo, DataProviderRejection, Row } from '../data/types.js';
import type { HypothesisRecord } from '../fdr/index.js';

/**
 * `'test'` arms L4's online-FDR stepper (R6/R7); `'transform'` is FDR-exempt.
 *
 * The array is the source, and the type is derived from it — the same shape
 * `OUTPUT_CHANNELS` has, and for the same reason: a hand-copied `Set` of
 * literals in the validator has no relationship to the union, so a name added
 * to one and not the other type-checks clean and then refuses at runtime.
 */
export const ANALYSIS_KINDS = ['test', 'transform'] as const;
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];

// ── The R11 output vocabulary. NEVER a row-id list (R11 forbids it). ──────────

/**
 * What a produced column is DECLARED as — the one type vocabulary the columns
 * channel and the table channel share.
 *
 * `boolean`, `date` and `unknown` joined the three arithmetic words when the
 * derive grammar landed (`../derive/analysis.ts`): a declared column's type is
 * COMPUTED from the op table at declaration, so a column of ISO date strings
 * or of true/false has a type arithmetic could never produce — and one whose
 * act was replayed rather than re-judged says `unknown` rather than a type
 * tallied from its values. An aggregate's measures carry the same words
 * (`../derive/aggregate.ts`), which is why the table's schema speaks them too.
 */
export type OutputColumnType = 'int' | 'float' | 'string' | 'boolean' | 'date' | 'unknown';

/** A materialized column set (e.g. adds `cluster_id : int`). Re-enters as a predicate. */
export interface ColumnsOutput {
  readonly as: 'columns';
  readonly table: string;
  /** What each column it wrote is DECLARED as ({@link OutputColumnType}). */
  readonly columns: Record<string, { readonly type: OutputColumnType }>;
}
/**
 * A fitted LINE layer — today's only geometry: slope + intercept over a domain.
 * Selects NO rows — no clause. When a second shape lands (a hull, a contour),
 * `features` becomes a discriminated union and this sentence grows with it; a
 * doc naming shapes the type refuses is a promise nobody can keep.
 */
export interface GeometryOutput {
  readonly as: 'geometry';
  readonly layer: string;
  readonly features: {
    readonly slope: number;
    readonly intercept: number;
    readonly domain: readonly [number, number];
  };
}
/** A single scalar (e.g. a correlation coefficient). */
export interface ScalarOutput {
  readonly as: 'scalar';
  readonly name: string;
  readonly value: number | string | boolean;
}
/** A new queryable summary table. Filterable by ordinary predicates — no new verb. */
export interface TableOutput {
  readonly as: 'table';
  readonly name: string;
  readonly schema: Record<string, OutputColumnType>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}
export type AnalysisOutput = ColumnsOutput | GeometryOutput | ScalarOutput | TableOutput;

/** The `as` discriminants — the closed channel set (R11). */
export const OUTPUT_CHANNELS = ['columns', 'geometry', 'scalar', 'table'] as const;
export type OutputChannel = (typeof OUTPUT_CHANNELS)[number];

// ── Honesty (R14): a typed degenerate flag, never a fabricated fit. ───────────

export interface DegenerateResult {
  readonly ok: false;
  readonly reason: 'degenerate-fit';
  readonly n: number;
  readonly fitDegenerate: true;
}

/**
 * The rows could not be READ: the parent table's engine refused, so nothing
 * was computed and nothing lands. The third outcome, distinct from the other
 * two — a degenerate result means the rows were read and no honest fit came
 * of them; a refusal means the act was never performed. The session files
 * this as `derive-source-refused`, carrying the engine's own rejection
 * verbatim rather than a fabricated degenerate flag.
 */
export interface UnavailableResult {
  readonly ok: false;
  readonly reason: 'unavailable';
  readonly rejection: DataProviderRejection;
}

/**
 * A finished analysis: a typed output, an honest degenerate flag (R14), or the
 * rows it could not read. An EMPTY output — a table of zero rows, a column of
 * nothing but absences — is `ok: true`: an honest answer that LANDS, never a
 * degenerate one.
 */
export type AnalysisResult<O extends AnalysisOutput = AnalysisOutput> =
  | { readonly ok: true; readonly output: O }
  | DegenerateResult
  | UnavailableResult;

/** Declarative honesty envelope. Inert metadata; the guard lives in `precheck`/`readOutput`. */
export interface HonestyDecl {
  /** Minimum row count below which a fit is not trusted (R14 floor). */
  readonly minPoints?: number;
  /** Free-text rationale. Inert — never parsed or dispatched on. */
  readonly notes?: string;
}

// ── The declarative read-set (feeds sliceForKey + docs). ──────────────────────

/**
 * The inert role labels, as a value so the validator cannot drift from the type.
 *
 * `'identifier'` names the column rows are IDENTIFIED by — a node key, an edge
 * endpoint — and is the data layer's own word (`ColumnRole`, `../data/types.ts`).
 * It is NOT `'group'`: a graph reader reads "group" as a clustered layout keyed
 * by that column, and a node key groups nothing.
 */
export const INPUT_ROLES = ['x', 'y', 'group', 'measure', 'value', 'param', 'identifier'] as const;
export type InputRole = (typeof INPUT_ROLES)[number];

export interface InputBinding {
  /** The data-space column / param the analysis reads. */
  readonly column: string;
  /** Inert role label. */
  readonly role?: InputRole;
}

// ── The tables an analysis reads BESIDE its own. ──────────────────────────────

/**
 * The rows of every table a def `reads`, keyed by table name — read at the
 * cursor, one entry per name. A table the def did not name is not in here.
 *
 * A table it DID name is here whenever the session resolved the rows — that
 * holds on both of `declareAnalysis`'s paths, the one that queries the data
 * space and the one where the caller brought its own `input` — because a
 * backend that refused a related table stops the whole act, so there is no
 * empty stand-in for a table that could not be read.
 *
 * The direct caller keeps the same promise or is refused: `run` narrows what it
 * is handed to the names the def declared, and REFUSES in a sentence when one of
 * them arrived with no rows — `{}` reaching a def that named `reads` would be an
 * edgeless graph laid out as a success, and half an input is not an input (R14).
 */
export type RelatedRows = Readonly<Record<string, readonly Row[]>>;

/**
 * The rows one invocation of an analysis runs over: its OWN table's rows, and
 * the related tables it declared. The session resolves this — one query per
 * table, at the cursor, with derived columns visible under their logical names
 * — and hands the two halves on: `rows` to `run`, `related` beside it.
 *
 * The two halves are NOT read under the same clauses. A columns-channel
 * analysis reads its own table WHOLE, because the values it materializes have
 * to align to the row order the table already has; a related table is read
 * under the clauses that reach IT (`clausesOn`), never the own table's. So
 * filtering the nodes view can turn brought-over values into misses while the
 * edge rows stay complete — that is the rule, not a bug.
 *
 * NOT `toRunInput`'s payload, despite the neighbouring name: this is the shape a
 * session RESOLVES and then takes apart into `run(rows, { related })`. No def
 * ever receives one whole.
 */
export interface AnalysisRunInput {
  readonly rows: readonly Row[];
  readonly related: RelatedRows;
}

/** Nothing was read beside the own table. The shared empty — frozen, so no caller can grow one. */
export const NO_RELATED_ROWS: RelatedRows = Object.freeze({});

// ── The test declaration (required iff kind==='test'). ────────────────────────

export interface TestContext<I> {
  readonly snapshot: RuntimeSnapshot;
  readonly input: I;
  readonly output: AnalysisOutput;
}

export interface TestDecl<I = unknown> {
  /** Human-facing statistic name (inert; e.g. 'pearson-r'). */
  readonly statistic: string;
  /**
   * The caller-supplied p-value judge. L3 NEVER computes a p-value itself
   * (SPEC §5 non-goal: "the package brings the machinery, the consumer brings
   * the judge"). Must return a value in [0,1].
   */
  pValue(ctx: TestContext<I>): number;
  /** Optional provenance branch stamped on the emitted HypothesisRecord (R8). */
  readonly branchId?: string;
}

// ── The analysis definition + module. ─────────────────────────────────────────

export interface ReadContext<I> {
  readonly snapshot: RuntimeSnapshot;
  readonly input: I;
}

/**
 * A declared analysis. The DECLARATIVE fields are schema-validated and inert
 * (R12); the functions are developer-authored (never a model-supplied code
 * string). `build` returns a footprintjs flowchart re-run per invocation.
 */
export interface AnalysisDef<I = unknown, O extends AnalysisOutput = AnalysisOutput> {
  /** Stable id — also the emitted HypothesisRecord.hypothesisId. Inert string. */
  readonly id: string;
  readonly kind: AnalysisKind;
  /**
   * Which columns/params the analysis reads ON THE TABLE IT RUNS OVER (docs +
   * slice read-set hint). The columns of a `reads` table are NOT declared here
   * — only that table's NAME is, in `reads`, and the session's provenance
   * carries its selection commits.
   */
  readonly inputs: readonly InputBinding[];
  /**
   * The tables this analysis reads BESIDE the one it runs over — a layout on
   * `nodes` that needs `edges`, an analysis on `edges` that needs `nodes`.
   *
   * Declarative and inert here; the permission is asked for at the door. A
   * table named here must be a declared table AND joined to the analysis's own
   * table by a declared relation, in either direction — the relation IS the
   * permission (`../def/README.md`, "Relations"), and `declareAnalysis` refuses
   * in a sentence when there is none. Absent means what it always meant: the
   * analysis reads one table.
   */
  readonly reads?: readonly string[];
  /** The output CHANNEL this analysis re-enters through (R11 discriminant). */
  readonly produces: O['as'];
  /** Build the footprintjs flowchart. Developer function — NOT a model code string. */
  build(): import('footprintjs').FlowChart;
  /**
   * Map the caller's input to the flowchart run payload. `related` carries the
   * rows of every table `reads` names and of no other — `{}` for the analyses
   * that name none, which is why the parameter can simply be ignored by all of
   * them. A declared name is always present here: `run` refuses the invocation
   * that did not bring it, so `related[name] ?? []` reads an EMPTY table, never
   * a missing one.
   */
  toRunInput(input: I, related: RelatedRows): unknown;
  /** Extract the typed, value-bearing output from the finished run's snapshot. */
  readOutput(ctx: ReadContext<I>): AnalysisResult<O>;
  /** Pre-run honesty gate (R14): short-circuits BEFORE the chart runs on degenerate input. */
  precheck?(input: I): DegenerateResult | undefined;
  /**
   * Judge this analysis against the TABLE it is about to read, before a row
   * moves — one sentence per problem, an empty list for "nothing to say", and
   * never a throw.
   *
   * `precheck` is the other pre-run gate and answers a different question: it
   * sees the ROWS and reports a degenerate FIT (R14 honesty), which lands
   * nothing and says nothing beyond the flag. This one sees only the table's
   * COLUMNS — their names and the types the engine settled on — and reports
   * that the analysis was declared over something this table does not have. A
   * refusal, in words, before the act exists; the session files it as an
   * ordinary `guard-failed` gap and lands no commit.
   *
   * Optional, and almost every analysis wants nothing here: an analysis a
   * developer wrote names its columns in TypeScript and is judged when the
   * dashboard is built. The one that needs it is the one whose read-set was
   * typed in by a person (`formulaAnalysis`).
   */
  judgeTable?(table: string, columns: readonly ColumnInfo[]): readonly string[];
  /**
   * Which gap taxonomy this analysis's own refusals belong to.
   *
   * Inert data, and the only thing an analysis may say about the LEDGER: the
   * session reads it when it files a refusal about this analysis, so a declared
   * column's refusals land as `derive-invalid` / `derive-source-refused` rather
   * than the general `guard-failed` / `needs-backend-data`. An agent that gets
   * one back can tell "edit the tree" from "open the source" without reading
   * the sentence.
   *
   * Absent — every hand-written analysis — means the general codes, which is
   * what every analysis in this folder still files. A word this session does
   * not know is the general codes too: the def is a boundary, and a taxonomy
   * nobody can file is not one.
   */
  readonly refusalTaxonomy?: 'derive';
  /** Required iff kind==='test' (validated): statistic + caller-supplied p-value (R6). */
  readonly test?: TestDecl<I>;
  /** Optional honesty declaration (R14). */
  readonly honesty?: HonestyDecl;
}

/** Where a kind:'test' HypothesisRecord is emitted. L4 wiring is P3.4's job. */
export type HypothesisSink = (record: HypothesisRecord) => void;

export interface RunAnalysisOptions {
  /** Sink for the emitted HypothesisRecord (kind:'test' only). */
  readonly sink?: HypothesisSink;
  /** Logical arrival time stamped on the HypothesisRecord (monotone within a run). */
  readonly timestamp?: number;
  /**
   * The rows of the tables the def `reads`, resolved by the caller that has a
   * data space to read them from (the session). Absent is the one-table case —
   * `toRunInput` sees `{}`, which is what every one-table analysis already has;
   * absent for a def that DID name a table is a refusal, not an empty table
   * (`run` names the table it was handed no rows for). A name the def did not
   * declare is dropped: the door's permission was for the declared ones.
   */
  readonly related?: RelatedRows;
}

export interface AnalysisRunResult<O extends AnalysisOutput = AnalysisOutput> {
  readonly result: AnalysisResult<O>;
  /** The finished run's snapshot. ABSENT when a pre-run honesty gate short-circuited (R14). */
  readonly snapshot?: RuntimeSnapshot;
  /** Present only for a kind:'test' run that produced an output (never for degenerate/transform). */
  readonly hypothesis?: HypothesisRecord;
}

export interface AnalysisModule<I = unknown, O extends AnalysisOutput = AnalysisOutput> {
  readonly id: string;
  readonly kind: AnalysisKind;
  readonly def: AnalysisDef<I, O>;
  run(input: I, opts?: RunAnalysisOptions): Promise<AnalysisRunResult<O>>;
}
