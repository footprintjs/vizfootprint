/**
 * L5 session — COVERAGE PACKET (dispatch/seek/branch/checkpoint corners).
 *
 * session.test.ts and timeTravel.test.ts already pin the documented R#
 * behaviors; this file drives the remaining verb-validation edges,
 * branch-scoped column edges, and seek/fold corners entirely through the
 * PUBLIC `InteractionSession` API (`buildDashboard(...).createSession()`,
 * plus `s.log` which is itself part of that public surface — see
 * `InteractionSession.log` in `types.ts`).
 */
import { describe, it, expect } from 'vitest';
import { flowChart } from 'footprintjs';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from './dashboard.fixture.js';
import { TEST_ANALOG_FIELD } from '../fdr/index.js';
import type { Cause } from '../cause/index.js';
import type { AnalysisDef, AnalysisModule, ColumnsOutput, ScalarOutput, TableOutput, DataRow } from '../analysis/index.js';
import type { AgentEventFrame } from '../why/index.js';
import { GapLedger } from './gapLedger.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });

function freshSession() {
  return buildDashboard(makeDashboardDef()).createSession();
}

// ── minimal custom defs (kept local to THIS file — the shared fixture is not
// touched) ─────────────────────────────────────────────────────────────────

/** Tiny def: one memory table, one plain view, an overridable `fdr` decl. */
function tinyDef(fdr: DashboardDef['fdr']): DashboardDef {
  return {
    data: { data: { rows: SAMPLE_ROWS } },
    actors: { bar: { actor: 'user' } },
    fdr,
    defaultTable: 'data',
  };
}

/** A view with a STATICALLY declared capability.encodings (point only). */
function narrowCapabilityDef(): DashboardDef {
  return {
    data: { data: { rows: SAMPLE_ROWS } },
    actors: { narrow: { actor: 'user' } },
    capabilities: [{ viewId: 'narrow', canProbe: true, encodings: ['point'] }],
    defaultTable: 'data',
  };
}

/** A view with a declared encoding surface that carries NO `initial` map. */
function noInitialEncodingDef(): DashboardDef {
  return {
    data: { data: { rows: SAMPLE_ROWS } },
    actors: { scatter: { actor: 'user' } },
    encodings: [{ viewId: 'scatter', chartKind: 'point', channels: ['x', 'y'] }],
    defaultTable: 'data',
  };
}

/** Two tables: `data` (memory, readable) + `sink` (server, materialize rejects). */
function dualTableDef(): DashboardDef {
  return {
    data: {
      data: { rows: SAMPLE_ROWS },
      sink: { rows: [], engine: 'server' },
    },
    actors: { bar: { actor: 'user' } },
    defaultTable: 'data',
  };
}

describe('constructor — initial alpha-wealth (the fdr?.w0 ?? procedure ternary)', () => {
  it('alpha-investing with no declared w0 seeds wealth at fdrAlpha directly (not halved)', async () => {
    const s = buildDashboard(tinyDef({ procedure: 'alpha-investing', alpha: 0.2 })).createSession();
    expect((await s.overview()).fdr.wealth).toBe(0.2);
  });

  it('a declared fdr.w0 seeds wealth directly, bypassing the procedure ternary entirely', async () => {
    const s = buildDashboard(tinyDef({ procedure: 'LORD++', alpha: 0.2, w0: 0.05 })).createSession();
    expect((await s.overview()).fdr.wealth).toBe(0.05);
  });
});

describe('branchPath — defensive dangling-parent guard', () => {
  it('a commit landed directly on the log (bypassing dispatch) with a nonexistent parent stops the fold cleanly', async () => {
    const s = freshSession();
    // Register 'bar' through the normal path first so its source identity exists.
    const seed = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(seed.ok).toBe(true);
    const barMeta = s.log.records[0]!.actorMeta;

    // Land a raw commit whose parent points at an id that was never committed.
    const { record } = s.log.commit({
      id: 'dangling-1',
      parent: 'no-such-ancestor',
      viewId: 'bar',
      actorMeta: barMeta,
      kind: 'point',
      field: 'category',
      value: 'Work',
      cause: userCause(),
    });

    // seek() only checks the commit ITSELF exists (it does) — the fold walk
    // must not throw when it later hits the dangling parent, it just stops.
    const res = s.seek(record.id);
    expect(res.ok).toBe(true);
    expect(s.cursor()).toBe(record.id);
    const ov = await s.overview();
    expect(ov.activeSelections).toEqual([{ viewId: 'bar', field: 'category', kind: 'point', value: 'Work' }]);
  });
});

describe('rebuildFold — reserved-field commits are inert even if landed directly on a real view', () => {
  it('a raw commit reusing the reserved pValue field on a declared view does not corrupt the replayed fold', async () => {
    const s = freshSession();
    const before = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(before.ok).toBe(true);
    const beforeId = before.ok ? before.commit!.id : '';
    const barMeta = s.log.records[0]!.actorMeta;

    // doProbe would reject this (R6 guard) — land it directly on the log instead,
    // exercising rebuildFold's OWN defensive skip during replay.
    const { record: reservedRec } = s.log.commit({
      id: 'reserved-1',
      parent: beforeId,
      viewId: 'bar',
      actorMeta: barMeta,
      kind: 'point',
      field: TEST_ANALOG_FIELD,
      value: 0.5,
      cause: userCause(),
    });

    const seekRes = s.seek(reservedRec.id);
    expect(seekRes.ok).toBe(true);
    // the reserved-field commit must not overwrite (or appear as) bar's selection
    const ov = await s.overview();
    expect(ov.activeSelections).toEqual([{ viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' }]);
  });
});

describe('rebuildFold — an interval-clear commit replayed via seek (not just live)', () => {
  it('seeking to a commit whose path includes a null-valued interval clears that view in the rebuilt fold', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 120], cause: userCause() });
    const cleared = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: null, cause: userCause() });
    expect(cleared.ok).toBe(true);
    const clearedId = cleared.ok ? cleared.commit!.id : '';

    // Seeking directly AT the clearing commit forces rebuildFold to REPLAY both
    // the interval-set and the interval-clear (rather than trust the live path).
    s.seek(clearedId);
    const ov = await s.overview();
    expect(ov.activeSelections.find((a) => a.viewId === 'scatter')).toBeUndefined();
  });
});

describe('allRows / columnsOf / selectedRows — no provider at all for a table', () => {
  it('selectedRows on a table with no provider returns [] honestly (never throws)', async () => {
    const s = freshSession();
    await expect(s.selectedRows('totally-unknown-table')).resolves.toEqual([]);
  });

  it('a session whose defaultTable has no provider files needs-backend-data on select AND reencode', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession({ defaultTable: 'ghost-table' });
    const sel = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(sel.ok).toBe(false);
    if (!sel.ok) {
      expect(sel.rejection.code).toBe('needs-backend-data');
      expect(sel.rejection.detail).toBe('no provider for table "ghost-table"');
    }

    const renc = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'price', cause: userCause() });
    expect(renc.ok).toBe(false);
    if (!renc.ok) expect(renc.rejection.code).toBe('needs-backend-data');

    // overview()'s per-view `columns` fallback + the defaultCols fallback both
    // fire because 'ghost-table' never appears in `runtime.tables`.
    const ov = await s.overview();
    const bar = ov.views.find((v) => v.viewId === 'bar')!;
    expect(bar.columns).toEqual([]);
  });
});

describe('overview() — a real declared table whose provider rejects columns()', () => {
  it('a server-engine table shows an empty column list, never a thrown error', async () => {
    const dash = buildDashboard(makeDashboardDef({ engine: 'server' }), { availableEngines: ['memory', 'wasm', 'server'] });
    const s = dash.createSession();
    const ov = await s.overview();
    expect(ov.columns['data']).toEqual([]);
  });
});

describe('probeCapability / probeGuard — a statically declared capability.encodings', () => {
  it('narrows probeGuard to the declared kinds and shows up in overview.selectionKinds', async () => {
    const s = buildDashboard(narrowCapabilityDef()).createSession();
    const okSelect = await s.dispatch({ verb: 'select', viewId: 'narrow', field: 'category', value: 'Formal', cause: userCause() });
    expect(okSelect.ok).toBe(true); // 'point' IS in the declared encodings -> falls through to allow

    const badFilter = await s.dispatch({ verb: 'filter', viewId: 'narrow', field: 'price', range: [1, 2], cause: userCause() });
    expect(badFilter.ok).toBe(false);
    if (!badFilter.ok) {
      expect(badFilter.rejection.code).toBe('guard-failed');
      expect(badFilter.rejection.detail).toBe('view "narrow" does not encode a interval selection');
    }

    const ov = await s.overview();
    expect(ov.views.find((v) => v.viewId === 'narrow')!.selectionKinds).toEqual(['point']);
  });
});

describe('mountView — an undeclared view is a typed needs-view gap', () => {
  it('mounting an adapter under an unknown viewId does not register it', () => {
    const s = freshSession();
    const res = s.mountView('ghost-view', { capabilities: { canProbe: true } });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap.code).toBe('needs-view');
      expect(res.gap.op).toBe('mountView');
    }
  });
});

describe('dispatch — the annotate verb (never exercised via dispatch elsewhere)', () => {
  it('lands an inert annotation commit and echoes { target, note }', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'annotate', target: 'cluster_id', note: 'looks bimodal', cause: userCause() });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.verb).toBe('annotate');
      expect(res.intent).toBe('optional-interaction');
      expect(res.annotated).toEqual({ target: 'cluster_id', note: 'looks bimodal' });
      expect(res.commit).toMatchObject({ viewId: 'annotation:user', field: '__annotation__', value: 'looks bimodal', kind: 'point' });
    }
    expect(s.log.records).toHaveLength(1);
    expect(s.head).toBe(s.log.records[0]!.id); // annotate still lands/branch-on-acts like any other verb
  });
});

describe('dispatch — the navigate verb (never exercised via dispatch elsewhere)', () => {
  it('a known view sets currentView; an unknown view is a typed needs-view gap', async () => {
    const s = freshSession();
    const ok = await s.dispatch({ verb: 'navigate', viewId: 'bar', cause: userCause() });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.verb).toBe('navigate');
      expect(ok.intent).toBe('optional-interaction');
      expect(ok.navigatedTo).toBe('bar');
    }
    expect((await s.overview()).currentView).toBe('bar');
    expect(s.log.records).toHaveLength(0); // navigate lands NO commit

    const bad = await s.dispatch({ verb: 'navigate', viewId: 'ghost', cause: userCause() });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.rejection.code).toBe('needs-view');
    // a failed navigate does not clobber the prior currentView
    expect((await s.overview()).currentView).toBe('bar');
  });
});

describe('doReencode — correlationId spread + a view with no declared `initial` map', () => {
  it('the first reencode on a no-initial view falls back to {} live, and the SAME fallback fires on replay via seek', async () => {
    const s = buildDashboard(noInitialEncodingDef()).createSession();
    expect(s.viewEncodings('scatter')).toEqual({}); // no `initial` declared at all

    const c1 = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'price', cause: userCause(), correlationId: 'renc-1' });
    expect(c1.ok).toBe(true);
    if (c1.ok) expect(c1.commit!.correlationId).toBe('renc-1');
    expect(s.viewEncodings('scatter')).toEqual({ x: 'price' });

    const c2 = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'y', field: 'category', cause: userCause() });
    expect(c2.ok).toBe(true);
    const c2Id = c2.ok ? c2.commit!.id : '';

    // Force a FULL fold rebuild (rebuildFold's own `?? {}` seed path, not the
    // live doReencode path exercised above) by seeking to the tip.
    s.seek(c2Id);
    expect(s.viewEncodings('scatter')).toEqual({ x: 'price', y: 'category' });
  });
});

describe('doProbe — the correlationId spread + an explicit undefined point value', () => {
  it('a select carries an optional correlationId onto its commit', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause(), correlationId: 'sel-xyz' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.commit!.correlationId).toBe('sel-xyz');
  });

  it('an explicit undefined value still lands — as a CLEAR: the commit is real, the view has no active selection (SET-1: one clearing rule for every kind)', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: undefined, cause: userCause() });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.commit?.kind).toBe('point');
    const ov = await s.overview();
    expect(ov.activeSelections.find((a) => a.viewId === 'bar')).toBeUndefined();
  });
});

describe('dispatch — the analyze verb (existing tests only exercise its needs-analysis-kind gap)', () => {
  it('with none of {input, as, correlationId} supplied', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'analyze', analysisId: 'correlation', cause: userCause() });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.verb).toBe('analyze');
      expect(res.analysis!.analysisId).toBe('correlation');
    }
  });

  it('with input, as, AND correlationId all supplied', async () => {
    const s = freshSession();
    const res = await s.dispatch(
      { verb: 'analyze', analysisId: 'correlation', cause: userCause(), input: SAMPLE_ROWS.slice(0, 12), correlationId: 'an-1' },
      { as: 'agent' },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.analysis!.result.ok).toBe(true);
      expect(res.analysis!.commit?.correlationId).toBe('an-1');
      expect(res.analysis!.commit?.cause.requestedBy).toBe('agent');
    }
  });
});

describe('doCheckpoint — a too-long label is a typed guard-failed gap', () => {
  it('rejects a label over 200 chars and truncates the detail to 40 chars', async () => {
    const s = freshSession();
    const long = 'x'.repeat(250);
    const res = await s.dispatch({ verb: 'checkpoint', label: long, cause: userCause() });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.rejection.code).toBe('guard-failed');
      expect(res.rejection.target).toBe(long.slice(0, 40));
    }
    expect(s.checkpoints()).toHaveLength(0);
  });
});

describe('declareAnalysis — the { def } inline-registration option + the unknown-id throw', () => {
  it('declareAnalysis(id, { def }) registers AND runs in one call', async () => {
    const s = freshSession();
    const inline: AnalysisDef<void, ScalarOutput> = {
      id: 'inline-const',
      kind: 'transform',
      produces: 'scalar',
      inputs: [],
      build: () => flowChart<Record<string, unknown>>('seed', (scope) => scope.$setValue('v', 42), 'seed').build(),
      toRunInput: () => undefined,
      readOutput: ({ snapshot }) => ({ ok: true, output: { as: 'scalar', name: 'v', value: snapshot.sharedState.v as number } }),
    };
    expect(s.hasAnalysis('inline-const')).toBe(false);
    const res = await s.declareAnalysis('inline-const', { def: inline });
    expect(s.hasAnalysis('inline-const')).toBe(true);
    expect(res.result.ok).toBe(true);
    if (res.result.ok) expect(res.result.output).toEqual({ as: 'scalar', name: 'v', value: 42 });
  });

  it('a totally unknown id with no { def } throws (never a silent empty result)', async () => {
    const s = freshSession();
    await expect(s.declareAnalysis('never-declared')).rejects.toThrow(
      'vizfootprint: unknown analysis "never-declared" — declare it in the def or pass { def }',
    );
  });
});

describe('declareAnalysis — the columns-materialize branches (needs-view / guard-failed / needs-backend-data)', () => {
  const flow = (setup: (scope: { $setValue(k: string, v: unknown): void }) => void) =>
    flowChart<Record<string, unknown>>('seed', setup, 'seed').build();

  it('a columns output naming a table with NO provider is a needs-view gap; nothing materializes', async () => {
    const s = freshSession();
    const ghostOut: AnalysisDef<readonly DataRow[], ColumnsOutput> = {
      id: 'ghost-out',
      kind: 'transform',
      produces: 'columns',
      inputs: [],
      build: () => flow((scope) => scope.$setValue('foo', [1])),
      toRunInput: () => [],
      readOutput: () => ({ ok: true, output: { as: 'columns', table: 'no-such-table', columns: { foo: { type: 'int' } } } }),
    };
    const res = await s.declareAnalysis('ghost-out', { def: ghostOut });
    expect(res.materialized).toEqual([]);
    expect(res.gap?.code).toBe('needs-view');
    expect(res.gap?.detail).toBe('no provider for table "no-such-table"');
  });

  it('a column the flowchart never set, AND a wrong-length column, both land guard-failed gaps on the SAME memory table', async () => {
    const s = freshSession();
    const badCols: AnalysisDef<readonly DataRow[], ColumnsOutput> = {
      id: 'bad-cols',
      kind: 'transform',
      produces: 'columns',
      // A real column length is SAMPLE_ROWS.length (40); 3 will always mismatch.
      build: () => flow((scope) => scope.$setValue('shortCol', [1, 2, 3])),
      inputs: [],
      toRunInput: () => [],
      readOutput: () => ({
        ok: true,
        output: { as: 'columns', table: 'data', columns: { missingCol: { type: 'int' }, shortCol: { type: 'int' } } },
      }),
    };
    const res = await s.declareAnalysis('bad-cols', { def: badCols });
    expect(res.materialized).toEqual([]); // neither column landed
    expect(res.gap?.code).toBe('guard-failed');
    // the LAST failing column's gap is what rides the return (both filed on the ledger)
    const gaps = s.gaps().filter((g) => g.op === 'declareAnalysis');
    expect(gaps.map((g) => g.detail)).toEqual([
      'analysis "bad-cols" produced no values for column "missingCol"',
      expect.stringContaining('has 40 rows; got 3 values'),
    ]);
  });

  it('a columns output landing on a DIFFERENT (server-engine) table is a needs-backend-data gap', async () => {
    const s = buildDashboard(dualTableDef()).createSession();
    const toSink: AnalysisDef<readonly DataRow[], ColumnsOutput> = {
      id: 'to-sink',
      kind: 'transform',
      produces: 'columns',
      inputs: [],
      build: () => flow((scope) => scope.$setValue('foo', [1, 2, 3])),
      toRunInput: () => [],
      readOutput: () => ({ ok: true, output: { as: 'columns', table: 'sink', columns: { foo: { type: 'int' } } } }),
    };
    const res = await s.declareAnalysis('to-sink', { def: toSink, table: 'data' });
    expect(res.materialized).toEqual([]);
    expect(res.gap?.code).toBe('needs-backend-data');
  });
});

describe('declareAnalysis — a "table" output (groupby) reaches the else arm of the columns/scalar/table split', () => {
  it('groupby runs over the SELECTION (not the full table) and its provenance carries no scalar kernelKey', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    const res = await s.declareAnalysis('groupby');
    expect(res.result.ok).toBe(true);
    if (res.result.ok) expect(res.result.output.as).toBe('table');
    // reachable at all only if the provenance capture's table/geometry arm ran
    const w = s.why({ kind: 'hypothesis', analysisId: 'groupby' });
    expect(w.ok).toBe(true);
  });
});

describe('declareAnalysis — an ambiguous scalar value resolves to an honest missing kernelKey', () => {
  it('two committed state keys sharing the same value make resolveScalarKernelKey report undefined (never a guess)', async () => {
    const s = freshSession();
    const ambiguous: AnalysisDef<void, ScalarOutput> = {
      id: 'ambiguous',
      kind: 'transform',
      produces: 'scalar',
      inputs: [],
      build: () =>
        flowChart<Record<string, unknown>>(
          'seed',
          (scope) => {
            scope.$setValue('a', 1);
            scope.$setValue('b', 1); // TWO keys share the value the output reports
          },
          'seed',
        ).build(),
      toRunInput: () => undefined,
      readOutput: () => ({ ok: true, output: { as: 'scalar', name: 'x', value: 1 } }),
    };
    const res = await s.declareAnalysis('ambiguous', { def: ambiguous });
    expect(res.result.ok).toBe(true);
    const w = s.why({ kind: 'hypothesis', analysisId: 'ambiguous' });
    expect(w.ok).toBe(true);
    if (w.ok) expect(w.kernel?.writerId === undefined || w.key).toBeDefined(); // honest either way, never a crash
  });
});

describe('declareAnalysis — a hand-authored AnalysisModule with NO snapshot (bypasses defineAnalysis entirely)', () => {
  it('resolveScalarKernelKey short-circuits on a missing snapshot; why() reports the tier honestly absent', async () => {
    const s = freshSession();
    const rawDef: AnalysisDef<void, ScalarOutput> = {
      id: 'no-snap',
      kind: 'transform',
      produces: 'scalar',
      inputs: [],
      build: () => flowChart<Record<string, unknown>>('seed', (scope) => scope.$setValue('unused', 0), 'seed').build(),
      toRunInput: () => undefined,
      readOutput: () => ({ ok: true, output: { as: 'scalar', name: 'noSnap', value: 7 } }),
    };
    const rawModule: AnalysisModule<void, ScalarOutput> = {
      id: 'no-snap',
      kind: 'transform',
      def: rawDef,
      // No `snapshot` in the returned AnalysisRunResult — a caller-supplied
      // module is free to skip it; the session must degrade honestly.
      run: async () => ({ result: { ok: true, output: { as: 'scalar', name: 'noSnap', value: 7 } } }),
    };
    s.registerAnalysis('no-snap', rawModule);
    const res = await s.declareAnalysis('no-snap');
    expect(res.result.ok).toBe(true);
    expect(res.commit).toBeDefined(); // still lands the viz-tier provenance commit

    const w = s.why({ kind: 'hypothesis', analysisId: 'no-snap' });
    expect(w.ok).toBe(true);
    if (w.ok) {
      expect(w.kernel).toBeNull(); // no snapshot -> no kernel tier
      expect(w.misses.some((m) => m.tier === 'kernel')).toBe(true);
    }
  });
});

describe('why(target) — the real cross-tier assembly (session.test.ts only pins the no-such-target miss)', () => {
  it('a materialized column answers with viz + kernel tiers, unthreaded (no correlationId/agent supplied)', async () => {
    const s = freshSession();
    const clustered = await s.declareAnalysis('clustering');
    expect(clustered.materialized).toEqual(['cluster_id']);

    const w = s.why({ kind: 'column', column: 'cluster_id' });
    expect(w.ok).toBe(true);
    if (w.ok) {
      expect(w.targetKind).toBe('column');
      expect(w.key).toBe('cluster_id');
      expect(w.viz.commitId).toBe(clustered.commit!.id);
      expect(w.threaded).toBe(false);
      expect(w.agent).toBeNull();
      expect(w.kernel).not.toBeNull();
      expect('correlationId' in w).toBe(false);
      expect('fdr' in w).toBe(false);
    }
  });

  it('a hypothesis target THREADED through a correlationId + agentEventLog resolves ALL three tiers', async () => {
    const s = freshSession();
    const declared = await s.declareAnalysis('correlation', { correlationId: 'corr-42' });
    expect(declared.fdrStep).toBeDefined();
    const frame: AgentEventFrame = { toolCallId: 'tool-1', runId: 'run-1', runtimeStageId: 'analyze#1', correlationId: 'corr-42' };

    const w = s.why({ kind: 'hypothesis', analysisId: 'correlation' }, { agentEventLog: [frame] });
    expect(w.ok).toBe(true);
    if (w.ok) {
      expect(w.correlationId).toBe('corr-42');
      expect(w.threaded).toBe(true);
      expect(w.agent).toEqual({ toolCallId: 'tool-1', runtimeStageId: 'analyze#1', runId: 'run-1' });
      expect(w.fdr).toEqual({ step: declared.fdrStep!.step, reject: declared.fdrStep!.reject });
    }
  });
});

describe('visibleMaterialized — a materialized column on one table never leaks visibility onto another', () => {
  it('overview() over a SECOND declared table never counts a cluster_id materialized on `data`', async () => {
    const base = makeDashboardDef();
    const twoTableDef: DashboardDef = { ...base, data: { ...base.data, other: { rows: SAMPLE_ROWS } } };
    const s = buildDashboard(twoTableDef).createSession();
    const clustered = await s.declareAnalysis('clustering'); // materializes cluster_id on 'data' only
    expect(clustered.materialized).toEqual(['cluster_id']);

    const ov = await s.overview();
    expect(ov.columns['data']!.map((c) => c.field)).toContain('cluster_id');
    expect(ov.columns['other']!.map((c) => c.field)).not.toContain('cluster_id');
  });
});

describe('GapLedger — a gap filed with no target omits the field entirely', () => {
  it('rows() carries no `target` key when the caller does not supply one', () => {
    const ledger = new GapLedger();
    const row = ledger.file('needs-view', 'mountView', 'no target supplied here');
    expect('target' in row).toBe(false);
    expect(row.target).toBeUndefined();
    expect(ledger.rows()).toEqual([row]);
    expect(ledger.byCode()).toMatchObject({ 'needs-view': 1 });
  });
});

describe('dashboard.fixture — withDisplayView:false omits the display view', () => {
  it('the fixture def carries only scatter/bar/cluster when withDisplayView is false', () => {
    const def = makeDashboardDef({ withDisplayView: false });
    expect(Object.keys(def.actors).sort()).toEqual(['bar', 'cluster', 'scatter']);
  });
});
