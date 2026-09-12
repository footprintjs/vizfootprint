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
import type { RefreshRecord } from './buildDashboard.js';
import type { EmissionKind, LinkDecl, LinkDefault, LinkGraph } from '../links/types.js';
import type { ColumnDecl, EncodingPorts, EncodingRules } from '../encoding/types.js';
import type { ProseDecl } from '../prose/types.js';
import type { SourceDecl, SourceInfo } from '../source/types.js';
import type { ActorMeta } from '../selection/index.js';
import type {
  AnalysisDef,
  AnalysisKind,
  AnalysisModule,
  AnalysisOutput,
  AnalysisRunResult,
  RunAnalysisOptions,
} from '../analysis/index.js';
import type { BuiltinAnalysisDecl } from './builtinAnalyses.js';
import type { FdrStep, GammaSequence, HypothesisRecord } from '../fdr/index.js';
import type { ColumnFacet, ColumnInfo, DataProvider, DerivedColumnStore, DerivedTable, DerivedTableStore, Engine, LandedColumns, Row } from '../data/index.js';

// ── The dispatch verb vocabulary (SPEC §9; Q6 — the 7-verb set was INCOMPLETE:
// changing a view's visual encoding is a state-changing transition too, not an
// optional-interaction affordance — docs/RESEARCH_STATE.md Q6/D-note). ────────

/** The ten semantic verbs the agent drives every interaction through (R4) — `link` edits the link graph, `describe` a view's words (layer 4). */
export type DispatchVerb =
  | 'select'
  | 'filter'
  | 'annotate'
  | 'navigate'
  | 'analyze'
  | 'fork'
  | 'bookmark'
  | 'reencode'
  | 'link'
  | 'describe';

/** The ten verbs, frozen (used for validation + tool-schema enumeration). `link` (layer 4) edits the graph, not a data view. */
export const DISPATCH_VERBS: readonly DispatchVerb[] = [
  'select',
  'filter',
  'annotate',
  'navigate',
  'analyze',
  'fork',
  'bookmark',
  'reencode',
  'link',
  'describe',
] as const;

/**
 * Dual intent (D13 / R11): a verb is either **mandatory-analytical** (must be
 * honored or a gap is filed) or **optional-interaction** (best-effort UI
 * affordance). Per SPEC §7 the defaults are: `analyze` mandatory-analytical;
 * `annotate`/`navigate` optional-interaction; the state-changing analytical
 * verbs (`select`/`filter`/`fork`/`bookmark`) mandatory-analytical.
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
  bookmark: 'mandatory-analytical',
  // reencode changes what a view SHOWS, not just what it highlights — a
  // state-changing transition (the orchestrator ruling), same class as
  // select/filter/fork/bookmark: must be honored or filed as a typed gap.
  reencode: 'mandatory-analytical',
  // link changes what FILTERS what — the graph itself — so it is state-changing like reencode.
  link: 'mandatory-analytical',
  // describe changes what a view SAYS — the same class as reencode changing what it shows (never the inert annotate).
  describe: 'mandatory-analytical',
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
   *
   * A LIST when silence belongs to a column and not to the row: a
   * `measurements` table whose radius was measured, whose mass is a published
   * bound and whose period was never taken has three state columns, each
   * naming the value columns it `governs`. One reading answers all of them
   * (`../data/silence.ts` · `silenceOfDecl`), and every reader asks that.
   */
  readonly absence?: AbsenceDecl | readonly AbsenceDecl[];
  /**
   * What the caller STATES about its columns for the encoding plane — a role
   * (`identifier | dimension | measure`), a scale, a label. The absence
   * column's role is derived from `absence`; everything else is declared or
   * absent, never guessed (see src/encoding/README.md).
   */
  readonly columns?: Readonly<Record<string, ColumnDecl>>;
  /**
   * Where the rows come from, as three tags (see src/source/README.md):
   * `format` (rows | csv | json), `via` (inline | file | http), `at`. Mutually
   * exclusive with `rows` / `csv`, which say `{ format, via: 'inline' }` the
   * short way. A non-inline source needs `buildDashboardAsync`.
   */
  readonly source?: SourceDecl;
  /**
   * The row identity column, if the table has one. With it a refresh can say
   * what was added, updated and removed; without it a refreshed table is
   * "replaced" and nothing is guessed (the no-row-key law).
   */
  readonly key?: string;
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
 * THE VOCABULARY IS THE DEFINITION'S, both anchors included. The two words
 * every reader has an opinion about — the one that means "reported" and the
 * one that means "could not tell" — are the definition's to name
 * ({@link AbsenceDecl.present}, {@link AbsenceDecl.unknown}); the library's
 * words ({@link ABSENCE_PRESENT}, {@link ABSENCE_UNKNOWN}) are the DEFAULT,
 * never the requirement. A source whose own word is `final` or `measured` is
 * not rewritten in ETL to say `present`. A definition naming neither is
 * byte-identical to one written before the two keys existed.
 *
 * Inert declarative data (R12): strings echoed verbatim, never parsed.
 */
export interface AbsenceDecl {
  /** The column that carries the state. */
  readonly field: string;
  /**
   * The vocabulary that column may hold. MUST include this definition's word
   * for "reported" ({@link AbsenceDecl.present}, `present` by default) and its
   * word for "could not tell" ({@link AbsenceDecl.unknown}, `unknown` by default).
   */
  readonly states: readonly string[];
  /**
   * This definition's OWN word for a row that reported a value. Default
   * {@link ABSENCE_PRESENT} (`'present'`).
   *
   * Every reader that asks "did the source report anything?" — the arithmetic
   * (`../derive/walk.ts`), the contradiction check
   * (`../data/absenceContradiction.ts`), `arithmetic: 'present-only'` — reads
   * THIS word through the port (`../data/silence.ts` · `ColumnSilence.present`),
   * never the library's constant. It must be one of `states`, and `carries` may
   * not name it (a row that reported its value is not a silence that carries one).
   *
   * ```ts
   * { field: 'demand_state', present: 'final', unknown: 'unclear', states: ['final', 'estimated', 'unclear'] }
   * ```
   */
  readonly present?: string;
  /**
   * This definition's OWN word for a silence the source could not tell apart.
   * Default {@link ABSENCE_UNKNOWN} (`'unknown'`).
   *
   * It is still the honest state and still REQUIRED in `states`; it still may
   * never carry a value (`carries` may not name it), and it may not be the same
   * word as {@link AbsenceDecl.present}. Same example as above.
   */
  readonly unknown?: string;
  /**
   * Which of those states CARRY a number, besides `present` — because an
   * estimated figure is a figure, and a replaced one is the number the agency
   * published beside the one that was filed. Default NONE: a declaration that
   * says nothing says what every declaration said before this key existed —
   * every state but `present` is a silence.
   *
   * It is read by ONE thing: the contradiction check
   * (`../data/absenceContradiction.ts`), which refuses a table whose SILENT row
   * holds a number. A state named here is not silent, so its number is not a
   * contradiction. It does NOT by itself move the arithmetic: the walker
   * (`../derive/walk.ts`) reads exactly `present` unless this entry also says
   * {@link AbsenceDecl.arithmetic} — because "the source put a number here"
   * and "the arithmetic may add it" are two different questions and only the
   * source can answer the first.
   *
   * The definition's `present` word may not be named again (it is not a
   * silence to begin with) and its `unknown` word may never be named at all: it
   * is the word for a silence the source could not tell apart, and a vocabulary
   * that let it hold a value would have no honest word left.
   *
   * ```ts
   * { field: 'demand_state', states: ['present', 'estimated', 'replaced', 'unavailable', 'unknown'], carries: ['estimated', 'replaced'] }
   * ```
   */
  readonly carries?: readonly string[];
  /**
   * The VALUE columns this state column speaks for.
   *
   * ABSENT keeps the meaning this declaration always had: every OTHER column of
   * the table. Named, it speaks for exactly those columns and no others — which
   * is how one table carries three silences (a measured radius, a bounded mass,
   * a period never taken).
   *
   * In the LIST form an entry MUST name it: two entries each claiming "every
   * other column" are two answers to one question, and the def door refuses
   * that rather than pick. One column may be governed by one entry only, and an
   * entry may not govern its own state column (which speaks for itself).
   *
   * ```ts
   * { field: 'radius_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_rade'] }
   * ```
   */
  readonly governs?: readonly string[];
  /**
   * Whether the ARITHMETIC reads a number a silent state carries. Default
   * `'present-only'`.
   *
   * `'present-only'` reads exactly this definition's `present` word — every
   * total this library has ever computed. `'carried'` opts THIS entry's columns in: a state named in
   * {@link AbsenceDecl.carries} reads as the number its cell holds, so a
   * published bound lands in the sum.
   *
   * It is per entry and never global, because a global switch would silently
   * move every total already computed. A dashboard that wants published
   * estimates inside its sums declares it here, where a reader can see it
   * (`../derive/README.md` states the law).
   *
   * ```ts
   * { field: 'radius_state', states: ['present', 'upper-bound', 'unknown'], carries: ['upper-bound'], governs: ['pl_rade'], arithmetic: 'carried' }
   * ```
   */
  readonly arithmetic?: 'present-only' | 'carried';
}

/**
 * The canonical absence vocabulary; a table may declare a subset, or its own
 * words for the SILENCES — and, since the two anchors became the definition's
 * ({@link AbsenceDecl.present}, {@link AbsenceDecl.unknown}), its own words for
 * those too. What it must be able to say is ITS word for "reported" and ITS
 * word for "could not tell", and the validator refuses a vocabulary that cannot.
 */
export const ABSENCE_STATES: readonly string[] = Object.freeze(['present', 'not-configured', 'unavailable', 'unknown']);
/**
 * THE DEFAULT word for a row that reported a value — what a definition means
 * when it names no {@link AbsenceDecl.present} of its own, and nothing else.
 * No reader compares to this constant: the adapter (`../data/silence.ts` ·
 * `silenceOfDecl`) fills `ColumnSilence.present` from the declaration or from
 * here, and every reader reads the port.
 */
export const ABSENCE_PRESENT = 'present';
/**
 * THE DEFAULT word for a silence the source could not tell apart — what a
 * definition means when it names no {@link AbsenceDecl.unknown} of its own.
 * Filled onto `ColumnSilence.unknown` the same way; the validator reads the
 * definition's word, never this one.
 */
export const ABSENCE_UNKNOWN = 'unknown';

/**
 * The magnitude channels — owned by the encoding plane (src/encoding), re-exported
 * here because the def is where the absence law is first felt.
 */
export { MAGNITUDE_CHANNELS } from '../encoding/types.js';

/**
 * One view's declared VISUAL-ENCODING surface (the `reencode` verb's
 * validation + fold seed; D10 VL vocab). NOT to be confused with
 * `CapabilityDecl.encodings` / `ChartEncoding` (`selection/emission.ts`) — those
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
  /**
   * The view's layers, when it draws more than one table on one frame (a
   * node-link: edges under nodes). Each layer names ITS table; an act on a
   * layer lands under the address `viewId~layerId` (`./layerAddress.ts`).
   * A view with no layers is exactly what it was before layers existed.
   */
  readonly layers?: readonly LayerDecl[];
  /**
   * THE FRAME: per CHANNEL, how its scale is resolved across the layers
   * (`./README.md`, "The frame"). Keyed by channel name — `{ y: { mode:
   * 'shared' }, color: { mode: 'independent' } }`.
   *
   * A channel the frame does not name is `shared / union / table / merged` —
   * Wickham's default, because "scales are common across layers" is what makes
   * a stack of layers ONE picture.
   *
   * A LAYERLESS VIEW MAY DECLARE ONE TOO, and this is the law: **a transform is
   * not a resolution, and the frame owns both.** Whether an axis is linear or
   * logarithmic has nothing to do with layers — a plain scatter of mass against
   * radius needs it exactly as much as a stack does — so the frame is legal on
   * any view and the refusal narrows to the one key that needs layers: `mode`,
   * refused by name on a view with no layers (`shared` versus `independent` is
   * meaningless with one layer), while `transform` and `zero` are legal there.
   * NO SECOND TYPE IS MINTED: a layerless frame entry is the same
   * {@link ChannelResolution}, judged with `mode` refused, and the view itself
   * is judged as its own one implicit layer (`./layers.ts`, `validateFrame`).
   */
  readonly frame?: Readonly<Record<string, ChannelResolution>>;
}

/**
 * HOW ONE CHANNEL'S SCALE IS RESOLVED ACROSS A VIEW'S LAYERS — the frame's
 * half of "layers on one frame".
 *
 * A view is an ordered stack of LAYERS over ONE FRAME, and the frame owns the
 * scales, the axes and the legends. Per channel it declares a RESOLUTION and
 * nothing else:
 *
 * - `mode: 'shared'` — one domain folded across every layer that binds the
 *   channel, so equal values sit at equal pixels in every layer.
 * - `mode: 'independent'` — each layer keeps its own scale, and each draws its
 *   own guide. Never available on the quantitative channel of a `bar`,
 *   `histogram` or `boxplot`: a bar measured against a second axis is a lie
 *   about its own height.
 *
 * **No hand-typed domain exists in this type.** `domain: 'union'` is a WORD;
 * the numbers are folded from the rows by `frameDomains`
 * (`vizfootprint/def` — the door that re-exports the encoding plane,
 * PACKAGING.md, Law 1) at every update, so an axis can never disagree
 * with the data under it.
 *
 * ```ts
 * frame: {
 *   x: { mode: 'shared', basis: 'table' },   // the axis does not move when a filter elsewhere lands
 *   y: { mode: 'shared', zero: true },       // one zero policy for the whole stack
 *   color: { mode: 'independent' },          // each layer legends its own categories
 * }
 * ```
 */
export type ChannelResolution =
  | {
      readonly mode: 'shared';
      /** The only fold there is — a word, never numbers. Default `'union'`. */
      readonly domain?: 'union';
      /**
       * WHICH ROWS the domain is folded over. `'table'` (the default) = the
       * table's rows at the cursor, so a filter elsewhere does not move the
       * axis (vgplot's `Fixed`); `'rows'` = only the rows this frame draws, so
       * the axis breathes with every selection.
       */
      readonly basis?: 'table' | 'rows';
      /**
       * `'merged'` (the default) = ONE axis/legend for the stack, drawn by the
       * frame; `'per-layer'` = the frame folds one domain but each layer still
       * draws its own guide.
       */
      readonly guide?: 'merged' | 'per-layer';
      /**
       * Extend the folded domain to include 0. One policy for the whole
       * channel — a stack cannot have two. Absent means the kinds decide:
       * a `bar` / `histogram` / `boxplot` layer anchors its magnitude channel
       * at zero, anything else takes the data's own union (`zeroPolicyFor`,
       * `vizfootprint/def` — the one owner of that default).
       */
      readonly zero?: boolean;
      /**
       * LINEAR OR LOGARITHMIC — the axis's own nature, and the frame is where
       * it is said. Default `'linear'`.
       *
       * NOT a `ColumnScale` (`../data/types.ts`, `'discrete' | 'continuous'`):
       * that is the COLUMN's nature, and the same column is drawn linear on one
       * chart and logarithmic on another. NOT a second per-channel block on the
       * encoding declaration either — an axis has ONE owner, and `zero` already
       * lives here.
       *
       * `'log'` is refused with `zero: true` (a logarithmic axis has no zero),
       * on a channel whose bound column is not a number, and on the MAGNITUDE
       * channel of a `bar`/`histogram`/`boxplot` — a bar's length IS its
       * quantity, and on a log axis a bar four times as long is not four times
       * the value. A POSITION channel of those marks may still be logarithmic
       * (a histogram of log-spaced bins is legitimate). The cells a logarithm
       * cannot place — a zero, a negative — are DATA, not declaration, so they
       * are excluded and COUNTED by the fold (`ResolvedDomain.excluded`), never
       * refused at the door and never silently dropped.
       */
      readonly transform?: 'linear' | 'log';
    }
  | {
      readonly mode: 'independent';
      /** Only `'per-layer'` is meaningful: there is no merged guide for scales that disagree. */
      readonly guide?: 'per-layer';
      /** Linear or logarithmic — each layer's own scale is still an AXIS, so it is said here too. Default `'linear'`. */
      readonly transform?: 'linear' | 'log';
    }
  | {
      /**
       * THE AXIS ALONE — the arm a view with NO LAYERS declares: every key the
       * axis has and no `mode`, because `shared` versus `independent` is a
       * question about layers and there are none (the validator refuses a
       * `mode` here by name). It is an ARM of this same union rather than a
       * type of its own, so `transform` and `zero` are declared and read
       * identically whether or not the view has layers, and the FOLD reads it
       * as shared (`resolutionFor`, `../encoding/frame.ts`).
       *
       * A LAYERED view may not use this arm — a resolution with no mode is
       * refused at the door, which TypeScript cannot tell apart because
       * whether layers exist is a fact about a sibling key.
       */
      readonly mode?: undefined;
      readonly domain?: 'union';
      readonly basis?: 'table' | 'rows';
      readonly guide?: 'merged' | 'per-layer';
      readonly zero?: boolean;
      readonly transform?: 'linear' | 'log';
    };

/**
 * One layer of a view — the same encoding surface a view declares, plus the
 * table it reads. `table` is required: a layer exists to name one. Its
 * `channels` and `initial` are judged by the encoding rules against THAT
 * table's columns, never the default table's. `label` is prose for the
 * layer's actor meta; `layerId` may not wear the layer marker.
 */
export interface LayerDecl {
  readonly layerId: string;
  readonly table: string;
  /** Informational mark name, echoed verbatim (the view-level `chartKind` precedent). */
  readonly chartKind: string;
  readonly channels: readonly string[];
  readonly initial?: Readonly<Record<string, string>>;
  readonly label?: string;
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
   *
   * Spelled `EmissionKind` rather than a literal union, and so is
   * {@link AdapterCapabilities.encodings}: one idea, one declaration. The
   * literal restatement here and in the session's twin drifted — the twin
   * never gained `'match'` — while `voiceOf`, the one reader of both, had
   * always typed it as the full set.
   */
  readonly encodings?: readonly EmissionKind[];
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
 * A declared analysis in a def is one of THREE forms, discriminated on shape,
 * never guessed at:
 *
 *   - a `run` function  ⇒ an already-built {@link AnalysisModule} (e.g. the L3
 *     built-ins `clusteringAnalysis(...)`), validated at its own construction;
 *   - a `build` function ⇒ a raw {@link AnalysisDef}, promoted via
 *     `defineAnalysis` at build time and re-firewalled by `validateAnalysisDef`;
 *   - a `builtin` name  ⇒ a {@link BuiltinAnalysisDecl} — the factory's own
 *     options AS DATA (`{ builtin: 'groupBy', by: 'disease', measure: 'cases' }`),
 *     resolved to the factory at registration.
 *
 * Anything else is refused in a sentence. SPEC §7's
 * `analyses?: Record<id, AnalysisDef>` is widened to accept all three (flagged
 * §7 refinement).
 *
 * The third form is what makes a def SERIALISABLE: every other key of a
 * `DashboardDef` is already data, so a definition whose analyses are all
 * builtin records — and which declares no `fdr.gamma` — survives
 * `JSON.parse(JSON.stringify(def))` intact, and can be authored by something
 * that cannot write TypeScript. See src/def/README.md.
 */
export type AnalysisSlot =
  | AnalysisDef<unknown, AnalysisOutput>
  | AnalysisModule<any, AnalysisOutput> // eslint-disable-line @typescript-eslint/no-explicit-any -- heterogeneous registry; input variance erased at the boundary
  | BuiltinAnalysisDecl;

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
  /** Layer 4: each view's GRAIN — the group keys its marks stand for (`[]` = one mark per row); an edge that crosses grains must state its `fold`. */
  readonly grains?: readonly GrainDecl[];
  /** Layer 4: the declared LINKS between views — what one view's emission does to another (see src/links/README.md). */
  readonly links?: readonly LinkDecl[];
  /** The rule the link graph starts from: `crossfilter` (every view filters every other, self excluded — the default) or `none`. */
  readonly linkDefault?: LinkDefault;
  /**
   * The RELATIONS between tables: a column of one table points at the declared
   * `key` of another (see {@link RelationDecl} and src/def/README.md,
   * "Relations"). Data on the map — the overview echoes them; a session acts
   * on them in three places: an analysis reads across one (law 6), a
   * `neighbourhood` walks a pair (law 7), and a clause TRAVELS one to a view
   * whose table lacks its column (`../session/README.md`, "A clause travels
   * a relation").
   */
  readonly relations?: readonly RelationDecl[];
  /** The encoding plane's rule set as data: channel requirements per chart kind, business rules, and the policy (see src/encoding/README.md). */
  readonly encodingRules?: EncodingRules;
  /** The prose plane: a view's words — title, caption, alt text, how to read it — as records with an author, a level of claim and a basis (see src/prose/README.md). */
  readonly prose?: readonly ProseDecl[];
}

// ── The resolved runtime bundle `buildDashboard` produces for a session. ───────

/** A registered analysis with input variance erased at the registry boundary. */
export interface RegisteredAnalysis {
  readonly id: string;
  readonly kind: AnalysisKind;
  readonly def: AnalysisDef<unknown, AnalysisOutput>;
  run(input: readonly Row[], opts?: RunAnalysisOptions): Promise<AnalysisRunResult<AnalysisOutput>>;
  /**
   * The builtin RECORD this analysis was built from, when it was built from one
   * — and absent for the other two forms, which are code.
   *
   * It is here so an act can carry its own declaration onto the trace: a record
   * is data, so a commit can hold it and a replay can rebuild the analysis from
   * bytes alone (`../session/README.md`, law 6). A module or a raw def cannot
   * ride, which is not a policy but a fact about functions.
   */
  readonly record?: BuiltinAnalysisDecl;
}

/** One declared view: its actor identity + resolved capability envelope. */
/** A view's grain, declared: the group keys its marks aggregate over (`[]` = rows). */
export interface GrainDecl {
  readonly viewId: string;
  readonly keys: readonly string[];
}

// ── Relations: edges between TABLES (the link graph is edges between VIEWS). ──

/** The two cardinalities a relation may declare. Declared, never inferred from the rows. */
export const RELATION_KINDS = ['many-to-one', 'one-to-one'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** One end of a relation: a column of a declared table. */
export interface RelationEnd {
  readonly table: string;
  readonly column: string;
}

/**
 * A relation points at an IDENTITY: `to.column` must be the declared
 * `data[to.table].key`, and `from.column` a column of `from.table`. `kind`
 * defaults to `many-to-one`; `label` is prose, inert. Validated by
 * `./relations.ts`; the laws with an example each are in `./README.md`.
 */
export interface RelationDecl {
  readonly from: RelationEnd;
  readonly to: RelationEnd;
  readonly kind?: RelationKind;
  readonly label?: string;
}

/**
 * A relation as the RUNTIME holds it: the declaration with its `kind` written
 * out (the `LinkDecl` → `LinkEdge` precedent), so a reader of the runtime or
 * the overview never re-derives the default the def left unsaid.
 */
export interface RelationEdge extends RelationDecl {
  readonly kind: RelationKind;
}

export interface ViewDecl {
  readonly viewId: string;
  readonly meta: ActorMeta;
  readonly capability?: CapabilityDecl;
  /** The view's declared grain (layer 4), if any. */
  readonly grain?: readonly string[];
  /** This view's declared encoding surface (chart kind + valid channels + initial mapping), if any. */
  readonly encoding?: ViewEncodingDecl;
  /**
   * The view's layers, resolved and frozen at build (the list and each
   * declaration) — present only when the def declared them, so a view with
   * none is byte-identical to a view built before layers existed.
   */
  readonly layers?: readonly LayerDecl[];
}

/** The minimal online-FDR stepper contract a session drives (uniform over both procedures). */
export interface FdrStepper {
  step(h: HypothesisRecord): FdrStep;
}

/** One condition of a saved selection: which chart, which field, which test on the value. One per view — a picture names a view once. */
export interface SavedClause {
  readonly viewId: string;
  readonly kind: 'point' | 'interval' | 'match' | 'cell' | 'neighbourhood';
  /** The column (a two-column kind's joint label — the pair rides `fields`). */
  readonly field: string;
  /** The two-column kinds only: a cell's axes, a neighbourhood's two endpoint columns. */
  readonly fields?: readonly [string, string];
  /**
   * JSON-safe: a point's value, an interval's bounds, a match body
   * `{ values, exclude? }`, a cell's two sides, a neighbourhood's whole walk
   * `{ seed, derivation, hops, to?, ids }` — which is what lets applying the
   * picture RE-ASK the walk over today's rows rather than replay yesterday's
   * answer, and re-ask the walk it RECORDED (a picture saved with a path
   * re-walks a path — `../session/wire.ts`, `walkAsked`).
   */
  readonly value: unknown;
}

/**
 * A SAVED SELECTION IS SAVED LOGIC: the whole picture a person had filtered
 * to, written as data — one condition per view — plus who saved it, when, and
 * the data version it was made on. It lives BESIDE the commit log, never in
 * it: naming a picture is not an act on the data, so it lands nothing on the
 * rail. Applying it is the act: one ordinary select or filter commit per
 * condition, all under one cause ("applied saved selection <name>") and one
 * correlation id, on any branch, after a fresh start, on refreshed rows —
 * each condition is evaluated against whatever rows are there now. `from` is
 * provenance (the commits the conditions were named from), never identity.
 */
export interface SavedSelection {
  /** The store's own short id (`p1`, `p2`, …) — the IDENTITY: what a note's words link, so a rename never breaks a link. */
  readonly id: string;
  readonly name: string;
  readonly conditions: readonly SavedClause[];
  /** Who saved it — the CREATOR, never restamped. */
  readonly by: Actor;
  /** ISO time it was saved — CREATION, never restamped (which is why the list's order is stable). */
  readonly at: string;
  /** Who last renamed it, when anyone has. */
  readonly editedBy?: Actor;
  /** ISO time of that rename. */
  readonly editedAt?: string;
  /** The default table and its data version when it was saved — so a list can say "saved on version 3, applied on version 5". */
  readonly on?: { readonly table: string; readonly version: string | null };
  readonly from?: readonly string[];
}

/** A saved selection as a HOST hands it back (`restoreSaved`): the whole record, its id optional — a store with room for it keeps the id, otherwise the store names it and says so. */
export type RestorableSaved = Omit<SavedSelection, 'id'> & { readonly id?: string };

/**
 * A BOOKMARK IS A NAME ON A MOMENT — a place in the history you want to come
 * back to: the name, the commit it marks, a description, who made it and when.
 * Several bookmarks may sit on one commit; a name points at one moment. A
 * bookmark lives BESIDE the log, never in it: bookmarking lands no commit and
 * starts no branch, saves no state, and a bookmark stays valid on every branch
 * that runs through its commit. Present mode walks the bookmarked moments;
 * seeking a bookmark seeks its commit.
 */
export interface Bookmark {
  /** The store's own short id (`b1`, `b2`, …) — the IDENTITY: what a note's words link, so a rename never breaks a link. */
  readonly id: string;
  readonly name: string;
  readonly commitId: string;
  /** Words for the list — why this moment matters. Inert data, never parsed. */
  readonly description?: string;
  /** Who made the bookmark — the CREATOR, never restamped. */
  readonly by: Actor;
  /** ISO time it was made — CREATION, never restamped (which is why the list's order is stable). */
  readonly at: string;
  /** Who last renamed it or changed its words, when anyone has. */
  readonly editedBy?: Actor;
  /** ISO time of that change. */
  readonly editedAt?: string;
}

/** A bookmark as a HOST hands it back (`restoreBookmarks`): the whole record, its id optional — a store with room for it keeps the id, otherwise the store names it and says so. */
export type RestorableBookmark = Omit<Bookmark, 'id'> & { readonly id?: string };

/** The store: the bookmarks in the order they were made (a mutable list the session's doors write). */
export interface BookmarkStore {
  readonly list: Bookmark[];
  /**
   * The highest number this store has ever handed out (`b7` ⇒ 7). It only
   * goes UP: forgetting a bookmark does not free its number, so a note written at
   * another moment in the history can never be silently re-pointed at a
   * different moment. Restoring raises it too, so a host's `b7` is safe after
   * a restart. Lives on the STORE because the store outlives every session.
   */
  minted: number;
}

/**
 * The commit-id counter. Lives on the dashboard runtime beside the saved and
 * bookmark stores, and for exactly the same reason: those records name commit
 * ids and are shared by every session, so a commit id must be unique per
 * DASHBOARD. A session's own log therefore has gaps in its numbering (session
 * A holds `s1, s3`; session B holds `s2, s4`) — nothing reads an id as a
 * position, so a gap costs nothing. See src/log/README.md, "Law 2".
 */
export interface CommitIdStore {
  /** The highest number this dashboard has ever handed out (`s7` ⇒ 7). It only goes UP. */
  minted: number;
}

/** The store: the saved selections in the order they were saved (a mutable list the session's doors write). */
export interface SavedStore {
  readonly list: SavedSelection[];
  /** The highest number this store has ever handed out (`p7` ⇒ 7) — see {@link BookmarkStore.minted}: a freed number never comes back. */
  minted: number;
}

/**
 * What putting records back did: the names restored, the ones refused with a
 * sentence, and the ones the store had to NAME ITSELF — a record that carried
 * no id, or one whose id another record already holds. An id is never quietly
 * overwritten: if it changed, it is on this list.
 */
export interface RestoreResult {
  readonly restored: readonly string[];
  readonly refused: readonly { readonly name: string; readonly rejected: string }[];
  readonly reidentified: readonly { readonly name: string; readonly id: string; readonly was?: string }[];
}

/**
 * The resolved bundle a `Dashboard` hands each session: data providers, promoted
 * analyses, declared views, a fresh-per-session FDR stepper factory, and the
 * dual-intent resolver. Engine choice is already resolved (D24) — the session
 * never re-decides an engine.
 */
export interface DashboardRuntime {
  readonly def: DashboardDef;
  /** The definition's REVISION — digested once at build, frozen with the def (see `./revision.ts`). What a served answer states it was true of. */
  readonly revision: string;
  /** The session-id counter — one per dashboard, so two sessions on one dashboard can never carry the same id (the {@link CommitIdStore} pattern). */
  readonly sessionIds: { minted: number };
  readonly defaultTable: string;
  readonly tables: readonly string[];
  providerFor(table: string): DataProvider | undefined;
  readonly engines: Readonly<Record<string, Engine>>; // resolved engine per table (D24 audit)
  readonly analyses: ReadonlyMap<string, RegisteredAnalysis>;
  readonly views: ReadonlyMap<string, ViewDecl>;
  /** Layer 4: the MATERIALIZED link graph — the default rule written out as edges, declared edges overriding in place. */
  readonly links: LinkGraph;
  /** The encoding plane: the def's rule set, the ports passed at build, and column → facet resolution per table. */
  readonly encoding: EncodingRuntime;
  /** The prose plane: each view's declared slots (the fold's root before any `describe` commit). */
  readonly prose: ReadonlyMap<string, ProseDecl['slots']>;
  /** The data-source layer: what each declared source vouched for when it was read (absent for `rows` / `csv` tables). */
  readonly sources: Readonly<Record<string, SourceInfo>>;
  /** The data journal: every refresh the dashboard ran, oldest first — a dashboard-level record beside the log, shared by every session. */
  readonly journal: readonly RefreshRecord[];
  /** The saved selections — saved LOGIC beside the log, never in it (see {@link SavedSelection}); shared by every session, like the journal. */
  readonly saved: SavedStore;
  /** The bookmarks — names on moments beside the log (see {@link Bookmark}); shared by every session. */
  readonly bookmarks: BookmarkStore;
  /** The commit-id counter — one per dashboard, so two sessions can never mint the same commit id (see {@link CommitIdStore}). */
  readonly commitIds: CommitIdStore;
  /**
   * Which slots in the table stores hold TRACE-derived columns, and which act
   * made each — dashboard-scoped, because the stores are (see
   * `src/data/README.md`). A session resolves a derived column's name through
   * this at its cursor; every store column NOT registered here is declared
   * source data, and is visible on every branch.
   */
  readonly derived: DerivedColumnStore;
  /**
   * Which table names in this dashboard are DERIVED — an aggregate's landed
   * rows — and what act each belongs to (`src/data/derivedTables.ts`). The
   * columns registry one line up, one level out: a derived TABLE gets a slot
   * per ACT under the same marker, resolved at the cursor, and dropped from
   * view outside the branch that cut it.
   */
  readonly derivedTables: DerivedTableStore;
  /**
   * What the engine LANDED for each declared table — learned once at build and
   * again at each re-land, kept beside the table's version
   * (`src/data/landedColumns.ts`). Read by the session's SYNCHRONOUS judges
   * (`why()`, the overview's `narrowedFor`) where the definition declares no
   * columns; never by a read that must see the engine live. Absent for a table
   * whose engine could not describe it at the landing — omit, never invent.
   */
  readonly landedColumns: LandedColumns;
  /**
   * Land one derived table: mint its provider under the act's own slot and
   * register the act. THE ONE DOOR — a caller never reaches the providers map,
   * so the provider and the registry cannot come to disagree about which
   * slots exist. The rows are the act's own, already detached from the engine
   * that answered.
   */
  landDerivedTable(table: DerivedTable, rows: readonly Row[]): void;
  /** Build notes a def should hear: e.g. which engine `engine: 'auto'` resolved to, and the row count it resolved on. */
  readonly notes: readonly string[];
  /** The declared row key per table (absent = positional rows, no delta). */
  readonly keys: Readonly<Record<string, string>>;
  /** The declared relations between tables, each with its `kind` written out — frozen at build, `[]` when none. */
  readonly relations: readonly RelationEdge[];
  makeFdrStepper(): FdrStepper;
  readonly fdrProcedure: 'LORD++' | 'alpha-investing';
  readonly fdrAlpha: number;
  intentOf(verb: DispatchVerb): IntentClass;
}

/** The encoding plane as a session reads it (see src/encoding/README.md). */
export interface EncodingRuntime {
  readonly rules: EncodingRules;
  readonly ports: EncodingPorts;
  /** The provider's columns of `table` as facets: type + declared role/scale/label + the absence vocabulary. */
  facetsOf(table: string, cols: readonly ColumnInfo[]): ColumnFacet[];
}

// Re-exports the def layer commonly hands onward.
export type { Actor, ActorMeta, Cause, ColumnInfo, Row };
