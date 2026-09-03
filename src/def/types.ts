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
import type { ColumnFacet, ColumnInfo, DataProvider, DerivedColumnStore, Engine, Row } from '../data/index.js';

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
   */
  readonly absence?: AbsenceDecl;
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
 * The magnitude channels — owned by the encoding plane (src/encoding), re-exported
 * here because the def is where the absence law is first felt.
 */
export { MAGNITUDE_CHANNELS } from '../encoding/types.js';

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
  /** Layer 4: each view's GRAIN — the group keys its marks stand for (`[]` = one mark per row); an edge that crosses grains must state its `fold`. */
  readonly grains?: readonly GrainDecl[];
  /** Layer 4: the declared LINKS between views — what one view's emission does to another (see src/links/README.md). */
  readonly links?: readonly LinkDecl[];
  /** The rule the link graph starts from: `crossfilter` (every view filters every other, self excluded — the default) or `none`. */
  readonly linkDefault?: LinkDefault;
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
}

/** One declared view: its actor identity + resolved capability envelope. */
/** A view's grain, declared: the group keys its marks aggregate over (`[]` = rows). */
export interface GrainDecl {
  readonly viewId: string;
  readonly keys: readonly string[];
}

export interface ViewDecl {
  readonly viewId: string;
  readonly meta: ActorMeta;
  readonly capability?: CapabilityDecl;
  /** The view's declared grain (layer 4), if any. */
  readonly grain?: readonly string[];
  /** This view's declared encoding surface (chart kind + valid channels + initial mapping), if any. */
  readonly encoding?: ViewEncodingDecl;
}

/** The minimal online-FDR stepper contract a session drives (uniform over both procedures). */
export interface FdrStepper {
  step(h: HypothesisRecord): FdrStep;
}

/** One condition of a saved selection: which chart, which field, which test on the value. One per view — a picture names a view once. */
export interface SavedClause {
  readonly viewId: string;
  readonly kind: 'point' | 'interval' | 'match' | 'cell';
  /** The column (a cell's joint label — the pair rides `fields`). */
  readonly field: string;
  readonly fields?: readonly [string, string];
  /** JSON-safe: a point's value, an interval's bounds, a match body `{ values, exclude? }`, a cell's two sides. */
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
  /** Build notes a def should hear: e.g. `engine: 'auto'` resolved to memory because the thresholds are unmeasured. */
  readonly notes: readonly string[];
  /** The declared row key per table (absent = positional rows, no delta). */
  readonly keys: Readonly<Record<string, string>>;
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
