/**
 * BR-1 session integration — COVERAGE PACKET.
 *
 * paths.test.ts pins the acceptance criteria; this file drives the honest
 * edges: clear-encoding with nothing to restore, bring-over of an annotation,
 * bring-over that the dispatch layer itself rejects (branch-foreign column),
 * a degenerate re-declared analysis, and row counts over a backend that
 * cannot serve rows. Everything through the PUBLIC session API.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });

function freshSession() {
  return buildDashboard(makeDashboardDef()).createSession();
}

/** A view with a declared encoding surface but NO `initial` map. */
function noInitialEncodingDef(): DashboardDef {
  return {
    data: { data: { rows: SAMPLE_ROWS } },
    actors: { scatter: { actor: 'user' } },
    encodings: [{ viewId: 'scatter', chartKind: 'point', channels: ['x', 'y'] }],
    defaultTable: 'data',
  };
}

describe('undo — clear-encoding with nothing to restore is a typed gap (never a guessed binding)', () => {
  it('a view with NO initial map: undoing its first reencode gap-rejects on op "undo"', async () => {
    const s = buildDashboard(noInitialEncodingDef()).createSession();
    const u = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'price', cause: userCause() });
    const uId = u.ok ? u.commit!.id : '';
    const res = await s.undo(uId);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap.op).toBe('undo');
      expect(res.gap.detail).toContain('no initial "x" binding');
    }
  });

  it('an initial map WITHOUT the undone channel gap-rejects the same way', async () => {
    const s = freshSession(); // scatter initial = { x, y } — no color entry
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const u = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'id', cause: userCause() });
    const uId = u.ok ? u.commit!.id : '';
    const res = await s.undo(uId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.gap.detail).toContain('no initial "color" binding');
  });
});

describe('bringOver — the remaining recipe arms', () => {
  it('an ANNOTATION commit brings over as a fresh annotate (note preserved, cause tagged)', async () => {
    const s = freshSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    const n = await s.dispatch({ verb: 'annotate', target: 'scatter', note: 'looks linear', cause: userCause() });
    const nId = n.ok ? n.commit!.id : '';

    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('premium focus') });
    const res = await s.bringOver(nId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.recipe).toEqual({ apply: 'annotation', target: 'scatter', note: 'looks linear' }); // the note's own target survives the trip
    expect(res.commit?.cause.replayedFrom).toBe(nId);
    expect(res.result.ok && res.result.annotated?.note).toBe('looks linear');
  });

  it('a bring-over the dispatch layer rejects (branch-foreign materialized column) surfaces THAT gap', async () => {
    const s = freshSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    await s.declareAnalysis('clustering'); // materializes cluster_id on THIS path
    const k = await s.dispatch({ verb: 'select', viewId: 'cluster', field: 'cluster_id', value: 2, cause: userCause() });
    const kId = k.ok ? k.commit!.id : '';

    s.seek(aId); // sibling territory — cluster_id was never materialized here
    const res = await s.bringOver(kId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.gap.code).toBe('needs-column'); // the ordinary dispatch guard, surfaced honestly
  });

  it('a re-declared analysis that lands DEGENERATE on the new path returns ok with no commit (honest flag)', async () => {
    const s = freshSession();
    const t1 = await s.declareAnalysis('correlation'); // full table — lands
    expect(t1.commit).toBeDefined();
    const f = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [53, 53], cause: userCause() });
    expect(f.ok).toBe(true); // exactly one row selected — correlation over it is degenerate

    const res = await s.bringOver(t1.commit!.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.commit).toBeUndefined(); // degenerate lands NOTHING (and spends no wealth)
    expect(res.result.ok && res.result.analysis?.result.ok).toBe(false);
    expect((await s.overview()).fdr.tests).toBe(1); // only the original test in the ledger
  });
});

describe('compare — row-count honesty and non-selection fold entries', () => {
  it('a backend that cannot serve rows compares with rows: null (never a fake 0)', async () => {
    const dash = buildDashboard(makeDashboardDef({ engine: 'server' }), { availableEngines: ['memory', 'wasm', 'server'] });
    const s = dash.createSession();
    // annotations land without a data read, so a server-engine log still has commits
    const n = await s.dispatch({ verb: 'annotate', target: 'scatter', note: 'server-side', cause: userCause() });
    const nId = n.ok ? n.commit!.id : '';
    const cmp = await s.compare(nId, nId);
    expect(cmp.ok).toBe(true);
    if (cmp.ok) {
      expect(cmp.a.rows).toBeNull();
      expect(cmp.b.rows).toBeNull();
      expect(cmp.changed).toEqual([]);
    }
  });

  it('encoding/analysis commits at a tip do not filter rows — only selections count', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'rating', cause: userCause() });
    const t = await s.declareAnalysis('correlation');
    const tipId = t.commit!.id;
    const cmp = await s.compare(tipId, tipId);
    expect(cmp.ok).toBe(true);
    if (cmp.ok) {
      expect(cmp.a.rows).toBe(8); // the Formal selection alone — encoding/analysis entries are inert for counting
      expect(cmp.ancestor).toBe(tipId);
    }
  });
});
