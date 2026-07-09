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
import type { HypothesisRecord } from '../fdr/index.js';

/** `'test'` arms L4's online-FDR stepper (R6/R7); `'transform'` is FDR-exempt. */
export type AnalysisKind = 'test' | 'transform';

// ── The R11 output vocabulary. NEVER a row-id list (R11 forbids it). ──────────

/** A materialized column set (e.g. adds `cluster_id : int`). Re-enters as a predicate. */
export interface ColumnsOutput {
  readonly as: 'columns';
  readonly table: string;
  readonly columns: Record<string, { readonly type: 'int' | 'float' | 'string' }>;
}
/** A geometry layer (regression line / hull / contour). Selects NO rows — no clause. */
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
  readonly schema: Record<string, 'int' | 'float' | 'string'>;
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

/** A finished analysis: a typed output, or an honest degenerate flag (R14). */
export type AnalysisResult<O extends AnalysisOutput = AnalysisOutput> =
  | { readonly ok: true; readonly output: O }
  | DegenerateResult;

/** Declarative honesty envelope. Inert metadata; the guard lives in `precheck`/`readOutput`. */
export interface HonestyDecl {
  /** Minimum row count below which a fit is not trusted (R14 floor). */
  readonly minPoints?: number;
  /** Free-text rationale. Inert — never parsed or dispatched on. */
  readonly notes?: string;
}

// ── The declarative read-set (feeds sliceForKey + docs). ──────────────────────

export interface InputBinding {
  /** The data-space column / param the analysis reads. */
  readonly column: string;
  /** Inert role label. */
  readonly role?: 'x' | 'y' | 'group' | 'measure' | 'value' | 'param';
}

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
  /** Which columns/params the analysis reads (docs + slice read-set hint). */
  readonly inputs: readonly InputBinding[];
  /** The output CHANNEL this analysis re-enters through (R11 discriminant). */
  readonly produces: O['as'];
  /** Build the footprintjs flowchart. Developer function — NOT a model code string. */
  build(): import('footprintjs').FlowChart;
  /** Map the caller's input to the flowchart run payload. */
  toRunInput(input: I): unknown;
  /** Extract the typed, value-bearing output from the finished run's snapshot. */
  readOutput(ctx: ReadContext<I>): AnalysisResult<O>;
  /** Pre-run honesty gate (R14): short-circuits BEFORE the chart runs on degenerate input. */
  precheck?(input: I): DegenerateResult | undefined;
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
