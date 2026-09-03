/**
 * `buildDashboard(def)` — the offline, no-API-key entry to the L5 surface
 * (SPEC §7). Validates the def (R12 firewall), resolves each data table's
 * engine (D24), promotes each declared analysis (L3), and returns a
 * {@link Dashboard} whose `createSession()` wires ALL layers into one live
 * {@link InteractionSession}.
 *
 * Engine routing (D24): the def's `data[table].engine` key is routed to the
 * three D24 engines behind the data seam — `memory` (in-JS predicates,
 * always-on), `wasm`/`server` (typed stubs today), and `auto` (resolved via
 * `chooseEngine` over dataset stats). The INVARIANT (engine choice never
 * changes commit semantics) is inherited from `src/data`: the session speaks
 * only typed clauses, which every engine evaluates identically.
 */

import {
  chooseEngine,
  DerivedColumnStore,
  memoryProvider,
  serverProvider,
  wasmProvider,
  type DataProvider,
  type DatasetStats,
  type Engine,
  type ResolvedEngine,
  type RowsInput,
} from '../data/index.js';
import { createAlphaInvesting, createLordPlusPlus } from '../fdr/index.js';
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
import { createInteractionSession, type InteractionSession } from '../session/session.js';
import type { SessionOptions } from '../session/types.js';
import { materializeLinks, voiceOf } from '../links/index.js';
import { lintEncodings, resolveFacet, resolveFacets } from '../encoding/index.js';
import type { EncodingPorts, EncodingProblem } from '../encoding/index.js';
import { validateProseRecord } from '../prose/index.js';
import type { ProseProblem } from '../prose/index.js';
import { isRejection } from '../data/index.js';
import { decodeRows, deltaByKey, inlineVersion, isSourceRefusal, isUnchanged, openSource, SourceRefusal } from '../source/index.js';
import type { RefreshDelta, SourceAdapter, SourceDecl, SourceInfo, SourceRefusalReason, SourceSnapshot } from '../source/index.js';
import type { ColumnFacet } from '../data/index.js';
import { deepFreeze } from '../detach/index.js';

/** The offline dashboard handle. `createSession()` opens one live, stateful session. */
export interface Dashboard {
  /** The (frozen) validated def. */
  readonly def: DashboardDef;
  /** The resolved engine each table routed to (D24 audit). */
  readonly engines: Readonly<Record<string, Engine>>;
  /** What each declared source vouched for when it was read — the table's provenance. */
  readonly sources: Readonly<Record<string, SourceInfo>>;
  /** Build notes a def should hear (an `auto` engine resolved to memory, and why). */
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
  /** Judge the data declarations against the real data: today, that a declared row key names a column the engine lists. Sentences, never thrown. */
  lintData(): Promise<readonly string[]>;
  /** Open a fresh session: one live Mosaic Selection + commit log + FDR ledger. */
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
}

/** Options controlling engine resolution for `engine: 'auto'` tables. */
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
    }
  | { readonly refused: true; readonly reason: SourceRefusalReason | 'no-source'; readonly message: string };

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

export interface BuildDashboardOptions {
  /**
   * Engines actually available in this environment. It bounds an EXPLICIT
   * `engine` (a declared `server` needs it listed); `auto` no longer routes on
   * it — `auto` resolves to memory with a note until a measured bench exists,
   * and the guess the placeholder thresholds would have made is only quoted.
   */
  readonly availableEngines?: readonly ResolvedEngine[];
  /** The encoding plane's PORTS — explainer, coercers, recommender (code, so never on the def; see src/encoding/README.md). */
  readonly encoding?: EncodingPorts;
}

const DEFAULT_AVAILABLE: readonly ResolvedEngine[] = ['memory'];

function rowsInputOf(source: { rows?: readonly unknown[]; csv?: string }): RowsInput {
  return source.csv !== undefined ? source.csv : ((/* v8 ignore next -- rows is guaranteed defined here by the R12 firewall (rows XOR csv); unreachable via buildDashboard's public entry */ source.rows ?? []) as RowsInput);
}

function statsOf(source: { rows?: readonly unknown[]; csv?: string }): DatasetStats {
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

/** The engine a table runs on, and the note owed when `auto` was declared. */
function resolveEngine(
  declared: Engine | undefined,
  stats: DatasetStats,
  available: readonly ResolvedEngine[],
  table: string,
  notes: string[],
): ResolvedEngine {
  const engine = declared ?? 'memory';
  if (engine !== 'auto') return engine;
  // `auto` resolves to the one engine that runs, and says so: the thresholds behind
  // `chooseEngine` are an unmeasured placeholder (Q12), and a round number must not
  // route a real table to a stub that refuses every query.
  const guess = chooseEngine(stats, { availableEngines: available });
  notes.push(`data["${table}"]: engine "auto" resolved to memory (the placeholder thresholds would have said "${guess}"; they are unmeasured — declare an engine to choose otherwise)`);
  return 'memory';
}

function buildProvider(
  engine: ResolvedEngine,
  table: string,
  source: { rows?: readonly unknown[]; csv?: string; layout?: 'row' | 'column' },
): DataProvider {
  switch (engine) {
    case 'memory':
      return memoryProvider(rowsInputOf(source), {
        tableName: table,
        ...(source.layout ? { layout: source.layout } : {}),
      });
    case 'wasm':
      // Typed stub — declares the table so tables() is honest; every op rejects.
      return wasmProvider({ sources: { [table]: { kind: 'objects', data: [] } } });
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
  // a table whose rows must be fetched cannot be built synchronously — say so rather than pretend
  const remote = Object.entries(def.data).filter(([, src]) => src.source !== undefined && src.source.via !== 'inline').map(([t, src]) => `data["${t}"] declares a source via ${src.source!.via} — build it with buildDashboardAsync`);
  if (remote.length) throw new DashboardDefError(remote);

  const available = options.availableEngines ?? DEFAULT_AVAILABLE;
  const notes: string[] = [];
  const sources: Record<string, SourceInfo> = {};
  const journal: RefreshRecord[] = []; // the data journal — refreshes, oldest first

  // ── resolve data → one provider per table (D24) ──
  const providers = new Map<string, DataProvider>();
  const engines: Record<string, Engine> = {};
  for (const [table, source] of Object.entries(def.data)) {
    if (source.source !== undefined) {
      // an inline source: decoded here, the same rows `rows:` would have carried
      const rows = decodeRows(source.source.format, source.source.at, source.source.options);
      if ('rejected' in rows) throw new DashboardDefError([`data["${table}"].source: ${rows.rejected}`]);
      engines[table] = 'memory';
      providers.set(table, memoryProvider(rows, { tableName: table, ...(source.layout ? { layout: source.layout } : {}) }));
      sources[table] = { format: source.source.format, via: 'inline', version: inlineVersion(source.source.at), retrievedAt: new Date().toISOString(), rows: rows.length };
      continue;
    }
    const engine = resolveEngine(source.engine, statsOf(source), available, table, notes);
    engines[table] = engine;
    providers.set(table, buildProvider(engine, table, source));
  }
  return assemble(def, options, providers, engines, sources, notes, journal, new DerivedColumnStore());
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
  const available = options.availableEngines ?? DEFAULT_AVAILABLE;
  const notes: string[] = [];
  const sources: Record<string, SourceInfo> = {};
  const journal: RefreshRecord[] = []; // the data journal — refreshes, oldest first
  const providers = new Map<string, DataProvider>();
  const engines: Record<string, Engine> = {};
  for (const [table, source] of Object.entries(def.data)) {
    if (source.source !== undefined) {
      // the carrier's refusal is the def's problem, in the same shape the sync door raises it
      const snap = await readSource(source.source, table, options.sources ?? []);
      engines[table] = 'memory';
      providers.set(table, memoryProvider(snap.rows, { tableName: table, ...(source.layout ? { layout: source.layout } : {}) }));
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
    const engine = resolveEngine(source.engine, statsOf(source), available, table, notes);
    engines[table] = engine;
    providers.set(table, buildProvider(engine, table, source));
  }
  const adapters = options.sources ?? [];
  // Which table-store slots hold TRACE-derived columns (src/data/README.md).
  // Dashboard-scoped because the stores are: two sessions write into one
  // provider. A refresh replaces a provider, so it drops that table's slots.
  const derived = new DerivedColumnStore();
  const run = async (which?: readonly string[]): Promise<RefreshResult> => {
    const out: Record<string, RefreshOutcome> = {};
    for (const table of which ?? Object.keys(def.data)) {
      const decl = def.data[table];
      const held = sources[table];
      if (decl === undefined) {
        // an unknown name is refused as such — never described as a table with inline rows
        out[table] = { refused: true, reason: 'no-source', message: `no table "${table}" is declared — the tables are ${Object.keys(def.data).join(', ')}` };
        continue;
      }
      if (decl.source === undefined || held === undefined) {
        out[table] = { refused: true, reason: 'no-source', message: `data["${table}"] declares no source — inline rows never move` };
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
          // the delta is exact only with a row key; the old rows come from the provider being replaced —
          // compared like with like: columns an analysis materialised on them are not in the new bytes,
          // so they are stripped before the compare and REPORTED as lost, never read as "every row updated"
          const old = providers.get(table)!;
          const fresh = memoryProvider(snap.rows, { tableName: table, ...(decl.layout ? { layout: decl.layout } : {}) });
          const prior = await old.evaluate(table, null, { mode: 'rows' });
          /* v8 ignore next -- the table being replaced is a memory provider, which never rejects a rows read and always sets `.rows`; the arms keep the type honest */
          const before = isRejection(prior) ? [] : (prior.rows ?? []);
          // the columns both engines list — no scan of the rows for their keys
          const [oldCols, newCols] = await Promise.all([old.columns(table), fresh.columns(table)]);
          /* v8 ignore next -- a memory provider always lists its columns */
          const arrived = new Set((isRejection(newCols) ? [] : newCols).map((c) => c.name));
          /* v8 ignore next -- a memory provider always lists its columns */
          const goneSlots = (isRejection(oldCols) ? [] : oldCols).map((c) => c.name).filter((c) => !arrived.has(c));
          // A derived column is REPORTED by the name a person knows, not by the
          // slot it lived in; and the registry is dropped with the provider that
          // held it, or the session would keep resolving a name the store lacks.
          const spelling = derived.logicalByPhysical(table);
          const lost = goneSlots.map((c) => spelling.get(c) ?? c);
          derived.clear(table);
          const base = goneSlots.length === 0 ? before : before.map((r) => Object.fromEntries(Object.entries(r).filter(([c]) => arrived.has(c))));
          providers.set(table, fresh);
          sources[table] = { ...held, version: snap.version, retrievedAt: snap.retrievedAt, rows: snap.rows.length };
          out[table] = { changed: true, from: held.version, to: snap.version, retrievedAt: snap.retrievedAt, rows: snap.rows.length, delta: deltaByKey(base, snap.rows, decl.key), ...(lost.length > 0 ? { materialisedLost: lost } : {}) };
        } finally {
          await handle.close();
        }
      } catch (e) {
        out[table] = { refused: true, reason: isSourceRefusal(e) ? e.reason : 'no-source', message: e instanceof Error ? e.message : String(e) };
      }
    }
    journal.push(journalRecord([...(which ?? Object.keys(def.data))], out));
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
  return assemble(def, options, providers, engines, sources, notes, journal, derived, refresh);
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
      if (!['point', 'interval', 'match', 'cell'].includes(c.kind as string)) { bad = `"${String(c.kind)}" is not a condition kind`; break; }
      if (c.kind === 'cell' ? !Array.isArray(c.fields) || c.fields.length !== 2 : typeof c.field !== 'string' || c.field.length === 0) { bad = c.kind === 'cell' ? `a cell condition on "${c.viewId}" needs its two fields` : `a ${c.kind} condition on "${c.viewId}" needs a field`; break; }
      if (c.value === undefined) { bad = `the condition on "${c.viewId}" needs a value`; break; }
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
 * Everything after the providers exist — ONE assembly for both builders.
 *
 * `refresh` is passed IN rather than layered on afterwards. It used to be
 * layered on (`{ ...dashboard, refresh }` in the async builder), and spreading
 * an object EVALUATES its getters: the moment `sources` became a getter that
 * reads live state, the async dashboard froze a build-time snapshot of it and
 * never saw a refresh again. One object literal, built once, cannot go wrong
 * that way.
 */
function assemble(def: DashboardDef, options: BuildDashboardOptions, providers: Map<string, DataProvider>, engines: Record<string, Engine>, sources: Record<string, SourceInfo>, notes: readonly string[], journal: RefreshRecord[], derived: DerivedColumnStore, refresh?: Dashboard['refresh']): Dashboard {
  freezeDefinition(def);
  const saved: SavedStore = { list: [], minted: 0 }; // saved selections: logic beside the log, shared by every session (the counter rides the store: it outlives every session)
  const bookmarks: BookmarkStore = { list: [], minted: 0 }; // bookmarks: names on moments beside the log, shared by every session
  // the commit-id counter: beside those two stores because those two stores POINT AT commit ids
  // across sessions — an id must therefore be unique per dashboard, not per session
  const commitIds: CommitIdStore = { minted: 0 };
  const tables = [...providers.keys()];
  const keys: Record<string, string> = Object.fromEntries(Object.entries(def.data).flatMap(([t, d]) => (d.key !== undefined ? [[t, d.key]] : [])));
  const defaultTable = def.defaultTable ?? tables[0]!;

  // ── promote declared analyses (L3) ──
  const analyses = new Map<string, RegisteredAnalysis>();
  for (const [id, slot] of Object.entries(def.analyses ?? {})) {
    analyses.set(id, registerAnalysisSlot(id, slot));
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
    });
  }

  // ── dual-intent resolver ──
  const intents: Record<DispatchVerb, IntentClass> = { ...DEFAULT_INTENTS };
  for (const decl of def.agent?.intents ?? []) intents[decl.verb] = decl.intent;

  const makeFdrStepper = makeFdrStepperFactory(def);

  // ── layer 4: the link graph, materialized once (the default rule written out; declared edges override in place) ──
  const links = materializeLinks(
    [...views.values()].map((v) => ({
      viewId: v.viewId,
      voice: voiceOf(v.capability, { hasEncodingSurface: v.encoding !== undefined }),
      ...(v.encoding !== undefined ? { channels: v.encoding.channels } : {}),
      ...(v.grain !== undefined ? { grain: v.grain } : {}),
    })),
    def.links ?? [],
    def.linkDefault ?? 'crossfilter',
  );

  const runtime: DashboardRuntime = {
    def,
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
    journal,
    saved,
    bookmarks,
    commitIds,
    derived,
    makeFdrStepper,
    fdrProcedure: def.fdr?.procedure ?? 'LORD++',
    fdrAlpha: def.fdr?.alpha ?? 0.05,
    intentOf: (verb) => intents[verb],
  };

  // the other build-time constants, on the same reasoning as the def
  deepFreeze(engines);
  deepFreeze(keys);
  deepFreeze(notes);

  return {
    def,
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
      const asked = [...(which ?? Object.keys(def.data))];
      const result: RefreshResult = {
        tables: Object.fromEntries(
          asked.map((t) => [
            t,
            def.data[t] === undefined
              ? { refused: true, reason: 'no-source', message: `no table "${t}" is declared — the tables are ${Object.keys(def.data).join(', ')}` }
              : sources[t] !== undefined
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
    lintProse: async () => {
      const cols = await providers.get(defaultTable)!.columns(defaultTable);
      if (isRejection(cols)) throw new Error(`lintProse: the "${defaultTable}" provider cannot list its columns — ${cols.reason}`);
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
          /* v8 ignore next -- every provider's reject() supplies a `detail`; the `reason` fallback is unreachable via the public API (the allRows precedent) */
          out.push(`data["${table}"].key "${key}": the engine cannot list this table's columns — ${cols.detail ?? cols.reason}`);
          continue;
        }
        if (!cols.some((c) => c.name === key)) out.push(`data["${table}"].key "${key}" names no column of the table — the columns are ${cols.map((c) => c.name).join(', ')}`);
      }
      return out;
    },
    lint: async () => {
      const cols = await providers.get(defaultTable)!.columns(defaultTable);
      if (isRejection(cols)) throw new Error(`lint: the "${defaultTable}" provider cannot list its columns — ${cols.reason}`);
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
      return lintEncodings({
        views: surfaces,
        facets: [...runtime.encoding.facetsOf(defaultTable, cols), ...extra],
        rules: runtime.encoding.rules,
        ports: runtime.encoding.ports,
      });
    },
  };
}
