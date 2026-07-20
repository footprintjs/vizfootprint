/**
 * D30 — the compound `cell` commit at the SESSION tier (the C3 design
 * decision, end to end): a heatmap cell click selects on TWO fields with ONE
 * gesture, and the ruling is one gesture = ONE commit — never two
 * correlationId-linked commits. The cell rides the `select` verb (the
 * vocabulary stays at 8), lands under the SAME fold key
 * (`selection:${viewId}`, last-wins per view), so branches / compare /
 * time-travel are untouched by construction — verified here with targeted
 * tests, not assumed.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';
import type { CauseClause } from '../mosaic/index.js';
import type { DataRow } from '../analysis/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });

/** The dresses fixture + a heatmap view that HONESTLY declares only cell emissions. */
function heatmapDef(rows?: DataRow[]): DashboardDef {
  const base = makeDashboardDef(rows ? { rows } : {});
  return {
    ...base,
    actors: { ...base.actors, heatmap: { actor: 'user', label: 'Price × category heatmap' } },
    capabilities: [
      ...(base.capabilities ?? []),
      { viewId: 'heatmap', canProbe: true, encodings: ['cell'] },
      // a classic chart declaring point+interval — must REFUSE a cell probe
      { viewId: 'bar', canProbe: true, encodings: ['point', 'interval'] },
    ],
  };
}

function freshSession() {
  return buildDashboard(heatmapDef()).createSession();
}

const CELL_FIELDS = ['price', 'category'] as const;
const CELL_VALUES = [[100, 150], 'Formal'] as const;

describe('D30 — one cell gesture lands ONE compound commit', () => {
  it('dispatch select-with-fields lands exactly one cell commit whose predicate is the AND of both sides', async () => {
    const s = freshSession();
    const res = await s.dispatch({
      verb: 'select',
      viewId: 'heatmap',
      fields: [...CELL_FIELDS],
      values: [...CELL_VALUES],
      cause: userCause('click the 100–150 × Formal cell'),
    });
    expect(res.ok).toBe(true);
    expect(s.log.records).toHaveLength(1); // the ruling: ONE commit, never two linked ones
    const rec = s.log.records[0]!;
    expect(rec.kind).toBe('cell');
    expect(rec.fields).toEqual(['price', 'category']);
    expect(rec.field).toBe('price × category'); // display-only joint label
    expect(rec.value).toEqual([[100, 150], 'Formal']);
    expect(rec.predicateSQL).toBe(`(("price" BETWEEN 100 AND 150) AND ("category" IN ('Formal')))`);
    expect(res.ok && res.verb).toBe('select');
    expect(res.ok && res.intent).toBe('mandatory-analytical');
  });

  it('BOTH constraints crossfilter: selectedRows honors price ∈ [100,150] AND category = Formal', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: [...CELL_VALUES], cause: userCause() });
    const rows = await s.selectedRows();
    const expected = SAMPLE_ROWS.filter(
      (r) => (r['price'] as number) >= 100 && (r['price'] as number) <= 150 && r['category'] === 'Formal',
    );
    expect(rows.length).toBe(expected.length);
    expect(rows.length).toBeGreaterThan(0); // the fixture genuinely has Formal rows in that band
    expect(rows.every((r) => r['category'] === 'Formal')).toBe(true);
  });

  it('click-again clears: values null lands a cleared cell commit and releases BOTH constraints', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: [...CELL_VALUES], cause: userCause() });
    const cleared = await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: null, cause: userCause('clear the cell') });
    expect(cleared.ok).toBe(true);
    expect(s.log.records).toHaveLength(2); // the clear is a real commit (replayable), like a cleared interval
    expect(s.log.records[1]!.predicateSQL).toBe('null');
    expect((await s.overview()).activeSelections).toHaveLength(0);
    expect((await s.selectedRows()).length).toBe(SAMPLE_ROWS.length);
  });

  it('last-wins per view: a cell REPLACES the view\'s prior cell (one live clause, not a stack)', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: [...CELL_VALUES], cause: userCause() });
    await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: [[50, 90], 'Casual'], cause: userCause() });
    const ov = await s.overview();
    expect(ov.activeSelections).toHaveLength(1);
    expect(ov.activeSelections[0]).toEqual({
      viewId: 'heatmap',
      field: 'price × category',
      kind: 'cell',
      value: [[50, 90], 'Casual'],
      fields: ['price', 'category'],
    });
  });

  it('correlationId rides the ONE commit (R10) — there is no second commit to link', async () => {
    const s = freshSession();
    await s.dispatch({
      verb: 'select',
      viewId: 'heatmap',
      fields: [...CELL_FIELDS],
      values: [...CELL_VALUES],
      cause: userCause(),
      correlationId: 'tool-call-7',
    });
    expect(s.log.records).toHaveLength(1);
    expect(s.log.records[0]!.correlationId).toBe('tool-call-7');
  });

  it('R3 inbound: a mounted adapter receives the resolved compound clause', async () => {
    const s = freshSession();
    const seen: CauseClause[] = [];
    s.mountView('heatmap', {
      capabilities: { canProbe: true, encodings: ['cell'] },
      applyClause: (c) => seen.push(c),
    });
    await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: [...CELL_VALUES], cause: userCause() });
    expect(seen).toHaveLength(1);
    expect(String(seen[0]!.predicate)).toBe(`(("price" BETWEEN 100 AND 150) AND ("category" IN ('Formal')))`);
  });
});

describe('D30 — honest guards (R14 typed gaps, never a silent drop)', () => {
  it('needs-view: a cell select on an undeclared view', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'ghost', fields: [...CELL_FIELDS], values: [...CELL_VALUES], cause: userCause() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection.code).toBe('needs-view');
  });

  it('guard-failed: a classic point/interval chart honestly does NOT emit cells', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'bar', fields: [...CELL_FIELDS], values: [...CELL_VALUES], cause: userCause() });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.rejection.code).toBe('guard-failed');
      expect(res.rejection.detail).toContain('does not encode a cell selection');
    }
  });

  it('guard-failed the other way: a cell-only heatmap refuses a plain point probe', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'heatmap', field: 'category', value: 'Formal', cause: userCause() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection.detail).toContain('does not encode a point selection');
  });

  it('guard-failed: the same field on both sides is refused (a cell is a TWO-field gesture)', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: ['price', 'price'], values: [[0, 1], 2], cause: userCause() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection.detail).toContain('two DIFFERENT fields');
  });

  it('guard-failed: a reserved session field on EITHER side keeps the test-analog channel clean (R6)', async () => {
    const rows: DataRow[] = SAMPLE_ROWS.map((r) => ({ ...r, pValue: 0.03 }));
    const s = buildDashboard(heatmapDef(rows)).createSession();
    const first = await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: ['pValue', 'category'], values: [0.03, 'Formal'], cause: userCause() });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.rejection.code).toBe('guard-failed');
    const second = await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: ['price', 'pValue'], values: [[0, 1], 0.03], cause: userCause() });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.rejection.code).toBe('guard-failed');
    expect(s.log.records).toHaveLength(0);
  });

  it('needs-column: EACH side must be a real, branch-visible column', async () => {
    const s = freshSession();
    const badX = await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: ['ghost', 'category'], values: [[0, 1], 'Formal'], cause: userCause() });
    expect(badX.ok).toBe(false);
    if (!badX.ok) {
      expect(badX.rejection.code).toBe('needs-column');
      expect(badX.rejection.target).toBe('ghost');
    }
    const badY = await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: ['price', 'ghost'], values: [[0, 1], 'x'], cause: userCause() });
    expect(badY.ok).toBe(false);
    if (!badY.ok) expect(badY.rejection.target).toBe('ghost');
  });

  it('needs-backend-data: no provider for the default table', async () => {
    const s = buildDashboard(heatmapDef()).createSession({ defaultTable: 'ghost-table' });
    const res = await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: [...CELL_VALUES], cause: userCause() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection.code).toBe('needs-backend-data');
  });
});

describe('D30 — TARGETED: branching / compare / time-travel machinery untouched by construction', () => {
  it('seek before the cell commit removes BOTH constraints; seek back to it restores the compound', async () => {
    const s = freshSession();
    const first = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    const firstId = first.ok ? first.commit!.id : '';
    const cell = await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: [...CELL_VALUES], cause: userCause() });
    const cellId = cell.ok ? cell.commit!.id : '';

    s.seek(firstId);
    const past = await s.overview();
    expect(past.activeSelections.map((a) => a.viewId)).toEqual(['bar']); // the cell fold entry is gone in the past

    s.seek(cellId);
    const present = await s.overview();
    expect(present.activeSelections.find((a) => a.viewId === 'heatmap')).toMatchObject({
      kind: 'cell',
      fields: ['price', 'category'],
      value: [[100, 150], 'Formal'],
    });
  });

  it('a cleared cell folds away on seek too (the rebuild honors the delete rule)', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: [...CELL_VALUES], cause: userCause() });
    const cleared = await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: null, cause: userCause() });
    const clearedId = cleared.ok ? cleared.commit!.id : '';
    s.seek(clearedId); // rebuild the fold across set-then-clear
    expect((await s.overview()).activeSelections).toHaveLength(0);
  });

  it('branch-on-act: a cell select from a past cursor lands a SIBLING lineage (R8, no history rewritten)', async () => {
    const s = freshSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 120], cause: userCause() });
    s.seek(a.ok ? a.commit!.id : '');
    await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: [...CELL_VALUES], cause: userCause('cell from the past') });
    expect(s.branches()).toHaveLength(2); // two tips — the old lineage intact
    expect(s.log.records).toHaveLength(3);
  });

  it('compare() renders a cell in the diff and counts rows under it (path names or ids — read-only)', async () => {
    const s = freshSession();
    // a WIDE, cell-compatible filter as the common base (a conflicting point
    // select would intersect the cell to zero and prove nothing)
    const a = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [0, 300], cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    const b = await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: [...CELL_VALUES], cause: userCause() });
    const bId = b.ok ? b.commit!.id : '';
    const cmp = await s.compare(aId, bId);
    expect(cmp.ok).toBe(true);
    if (cmp.ok) {
      expect(cmp.onlyB).toHaveLength(1);
      expect(cmp.onlyB[0]!.value).toMatchObject({
        kind: 'selection',
        clause: { kind: 'cell', fields: ['price', 'category'], value: [[100, 150], 'Formal'] },
      });
      // rowsAtTip evaluated the compound: side B counts only Formal rows in [100, 150]
      const expected = SAMPLE_ROWS.filter(
        (r) => (r['price'] as number) >= 100 && (r['price'] as number) <= 150 && r['category'] === 'Formal',
      ).length;
      expect(cmp.b.rows).toBe(expected);
    }
  });

  it('bringOver replays a cell commit onto another branch as ONE compound commit (replayedFrom rides the cause)', async () => {
    const s = freshSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    const cell = await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: [...CELL_VALUES], cause: userCause() });
    const cellId = cell.ok ? cell.commit!.id : '';
    s.seek(aId); // move to the other position, then cherry-pick the cell over
    const res = await s.bringOver(cellId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.commit?.kind).toBe('cell');
      expect(res.commit?.fields).toEqual(['price', 'category']);
      expect(res.commit?.cause.replayedFrom).toBe(cellId);
    }
  });

  it('undo of a cell commit restores the prior compound; undo of the FIRST cell clears kind-faithfully', async () => {
    const s = freshSession();
    const first = await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: [[50, 90], 'Casual'], cause: userCause() });
    const firstId = first.ok ? first.commit!.id : '';
    const second = await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: [...CELL_VALUES], cause: userCause() });
    const secondId = second.ok ? second.commit!.id : '';

    const undoSecond = await s.undo(secondId);
    expect(undoSecond.ok).toBe(true);
    if (undoSecond.ok) {
      expect(undoSecond.commit?.kind).toBe('cell');
      expect(undoSecond.commit?.value).toEqual([[50, 90], 'Casual']); // the prior compound restored
      expect(undoSecond.commit?.cause.revertOf).toBe(secondId);
    }

    const undoFirst = await s.undo(firstId);
    expect(undoFirst.ok).toBe(true);
    if (undoFirst.ok) {
      // absent at parent → a CLEARED CELL commit (kind-faithful, never a
      // flattened interval-clear on the joint label pseudo-column)
      expect(undoFirst.commit?.kind).toBe('cell');
      expect(undoFirst.commit?.value).toBeNull();
    }
    expect((await s.overview()).activeSelections).toHaveLength(0);
  });

  it('whats_here discloses the declared cell capability on selectionKinds', async () => {
    const s = freshSession();
    const ov = await s.overview();
    expect(ov.views.find((v) => v.viewId === 'heatmap')?.selectionKinds).toEqual(['cell']);
    expect(ov.views.find((v) => v.viewId === 'bar')?.selectionKinds).toEqual(['point', 'interval']);
  });

  it('session-level replay: a serialized log with a cell commit replays byte-identically (R2)', async () => {
    const { serializeLog, replayLog } = await import('../log/index.js');
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: [...CELL_FIELDS], values: [...CELL_VALUES], cause: userCause('cell') });
    const replayed = replayLog(serializeLog(s.log.records));
    expect(replayed.records.map((r) => r.predicateSQL)).toEqual(s.log.records.map((r) => r.predicateSQL));
    expect(replayed.records[0]!.cause.replayed).toBe(true);
  });
});
