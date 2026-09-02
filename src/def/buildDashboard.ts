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
import { isRejection } from '../data/index.js';
import type { ColumnFacet } from '../data/index.js';

/** The offline dashboard handle. `createSession()` opens one live, stateful session. */
export interface Dashboard {
  /** The (frozen) validated def. */
  readonly def: DashboardDef;
  /** The resolved engine each table routed to (D24 audit). */
  readonly engines: Readonly<Record<string, Engine>>;
  /** Open a fresh session: one live Mosaic Selection + commit log + FDR ledger. */
  createSession(opts?: SessionOptions): InteractionSession;
  /**
   * The LINT door of the encoding plane: every declared initial binding judged
   * with the provider's real column types (the build door judged what the def
   * alone could prove). Throws when the default table's provider cannot list
   * its columns (a stub engine) — nothing to judge is not "nothing wrong".
   */
  lint(): Promise<EncodingProblem[]>;
}

/** Options controlling engine resolution for `engine: 'auto'` tables. */
export interface BuildDashboardOptions {
  /**
   * Engines actually available in this environment. `wasm`/`server` are typed
   * stubs today, so a caller driving real data should leave this at its default
   * (`['memory']`) — `auto` then always resolves to the runnable memory engine.
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

function resolveEngine(
  declared: Engine | undefined,
  stats: DatasetStats,
  available: readonly ResolvedEngine[],
): ResolvedEngine {
  const engine = declared ?? 'memory';
  if (engine !== 'auto') return engine;
  return chooseEngine(stats, { availableEngines: available });
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

  const available = options.availableEngines ?? DEFAULT_AVAILABLE;

  // ── resolve data → one provider per table (D24) ──
  const providers = new Map<string, DataProvider>();
  const engines: Record<string, Engine> = {};
  for (const [table, source] of Object.entries(def.data)) {
    const engine = resolveEngine(source.engine, statsOf(source), available);
    engines[table] = engine;
    providers.set(table, buildProvider(engine, table, source));
  }
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
  const views = new Map<string, ViewDecl>();
  for (const [viewId, meta] of Object.entries(def.actors)) {
    views.set(viewId, {
      viewId,
      meta,
      ...(capabilityByView.has(viewId) ? { capability: capabilityByView.get(viewId)! } : {}),
      ...(encodingByView.has(viewId) ? { encoding: encodingByView.get(viewId)! } : {}),
    });
  }

  // ── dual-intent resolver ──
  const intents: Record<DispatchVerb, IntentClass> = { ...DEFAULT_INTENTS };
  for (const decl of def.agent?.intents ?? []) intents[decl.verb] = decl.intent;

  const makeFdrStepper = makeFdrStepperFactory(def);

  // ── layer 4: the link graph, materialized once (the default rule written out; declared edges override in place) ──
  const links = materializeLinks(
    [...views.values()].map((v) => ({ viewId: v.viewId, voice: voiceOf(v.capability) })),
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
    makeFdrStepper,
    fdrProcedure: def.fdr?.procedure ?? 'LORD++',
    fdrAlpha: def.fdr?.alpha ?? 0.05,
    intentOf: (verb) => intents[verb],
  };

  Object.freeze(engines);

  return {
    def,
    engines,
    createSession: (opts) => createInteractionSession(runtime, opts),
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
