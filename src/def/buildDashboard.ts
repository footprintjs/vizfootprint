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
} from './types.js';
import { createInteractionSession, type InteractionSession } from '../session/session.js';
import type { SessionOptions } from '../session/types.js';
import { materializeLinks, voiceOf } from '../links/index.js';
import { lintEncodings, resolveFacet, resolveFacets } from '../encoding/index.js';
import type { EncodingPorts, EncodingProblem } from '../encoding/index.js';
import { validateProseRecord } from '../prose/index.js';
import type { ProseProblem } from '../prose/index.js';
import { isRejection } from '../data/index.js';
import { decodeRows, inlineVersion, openSource } from '../source/index.js';
import type { SourceAdapter, SourceDecl, SourceInfo, SourceSnapshot } from '../source/index.js';
import type { ColumnFacet } from '../data/index.js';

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
  return assemble(def, options, providers, engines, sources, notes);
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
  return assemble(def, options, providers, engines, sources, notes);
}

/** Open, snapshot, close — and turn what the carrier refused into a def problem. */
async function readSource(decl: SourceDecl, table: string, adapters: readonly SourceAdapter[]): Promise<SourceSnapshot> {
  try {
    const handle = await openSource(decl, table, adapters);
    try {
      return await handle.snapshot();
    } finally {
      await handle.close();
    }
  } catch (e) {
    throw new DashboardDefError([`data["${table}"].source: ${e instanceof Error ? e.message : String(e)}`]);
  }
}

/** Everything after the providers exist — one assembly for both builders. */
function assemble(def: DashboardDef, options: BuildDashboardOptions, providers: Map<string, DataProvider>, engines: Record<string, Engine>, sources: Record<string, SourceInfo>, notes: readonly string[]): Dashboard {
  const tables = [...providers.keys()];
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
    makeFdrStepper,
    fdrProcedure: def.fdr?.procedure ?? 'LORD++',
    fdrAlpha: def.fdr?.alpha ?? 0.05,
    intentOf: (verb) => intents[verb],
  };

  Object.freeze(engines);

  return {
    def,
    engines,
    sources,
    notes,
    createSession: (opts) => createInteractionSession(runtime, opts),
    lintProse: async () => {
      const cols = await providers.get(defaultTable)!.columns(defaultTable);
      if (isRejection(cols)) throw new Error(`lintProse: the "${defaultTable}" provider cannot list its columns — ${cols.reason}`);
      const world = { columns: new Set(cols.map((c) => c.name)), analyses: new Set(analyses.keys()), surfaced: new Set([...views.values()].filter((v) => v.encoding !== undefined).map((v) => v.viewId)) };
      const problems: ProseProblem[] = [];
      for (const [viewId, slots] of runtime.prose) for (const [slot, record] of Object.entries(slots)) problems.push(...validateProseRecord(viewId, slot, record, world));
      return problems;
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
