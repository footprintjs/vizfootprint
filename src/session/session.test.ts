/**
 * L5 session — the layer-wiring container. Covers R4 (dispatch is the only
 * entry), R1 (computedBy forced to 'system'), R1/R2 (cause histogram + replay
 * at session level), R6 (selects are never tests), R11 (materialized column
 * re-enters via ordinary dispatch), R14 (typed gaps incl. a no-probe adapter),
 * fork/checkpoint, and the L6 why-stub.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef, SAMPLE_ROWS, CATEGORIES } from './dashboard.fixture.js';
import { causeHistogram, serializeLog, replayLog } from '../log/index.js';
import { hypothesisRecordsFromLog } from '../fdr/index.js';
import type { Cause } from '../cause/index.js';
import type { DataRow } from '../analysis/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });

function freshSession() {
  return buildDashboard(makeDashboardDef()).createSession();
}

describe('R4 — dispatch is the single semantic entry', () => {
  it('a select lands one cause-tagged commit and shows in activeSelections', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick Formal') });
    expect(res.ok).toBe(true);
    expect(s.log.records).toHaveLength(1);
    const ov = await s.overview();
    expect(ov.activeSelections).toEqual([{ viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' }]);
  });

  it('a filter interval commits DATA-space values (R5), null clears it', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 120], cause: userCause() });
    expect((await s.overview()).activeSelections[0]).toMatchObject({ field: 'price', kind: 'interval', value: [60, 120] });
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: null, cause: userCause() });
    expect((await s.overview()).activeSelections.find((a) => a.viewId === 'scatter')).toBeUndefined();
  });

  it('FILTER-1: a half-open filter ([lo, null]) commits the DATA-space value verbatim and selectedRows honors it — no fabricated ceiling', async () => {
    // SAMPLE_ROWS price = 50 + 2i + (i mod 5), i in [0,40) → spans ~50..132.
    const s = freshSession();
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [100, null], cause: userCause('over $100') });
    expect((await s.overview()).activeSelections[0]).toMatchObject({ field: 'price', kind: 'interval', value: [100, null] });
    const rows = await s.selectedRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(SAMPLE_ROWS.length);
    expect(rows.every((r) => (r['price'] as number) >= 100)).toBe(true);
  });

  it('FILTER-1: a half-open filter ([null, hi]) survives seek/time-travel — the fold restores the SAME half-open value', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [null, 100], cause: userCause('up to 100') });
    expect(res.ok).toBe(true);
    const commitId = res.ok ? res.commit!.id : '';
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const seeked = s.seek(commitId);
    expect(seeked.ok).toBe(true);
    expect((await s.overview()).activeSelections).toEqual([{ viewId: 'scatter', field: 'price', kind: 'interval', value: [null, 100] }]);
  });
});

describe('R1 — computedBy is forced to system on an analysis (never caller-supplied)', () => {
  it('even a caller-supplied computedBy:agent lands as computedBy:system', async () => {
    const s = freshSession();
    const a = await s.declareAnalysis('correlation', { cause: { requestedBy: 'user', computedBy: 'agent' } });
    expect(a.commit?.cause.computedBy).toBe('system');
    expect(a.commit?.cause.requestedBy).toBe('user');
  });
});

describe('R1/R2 — cause histogram + replay at the session level', () => {
  it('the histogram is byte-identical across serialize -> replay, with replayed:true added', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause() });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Work', cause: { requestedBy: 'agent', computedBy: 'agent' } });
    await s.declareAnalysis('correlation');

    const before = causeHistogram(s.log.records);
    const replayed = replayLog(serializeLog(s.log.records));
    expect(causeHistogram(replayed.records)).toEqual(before);
    // Slots preserved; replay marker added; histogram deliberately ignores `replayed`.
    for (const r of replayed.records) expect(r.cause.replayed).toBe(true);
    expect(s.log.records.every((r) => r.cause.replayed === undefined)).toBe(true);
    expect(before).toMatchObject({ 'agent>system': 1 }); // the declared analysis
  });
});

describe('R6 — a select is never a test; only a declared analyze is', () => {
  it('100 dispatched selects produce 0 test commits; one correlation produces exactly 1', async () => {
    const s = freshSession();
    for (let i = 0; i < 100; i++) {
      await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: CATEGORIES[i % 5]!, cause: userCause() });
    }
    expect(hypothesisRecordsFromLog(s.log.records)).toHaveLength(0);
    expect(s.ledger()).toHaveLength(0);

    const a = await s.declareAnalysis('correlation');
    expect(a.kind).toBe('test');
    expect(hypothesisRecordsFromLog(s.log.records)).toHaveLength(1);
    expect(s.ledger()).toHaveLength(1);
    expect(a.fdrStep?.hypothesisId).toBe('corr:price:rating');
  });
});

describe('R11 — an analysis output re-enters via an ORDINARY dispatch select', () => {
  it('cluster_id is unknown before clustering (needs-column), filterable after', async () => {
    const s = freshSession();
    // Before: selecting cluster_id is a typed needs-column gap.
    const before = await s.dispatch({ verb: 'select', viewId: 'cluster', field: 'cluster_id', value: 2, cause: userCause() });
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.rejection.code).toBe('needs-column');

    // Cluster (transform, columns) materializes cluster_id over the full table.
    const clustered = await s.declareAnalysis('clustering');
    expect(clustered.materialized).toEqual(['cluster_id']);
    expect(clustered.gap).toBeUndefined();

    // After: cluster_id is an ordinary point clause — same KIND as a bar click.
    const after = await s.dispatch({ verb: 'select', viewId: 'cluster', field: 'cluster_id', value: 2, cause: userCause() });
    expect(after.ok).toBe(true);
    const rows = await s.selectedRows('data');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r['cluster_id'] === 2)).toBe(true);
  });
});

describe('R14 — every unmet request is a typed gap (D14 taxonomy)', () => {
  it('a no-probe adapter yields a typed rejection + a guard-failed gap row', async () => {
    const s = freshSession();
    const mounted = s.mountView('display', { capabilities: { canProbe: false } });
    expect(mounted.ok).toBe(true);
    const res = await s.dispatch({ verb: 'select', viewId: 'display', field: 'price', value: 100, cause: userCause() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection.code).toBe('guard-failed');
    expect(s.gaps().at(-1)?.code).toBe('guard-failed');
    expect(s.gaps().at(-1)?.op).toBe('select');
  });

  it('a nonexistent column -> needs-column; unknown view -> needs-view; unknown analysis -> needs-analysis-kind', async () => {
    const s = freshSession();
    const c = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'nope', value: 1, cause: userCause() });
    expect(c.ok === false && c.rejection.code).toBe('needs-column');
    const v = await s.dispatch({ verb: 'select', viewId: 'ghost', field: 'price', value: 1, cause: userCause() });
    expect(v.ok === false && v.rejection.code).toBe('needs-view');
    const a = await s.dispatch({ verb: 'analyze', analysisId: 'ghost-analysis', cause: userCause() });
    expect(a.ok === false && a.rejection.code).toBe('needs-analysis-kind');
    expect(s.gapLedger.byCode()).toMatchObject({ 'needs-column': 1, 'needs-view': 1, 'needs-analysis-kind': 1 });
  });
});

describe('R14 — a server-backed table that cannot evaluate is a needs-backend-data gap', () => {
  it('a select on a server-engine table files needs-backend-data (never a silent no-op)', async () => {
    const dash = buildDashboard(makeDashboardDef({ engine: 'server' }), { availableEngines: ['memory', 'wasm', 'server'] });
    const s = dash.createSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection.code).toBe('needs-backend-data');
  });

  it('an analysis over a server-engine table files needs-backend-data (input not silently masked as empty)', async () => {
    const dash = buildDashboard(makeDashboardDef({ engine: 'server' }), { availableEngines: ['memory', 'wasm', 'server'] });
    const s = dash.createSession();
    const a = await s.declareAnalysis('correlation');
    expect(a.gap?.code).toBe('needs-backend-data');
    expect(a.commit).toBeUndefined(); // nothing landed; no wealth spent
    expect(a.fdrStep).toBeUndefined();
    expect(s.ledger()).toHaveLength(0);
  });
});

describe('R6 guard — a reserved session field cannot be selected on (log stays uncorruptible)', () => {
  it('a select on a data column literally named "pValue" is a guard-failed gap; no test commit lands', async () => {
    const rows: DataRow[] = SAMPLE_ROWS.map((r) => ({ ...r, pValue: 0.03 }));
    const s = buildDashboard(makeDashboardDef({ rows })).createSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'pValue', value: 0.03, cause: userCause() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection.code).toBe('guard-failed');
    // The reserved-field guard kept the log's test-analog channel clean.
    expect(hypothesisRecordsFromLog(s.log.records)).toHaveLength(0);
    expect(s.log.records).toHaveLength(0);
  });
});

describe('R14 — honest degenerate fit (no commit, no wealth spent)', () => {
  it('a correlation over 8 zero-variance rows returns a flag and steps no ledger', async () => {
    const s = freshSession();
    const eight: DataRow[] = SAMPLE_ROWS.slice(0, 8).map((r) => ({ ...r, rating: 3 })); // zero y-variance
    const a = await s.declareAnalysis('correlation', { input: eight });
    expect(a.result.ok).toBe(false);
    if (!a.result.ok) expect(a.result.fitDegenerate).toBe(true);
    expect(a.commit).toBeUndefined();
    expect(a.fdrStep).toBeUndefined();
    expect(s.ledger()).toHaveLength(0);
    expect(hypothesisRecordsFromLog(s.log.records)).toHaveLength(0);
  });
});

describe('fork / checkpoint (R8 branching + named positions)', () => {
  it('fork moves the cursor (not the head) so the next commit is a sibling; checkpoint names the cursor', async () => {
    const s = freshSession();
    const c1 = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    const c2 = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const firstId = c1.ok ? c1.commit!.id : '';
    const secondId = c2.ok ? c2.commit!.id : '';
    expect(s.head).toBe(secondId);
    expect(s.cursor()).toBe(secondId); // linear flow: cursor == head

    // A checkpoint is a DECISION, so it lands a `beat:` commit (inert in the
    // fold) as the new tip — `commitId` IS that beat, and head/cursor move to it.
    const cp = await s.dispatch({ verb: 'checkpoint', label: 'after-two', cause: userCause() });
    const beatId = cp.ok ? cp.commit!.id : '';
    expect(cp.ok && cp.checkpoint?.commitId).toBe(beatId);
    expect(s.log.records.find((r) => r.id === beatId)!.parent).toBe(secondId); // the beat names c2's state
    expect(s.head).toBe(beatId);

    // Fork back to c1 (DEMO-2 fix): the CURSOR moves to the fork point; the head
    // (old tip) is left INTACT so the old lineage stays a live branch. The next
    // commit branches off c1 (same parent as c2) — a real sibling, no rewrite.
    await s.dispatch({ verb: 'fork', fromCommitId: firstId, cause: userCause() });
    expect(s.cursor()).toBe(firstId); // fork moved the cursor…
    expect(s.head).toBe(beatId); // …NOT the head — the old branch tip (now the beat) is preserved
    const sibling = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause() });
    const siblingId = sibling.ok ? sibling.commit!.id : '';
    const siblingRec = s.log.records.find((r) => r.id === siblingId)!;
    const secondRec = s.log.records.find((r) => r.id === secondId)!;
    expect(siblingRec.parent).toBe(secondRec.parent); // both children of c1 — a real branch
    // acting made the new lineage active: head + cursor now coincide on the sibling
    expect(s.head).toBe(siblingId);
    expect(s.cursor()).toBe(siblingId);
    // the old tip (the beat over c2) is still a leaf — branches() lists BOTH lineages
    const tips = s.branches().map((b) => b.tip).sort();
    expect(tips).toEqual([beatId, siblingId].sort());
    expect(s.branches().find((b) => b.tip === siblingId)!.active).toBe(true);
    expect(s.branches().find((b) => b.tip === beatId)!.active).toBe(false);
  });

  it('fork from an unknown commit is a typed guard-failed gap', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'fork', fromCommitId: 'nope', cause: userCause() });
    expect(res.ok === false && res.rejection.code).toBe('guard-failed');
  });
});

describe('Q6 — reencode: the 8th dispatch verb (a state-changing view-encoding transition)', () => {
  it('rebinds a channel to a field, lands one commit, and shows in overview + viewEncodings', async () => {
    const s = freshSession();
    expect(s.viewEncodings('scatter')).toEqual({ x: 'price', y: 'rating' }); // the declared initial mapping

    const res = await s.dispatch({
      verb: 'reencode',
      viewId: 'scatter',
      channel: 'x',
      field: 'rating',
      cause: userCause('swap x to rating'),
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.reencoded).toEqual({ viewId: 'scatter', channel: 'x', field: 'rating' });
      expect(res.commit).toMatchObject({ viewId: 'encoding:scatter', kind: 'point', field: 'x', value: 'rating' });
    }
    expect(s.log.records).toHaveLength(1);
    expect(s.viewEncodings('scatter')).toEqual({ x: 'rating', y: 'rating' });

    const ov = await s.overview();
    const scatter = ov.views.find((v) => v.viewId === 'scatter')!;
    expect(scatter.encodings).toEqual({ x: 'rating', y: 'rating' });
    expect(scatter.columns.map((c) => c.field).sort()).toEqual(['category', 'id', 'price', 'rating']);
    // The old point/interval capability field is unaffected by the rename.
    expect(scatter.selectionKinds).toEqual(['point', 'interval', 'match']); // SET-1: a set is a point's plural
    // The top-level convenience projection (viewId -> its encodings) agrees with `views[]`.
    expect(ov.encodings['scatter']).toEqual(scatter.encodings);
    expect(ov.encodings['bar']).toEqual({ x: 'category' }); // untouched — reencode only targeted scatter
  });

  it('an invalid channel for the view is a typed guard-failed gap; no commit lands', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'size', field: 'price', cause: userCause() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection.code).toBe('guard-failed');
    expect(s.log.records).toHaveLength(0);
    expect(s.viewEncodings('scatter')).toEqual({ x: 'price', y: 'rating' }); // unchanged
  });

  it('a view with no declared encoding surface is a typed guard-failed gap', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'reencode', viewId: 'cluster', channel: 'x', field: 'price', cause: userCause() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection.code).toBe('guard-failed');
  });

  it('an unknown view is a typed needs-view gap', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'reencode', viewId: 'ghost', channel: 'x', field: 'price', cause: userCause() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection.code).toBe('needs-view');
  });

  it('a field absent from the table is a typed needs-column gap', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'nope', cause: userCause() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection.code).toBe('needs-column');
  });

  it('reencode commits replay byte-identically (R2)', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'y', field: 'price', cause: userCause('swap y') });

    const before = causeHistogram(s.log.records);
    const replayed = replayLog(serializeLog(s.log.records));
    expect(causeHistogram(replayed.records)).toEqual(before);
    expect(replayed.records.map((r) => ({ viewId: r.viewId, field: r.field, value: r.value, kind: r.kind }))).toEqual(
      s.log.records.map((r) => ({ viewId: r.viewId, field: r.field, value: r.value, kind: r.kind })),
    );
    for (const r of replayed.records) expect(r.cause.replayed).toBe(true);
  });
});

describe('L6 seam — why(target) is promoted (real cross-tier slice)', () => {
  it('an unknown target is a typed no-such-target miss, never a fabricated answer', () => {
    const s = freshSession();
    const w = s.why({ kind: 'column', column: 'nope' });
    expect(w).toEqual({ ok: false, missing: 'no-such-target', target: { kind: 'column', column: 'nope' } });
  });
});

describe('D12 readiness disclosure (H6 seam)', () => {
  it('an analysis whose input column is absent is not-ready with needs-column', async () => {
    const s = freshSession();
    s.registerAnalysis('needs-missing', {
      // a raw def reading a column that does not exist yet
      id: 'needs-missing',
      kind: 'transform',
      produces: 'scalar',
      inputs: [{ column: 'cluster_id', role: 'value' }],
      build: () => (({}) as never),
      toRunInput: () => ({}),
      readOutput: () => ({ ok: true, output: { as: 'scalar', name: 'x', value: 1 } }),
    });
    const ov = await s.overview();
    const r = ov.analyses.find((a) => a.id === 'needs-missing')!;
    expect(r.ready).toBe(false);
    expect(r.blockedBy).toBe('needs-column');
    expect(r.missingColumns).toEqual(['cluster_id']);
    // The real correlation IS ready (price + rating exist).
    expect(ov.analyses.find((a) => a.id === 'correlation')!.ready).toBe(true);
  });
});

describe('absence — a declared silence vocabulary rides the column facet', () => {
  it('overview() marks the declared absence column with its vocabulary, and no other column', async () => {
    const rows = [
      { id: 1, category: 'Casual', price: 10, rating: 4, state: 'present' },
      { id: 2, category: 'Formal', price: 20, rating: 3, state: 'unknown' },
    ];
    const def = makeDashboardDef({ rows });
    const withAbsence = {
      ...def,
      data: { data: { ...def.data['data'], absence: { field: 'state', states: ['present', 'not-configured', 'unavailable', 'unknown'] } } },
    };
    const s = buildDashboard(withAbsence).createSession();
    const facets = (await s.overview()).columns['data'] ?? [];
    expect(facets.find((c) => c.field === 'state')).toEqual({
      field: 'state',
      type: 'string',
      absence: ['present', 'not-configured', 'unavailable', 'unknown'],
    });
    expect(facets.find((c) => c.field === 'category')).toEqual({ field: 'category', type: 'string' });
  });

  it('reencode refuses to put the absence column on a magnitude channel, and allows it on color', async () => {
    const rows = [
      { id: 1, category: 'Casual', price: 10, rating: 4, state: 'present' },
      { id: 2, category: 'Formal', price: 20, rating: 3, state: 'unknown' },
    ];
    const def = makeDashboardDef({ rows });
    const s = buildDashboard({
      ...def,
      data: { data: { ...def.data['data'], absence: { field: 'state', states: ['present', 'unknown'] } } },
    }).createSession();
    const onAxis = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'state', cause: userCause() });
    expect(onAxis.ok).toBe(false);
    if (!onAxis.ok) {
      expect(onAxis.rejection.code).toBe('guard-failed');
      expect(onAxis.rejection.detail).toMatch(/declared absence column .* magnitude channel "x"/);
    }
    expect(s.viewEncodings('scatter')).toEqual({ x: 'price', y: 'rating' }); // nothing landed
    const onColor = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'state', cause: userCause() });
    expect(onColor.ok).toBe(true);
    expect(s.viewEncodings('scatter')).toEqual({ x: 'price', y: 'rating', color: 'state' });
  });
});
