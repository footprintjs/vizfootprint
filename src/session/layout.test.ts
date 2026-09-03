/**
 * LY-1 — cockpit layout as SESSION view-state that time-travels.
 *
 * Pins the ruling: a layout change (preset / order / focus) rides the EXISTING
 * `navigate` dispatch verb under the `layout:${scope}` synthetic identity
 * (e.g. `layout:dashboard`), following the `encoding:${viewId}` precedent:
 *   - it LANDS one cause-tagged commit (recorded — the commit log tells the
 *     story in plain words via `cause.intent`), yet is deliberately
 *     NON-FILTERING (an arrangement is not a data claim — the same honesty
 *     ruling as pan/zoom): row counts, foldDiff, and conflicts never see it;
 *   - it is FOLD-CARRIED (`rebuildFold` → `activeLayouts`, last-wins per
 *     (scope, prop)) so `seek` / `switchPath` / bookmark travel restore the
 *     arrangement, and branch-on-act gives each path its OWN arrangement;
 *   - `overview().layouts` exposes the fold (scope → prop → value), cloned;
 *   - a bring-over RE-LANDS the same layout prop here (the `layout` plan
 *     recipe → navigate); an undo is honestly refused (inert — no prior fold
 *     entry to restore);
 *   - guards: bare `layout:` scope, a missing/blank prop, a non-string value,
 *     and an over-long value are each a TYPED `guard-failed` gap, never a drop.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import { keyOf, foldDiff, LAYOUT_VIEW_PREFIX, planBringOver, planUndo } from '../branches/index.js';
import type { Cause } from '../cause/index.js';

const cause = (requestedBy: 'user' | 'agent', intent?: string): Cause => ({ requestedBy, computedBy: requestedBy, ...(intent ? { intent } : {}) });

function freshSession() {
  return buildDashboard(makeDashboardDef()).createSession({ as: 'user' });
}

const LAYOUT = `${LAYOUT_VIEW_PREFIX}dashboard`; // 'layout:dashboard'

describe('LY-1 — the layout navigate lands a recorded, non-filtering commit', () => {
  it('lands ONE cause-tagged commit under layout:dashboard with plain-words intent', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'grid', cause: cause('user', 'layout = grid') });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.verb).toBe('navigate');
    expect(res.navigatedTo).toBe(LAYOUT);
    const commit = res.commit!;
    expect(commit.viewId).toBe(LAYOUT);
    expect(commit.kind).toBe('point');
    expect(commit.field).toBe('preset');
    expect(commit.value).toBe('grid');
    expect(commit.cause.requestedBy).toBe('user');
    expect(commit.cause.intent).toBe('layout = grid'); // the commit log's plain words
    // the head/cursor advanced onto the landed commit (a real act, not a side note)
    expect(s.head).toBe(commit.id);
    expect(s.cursor()).toBe(commit.id);
    // a caller-supplied cross-tier join key rides the commit (R10)
    const bookmarked = await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'focus', value: 'scatter', cause: cause('user', 'layout = focus on scatter'), correlationId: 'corr-9' });
    expect(bookmarked.ok && bookmarked.commit!.correlationId === 'corr-9').toBe(true);
  });

  it('is deliberately NON-FILTERING: selections, row counts, and foldDiff never see it', async () => {
    const s = freshSession();
    const rowsBefore = (await s.selectedRows()).length;
    const a = await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'focus', cause: cause('user') });
    const b = await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'focus', value: 'scatter', cause: cause('user') });
    expect(a.ok && b.ok).toBe(true);
    const overview = await s.overview();
    expect(overview.activeSelections).toMatchObject([]); // no clause anywhere
    expect((await s.selectedRows()).length).toBe(rowsBefore); // row truth untouched
    // inert in the branches fold: no state key, no diff entry between the two positions
    const aId = a.ok ? a.commit!.id : '';
    const bId = b.ok ? b.commit!.id : '';
    expect(keyOf(s.log.records.find((r) => r.id === aId)!)).toBeNull();
    const diff = foldDiff(s.log.records, aId, bId);
    expect(diff.ok && diff.changed.length === 0 && diff.onlyA.length === 0 && diff.onlyB.length === 0).toBe(true);
  });

  it('a second actor lands on the SAME layout source without a registry conflict (constant meta)', async () => {
    const s = freshSession();
    const first = await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'grid', cause: cause('user') });
    const second = await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'focus', cause: cause('agent') }, { as: 'agent' });
    expect(first.ok && second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.commit!.cause.requestedBy).toBe('agent'); // WHO acted lives in the cause
    expect((await s.overview()).layouts['dashboard']).toEqual({ preset: 'focus' });
  });

  it('a declared-view navigate stays commit-free even when field/value ride along (RP-1 unchanged)', async () => {
    const s = freshSession();
    const before = s.log.records.length;
    const res = await s.dispatch({ verb: 'navigate', viewId: 'scatter', field: 'preset', value: 'grid', cause: cause('user', 'navigate scatter x:[0, 1]') });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.navigatedTo).toBe('scatter');
    expect(res.commit).toBeUndefined();
    expect(s.log.records.length).toBe(before);
    // and an UNDECLARED non-layout view still files the typed needs-view gap
    const missing = await s.dispatch({ verb: 'navigate', viewId: 'nope', cause: cause('user') });
    expect(!missing.ok && missing.rejection.code === 'needs-view').toBe(true);
  });
});

describe('LY-1 — the fold carries the arrangement (last-wins per scope+prop)', () => {
  it('overview().layouts folds preset/order/focus, and is a clone (caller mutation never leaks)', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'focus', cause: cause('user') });
    await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'focus', value: 'scatter', cause: cause('user') });
    await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'order', value: 'bar,scatter,cluster', cause: cause('user') });
    await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'focus', value: 'bar', cause: cause('user') }); // last-wins
    const layouts = (await s.overview()).layouts;
    expect(layouts).toEqual({ dashboard: { preset: 'focus', focus: 'bar', order: 'bar,scatter,cluster' } });
    (layouts['dashboard'] as Record<string, string>)['preset'] = 'HACKED';
    expect((await s.overview()).layouts['dashboard']!['preset']).toBe('focus');
  });

  it('seek restores the OLD arrangement; returning to head restores the new one', async () => {
    const s = freshSession();
    const flowEra = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: cause('user') });
    const flowId = flowEra.ok ? flowEra.commit!.id : '';
    const grid = await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'grid', cause: cause('user', 'layout = grid') });
    const gridId = grid.ok ? grid.commit!.id : '';
    await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'focus', cause: cause('user', 'layout = focus on scatter') });
    await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'focus', value: 'scatter', cause: cause('user') });
    const headId = s.head!;

    // time-travel BACK: before any layout note → the empty (consumer-default) fold
    expect(s.seek(flowId).ok).toBe(true);
    expect((await s.overview()).layouts).toEqual({});
    // mid-history: the grid era
    expect(s.seek(gridId).ok).toBe(true);
    expect((await s.overview()).layouts).toEqual({ dashboard: { preset: 'grid' } });
    // forward to head: focus on scatter again
    expect(s.seek(headId).ok).toBe(true);
    expect((await s.overview()).layouts).toEqual({ dashboard: { preset: 'focus', focus: 'scatter' } });
  });

  it('branch-on-act: each path keeps its OWN arrangement; switchPath restores per-path', async () => {
    const s = freshSession();
    const base = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: cause('user', 'base') });
    const baseId = base.ok ? base.commit!.id : '';
    await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'grid', cause: cause('user', 'layout = grid') });
    const mainName = s.paths()[0]!.name; // the auto-named active lineage

    // fork from the past with a DIFFERENT arrangement → a second, named path
    s.seek(baseId);
    await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'focus', cause: cause('user', 'layout = focus on bar') });
    await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'focus', value: 'bar', cause: cause('user') });
    const forkName = s.paths().find((p) => p.active)!.name;
    expect(forkName).not.toBe(mainName);
    expect((await s.overview()).layouts).toEqual({ dashboard: { preset: 'focus', focus: 'bar' } });

    // switching paths swaps the WHOLE arrangement, both directions
    expect(s.switchPath(mainName).ok).toBe(true);
    expect((await s.overview()).layouts).toEqual({ dashboard: { preset: 'grid' } });
    expect(s.switchPath(forkName).ok).toBe(true);
    expect((await s.overview()).layouts).toEqual({ dashboard: { preset: 'focus', focus: 'bar' } });
  });

  it('a bookmark names a commit whose seek restores that bookmark’s arrangement (present-mode contract)', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'grid', cause: cause('user') });
    await s.dispatch({ verb: 'bookmark', label: 'grid bookmark', cause: cause('user') });
    await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'focus', cause: cause('user') });
    const bookmark = s.bookmarkViews().find((c) => c.label === 'grid bookmark')!;
    expect(s.seek(bookmark.commitId!).ok).toBe(true);
    expect((await s.overview()).layouts).toEqual({ dashboard: { preset: 'grid' } });
  });
});

describe('LY-1 — plans: bring-over re-lands, undo honestly refuses', () => {
  it('bringOver a layout commit re-lands the same prop here with replayedFrom provenance', async () => {
    const s = freshSession();
    const base = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: cause('user', 'base') });
    const baseId = base.ok ? base.commit!.id : '';
    const grid = await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'grid', cause: cause('user', 'layout = grid') });
    const gridId = grid.ok ? grid.commit!.id : '';

    // fork a sibling path (no layout there), then bring the grid note over
    s.seek(baseId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Work', cause: cause('user', 'sibling') });
    const plan = planBringOver(s.log.records, gridId, s.cursor());
    expect(plan.ok && plan.recipe).toEqual(expect.objectContaining({ apply: 'layout', scope: 'dashboard', prop: 'preset', value: 'grid' }));
    const brought = await s.bringOver(gridId);
    expect(brought.ok).toBe(true);
    if (!brought.ok) return;
    expect(brought.conflicts).toEqual([]); // layout is inert — never a conflict
    expect(brought.commit!.viewId).toBe(LAYOUT);
    expect(brought.commit!.cause.replayedFrom).toBe(gridId);
    expect((await s.overview()).layouts).toEqual({ dashboard: { preset: 'grid' } });
  });

  it('undo of a layout commit is honestly refused as inert view-state', async () => {
    const s = freshSession();
    const grid = await s.dispatch({ verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'grid', cause: cause('user') });
    const gridId = grid.ok ? grid.commit!.id : '';
    const plan = planUndo(s.log.records, gridId, s.cursor());
    expect(!plan.ok && plan.reason === 'not-undoable' && plan.detail.includes('layout note')).toBe(true);
    const undone = await s.undo(gridId);
    expect(!undone.ok && undone.gap.code === 'guard-failed').toBe(true);
  });
});

describe('LY-1 — typed guards (never a silent drop)', () => {
  it.each([
    ['bare layout: scope', { viewId: 'layout:', field: 'preset', value: 'grid' }, 'needs a scope'],
    ['missing prop field', { viewId: LAYOUT, value: 'grid' }, 'needs a field'],
    ['blank prop field', { viewId: LAYOUT, field: '   ', value: 'grid' }, 'needs a field'],
    ['missing string value', { viewId: LAYOUT, field: 'preset' }, 'needs a plain-string value'],
    ['over-long value', { viewId: LAYOUT, field: 'order', value: 'x'.repeat(501) }, 'too long'],
  ] as const)('%s → a guard-failed gap', async (_name, action, detail) => {
    const s = freshSession();
    const before = s.log.records.length;
    const res = await s.dispatch({ verb: 'navigate', cause: cause('user'), ...action });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.rejection.code).toBe('guard-failed');
    expect(res.rejection.detail).toContain(detail);
    expect(s.log.records.length).toBe(before); // nothing landed
    expect(s.gaps().some((g) => g.op === 'navigate' && g.detail.includes(detail))).toBe(true);
  });
});
