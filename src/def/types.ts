/**
 * L5 — def (`vizfootprint/agent`, the declarative half) · shared types.
 *
 * A `DashboardDef` is a **Mosaic-spec superset** (D10 / SPEC §7). Mosaic's own
 * spec parser destructures its top level as
 *   `{ meta, config, data = {}, params, plotDefaults = {}, ...root }`
 *   (`node_modules/@uwdata/mosaic-spec/dist/src/parse-spec.js:60`; `SpecNode`
 *    carries `root, meta, config, data, params, plotDefaults` —
 *    `.../ast/SpecNode.d.ts:2-7`).
 * vizfootprint MIRRORS those exact top-level keys (`meta`, `config`, `data`,
 * `params`, `plotDefaults`, plus the `...views` plot tree) as opaque
 * pass-through — vizfootprint renders nothing (SPEC §1 non-goal "No charting
 * library"), so the VL encodings ride untouched — and ADDS the vizfootprint
 * keys below (`actors`, `analyses`, `capabilities`, `fdr`, `agent`,
 * `defaultTable`).
 *
 * R12 firewall (mirrors L0 `parseCause` / L3 `validateAnalysisDef`): every
 * DECLARATIVE field is validated against a strict allowlist and treated as
 * inert data. A hostile string in `meta`/`label`/an analysis `id` is stored and
 * echoed verbatim, NEVER interpreted. The only executable parts are
 * developer-authored functions already firewalled by L3 (`AnalysisDef.build`
 * etc.) and an optional developer-authored `fdr.gamma` sequence — never a
 * model-supplied code string.
 */

import type { Actor, Cause } from '../cause/index.js';
import type { LinkDecl, LinkDefault, LinkGraph } from '../links/types.js';
import type { ActorMeta } from '../mosaic/index.js';
import type {
  AnalysisDef,
  AnalysisKind,
  AnalysisModule,
  AnalysisOutput,
  AnalysisRunResult,
  RunAnalysisOptions,
} from '../analysis/index.js';
import type { FdrStep, GammaSequence, HypothesisRecord } from '../fdr/index.js';
import type { ColumnInfo, DataProvider, Engine, Row } from '../data/index.js';

// ── The dispatch verb vocabulary (SPEC §9; Q6 — the 7-verb set was INCOMPLETE:
// changing a view's visual encoding is a state-changing transition too, not an
// optional-interaction affordance — docs/RESEARCH_STATE.md Q6/D-note). ────────

/** The eight semantic verbs the agent drives every interaction through (R4). */
export type DispatchVerb =
  | 'select'
  | 'filter'
  | 'annotate'
  | 'navigate'
  | 'analyze'
  | 'fork'
  | 'checkpoint'
  | 'reencode'
  | 'link';

/** The nine verbs, frozen (used for validation + tool-schema enumeration). `link` (layer 4) edits the graph, not a data view. */
export const DISPATCH_VERBS: readonly DispatchVerb[] = [
  'select',
  'filter',
  'annotate',
  'navigate',
  'analyze',
  'fork',
  'checkpoint',
  'reencode',
  'link',
] as const;

/**
 * Dual intent (D13 / R11): a verb is either **mandatory-analytical** (must be
 * honored or a gap is filed) or **optional-interaction** (best-effort UI
 * affordance). Per SPEC §7 the defaults are: `analyze` mandatory-analytical;
 * `annotate`/`navigate` optional-interaction; the state-changing analytical
 * verbs (`select`/`filter`/`fork`/`checkpoint`) mandatory-analytical.
 */
export type IntentClass = 'mandatory-analytical' | 'optional-interaction';

export interface IntentDecl {
  readonly verb: DispatchVerb;
  readonly intent: IntentClass;
}

/** The default dual-intent tagging (SPEC §7). Overridable per verb via `def.agent.intents`. */
export const DEFAULT_INTENTS: Readonly<Record<DispatchVerb, IntentClass>> = {
  select: 'mandatory-analytical',
  filter: 'mandatory-analytical',
  analyze: 'mandatory-analytical',
  fork: 'mandatory-analytical',
  checkpoint: 'mandatory-analytical',
  // reencode changes what a view SHOWS, not just what it highlights — a
  // state-changing transition (the orchestrator ruling), same class as
  // select/filter/fork/checkpoint: must be honored or filed as a typed gap.
  reencode: 'mandatory-analytical',
  // link changes what FILTERS what — the graph itself — so it is state-changing like reencode.
  link: 'mandatory-analytical',
  annotate: 'optional-interaction',
  navigate: 'optional-interaction',
};

// ── The def schema (mosaic-spec superset). ─────────────────────────────────────

/**
 * What the CALLER states about how a table's rows were produced — the bucket
 * they cover, how they were collapsed, how many source points went in.
 *
 * STATED, never inferred: a row array cannot reveal that it was downsampled
 * (100 daily means and 100 raw readings are byte-identical in shape), so
 * vizfootprint refuses to guess and instead carries what the source said.
 * Absent means the source said nothing — which is NOT the same as "raw", and
 * is rendered as no caption at all (`seriesCaption` returns `null`).
 *
 * Every field is a caller-supplied string echoed verbatim, never parsed (R12):
 * vizfootprint does not know what `'5m'` or `'p95'` mean and does not pretend to.
 */
export interface SeriesGrain {
  /** The span each row covers, in the caller's own words — `'day'`, `'5m'`, `'raw'`. */
  readonly bucket?: string;
  /** How points were collapsed into a bucket, in the caller's own words — `'mean'`, `'p95'`, `'last'`. */
  readonly reducer?: string;
  /** How many source points went in before collapsing. Non-negative. */
  readonly collapsedFrom?: number;
  /** Anything else the source wants shown under the chart. Echoed verbatim. */
  readonly note?: string;
}

/** One table's data source — a Mosaic-spec `data` entry, superset (D24 engine key). */
export interface DataSourceDef {
  /** Inline row objects. Mutually exclusive with `csv`. */
  readonly rows?: readonly Row[];
  /** CSV text (parsed by `src/data/csv`). Mutually exclusive with `rows`. */
  readonly csv?: string;
  /** D24 engine key: `memory` | `wasm` | `server` | `auto`. Default `memory`. */
  readonly engine?: Engine;
  /** Memory engine internal storage layout (pass-through; default `row`). */
  readonly layout?: 'row' | 'column';
  /**
   * Source metadata: what the caller STATES about this table's granularity
   * (see {@link SeriesGrain}). Inert declarative data — it never changes a
   * clause, a commit, or a query; it exists so a downsampling fact can be
   * rendered as a caption instead of silently misread as raw detail.
   */
  readonly grain?: SeriesGrain;
  /**
   * Which column carries this table's ABSENCE state, and the vocabulary it
   * speaks (see {@link AbsenceDecl}). Declared, never inferred: a value in
   * that column is a fact the SOURCE established, and the validator refuses
   * to let the column bind to a numeric channel — "unavailable" is not a low
   * number.
   */
  readonly absence?: AbsenceDecl;
}

/**
 * A declared absence vocabulary — the one place a table says how it spells
 * "there is no value here, and here is which kind of no value".
 *
 * The four canonical states, in the order every chart and caption should
 * present them:
 *   - `present`        — the thing reported; here it is
 *   - `not-configured` — genuinely absent: the feature is off, there is no policy
 *   - `unavailable`    — we could not check: timeout, auth, collector down
 *   - `unknown`        — the source CANNOT tell the two silences apart
 *
 * `unknown` is the honest state and is REQUIRED in every vocabulary: a
 * collector that writes "analytics unreadable" and "analytics off" as the
 * same bytes must be able to say so, instead of the tool asserting a
 * confident `not-configured` that tells the reader to stop looking.
 *
 * Inert declarative data (R12): strings echoed verbatim, never parsed.
 */
export interface AbsenceDecl {
  /** The column that carries the state. */
  readonly field: string;
  /** The vocabulary that column may hold. MUST include `unknown`. */
  readonly states: readonly string[];
}

/** The canonical absence vocabulary; a table may declare a subset plus `unknown`, or its own words plus `unknown`. */
export const ABSENCE_STATES: readonly string[] = Object.freeze(['present', 'not-configured', 'unavailable', 'unknown']);
/** The one state every absence vocabulary must be able to say. */
export const ABSENCE_UNKNOWN = 'unknown';

/**
 * The visual channels that carry a MAGNITUDE — position along an axis, size,
 * radius, angle. A declared absence column may never bind to one of these:
 * "unavailable" on an axis renders as a low number and tells the reader the
 * wrong thing with a straight face. One list, read by the def validator
 * (`initial` bindings), the `reencode` verb (runtime rebinds), and the ui's
 * compatibility check — so the rule cannot drift between the three doors.
 */
export const MAGNITUDE_CHANNELS: ReadonlySet<string> = new Set(['x', 'y', 'size', 'r', 'radius', 'theta']);

/**
 * One view's declared VISUAL-ENCODING surface (the `reencode` verb's
 * validation + fold seed; D10 VL vocab). NOT to be confused with
 * `CapabilityDecl.encodings` / `ChartEncoding` (`mosaic/emission.ts`) — those
 * name the point/interval SELECTION kind a view emits. This names which
 * plot CHANNEL (x/y/color/…) a data field is bound to.
 *
 * A view absent from `DashboardDef.encodings` has no declared encoding
 * surface at all — `reencode` against it is an honest `guard-failed` gap
 * (R14: never guess a channel vocabulary for an undeclared chart kind).
 */
export interface ViewEncodingDecl {
  readonly viewId: string;
  /** Informational VL/Mosaic mark name (e.g. 'point', 'bar', 'line'). Echoed verbatim, never parsed (R12). */
  readonly chartKind: string;
  /** The channels this view's chart kind accepts (e.g. `['x','y','color']` for a scatter). */
  readonly channels: readonly string[];
  /** The channel→field mapping this view starts with — the session fold's ROOT, before any `reencode` commit. */
  readonly initial?: Readonly<Record<string, string>>;
}

/** R14 honest capability envelope for a view (its adapter may narrow this further at mount). */
export interface CapabilityDecl {
  readonly viewId: string;
  /** Can this view emit selections at all? A `false` here makes every probe a typed `guard-failed` gap. */
  readonly canProbe: boolean;
  /**
   * Which emission kinds it can produce (`'cell'` = the D30 compound —
   * a heatmap declares `['cell']`; `'match'` = the SET-1 many-values select).
   * Default: every kind is allowed. A view that declares `'point'` may also
   * emit `'match'` — a set is a point's plural, never a new capability.
   */
  readonly encodings?: readonly ('point' | 'interval' | 'cell' | 'match')[];
  /** Which data fields it encodes (informational; drives readiness hints). */
  readonly fields?: readonly string[];
}

/** L4 defaults for the session's online-FDR stepper. `gamma` is a developer-authored sequence (optional). */
export interface FdrDecl {
  readonly procedure: 'LORD++' | 'alpha-investing';
  readonly alpha: number;
  readonly w0?: number;
  readonly omega?: number;
  readonly gamma?: GammaSequence;
}

export interface AgentDecl {
  /** Per-verb dual-intent overrides (R11). Absent verbs use {@link DEFAULT_INTENTS}. */
  readonly intents?: readonly IntentDecl[];
}

/**
 * A declared analysis in a def is either a raw {@link AnalysisDef} (promoted via
 * `defineAnalysis` at build time, re-firewalled by L3's `validateAnalysisDef`)
 * or an already-built {@link AnalysisModule} (e.g. the L3 built-ins
 * `clusteringAnalysis(...)` / `correlationAnalysis(...)`, validated at their own
 * construction). SPEC §7's `analyses?: Record<id, AnalysisDef>` is widened to
 * accept both (flagged §7 refinement) — the built-ins are the common case.
 */
export type AnalysisSlot =
  | AnalysisDef<unknown, AnalysisOutput>
  | AnalysisModule<any, AnalysisOutput>; // eslint-disable-line @typescript-eslint/no-explicit-any -- heterogeneous registry; input variance erased at the boundary

/**
 * The declarative dashboard definition — a Mosaic-spec superset (see file
 * header). Offline, no API key; validated by `buildDashboard` (R12).
 */
export interface DashboardDef {
  // ── inherited Mosaic-spec top-level keys (opaque pass-through) ──
  readonly meta?: unknown;
  readonly config?: unknown;
  readonly data: Record<string, DataSourceDef>;
  readonly params?: unknown;
  readonly plotDefaults?: unknown;
  /** The vconcat/hconcat/plot tree (VL encodings). Opaque to vizfootprint. */
  readonly views?: unknown;
  // ── vizfootprint additions ──
  /** Who drives each view (the L2 registry seed). The declared view identities. */
  readonly actors: Record<string, ActorMeta>;
  /** Declared analyses (kind:'test' arms L4; kind:'transform' is FDR-exempt). */
  readonly analyses?: Record<string, AnalysisSlot>;
  /** R14 honest capability envelope, per view. */
  readonly capabilities?: readonly CapabilityDecl[];
  /** Per-view visual-encoding declarations (R14; the `reencode` verb's validation + fold seed). */
  readonly encodings?: readonly ViewEncodingDecl[];
  /** Online-FDR defaults (L4). Absent = LORD++ at alpha 0.05. */
  readonly fdr?: FdrDecl;
  /** Dual-intent tagging overrides for dispatch verbs (R4/R11). */
  readonly agent?: AgentDecl;
  /** The default table `select`/`filter`/`analyze` operate over. Default: the first `data` key. */
  readonly defaultTable?: string;
  /** Layer 4: the declared LINKS between views — what one view's emission does to another (see src/links/README.md). */
  readonly links?: readonly LinkDecl[];
  /** The rule the link graph starts from: `crossfilter` (every view filters every other, self excluded — the default) or `none`. */
  readonly linkDefault?: LinkDefault;
}

// ── The resolved runtime bundle `buildDashboard` produces for a session. ───────

/** A registered analysis with input variance erased at the registry boundary. */
export interface RegisteredAnalysis {
  readonly id: string;
  readonly kind: AnalysisKind;
  readonly def: AnalysisDef<unknown, AnalysisOutput>;
  run(input: readonly Row[], opts?: RunAnalysisOptions): Promise<AnalysisRunResult<AnalysisOutput>>;
}

/** One declared view: its actor identity + resolved capability envelope. */
export interface ViewDecl {
  readonly viewId: string;
  readonly meta: ActorMeta;
  readonly capability?: CapabilityDecl;
  /** This view's declared encoding surface (chart kind + valid channels + initial mapping), if any. */
  readonly encoding?: ViewEncodingDecl;
}

/** The minimal online-FDR stepper contract a session drives (uniform over both procedures). */
export interface FdrStepper {
  step(h: HypothesisRecord): FdrStep;
}

/**
 * The resolved bundle a `Dashboard` hands each session: data providers, promoted
 * analyses, declared views, a fresh-per-session FDR stepper factory, and the
 * dual-intent resolver. Engine choice is already resolved (D24) — the session
 * never re-decides an engine.
 */
export interface DashboardRuntime {
  readonly def: DashboardDef;
  readonly defaultTable: string;
  readonly tables: readonly string[];
  providerFor(table: string): DataProvider | undefined;
  readonly engines: Readonly<Record<string, Engine>>; // resolved engine per table (D24 audit)
  readonly analyses: ReadonlyMap<string, RegisteredAnalysis>;
  readonly views: ReadonlyMap<string, ViewDecl>;
  /** Layer 4: the MATERIALIZED link graph — the default rule written out as edges, declared edges overriding in place. */
  readonly links: LinkGraph;
  makeFdrStepper(): FdrStepper;
  readonly fdrProcedure: 'LORD++' | 'alpha-investing';
  readonly fdrAlpha: number;
  intentOf(verb: DispatchVerb): IntentClass;
}

// Re-exports the def layer commonly hands onward.
export type { Actor, ActorMeta, Cause, ColumnInfo, Row };
