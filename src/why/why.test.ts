/**
 * P3-L6 acceptance — `session.why(target)` over the LIVE session, proving the
 * TWO target kinds adjudication C2 demands (a materialised COLUMN and a
 * SCALAR/hypothesis ledger row) with full DECOY discipline: every test asserts
 * decoys ABSENT (minimality), not merely the wanted commits present.
 *
 *   A1 — both target kinds: slice == the hand-listed minimal set, decoys excluded.
 *   A2 — machine-shaped: flat {tier,id,kind} records, no prose fields.
 *   A4 — honest misses typed (no-agent-tier / no-kernel-snapshot / kernel-key-
 *        unresolved / no-such-target / no-join-key), never faked.
 *
 * Custom analyses carry an intra-kernel DECOY stage (writes a key nothing reads)
 * so `sliceForKey` minimality is exercised at the session level too.
 */

import { describe, expect, it } from 'vitest';
import { flowChart } from 'footprintjs';
import type { FlowChart } from 'footprintjs';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import {
  defineAnalysis,
  normalApproxPValue,
  pearson,
  quantileBins,
  type ColumnsOutput,
  type DataRow,
  type ScalarOutput,
} from '../analysis/index.js';
import { resolveAgentTier, resolveKernelTier } from './index.js';
import type { CrossTierSlice } from './index.js';
import { runKernel } from './kernel.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });

function freshSession() {
  return buildDashboard(makeDashboardDef()).createSession();
}

// ── custom analyses, each with an intra-kernel DECOY stage ──────────────────────

/** columns channel — quantile bins → `cluster_id`, with a `kdecoy` stage nothing reads. */
const clusterDecoy = defineAnalysis<readonly DataRow[], ColumnsOutput>({
  id: 'cluster-decoy',
  kind: 'transform',
  produces: 'columns',
  inputs: [{ column: 'price', role: 'value' }],
  build: (): FlowChart =>
    flowChart<Record<string, unknown>>(
      'load values',
      (scope) => {
        const args = scope.$getArgs<{ values: number[]; k: number }>();
        scope.$setValue('clusterVals', args.values);
        scope.$setValue('clusterK', args.k);
      },
      'load',
    )
      .addFunction(
        'audit (decoy)',
        (scope) => {
          const v = scope.$getValue('clusterVals') as number[];
          scope.$setValue('kdecoyNote', `n=${v.length}`); // read by nobody
        },
        'kdecoy',
      )
      .addFunction(
        'assign bins',
        (scope) => {
          const v = scope.$getValue('clusterVals') as number[];
          const k = scope.$getValue('clusterK') as number;
          scope.$setValue('cluster_id', quantileBins(v, k));
        },
        'cluster',
      )
      .build(),
  toRunInput: (rows) => ({ values: rows.map((r) => Number(r.price)), k: 4 }),
  readOutput: () => ({ ok: true, output: { as: 'columns', table: 'data', columns: { cluster_id: { type: 'int' } } } }),
});

/** scalar/test channel — Pearson r, with a `cdecoy` stage nothing reads. */
const corrDecoy = defineAnalysis<readonly DataRow[], ScalarOutput>({
  id: 'corr-decoy',
  kind: 'test',
  produces: 'scalar',
  inputs: [
    { column: 'price', role: 'x' },
    { column: 'rating', role: 'y' },
  ],
  build: (): FlowChart =>
    flowChart<Record<string, unknown>>(
      'load pairs',
      (scope) => {
        const args = scope.$getArgs<{ xs: number[]; ys: number[] }>();
        scope.$setValue('cxs', args.xs);
        scope.$setValue('cys', args.ys);
      },
      'load',
    )
      .addFunction(
        'audit (decoy)',
        (scope) => {
          const xs = scope.$getValue('cxs') as number[];
          scope.$setValue('cdecoyNote', `n=${xs.length}`); // read by nobody
        },
        'cdecoy',
      )
      .addFunction(
        'compute r',
        (scope) => {
          const xs = scope.$getValue('cxs') as number[];
          const ys = scope.$getValue('cys') as number[];
          const { r, n } = pearson(xs, ys);
          scope.$setValue('rval', r);
          scope.$setValue('nval', n);
        },
        'correlate',
      )
      .build(),
  toRunInput: (rows) => ({ xs: rows.map((r) => Number(r.price)), ys: rows.map((r) => Number(r.rating)) }),
  readOutput: ({ snapshot }) => {
    const r = snapshot.sharedState.rval as number;
    if (!Number.isFinite(r)) return { ok: false, reason: 'degenerate-fit', n: snapshot.sharedState.nval as number, fitDegenerate: true };
    return { ok: true, output: { as: 'scalar', name: 'corr_price_rating', value: r } };
  },
  test: {
    statistic: 'pearson-r',
    pValue: ({ snapshot }) => normalApproxPValue(snapshot.sharedState.rval as number, snapshot.sharedState.nval as number),
  },
});

// ── A1(a) — a materialised COLUMN ───────────────────────────────────────────────

describe('A1(a) — why({kind:column}) over a materialised column (cluster_id)', () => {
  it('slice == {declaring + kernel load,cluster}; an active-but-unused select is EXCLUDED', async () => {
    const s = freshSession();
    s.registerAnalysis('cluster-decoy', clusterDecoy);
    // A DECOY select that stays ACTIVE — a full-table columns transform does NOT
    // depend on it, so `why` must exclude it (minimality, not reachability).
    const decoySel = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    const decoySelId = decoySel.ok ? decoySel.commit!.id : '';
    const a = await s.declareAnalysis('cluster-decoy');
    expect(a.materialized).toContain('cluster_id');

    const r = s.why({ kind: 'column', column: 'cluster_id' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // hand-computed minimal set: declaring commit + kernel {load, cluster}.
    const composed = r.commits.map((c) => `${c.tier}:${c.kind}:${c.stageId ?? c.id}`).sort();
    expect(composed).toEqual(
      [`viz:declaring:${a.commit!.id}`, 'kernel:kernel-stage:load', 'kernel:kernel-stage:cluster'].sort(),
    );
    // DECOYS excluded: the active select, and the intra-kernel `kdecoy` stage.
    const ids = new Set(r.commits.map((c) => c.id));
    expect(ids.has(decoySelId)).toBe(false);
    expect(r.kernel!.stageIds).not.toContain('kdecoy');
    // full-table transform ⇒ no input-selection commits (honest, minimal).
    expect(r.commits.some((c) => c.kind === 'input-selection')).toBe(false);
    // no agent tier was threaded ⇒ typed miss (A4), not a fake.
    expect(r.agent).toBeNull();
    expect(r.misses).toContainEqual({ tier: 'agent', missing: 'no-agent-tier' });
  });
});

// ── A1(b) — a SCALAR / hypothesis ledger row ────────────────────────────────────

describe('A1(b) — why({kind:hypothesis}) over a scalar/test result (corr-decoy)', () => {
  it('slice == {declaring + input-selection + kernel load,correlate}; superseded/cleared/other decoys EXCLUDED', async () => {
    const s = freshSession();
    s.registerAnalysis('corr-decoy', corrDecoy);

    // DECOY S1 — superseded on view 'bar' by S2.
    const s1 = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    // ACTIVE input S2 — the live 'bar' selection.
    const s2 = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause() });
    // DECOY S3 — a scatter filter later cleared by S4.
    const s3 = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [0, 10], cause: userCause() });
    const s4 = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: null, cause: userCause() });
    // ACTIVE input S5 — the live scatter filter.
    const s5 = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 120], cause: userCause() });
    // DECOY analysis — a groupby whose commit must never appear.
    const decoyAnalysis = await s.declareAnalysis('groupby');

    const id = (r: Awaited<ReturnType<typeof s.dispatch>>) => (r.ok ? r.commit!.id : '');
    const [S1, S2, S3, S4, S5] = [id(s1), id(s2), id(s3), id(s4), id(s5)];

    const a = await s.declareAnalysis('corr-decoy');
    expect(a.hypothesis).toBeDefined(); // a real test landed (n=5, finite r)
    expect(a.fdrStep).toBeDefined();

    const r = s.why({ kind: 'hypothesis', analysisId: 'corr-decoy' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // hand-computed minimal set: declaring + the two ACTIVE input selects + kernel {load, correlate}.
    const composed = r.commits.map((c) => `${c.tier}:${c.kind}:${c.stageId ?? c.id}`).sort();
    expect(composed).toEqual(
      [
        `viz:declaring:${a.commit!.id}`,
        `viz:input-selection:${S2}`,
        `viz:input-selection:${S5}`,
        'kernel:kernel-stage:load',
        'kernel:kernel-stage:correlate',
      ].sort(),
    );
    // DECOYS excluded: superseded S1, cleared S3 + its clearing commit S4, the
    // decoy groupby analysis commit, and the intra-kernel `cdecoy` stage.
    const ids = new Set(r.commits.map((c) => c.id));
    for (const decoy of [S1, S3, S4, decoyAnalysis.commit!.id]) expect(ids.has(decoy)).toBe(false);
    expect(r.kernel!.stageIds).not.toContain('cdecoy');
    // hypothesis ⇒ the online-FDR ledger row rides as machine context.
    expect(r.fdr).toBeDefined();
    expect(typeof r.fdr!.step).toBe('number');
  });
});

// ── A2 — machine-shaped, never prose ────────────────────────────────────────────

describe('A2 — the session slice is machine-shaped', () => {
  async function clusterSlice(): Promise<CrossTierSlice> {
    const s = freshSession();
    s.registerAnalysis('cluster-decoy', clusterDecoy);
    await s.declareAnalysis('cluster-decoy');
    const r = s.why({ kind: 'column', column: 'cluster_id' });
    if (!r.ok) throw new Error('expected a slice');
    return r;
  }

  it('every commit is a {tier,id,kind} record; the top-level key set is fixed', async () => {
    const r = await clusterSlice();
    for (const c of r.commits) {
      expect(['viz', 'agent', 'kernel']).toContain(c.tier);
      expect(['declaring', 'input-selection', 'kernel-stage', 'agent-frame']).toContain(c.kind);
      expect(typeof c.id).toBe('string');
    }
    expect(Object.keys(r).sort()).toEqual(
      ['agent', 'commits', 'flags', 'kernel', 'key', 'misses', 'ok', 'targetKind', 'threaded', 'viz'].sort(),
    );
  });

  it('carries no prose: no stage NAMES, no cause.intent, no analysis prose leaks', async () => {
    const r = await clusterSlice();
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain('load values'); // kernel stage NAME (we keep stageId)
    expect(serialized).not.toContain('assign bins');
    expect(serialized).not.toContain('audit'); // decoy stage name
    // stageIds are index-free stable ids, not runtimeStageIds with '#'.
    for (const sid of r.kernel!.stageIds) expect(sid).not.toContain('#');
  });
});

// ── A4 — honest typed misses ────────────────────────────────────────────────────

describe('A4 — honest misses are typed, never faked', () => {
  it('no-such-target for an unknown column or analysis', () => {
    const s = freshSession();
    expect(s.why({ kind: 'column', column: 'ghost' })).toEqual({
      ok: false,
      missing: 'no-such-target',
      target: { kind: 'column', column: 'ghost' },
    });
    expect(s.why({ kind: 'hypothesis', analysisId: 'ghost' })).toEqual({
      ok: false,
      missing: 'no-such-target',
      target: { kind: 'hypothesis', analysisId: 'ghost' },
    });
  });

  it('no-agent-tier when no event log is supplied (session default)', async () => {
    const s = freshSession();
    s.registerAnalysis('cluster-decoy', clusterDecoy);
    await s.declareAnalysis('cluster-decoy');
    const r = s.why({ kind: 'column', column: 'cluster_id' });
    expect(r.ok && r.misses).toContainEqual({ tier: 'agent', missing: 'no-agent-tier' });
  });

  it('no-join-key when an event log is supplied but the target has no correlationId', () => {
    const res = resolveAgentTier(undefined, [{ toolCallId: 't', runId: 'r', runtimeStageId: 's', correlationId: 'x' }]);
    expect('miss' in res && res.miss).toEqual({ tier: 'agent', missing: 'no-join-key' });
  });

  it('no-kernel-snapshot and kernel-key-unresolved are typed kernel misses', async () => {
    // no snapshot at all.
    const noSnap = resolveKernelTier('rowCount', undefined);
    expect('miss' in noSnap && noSnap.miss).toEqual({ tier: 'kernel', missing: 'no-kernel-snapshot' });
    // a real footprintjs snapshot but a key that was never written.
    const kernel = await runKernel({ correlationId: 'k', field: 'amount', range: [10, 20] });
    const unresolved = resolveKernelTier('never-written-key', kernel.snapshot);
    expect('miss' in unresolved && unresolved.miss).toEqual({ tier: 'kernel', missing: 'kernel-key-unresolved' });
  });
});
