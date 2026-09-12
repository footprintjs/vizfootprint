/**
 * `buildDashboard(def)` — the offline, no-API-key entry to the L5 surface
 * (SPEC §7). Validates the def (R12 firewall), resolves each data table's
 * engine (D24), promotes each declared analysis (L3), and returns a
 * {@link Dashboard} whose `createSession()` wires ALL layers into one live
 * {@link InteractionSession}.
 *
 * Engine routing (D24): the def's `data[table].engine` key is routed to the
 * three D24 engines behind the data seam — `memory` (in-JS predicates,
 * always-on), `wasm`/`server` (typed stubs, which answer NO query in this
 * version and say so in a build note), and `auto` (resolved to memory, quoting
 * the guess `chooseEngine` would have made). The INVARIANT (engine choice never
 * changes commit semantics) is inherited from `src/data`: the session speaks
 * only typed clauses, which every engine evaluates identically.
 */

import {
  chooseEngine,
  DerivedColumnStore,
  DerivedTableStore,
  isPairKind,
  isStubEngine,
  memoryProvider,
  serverProvider,
  stubEngineRefusal,
  STUB_ENGINES,
  type DataProvider,
  type DatasetStats,
  type Engine,
  type DerivedTable,
  type ResolvedEngine,
  type Row,
  type RowsInput,
  type SqlConnection,
  type StubEngine,
} from '../data/index.js';
// This build's ONE wasm backend: where a def's bytes meet a SQL connection (./wasmBackend.ts).
import { wasmBackend, wasmBytesOf, wasmRowBytes, type WasmBackend } from './wasmBackend.js';
import { createAlphaInvesting, createLordPlusPlus } from '../fdr/index.js';
import { absenceByTable } from './builtinAnalyses.js';
import { DashboardDefError, validateDashboardDef } from './validate.js';
import { registerAnalysisSlot } from './register.js';
import {
  DEFAULT_INTENTS,
  type CapabilityDecl,
  type DashboardDef,
  type DashboardRuntime,
  type DispatchVerb,
  type FdrStepper,
  type IntentClass,
  type RegisteredAnalysis,
  type RelationEdge,
  type ViewDecl,
  type ViewEncodingDecl,
  type RestorableSaved,
  type RestorableBookmark,
  type RestoreResult,
  type SavedClause,
  type SavedSelection,
  type SavedStore,
  type Bookmark,
  type BookmarkStore,
  type CommitIdStore,
} from './types.js';
import { COMMIT_ID_PREFIX, PICTURE_ID_PREFIX, BOOKMARK_ID_PREFIX, raiseMinted, restoredRecordId } from './recordIds.js';
import { defRevision } from './revision.js';
import { layerLinkViewOf, layerSurfaceOf, ownRowsOf } from './layers.js';
import { tableReachOf } from './tableReach.js';
import { createInteractionSession, type InteractionSession } from '../session/session.js';
import type { SessionOptions } from '../session/types.js';
import { EMISSION_KINDS, materializeLinks, voiceOf } from '../links/index.js';
import { lintEncodings, pageBindings, resolveFacet, resolveFacets } from '../encoding/index.js';
import type { Bindings, EncodingPorts, EncodingProblem, FrameNote } from '../encoding/index.js';
import { frameLint } from '../encoding/index.js';
import { validateProseRecord } from '../prose/index.js';
import type { ProseProblem } from '../prose/index.js';
import { isRejection } from '../data/index.js';
import { DEFAULT_RELATION_KIND } from './relations.js';
import { decodeRows, inlineVersion, isSourceRefusal, isUnchanged, openSource, SourceRefusal } from '../source/index.js';
import type { RefreshDelta, SourceAdapter, SourceDecl, SourceInfo, SourceRefusalReason, SourceSnapshot } from '../source/index.js';
import type { ColumnFacet } from '../data/index.js';
import { deepFreeze } from '../detach/index.js';

/** The offline dashboard handle. `createSession()` opens one live, stateful session. */
export interface Dashboard {
  /** The (frozen) validated def. */
  readonly def: DashboardDef;
  /**
   * WHICH definition this dashboard was built from — digested once, here, and
   * frozen with the def. A served answer carries it as `basis.revision`, and a
   * reader compares it before trusting a part it cached from an earlier build.
   * See `./revision.ts` for what a digest can and cannot cover.
   */
  readonly revision: string;
  /** The resolved engine each table routed to (D24 audit). */
  readonly engines: Readonly<Record<string, Engine>>;
  /** What each declared source vouched for when it was read — the table's provenance. */
  readonly sources: Readonly<Record<string, SourceInfo>>;
  /**
   * Build notes a def should hear, in the order its tables were read: an `auto`
   * engine resolved to memory and why; a table routed to an engine this version
   * does not run, and what that table will say at its first read; a table a host
   * answered with its own provider. Worth reading — a dashboard that builds
   * without a problem can still be one that answers nothing.
   */
  readonly notes: readonly string[];
  /**
   * Re-read every declared source (or the named tables) with the version held:
   * an unchanged source moves nothing; a changed one replaces the table's rows
   * in place — every session sees the new rows on its next query — and reports
   * what changed, exactly when the table declares a row key. Columns an analysis
   * materialised on a replaced table are gone with the old rows: re-run it.
   */
  refresh(tables?: readonly string[]): Promise<RefreshResult>;
  /** The data journal: every refresh this dashboard ran, oldest first (see {@link RefreshRecord}). */
  journal(): readonly RefreshRecord[];
  /** The saved selections — saved logic beside the log (see {@link SavedSelection}); the session's doors write it. */
  saved(): readonly SavedSelection[];
  /** Put saved selections back (a host's persistence): each record whole — name, conditions, who, when, on what — judged, never re-stamped; refused entries are named, and so is any record the store had to give a new id. */
  restoreSaved(list: readonly RestorableSaved[]): RestoreResult;
  /** The bookmarks — names on moments beside the log (see {@link Bookmark}); the session's doors write them. */
  bookmarks(): readonly Bookmark[];
  /** Put bookmarks back whole (a host's persistence) — judged (a name, a commit id, who, when), never re-stamped; refused entries named, and so is any record the store had to give a new id. A session's `restoreBookmarks` also checks the commit is in its log. */
  restoreBookmarks(list: readonly RestorableBookmark[]): RestoreResult;
  /** Judge the data declarations against the real data: that a declared row key, and every relation's source column, names a column the engine lists. Sentences, never thrown. */
  lintData(): Promise<readonly string[]>;
  /** Open a fresh session: one selection port (the built-in unless `opts.selection` hands one in) + commit log + FDR ledger. */
  createSession(opts?: SessionOptions): InteractionSession;
  /**
   * The LINT door of the encoding plane: every declared initial binding judged
   * with the provider's real column types (the build door judged what the def
   * alone could prove). Throws when the default table's provider cannot list
   * its columns (a stub engine) — nothing to judge is not "nothing wrong".
   */
  lint(): Promise<EncodingProblem[]>;
  /** The LINT door of the prose plane: every declared slot judged with the data's real columns and the declared analyses. */
  lintProse(): Promise<ProseProblem[]>;
  /**
   * The LINT door of the FRAME: what a reader will struggle with in a view's
   * stack of layers, said in advice (`frameLint`) rather than refused — more
   * than four layers on one frame is a judgement, not an error.
   *
   * SYNCHRONOUS, unlike the other two: a frame note reads the DEFINITION (how
   * many layers a view stacks), never a column, so there is no provider to ask
   * and nothing to await.
   */
  lintFrames(): readonly FrameNote[];
  /**
   * Release what this BUILD opened: the SQL connection a `wasm` table's bytes
   * were landed in (`./wasmBackend.ts`). Nothing else — a `DataProvider` a host
   * brought and a database a host's own `openSqlConnection` opened stay the
   * host's, on the one law an owner can be read from: whoever opened it closes
   * it.
   *
   * Never throws, and safe to call twice. A dashboard with no wasm table has
   * nothing to close and says so by doing nothing. Sessions opened from this
   * dashboard read through that connection, so close it when the last of them
   * is done — a read after it is refused by the engine's own words.
   */
  close(): Promise<void>;
}

/** One table's answer to a refresh. */
export type RefreshOutcome =
  | { readonly unchanged: true; readonly version: string }
  | {
      readonly changed: true;
      readonly from: string;
      readonly to: string;
      readonly retrievedAt: string;
      readonly rows: number;
      readonly delta: RefreshDelta;
      /** Columns an analysis had materialised on the old rows, gone with them — re-run the analysis. */
      readonly materialisedLost?: readonly string[];
      /**
       * Derived TABLES an aggregate had cut from the old rows, gone with them —
       * and every table cut from those in turn. Reported by the names a person
       * knows, like `materialisedLost`, and for its reason: a table whose
       * parent moved cannot be replayed from its record against the new bytes
       * and still claim the version it was cut from.
       */
      readonly derivedLost?: readonly string[];
    }
  | {
      readonly refused: true;
      /**
       * Why nothing moved: the carrier's own reason, `no-source` (nothing to
       * re-read), or `not-reloadable` (there IS a source and it was read, but
       * the table's engine could not re-land the rows: it has no `replaceRows`
       * at all — a stub — or its backend refused the act, in the engine's own
       * words; see `refresh`).
       */
      readonly reason: SourceRefusalReason | 'no-source' | 'not-reloadable';
      readonly message: string;
    };

export interface RefreshResult {
  readonly tables: Readonly<Record<string, RefreshOutcome>>;
}

/**
 * One refresh as the DATA JOURNAL keeps it: a dashboard-level act (a refresh
 * swaps a table's rows for every session at once, so it is never a branch-scoped
 * commit), with when it ran and what every table answered. The journal lives
 * beside the commit log; `Overview.journal` serves it to every session.
 */
export interface RefreshRecord {
  /** When the refresh ran (ISO). */
  readonly at: string;
  /** The tables asked, in the order asked — every table when none was named. */
  readonly asked: readonly string[];
  readonly tables: Readonly<Record<string, RefreshOutcome>>;
}

/** The async builder's options: the source adapters the host brought (`inline` is always known). */
export interface BuildDashboardAsyncOptions extends BuildDashboardOptions {
  readonly sources?: readonly SourceAdapter[];
}

/** What a host brings to a build that the def cannot carry: the engines it has, the encoding plane's ports, and its own providers. */
export interface BuildDashboardOptions {
  /**
   * Engines the host says this environment has. It bounds ONE thing — the guess
   * `auto` quotes — and it is documented that narrowly because it kept nothing
   * else: an explicit `engine` is honoured whether or not it is listed here (a
   * declared `wasm` or `server` routes to that engine's typed stub, and the
   * build note says what that table will answer), and `auto` resolves to memory
   * either way, until a measured bench exists.
   *
   * Naming NONE (`[]`) is refused at the door, because `[]` is not "unset": it
   * survives the default and leaves `auto` with nothing to resolve at all.
   */
  readonly availableEngines?: readonly ResolvedEngine[];
  /**
   * How the WASM engine's SQL backend is opened, for a def that declares one.
   * Omitted, it is `duckdbConnection()` — DuckDB-WASM in a browser, imported
   * dynamically by the read that finally needs it.
   *
   * ONE connection serves every wasm table in the build (they have to be able to
   * see each other), it is opened at most once, and a build with no wasm table
   * never calls this at all.
   */
  readonly openSqlConnection?: () => Promise<SqlConnection>;
  /** The encoding plane's PORTS — explainer, coercers, recommender (code, so never on the def; see src/encoding/README.md). */
  readonly encoding?: EncodingPorts;
  /**
   * THE ENGINE SEAM: the {@link DataProvider} a named table runs on, brought by
   * the host instead of built from the def. One entry per table; a table not
   * named here is built exactly as it always was, so the default behaviour with
   * this option absent is unchanged.
   *
   * It exists for two reasons, and they are the same reason twice.
   *
   * **A failing engine has to be testable through a door.** `DataProvider` is a
   * port, and a real one behind it — a wasm build, an HTTP backend — can throw
   * where the memory engine never does. The session's answer to that is a typed
   * `effect-failed` gap and an act that still stands
   * (`src/session/README.md`, law 1, rule 3), which is a real behaviour with a
   * real test. That test used to reach `session.runtime.providerFor('data')`
   * through a cast, because there was no seam: it asserted a public behaviour
   * by going around the public surface, and nothing would have told it if the
   * shape it reached through had moved.
   *
   * **A host may bring its own engine.** A DuckDB connection, a warehouse
   * client, a fixture — anything that answers the port — without forking the
   * resolver or declaring a fictional `engine` on the def.
   *
   * Judged at BUILD time like every other declaration, never at first query: a
   * key naming no declared table, a value that does not answer the port, or a
   * table that also declares a `source` (two answers to where its rows come
   * from) is a {@link DashboardDefError} in a sentence. `dashboard.engines`
   * reports the engine the PROVIDER names itself (that is the D24 audit's
   * question — what answers this table — and the port already carries the
   * answer), and `dashboard.notes` carries the sentence saying the def's own
   * routing was never built, so the audit never claims an engine was built
   * that was not.
   */
  readonly providers?: Readonly<Record<string, DataProvider>>;
}

/** The port's four methods — a provider that misses one cannot answer a query. */
const PROVIDER_METHODS = ['tables', 'columns', 'evaluate', 'materializeColumn'] as const;
/**
 * …and the one data field the audit reads back: which engine the host's provider IS.
 * The two that ANSWER, then the `src/data/stubEngines.ts` names — that second half is
 * never hand-typed, so the day an engine starts answering it leaves this list by
 * leaving that one (`wasm` did exactly that in D24 build step 2).
 */
const RESOLVED_ENGINES: readonly ResolvedEngine[] = ['memory', 'wasm', ...STUB_ENGINES];

/**
 * Judge {@link BuildDashboardOptions.providers} against the def, before a
 * single table is built. Returns the sentences, in the order the keys were
 * given — never throws, so both builders raise them the one way they raise
 * every other def problem.
 */
function judgeProviders(def: DashboardDef, supplied: BuildDashboardOptions['providers']): string[] {
  if (supplied === undefined) return [];
  const problems: string[] = [];
  const declared = Object.keys(def.data);
  for (const [table, provider] of Object.entries(supplied)) {
    if (!Object.prototype.hasOwnProperty.call(def.data, table)) {
      problems.push(`providers["${table}"] names no declared table — the tables are ${declared.join(', ')}`);
      continue;
    }
    if (provider === null || typeof provider !== 'object') {
      problems.push(`providers["${table}"] is not a DataProvider — it must be an object with ${PROVIDER_METHODS.join(', ')}`);
      continue;
    }
    const missing = PROVIDER_METHODS.filter((m) => typeof (provider as unknown as Record<string, unknown>)[m] !== 'function');
    if (missing.length > 0) {
      problems.push(`providers["${table}"] does not answer the DataProvider port — it is missing ${missing.join(', ')}`);
      continue;
    }
    // `engine` is not decoration: it is what `dashboard.engines` reports for
    // this table, so a provider that will not name itself leaves the audit
    // saying something nobody wrote.
    if (!RESOLVED_ENGINES.includes(provider.engine)) {
      problems.push(`providers["${table}"].engine is "${String(provider.engine)}" — a DataProvider names which engine it is, one of ${RESOLVED_ENGINES.join(', ')}`);
      continue;
    }
    // the port's sixth member, judged on the same WHY as `engine`: the session
    // reads `capabilities.canSort` before every sorted window, so a provider
    // that will not declare them leaves it dereferencing nothing at first query
    const caps = (provider as unknown as Record<string, unknown>).capabilities;
    if (caps === null || typeof caps !== 'object') {
      problems.push(`providers["${table}"] declares no capabilities — a DataProvider says what it can do (canEvaluateSQL, canMaterialize, canSort), and the session reads it before every sorted window`);
      continue;
    }
    if (def.data[table]!.source !== undefined) {
      problems.push(`providers["${table}"] brings its own rows, and data["${table}"] declares a source — a table's rows come from one place; drop one of them`);
    }
  }
  return problems;
}

/**
 * …and the host option that can be EMPTY. `[]` is not `undefined`: it survives
 * the default, reaches `chooseEngine` with nothing at or above the picked tier,
 * and aborts the whole build with a `RangeError` from a module the caller never
 * named — for a guess that is only quoted in a note. Judged here instead, in the
 * same sentence shape every other bad option gets.
 */
function judgeAvailableEngines(available: readonly ResolvedEngine[] | undefined): string[] {
  return available !== undefined && available.length === 0
    ? [`availableEngines is [] — name at least one engine (${RESOLVED_ENGINES.join(', ')}), or omit it to mean ${DEFAULT_AVAILABLE.join(', ')}`]
    : [];
}

/** The note a host-supplied table owes the audit: the def routed it somewhere nothing was built. */
const hostProviderNote = (table: string, host: ResolvedEngine, declared: Engine): string =>
  `data["${table}"]: the host supplied its own "${host}" provider — the declared engine "${declared}" was not built`;

/** …and the note a table routed to an engine THIS VERSION DOES NOT RUN owes it: the read-time refusal, word for word, heard at the door instead. */
const stubEngineNote = (table: string, engine: StubEngine): string => `data["${table}"]: ${stubEngineRefusal(engine, table)}`;

/**
 * …and the note the engine that DOES run owes THIS door: landing bytes in a SQL
 * backend is an await, and this door has none to spend. The table is built lazy —
 * the connection opens and the bytes land on the first read that needs an answer
 * (`./wasmBackend.ts`) — and the author hears at BUILD which read will pay for it.
 */
const wasmLazyNote = (table: string): string =>
  `data["${table}"]: the "wasm" engine holds this table lazily — a sync build cannot await a load, so the SQL connection opens and its bytes land on the first read; build with buildDashboardAsync to have them landed before the dashboard is returned`;

/** …and the note a table owes when its bytes DID NOT land: the read-time refusal, word for word, heard at the door instead. */
const wasmFailedNote = (table: string, failed: string): string => `data["${table}"]: ${failed}`;

const DEFAULT_AVAILABLE: readonly ResolvedEngine[] = ['memory'];

function rowsInputOf(source: { rows?: readonly unknown[]; csv?: string }): RowsInput {
  return source.csv !== undefined ? source.csv : ((/* v8 ignore next -- rows is guaranteed defined here by the R12 firewall (rows XOR csv); unreachable via buildDashboard's public entry */ source.rows ?? []) as RowsInput);
}

/**
 * A dataset's stats WITH the one field this door always knows.
 *
 * WHY the intersection: `statsOf` counts rows on every path it has, so the note
 * below can print the count without a fallback — and a `?? 0` for a case that
 * cannot happen is a branch no test can ever take.
 */
type CountedStats = DatasetStats & { readonly rowCountEstimate: number };

function statsOf(source: { rows?: readonly unknown[]; csv?: string }): CountedStats {
  if (source.rows !== undefined) return { rowCountEstimate: source.rows.length };
  /* v8 ignore else -- the "neither rows nor csv" fall-through is unreachable: the R12 firewall (validateDashboardDef) rejects a data table declaring neither before buildDashboard ever calls statsOf */
  if (typeof source.csv === 'string') {
    // Cheap estimate for `auto` routing: data lines = non-empty lines minus the header.
    const lines = source.csv.split('\n').filter((l) => l.trim().length > 0).length;
    return { rowCountEstimate: Math.max(0, lines - 1) };
  }
  /* v8 ignore next -- neither rows nor csv: unreachable, the R12 firewall (validateDashboardDef) rejects a data table declaring neither before buildDashboard ever calls statsOf */
  return { rowCountEstimate: 0 };
}

/**
 * The engine a table runs on, and the NOTES it owes — one when `auto` was
 * declared, one when the declaration routed somewhere this version does not run.
 *
 * WHY a declared `server` is honoured and NOT refused at the def door: it names
 * a real seam, it is legal in the def's grammar, and the very same def RUNS when
 * a host answers that table through `options.providers` — which the validator
 * never sees. What is missing is an engine in this VERSION, not a rule the def
 * broke; so the build says it, loudly, in the words the engine itself will use
 * at the first read (`src/data/stubEngines.ts`).
 *
 * `wasm` is no longer one of those: it RUNS (`./wasmBackend.ts` lands a def's
 * bytes in a SQL connection), so the note it owes is about WHEN — and only the
 * sync door owes one at all, which is why it is minted there and not here.
 */
function resolveEngine(
  declared: Engine | undefined,
  // a THUNK: only `auto` reads the stats, and counting a 50MB CSV's lines for a
  // table that declared its engine is a whole extra pass over the bytes
  stats: () => CountedStats,
  available: readonly ResolvedEngine[],
  table: string,
  notes: string[],
): ResolvedEngine {
  const engine = declared ?? 'memory';
  if (engine === 'auto') {
    // `auto` FOLLOWS `chooseEngine` now. It used to resolve to memory whatever the
    // stats said, because the thresholds behind it were an unmeasured placeholder
    // (Q12) and a round number must not spawn a WASM database for a table this
    // process can answer in JS. `bench/step0-wasm` measured the row axis — at
    // 300,000 rows the memory engine answers every steady-state read inside an
    // interaction budget (its FIRST sorted ask, which builds the permutation,
    // is 125 ms); at 1,000,000 it does not: the sorted window is 97.5 ms and
    // the first sorted ask 517 ms, against DuckDB's 14.8 ms — so above that
    // threshold the router now says so.
    // It still NAMES the engine it picked and the rows it picked it on: a table
    // that opens a database should never do it silently.
    // read ONCE: the thunk exists because counting a 50 MB CSV's lines is a whole
    // pass over the bytes, and asking twice would be two of them
    const seen = stats();
    const picked = chooseEngine(seen, { availableEngines: available });
    const rows = seen.rowCountEstimate;
    notes.push(
      `data["${table}"]: engine "auto" resolved to ${picked} (${rows.toLocaleString('en-US')} rows, against the measured row threshold in chooseEngine — declare an engine to choose otherwise)${clampNote(seen, picked, available)}`,
    );
    return picked;
  }
  // the same law one step over: if a round number may not route to a stub silently,
  // neither may a declaration — the author hears at BUILD what the table says at READ
  if (isStubEngine(engine)) notes.push(stubEngineNote(table, engine));
  return engine;
}

/**
 * The other half of the `auto` note: what the MEASUREMENT said, when the
 * availability clamp walked it back.
 *
 * WHY it has to be said out loud: `availableEngines` defaults to `['memory']`,
 * so a 400,000-row table crosses the measured threshold, `chooseEngine` picks
 * wasm on the numbers, the clamp answers memory because nobody told this build
 * wasm was there — and the note alone would read as if the bench had chosen
 * memory. It names the remedy, because "the threshold said wasm" without one is
 * a fact an author cannot act on.
 */
function clampNote(seen: CountedStats, picked: ResolvedEngine, available: readonly ResolvedEngine[]): string {
  const measured = chooseEngine(seen, { availableEngines: RESOLVED_ENGINES });
  if (measured === picked) return '';
  return `; the measured threshold said ${measured}, which this build was not told is available — pass availableEngines: ${JSON.stringify([...available, measured])} to allow it`;
}

function buildProvider(
  engine: ResolvedEngine,
  table: string,
  source: { rows?: readonly unknown[]; csv?: string; layout?: 'row' | 'column' },
  wasm: WasmBackend,
): DataProvider {
  switch (engine) {
    case 'memory':
      return memoryProvider(rowsInputOf(source), {
        tableName: table,
        ...(source.layout ? { layout: source.layout } : {}),
      });
    case 'wasm':
      // The declared bytes, and this build's ONE connection. Still inert: nothing
      // opens and nothing lands until a read needs an answer (`./wasmBackend.ts`).
      return wasm.provider(table, wasmBytesOf(source));
    case 'server':
      return serverProvider({ tables: [table] });
  }
}

function makeFdrStepperFactory(def: DashboardDef): () => FdrStepper {
  const fdr = def.fdr;
  const alpha = fdr?.alpha ?? 0.05;
  if (!fdr || fdr.procedure === 'LORD++') {
    return () =>
      createLordPlusPlus({
        alpha,
        ...(fdr?.w0 !== undefined ? { w0: fdr.w0 } : {}),
        ...(fdr?.gamma !== undefined ? { gamma: fdr.gamma } : {}),
      });
  }
  return () =>
    createAlphaInvesting({
      alpha,
      ...(fdr.w0 !== undefined ? { w0: fdr.w0 } : {}),
      ...(fdr.omega !== undefined ? { omega: fdr.omega } : {}),
    });
}

/**
 * Validate a def and resolve it into a live {@link Dashboard}. Throws
 * {@link DashboardDefError} on a malformed def (the R12 gate) — nothing is
 * built, no engine is touched, no analysis is promoted.
 */
export function buildDashboard(def: DashboardDef, options: BuildDashboardOptions = {}): Dashboard {
  const problems = validateDashboardDef(def);
  if (problems.length) throw new DashboardDefError(problems);
  // the host's own options — the providers it brought and the engines it says it has — judged with the def, before a table is built
  const hostProblems = [...judgeProviders(def, options.providers), ...judgeAvailableEngines(options.availableEngines)];
  if (hostProblems.length) throw new DashboardDefError(hostProblems);
  // What this door cannot do for a source table, one sentence per table: its bytes
  // must be FETCHED (an await), or LANDED in a SQL backend (also an await).
  const asyncOnly: string[] = [];
  for (const [table, src] of Object.entries(def.data)) {
    if (src.source === undefined) continue;
    if (src.source.via !== 'inline') asyncOnly.push(`data["${table}"] declares a source via ${src.source.via} — build it with buildDashboardAsync`);
    else if (src.engine === 'wasm') asyncOnly.push(`data["${table}"] declares a source with engine "wasm" — a source's rows are landed in the SQL backend by an await; build it with buildDashboardAsync`);
  }
  if (asyncOnly.length) throw new DashboardDefError(asyncOnly);

  const available = options.availableEngines ?? DEFAULT_AVAILABLE;
  const notes: string[] = [];
  const sources: Record<string, SourceInfo> = {};
  const journal: RefreshRecord[] = []; // the data journal — refreshes, oldest first
  const wasm = wasmBackend(options.openSqlConnection); // inert until a wasm table is declared, and then until it is read

  // ── resolve data → one provider per table (D24) ──
  const providers = new Map<string, DataProvider>();
  const engines: Record<string, Engine> = {};
  for (const [table, source] of Object.entries(def.data)) {
    const host = options.providers?.[table];
    if (host !== undefined) {
      // the host brought this table's engine, so the audit reports the engine
      // the PROVIDER says it is (judged above) and the note says the def's own
      // routing was never built
      engines[table] = host.engine;
      providers.set(table, host);
      notes.push(hostProviderNote(table, host.engine, source.engine ?? 'memory'));
      continue;
    }
    if (source.source !== undefined) {
      // an inline source: decoded here, the same rows `rows:` would have carried
      const rows = decodeRows(source.source.format, source.source.at, source.source.options);
      if ('rejected' in rows) throw new DashboardDefError([`data["${table}"].source: ${rows.rejected}`]);
      engines[table] = 'memory';
      providers.set(table, memoryProvider(rows, { tableName: table, ...(source.layout ? { layout: source.layout } : {}) }));
      sources[table] = { format: source.source.format, via: 'inline', version: inlineVersion(source.source.at), retrievedAt: new Date().toISOString(), rows: rows.length };
      continue;
    }
    const engine = resolveEngine(source.engine, () => statsOf(source), available, table, notes);
    engines[table] = engine;
    providers.set(table, buildProvider(engine, table, source, wasm));
    // the one thing this door cannot do for the engine that runs: land the bytes
    if (engine === 'wasm') notes.push(wasmLazyNote(table));
  }
  return assemble(def, options, providers, engines, sources, notes, journal, new DerivedColumnStore(), derivedTableSlots(providers), wasm);
}

/**
 * The same build, awaiting every declared source: each table's `source` is
 * opened with the adapters the host brought (`inline` is always known), its
 * snapshot becomes a memory table, and what the adapter vouched for — version,
 * retrieval time, row count — is kept as the table's provenance.
 */
export async function buildDashboardAsync(def: DashboardDef, options: BuildDashboardAsyncOptions = {}): Promise<Dashboard> {
  const problems = validateDashboardDef(def);
  if (problems.length) throw new DashboardDefError(problems);
  const hostProblems = [...judgeProviders(def, options.providers), ...judgeAvailableEngines(options.availableEngines)];
  if (hostProblems.length) throw new DashboardDefError(hostProblems);
  const available = options.availableEngines ?? DEFAULT_AVAILABLE;
  const notes: string[] = [];
  const sources: Record<string, SourceInfo> = {};
  const journal: RefreshRecord[] = []; // the data journal — refreshes, oldest first
  const wasm = wasmBackend(options.openSqlConnection);
  const providers = new Map<string, DataProvider>();
  const engines: Record<string, Engine> = {};
  for (const [table, source] of Object.entries(def.data)) {
    const host = options.providers?.[table];
    if (host !== undefined) {
      // the same seam here, and the source is never opened for it: the judge
      // above refuses a host provider on a table that declares one, so there is
      // nothing to fetch and nothing to discard
      engines[table] = host.engine;
      providers.set(table, host);
      notes.push(hostProviderNote(table, host.engine, source.engine ?? 'memory'));
      continue;
    }
    if (source.source !== undefined) {
      // the carrier's refusal is the def's problem, in the same shape the sync door raises it
      const snap = await readSource(source.source, table, options.sources ?? []);
      // A source table's rows go wherever its engine reads them: into this process,
      // or into the SQL backend — which is why a source may declare "wasm" at all
      // (../def/README.md, "A source table and the wasm engine").
      engines[table] = source.engine === 'wasm' ? 'wasm' : 'memory';
      providers.set(
        table,
        source.engine === 'wasm'
          ? wasm.provider(table, wasmRowBytes(snap.rows))
          : memoryProvider(snap.rows, { tableName: table, ...(source.layout ? { layout: source.layout } : {}) }),
      );
      sources[table] = {
        format: source.source.format,
        via: source.source.via,
        // an inline payload is never repeated; a locator is
        ...(source.source.via !== 'inline' && typeof source.source.at === 'string' ? { at: source.source.at } : {}),
        version: snap.version,
        retrievedAt: snap.retrievedAt,
        rows: snap.rows.length,
      };
      continue;
    }
    const engine = resolveEngine(source.engine, () => statsOf(source), available, table, notes);
    engines[table] = engine;
    providers.set(table, buildProvider(engine, table, source, wasm));
  }
  // THE DOOR THAT CAN AWAIT, DOES: every wasm table's bytes land here, so a caller
  // who asked for this door is handed an engine that has already answered its first
  // question. A landing that failed is a NOTE and a refused read — never a throw
  // past this door, which would lose the tables that did land.
  for (const outcome of await wasm.settle()) {
    if ('failed' in outcome) notes.push(wasmFailedNote(outcome.table, outcome.failed));
  }
  const adapters = options.sources ?? [];
  // Which table-store slots hold TRACE-derived columns (src/data/README.md).
  // Dashboard-scoped because the stores are: two sessions write into one
  // provider. A refresh replaces a table's ROWS, so it drops that table's slots.
  const derived = new DerivedColumnStore();
  // …and the tables an aggregate cut from them, on the same reasoning one level out.
  const derivedTables = derivedTableSlots(providers);
  const run = async (which?: readonly string[]): Promise<RefreshResult> => {
    // ONE answer per table asked: a name given twice fetches its carrier twice, and the second
    // pass reads the FIRST pass's own swap as "unchanged" — overwriting the change it just made
    const asked = [...new Set(which ?? Object.keys(def.data))];
    const out: Record<string, RefreshOutcome> = {};
    for (const table of asked) {
      // own keys only, the way `judgeProviders` reads the same map: `toString` is not a declared table
      const decl = Object.prototype.hasOwnProperty.call(def.data, table) ? def.data[table] : undefined;
      const held = Object.prototype.hasOwnProperty.call(sources, table) ? sources[table] : undefined;
      if (decl === undefined) {
        // an unknown name is refused as such — never described as a table with inline rows
        out[table] = { refused: true, reason: 'no-source', message: `no table "${table}" is declared — the tables are ${Object.keys(def.data).join(', ')}` };
        continue;
      }
      if (decl.source === undefined || held === undefined) {
        out[table] = { refused: true, reason: 'no-source', message: `data["${table}"] declares no source — inline rows never move` };
        continue;
      }
      // ONE PATH FOR EVERY ENGINE: open the source, take the snapshot, hand the
      // rows to the engine that holds the table and let IT compute the delta
      // (src/data/README.md, "A refresh is computed where the rows live"). The
      // provider stays the SAME object, so nothing holding a reference goes
      // stale; the memory engine swaps its arrays, the wasm engine re-lands in
      // its SQL backend — never, on refresh, the wasm table rebuilt as a memory
      // one, which would silently change the engine `dashboard.engines` names.
      const provider = providers.get(table)!;
      /* v8 ignore next 5 -- the port's law for an engine with no `replaceRows` (the stubs): no door reaches it today, because a source table
       * is routed to memory or wasm by the def door and a host provider on a source table is refused by `judgeProviders` — it is here so
       * the engine that arrives with `source` support and no reland is refused in words, never rebuilt on another engine; the sentence is pinned */
      if (provider.replaceRows === undefined) {
        out[table] = { refused: true, reason: 'not-reloadable', message: notReloadableMessage(table, engines[table] ?? provider.engine) };
        continue;
      }
      try {
        const handle = await openSource(decl.source, table, adapters);
        try {
          const snap = await handle.snapshot({ sinceVersion: held.version });
          // a carrier that cannot answer conditionally but vouches for the same version moved nothing either
          if (isUnchanged(snap) || snap.version === held.version) {
            out[table] = { unchanged: true, version: snap.version };
            continue;
          }
          // the names the OLD rows carried, read before they go: the engine answers the new schema with the delta
          const oldCols = await provider.columns(table);
          const landed = await provider.replaceRows(table, snap.rows, decl.key !== undefined ? { key: decl.key } : {});
          if (isRejection(landed)) {
            // the engine's own words: nothing moved, and the registries below are left exactly as they were
            /* v8 ignore next -- both shipped engines quote a detail on every reland refusal; the reason is the honest fallback for a host provider that does not */
            out[table] = { refused: true, reason: 'not-reloadable', message: landed.detail ?? landed.reason };
            continue;
          }
          const arrived = new Set(landed.columns.map((c) => c.name));
          /* v8 ignore next -- the columns were listed a moment ago by the same provider; the arm keeps the type honest */
          const goneSlots = (isRejection(oldCols) ? [] : oldCols).map((c) => c.name).filter((c) => !arrived.has(c));
          // The SESSION's registries, not the engine's: a derived column is
          // REPORTED by the name a person knows, not by the slot it lived in; and
          // the registry is dropped with the rows that held it, or the session
          // would keep resolving a name the store lacks. On the wasm engine no
          // column was ever materialised (`canMaterialize: false`), so the list
          // names only columns the new bytes themselves dropped.
          const spelling = derived.logicalByPhysical(table);
          const lost = goneSlots.map((c) => spelling.get(c) ?? c);
          derived.clear(table);
          // A derived TABLE goes the same way and is reported the same way: its
          // record says which version of this parent it was cut from, and that
          // version no longer exists — so it is dropped rather than left
          // serving yesterday's rows under today's name.
          const tablesLost = derivedTables.drop(table);
          sources[table] = { ...held, version: snap.version, retrievedAt: snap.retrievedAt, rows: snap.rows.length };
          out[table] = { changed: true, from: held.version, to: snap.version, retrievedAt: snap.retrievedAt, rows: snap.rows.length, delta: landed.delta, ...(lost.length > 0 ? { materialisedLost: lost } : {}), ...(tablesLost.length > 0 ? { derivedLost: tablesLost } : {}) };
        } finally {
          await handle.close();
        }
      } catch (e) {
        out[table] = { refused: true, reason: isSourceRefusal(e) ? e.reason : 'no-source', message: e instanceof Error ? e.message : String(e) };
      }
    }
    journal.push(journalRecord(asked, out));
    return { tables: out };
  };
  // refreshes run one after another: two overlapping ones would read each other's swap as a change of their own
  // `run` never rejects today (every table's failure is REPORTED in its outcome); the chain survives even if that changes
  let queue: Promise<unknown> = Promise.resolve();
  const refresh = (which?: readonly string[]): Promise<RefreshResult> => {
    const next = queue.then(() => run(which));
    /* v8 ignore next -- the settle-on-rejection arm guards an invariant no test can break */
    queue = next.catch(() => undefined);
    return next;
  };
  return assemble(def, options, providers, engines, sources, notes, journal, derived, derivedTables, wasm, refresh);
}

/**
 * THE MAP IS STILL — freeze the definition in place.
 *
 * The def is what could happen: declared once, read for the life of the
 * dashboard, written by nobody. `dashboard.def` is documented as frozen and it
 * was not — `def.meta.title = 'HIJACKED'` stuck. It is FROZEN rather than
 * copied on each read because it is read constantly (every fold, every lint,
 * every overview) and a copy per read would be the most expensive possible way
 * to say something that is true forever.
 *
 * TWO THINGS ARE DELIBERATELY LEFT ALONE, and both are the same reason:
 *
 *  - `deepFreeze` walks plain objects and arrays only, so an author's analysis
 *    functions and any live analysis module in `def.analyses` are untouched.
 *  - a table's `rows` and its inline `source.at` are BULK DATA THE AUTHOR
 *    STILL OWNS. The demo in this repo declares `data: { data: { rows } }` and
 *    goes on using that same array as its chart's local rows, writing a
 *    materialized `cluster_id` onto each — legitimate, and freezing it broke
 *    it. Nothing is lost by leaving it: every provider takes its own copy of
 *    the rows at build (memoryProvider clones each row), so writing to the
 *    author's array afterwards changes nothing the dashboard reads.
 *
 * Everything else under a table's declaration — its engine, key, layout,
 * column declarations — is frozen, and so is the `data` map itself, so no
 * table can be added, removed or re-pointed after the build.
 */
function freezeDefinition(def: DashboardDef): void {
  for (const decl of Object.values(def.data)) {
    for (const [key, value] of Object.entries(decl)) {
      if (key !== 'rows' && key !== 'source') deepFreeze(value);
    }
    Object.freeze(decl); // shallow ON PURPOSE: the payload doors above stay writable
  }
  Object.freeze(def.data); // …and `deepFreeze` below stops here, as its short-circuit promises
  deepFreeze(def);
}

/**
 * The refusal a table meets when its engine cannot re-land rows at all — it has
 * no `replaceRows` (the stubs). The remedy names both acts, close and build,
 * because a second build over an unclosed one leaves the first database open.
 */
export const notReloadableMessage = (table: string, engine: string): string =>
  `data["${table}"] runs on the "${engine}" engine, which cannot re-land rows — close() this dashboard and build again to read the source afresh`;

/** One journal record: its own copies of what it was handed, frozen — history is never editable through a result someone still holds. */
function journalRecord(asked: readonly string[], tables: Readonly<Record<string, RefreshOutcome>>): RefreshRecord {
  // A journal entry is finished the moment it is written, so it is FROZEN, not
  // copied — every level a caller can reach through the result it still holds:
  // the outcome, its delta, the lost list. (This used to be three hand-rolled
  // shallow freezes, which is the same law spelled out one level at a time.)
  const copied: Record<string, RefreshOutcome> = {};
  for (const [table, o] of Object.entries(tables)) copied[table] = { ...o };
  return deepFreeze({ at: new Date().toISOString(), asked: [...asked], tables: copied });
}

/** Open, snapshot, close — and turn what the carrier refused into a def problem. */
async function readSource(decl: SourceDecl, table: string, adapters: readonly SourceAdapter[]): Promise<SourceSnapshot> {
  try {
    const handle = await openSource(decl, table, adapters);
    try {
      const snap = await handle.snapshot();
      /* v8 ignore next -- a snapshot asked without sinceVersion never answers unchanged; the guard keeps the type honest */
      if (isUnchanged(snap)) throw new SourceRefusal('malformed', `table "${table}": the carrier answered "unchanged" to a first read`, table, decl.via);
      return snap;
    } finally {
      await handle.close();
    }
  } catch (e) {
    // the carrier's typed reason rides the def error, so a host can tell a timeout from a malformed payload
    throw new DashboardDefError([`data["${table}"].source: ${e instanceof Error ? e.message : String(e)}`], isSourceRefusal(e) ? e.reason : undefined);
  }
}

/** The kinds a saved condition may name — the emission kinds themselves, projected (`../links/types.ts`), never a second list to keep in step. */
const SAVED_CONDITION_KINDS: readonly string[] = EMISSION_KINDS;

/** Restore saved selections into the store: a whole record each, judged (a name, at least one condition on a declared view with a field or pair and a value, an author, a time), never re-stamped, refused in words. A record keeps the id it arrives with when no other record holds it; otherwise the store names it and says so in `reidentified`. */
export function restoreSavedInto(store: SavedStore, list: readonly RestorableSaved[], views: ReadonlySet<string>, commitIds: CommitIdStore): RestoreResult {
  const restored: string[] = [];
  const refused: { name: string; rejected: string }[] = [];
  const reidentified: { name: string; id: string; was?: string }[] = [];
  for (const r of list) {
    const name = typeof r?.name === 'string' ? r.name.trim() : '';
    const say = (rejected: string): void => { refused.push({ name: name.length > 0 ? name : '(unnamed)', rejected }); };
    if (name.length === 0) { say('a saved selection needs a name'); continue; }
    if (store.list.some((c) => c.name === name)) { say(`"${name}" is already saved — rename or forget it first`); continue; }
    if (!Array.isArray(r.conditions) || r.conditions.length === 0) { say('a saved selection needs at least one condition'); continue; }
    if (typeof r.by !== 'string' || typeof r.at !== 'string') { say('a saved selection carries who saved it and when'); continue; }
    if (r.id !== undefined && (typeof r.id !== 'string' || r.id.trim().length === 0)) { say('a saved selection\'s id, when it carries one, is a short name'); continue; }
    if ((r.editedBy !== undefined && typeof r.editedBy !== 'string') || (r.editedAt !== undefined && typeof r.editedAt !== 'string')) { say('a saved selection that was edited carries who edited it and when'); continue; }
    const seen = new Set<string>();
    let bad: string | undefined;
    for (const c of r.conditions) {
      if (typeof c?.viewId !== 'string' || !views.has(c.viewId)) { bad = `no declared view "${String(c?.viewId)}"`; break; }
      if (seen.has(c.viewId)) { bad = `the picture already has a condition on "${c.viewId}" — one condition per view`; break; }
      seen.add(c.viewId);
      if (!SAVED_CONDITION_KINDS.includes(c.kind as string)) { bad = `"${String(c.kind)}" is not a condition kind`; break; }
      // the two-column kinds are judged on their PAIR (their `field` is a joint label); every other kind on its field
      const pair = isPairKind(c.kind as string);
      if (pair ? !Array.isArray(c.fields) || c.fields.length !== 2 : typeof c.field !== 'string' || c.field.length === 0) { bad = pair ? `a ${c.kind} condition on "${c.viewId}" needs its two fields` : `a ${c.kind} condition on "${c.viewId}" needs a field`; break; }
      // `null` is the one spelling of CLEARED (src/session/README.md, beside law 6) — never a value a picture holds
      if (c.value === undefined || c.value === null) { bad = `the condition on "${c.viewId}" needs a value`; break; }
    }
    if (bad !== undefined) { say(bad); continue; }
    const named = restoredRecordId(PICTURE_ID_PREFIX, r.id, store);
    if (named.assigned) reidentified.push({ name, id: named.id, ...(r.id !== undefined ? { was: r.id } : {}) });
    // field by field, like the bookmark restore: a host's extra properties stay out of the store (and out of every `saved()` a consumer reads)
    store.list.push({
      id: named.id,
      name,
      conditions: structuredClone(r.conditions) as SavedClause[],
      by: r.by,
      at: r.at,
      ...(r.on !== undefined ? { on: structuredClone(r.on) } : {}),
      ...(r.from !== undefined ? { from: [...r.from] } : {}),
      ...(r.editedBy !== undefined ? { editedBy: r.editedBy } : {}),
      ...(r.editedAt !== undefined ? { editedAt: r.editedAt } : {}),
    });
    // the commits this picture was saved from are now pointed at: their numbers are spent
    raiseMinted(COMMIT_ID_PREFIX, r.from ?? [], commitIds);
    restored.push(name);
  }
  return { restored, refused, reidentified };
}

/** Restore bookmarks into the store: a whole record each, judged (a name, a commit id, who, when), never re-stamped, refused in words. `hasCommit` lets a session refuse a commit its log does not hold. A record keeps the id it arrives with when no other record holds it; otherwise the store names it and says so in `reidentified`. */
export function restoreBookmarksInto(store: BookmarkStore, list: readonly RestorableBookmark[], commitIds: CommitIdStore, hasCommit?: (id: string) => boolean): RestoreResult {
  const restored: string[] = [];
  const refused: { name: string; rejected: string }[] = [];
  const reidentified: { name: string; id: string; was?: string }[] = [];
  for (const t of list) {
    const name = typeof t?.name === 'string' ? t.name.trim() : '';
    const say = (rejected: string): void => { refused.push({ name: name.length > 0 ? name : '(unnamed)', rejected }); };
    if (name.length === 0) { say('a bookmark needs a name'); continue; }
    if (name.length > 200) { say('a bookmark name is at most 200 characters'); continue; }
    if (store.list.some((c) => c.name === name)) { say(`"${name}" is already a bookmark — rename or forget it first`); continue; }
    if (typeof t.commitId !== 'string' || t.commitId.length === 0) { say('a bookmark names a commit'); continue; }
    if (hasCommit !== undefined && !hasCommit(t.commitId)) { say(`no commit "${t.commitId}" in the log`); continue; }
    if (typeof t.by !== 'string' || typeof t.at !== 'string') { say('a bookmark carries who made it and when'); continue; }
    if (t.description !== undefined && typeof t.description !== 'string') { say('a bookmark\'s description is words'); continue; }
    if (t.id !== undefined && (typeof t.id !== 'string' || t.id.trim().length === 0)) { say('a bookmark\'s id, when it carries one, is a short name'); continue; }
    if ((t.editedBy !== undefined && typeof t.editedBy !== 'string') || (t.editedAt !== undefined && typeof t.editedAt !== 'string')) { say('a bookmark that was edited carries who edited it and when'); continue; }
    const named = restoredRecordId(BOOKMARK_ID_PREFIX, t.id, store);
    if (named.assigned) reidentified.push({ name, id: named.id, ...(t.id !== undefined ? { was: t.id } : {}) });
    store.list.push({
      id: named.id,
      name,
      commitId: t.commitId,
      ...(t.description !== undefined ? { description: t.description } : {}),
      by: t.by,
      at: t.at,
      ...(t.editedBy !== undefined ? { editedBy: t.editedBy } : {}),
      ...(t.editedAt !== undefined ? { editedAt: t.editedAt } : {}),
    });
    // the moment this bookmark names is now pointed at: its number is spent
    raiseMinted(COMMIT_ID_PREFIX, [t.commitId], commitIds);
    restored.push(name);
  }
  return { restored, refused, reidentified };
}

/**
 * The two things a derived table's slot IS, minted and dropped together: a row
 * provider registered under the act's physical name, and the registry entry
 * that says which act it belongs to.
 *
 * ONE owner for both, because a provider without its entry is a table nobody
 * can resolve a name to, and an entry without its provider is a name that
 * resolves to nothing. The providers map is the live one `providerFor` reads,
 * which is why a table cut by an act is readable the instant it lands and
 * unreadable the instant its parent moves.
 */
interface DerivedTableSlots {
  /** The registry a session resolves a derived table NAME through, at its cursor. */
  readonly store: DerivedTableStore;
  /** Land one: a fresh memory provider under the act's slot, then the entry. */
  land(table: DerivedTable, rows: readonly Row[]): void;
  /** Drop every table cut from one parent — and every table cut from THOSE — answering the names, oldest first. */
  drop(of: string): readonly string[];
}

function derivedTableSlots(providers: Map<string, DataProvider>): DerivedTableSlots {
  const store = new DerivedTableStore();
  return {
    store,
    land: (table, rows) => {
      // A FRESH provider per act: the rows were computed once, at one cursor, and
      // two acts that cut the same name are two tables (`src/data/derivedTables.ts`).
      //
      // DETACHED on the way in (`../detach/README.md`): these row objects are also
      // in the answer the act already handed its caller, and a store that shared them
      // would serve whatever that caller wrote into them, with no commit anywhere.
      // One shallow copy per row; the cells are borrowed values nobody writes to.
      providers.set(table.physical, memoryProvider(rows.map((row) => ({ ...row })), { tableName: table.physical }));
      store.record(table);
    },
    drop: (of) => {
      const dropped = store.clear(of);
      for (const table of dropped) providers.delete(table.physical);
      return dropped.map((table) => table.name);
    },
  };
}

/**
 * Everything after the providers exist — ONE assembly for both builders.
 *
 * `refresh` is passed IN rather than layered on afterwards. It used to be
 * layered on (`{ ...dashboard, refresh }` in the async builder), and spreading
 * an object EVALUATES its getters: the moment `sources` became a getter that
 * reads live state, the async dashboard froze a build-time snapshot of it and
 * never saw a refresh again. One object literal, built once, cannot go wrong
 * that way.
 */
function assemble(def: DashboardDef, options: BuildDashboardOptions, providers: Map<string, DataProvider>, engines: Record<string, Engine>, sources: Record<string, SourceInfo>, notes: readonly string[], journal: RefreshRecord[], derived: DerivedColumnStore, derivedTables: DerivedTableSlots, wasm: WasmBackend, refresh?: Dashboard['refresh']): Dashboard {
  freezeDefinition(def);
  const saved: SavedStore = { list: [], minted: 0 }; // saved selections: logic beside the log, shared by every session (the counter rides the store: it outlives every session)
  const bookmarks: BookmarkStore = { list: [], minted: 0 }; // bookmarks: names on moments beside the log, shared by every session
  // the commit-id counter: beside those two stores because those two stores POINT AT commit ids
  // across sessions — an id must therefore be unique per dashboard, not per session
  const commitIds: CommitIdStore = { minted: 0 };
  // the session-id counter, on the same reasoning one line up: a session id
  // names a session ACROSS the dashboard (a served answer's `basis.session`
  // says which one folded it), so it is minted per dashboard, never per session
  const sessionIds = { minted: 0 };
  // ONCE, over the validated def, beside the freeze that makes it safe to do so
  const revision = defRevision(def);
  const tables = [...providers.keys()];
  const keys: Record<string, string> = Object.fromEntries(Object.entries(def.data).flatMap(([t, d]) => (d.key !== undefined ? [[t, d.key]] : [])));
  // WHY: the materialized-links precedent — the default `kind` is written onto the runtime, not back into the def,
  // so a reader never re-derives it and the def stays byte-identical to what was declared
  const relations: RelationEdge[] = (def.relations ?? []).map((r) => ({ from: { ...r.from }, to: { ...r.to }, kind: r.kind ?? DEFAULT_RELATION_KIND, ...(r.label !== undefined ? { label: r.label } : {}) }));
  const defaultTable = def.defaultTable ?? tables[0]!;

  // ── promote declared analyses (L3) ──
  const analyses = new Map<string, RegisteredAnalysis>();
  for (const [id, slot] of Object.entries(def.analyses ?? {})) {
    // the def's relations ride along: a `bringOver` record reads its joins off
    // them (law 6), and a `derive` record reads its table's absence vocabulary
    // off the same context for the same reason
    analyses.set(id, registerAnalysisSlot(id, slot, { relations, absence: absenceByTable(def.data) }));
  }

  // ── declared views + capability envelope + encoding surface ──
  const capabilityByView = new Map<string, CapabilityDecl>();
  for (const cap of def.capabilities ?? []) capabilityByView.set(cap.viewId, cap);
  const encodingByView = new Map<string, ViewEncodingDecl>();
  for (const enc of def.encodings ?? []) encodingByView.set(enc.viewId, enc);
  const grainByView = new Map((def.grains ?? []).map((g) => [g.viewId, g.keys] as const));
  const views = new Map<string, ViewDecl>();
  for (const [viewId, meta] of Object.entries(def.actors)) {
    views.set(viewId, {
      viewId,
      meta,
      ...(capabilityByView.has(viewId) ? { capability: capabilityByView.get(viewId)! } : {}),
      ...(grainByView.has(viewId) ? { grain: grainByView.get(viewId)! } : {}),
      ...(encodingByView.has(viewId) ? { encoding: encodingByView.get(viewId)! } : {}),
      // WHY: the def is deep-frozen at build, so the declared list IS the frozen resolved list; the key is absent on a view that declared none (byte-identical to a view built before layers existed)
      ...(encodingByView.get(viewId)?.layers !== undefined ? { layers: encodingByView.get(viewId)!.layers! } : {}),
    });
  }

  // ── dual-intent resolver ──
  const intents: Record<DispatchVerb, IntentClass> = { ...DEFAULT_INTENTS };
  for (const decl of def.agent?.intents ?? []) intents[decl.verb] = decl.intent;

  const makeFdrStepper = makeFdrStepperFactory(def);

  // ── layer 4: the link graph, materialized once (the default rule written out; declared edges override in place) ──
  // the views first, then every layer as its own node under its address (the default rule writes no edge within a frame — src/links/materialize.ts)
  const linkViews = [...views.values()].map((v) => ({
    viewId: v.viewId,
    voice: voiceOf(v.capability, { hasEncodingSurface: v.encoding !== undefined }),
    // the ROWS this address reads: the DEFAULT table (a layerless view, or a layered one that binds something of
    // its own) — the rows the reach law judges an edge into it against — or NONE, and then the frame is its layers
    // (`./layers.ts` · `readsOwnTable`, the ONE owner; `frame` lists the readers, and no default edge touches it)
    ...ownRowsOf(v.viewId, { layers: v.layers, initial: v.encoding?.initial }, defaultTable),
    ...(v.encoding !== undefined ? { channels: v.encoding.channels } : {}),
    ...(v.grain !== undefined ? { grain: v.grain } : {}),
  }));
  const voiceByView = new Map(linkViews.map((lv) => [lv.viewId, lv.voice] as const)); // read once per layer: the voice is already computed, never re-derived
  const layerViews = [...views.values()].flatMap((v) => (v.layers ?? []).map((layer) => layerLinkViewOf(v.viewId, layer, voiceByView.get(v.viewId)!)));
  // the reach law's evidence, read off the def ONCE by the owner both doors share (./tableReach.ts)
  const links = materializeLinks([...linkViews, ...layerViews], def.links ?? [], def.linkDefault ?? 'crossfilter', tableReachOf(def));

  const runtime: DashboardRuntime = {
    def,
    revision,
    sessionIds,
    defaultTable,
    tables,
    providerFor: (table) => providers.get(table),
    engines,
    analyses,
    views,
    links,
    encoding: {
      rules: def.encodingRules ?? {},
      ports: options.encoding ?? {},
      facetsOf: (table, cols) => resolveFacets(cols, def.data[table]!), // every runtime table is a def table
    },
    prose: new Map((def.prose ?? []).map((p) => [p.viewId, p.slots] as const)),
    sources,
    notes,
    keys,
    relations,
    journal,
    saved,
    bookmarks,
    commitIds,
    derived,
    derivedTables: derivedTables.store,
    landDerivedTable: (table, rows) => derivedTables.land(table, rows),
    makeFdrStepper,
    fdrProcedure: def.fdr?.procedure ?? 'LORD++',
    fdrAlpha: def.fdr?.alpha ?? 0.05,
    intentOf: (verb) => intents[verb],
  };

  // the other build-time constants, on the same reasoning as the def
  deepFreeze(engines);
  deepFreeze(keys);
  deepFreeze(relations);
  deepFreeze(notes);

  return {
    def,
    revision,
    engines,
    // `sources` is the one build-time record that MOVES — `refresh()` replaces
    // a table's entry — so a reader gets a frozen COPY, not the live object.
    get sources() {
      return deepFreeze({ ...sources });
    },
    notes,
    // a synchronous dashboard holds inline sources only, which never move; a table with no source has nothing to refresh —
    // the answer is still journaled, so the tab can say "asked at 14:02: unchanged" instead of nothing
    refresh: refresh ?? (async (which) => {
      const asked = [...new Set(which ?? Object.keys(def.data))];
      const result: RefreshResult = {
        tables: Object.fromEntries(
          asked.map((t) => [
            t,
            // own keys only: `toString` is a member of every object, and no table anybody declared
            !Object.prototype.hasOwnProperty.call(def.data, t)
              ? { refused: true, reason: 'no-source', message: `no table "${t}" is declared — the tables are ${Object.keys(def.data).join(', ')}` }
              : Object.prototype.hasOwnProperty.call(sources, t)
                ? { unchanged: true, version: sources[t]!.version }
                : { refused: true, reason: 'no-source', message: `data["${t}"] declares no source — inline rows never move` },
          ]),
        ),
      };
      journal.push(journalRecord(asked, result.tables));
      return result;
    }),
    journal: () => Object.freeze([...journal]), // the entries are already frozen; the list is a fresh one each read
    saved: () => saved.list.map((c) => structuredClone(c)), // a host gets its own copies, never the store's objects
    /* v8 ignore next -- a validated def always declares its actors; the fallback keeps the type honest */
    restoreSaved: (list) => restoreSavedInto(saved, list, new Set(Object.keys(def.actors ?? {})), commitIds),
    bookmarks: () => bookmarks.list.map((t) => ({ ...t })),
    restoreBookmarks: (list) => restoreBookmarksInto(bookmarks, list, commitIds),
    createSession: (opts) => createInteractionSession(runtime, opts),
    // the ONE thing this build owns outside this process (./wasmBackend.ts, law 4)
    close: () => wasm.close(),
    lintProse: async () => {
      const cols = await providers.get(defaultTable)!.columns(defaultTable);
      if (isRejection(cols)) throw new Error(`lintProse: the "${defaultTable}" provider cannot list its columns — ${cols.detail ?? cols.reason}`);
      const world = { columns: new Set(cols.map((c) => c.name)), analyses: new Set(analyses.keys()), surfaced: new Set([...views.values()].filter((v) => v.encoding !== undefined).map((v) => v.viewId)) };
      const problems: ProseProblem[] = [];
      for (const [viewId, slots] of runtime.prose) for (const [slot, record] of Object.entries(slots)) problems.push(...validateProseRecord(viewId, slot, record, world));
      return problems;
    },
    lintData: async () => {
      const out: string[] = [];
      for (const [table, key] of Object.entries(keys)) {
        const cols = await providers.get(table)!.columns(table);
        if (isRejection(cols)) {
          out.push(`data["${table}"].key "${key}": the engine cannot list this table's columns — ${cols.detail ?? cols.reason}`);
          continue;
        }
        if (!cols.some((c) => c.name === key)) out.push(`data["${table}"].key "${key}" names no column of the table — the columns are ${cols.map((c) => c.name).join(', ')}`);
      }
      // law 2's other half: a source column the def door could not judge (its table declares no `columns`) is judged here, against the engine — every relation, the way every key is
      for (const [i, { from }] of relations.entries()) {
        const cols = await providers.get(from.table)!.columns(from.table);
        if (isRejection(cols)) {
          out.push(`relations[${i}].from.column "${from.column}": the engine cannot list this table's columns — ${cols.detail ?? cols.reason}`);
          continue;
        }
        if (!cols.some((c) => c.name === from.column)) out.push(`relations[${i}].from.column "${from.column}" names no column of "${from.table}" — the columns are ${cols.map((c) => c.name).join(', ')}`);
      }
      return out;
    },
    lintFrames: () => frameNotesOf(views),
    lint: async () => {
      const cols = await providers.get(defaultTable)!.columns(defaultTable);
      if (isRejection(cols)) throw new Error(`lint: the "${defaultTable}" provider cannot list its columns — ${cols.detail ?? cols.reason}`);
      const surfaces = [...views.values()].flatMap((v) => (v.encoding !== undefined ? [v.encoding] : []));
      // the same union the build door judges: the default table's real columns, plus every
      // field a view binds or another table declares — typed by that table when it declares
      // it, `unknown` otherwise (a view may read another table; the session's single default
      // table is a known limit, and lint must not call that a missing column)
      const known = new Set(cols.map((c) => c.name));
      const extra: ColumnFacet[] = [];
      for (const [table, source] of Object.entries(def.data)) {
        if (table === defaultTable) continue;
        for (const name of Object.keys(source.columns ?? {})) {
          if (!known.has(name)) {
            known.add(name);
            extra.push(resolveFacet({ name, type: 'unknown' }, source));
          }
        }
      }
      for (const surface of surfaces) {
        for (const name of Object.values(surface.initial ?? {})) {
          if (!known.has(name)) {
            known.add(name);
            extra.push({ field: name, type: 'unknown' });
          }
        }
      }
      // a `dashboard`-scope rule means anywhere on the page: every view's bindings and every layer's, so a
      // never-together pair cannot hide across the frame/layer boundary (src/def/README.md, "Layers", law 5)
      const page = pageBindings([...surfaces, ...[...views.values()].flatMap((v) => (v.layers ?? []).map((l) => layerSurfaceOf(v.viewId, l)))]);
      const viewProblems = lintEncodings({
        views: surfaces,
        facets: [...runtime.encoding.facetsOf(defaultTable, cols), ...extra],
        page,
        rules: runtime.encoding.rules,
        ports: runtime.encoding.ports,
      });
      // a layer is judged against ITS table's real columns — the `unknown` fudge above is for a view with no layers,
      // whose reads of another table the single default table cannot name (src/def/layers.ts)
      return [...viewProblems, ...(await lintLayers(views, providers, runtime, page))];
    },
  };
}

/**
 * Every view's FRAME linted: the notes `frameLint` gives a stack, each under the
 * view it is about. A view with no layers has no frame and no notes.
 *
 * The one owner of the sentence is `frameLint` (`../encoding/frame.ts`) — this
 * only says which stack it was asked about, so the def door and a host that
 * folds its own frame read the same advice.
 */
function frameNotesOf(views: ReadonlyMap<string, ViewDecl>): readonly FrameNote[] {
  const out: FrameNote[] = [];
  for (const view of views.values()) {
    for (const sentence of frameLint(view.layers ?? [])) out.push({ viewId: view.viewId, sentence });
  }
  return Object.freeze(out);
}

/**
 * Every layer of every view, linted one at a time against the columns its own
 * table's provider lists — under the layer ADDRESS, so a problem names the layer.
 * WHY one call per layer: the FACETS that judge a binding are its own table's.
 * `page` is what its dashboard-scope rules read, and that spans every table.
 */
async function lintLayers(views: ReadonlyMap<string, ViewDecl>, providers: ReadonlyMap<string, DataProvider>, runtime: DashboardRuntime, page: Readonly<Record<string, Bindings>>): Promise<EncodingProblem[]> {
  const out: EncodingProblem[] = [];
  for (const view of views.values()) {
    for (const layer of view.layers ?? []) {
      const provider = providers.get(layer.table);
      // WHY a layer can have no provider: its table is one an ACT lands (`mintedTables`, ./builtinAnalyses.ts)
      // and no act has run at build. The def door already judged its fields against the act's declared column
      // list; there are no ROWS to judge until the act lands, and inventing an empty table here would refuse
      // every binding on a chart that is perfectly well declared.
      if (provider === undefined) continue;
      const cols = await provider.columns(layer.table);
      if (isRejection(cols)) throw new Error(`lint: the "${layer.table}" provider cannot list its columns — ${cols.detail ?? cols.reason}`);
      out.push(...lintEncodings({ views: [layerSurfaceOf(view.viewId, layer)], facets: runtime.encoding.facetsOf(layer.table, cols), page, rules: runtime.encoding.rules, ports: runtime.encoding.ports }));
    }
  }
  return out;
}
