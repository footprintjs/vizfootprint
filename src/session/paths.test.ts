/**
 * BR-1 session integration — named paths over the live InteractionSession.
 *
 * Pins the packet-approved acceptance criteria at the SESSION level:
 *   - act-from-detached creates a NAMED ref (cause-slugged, unique) + head
 *     attach; act-at-tip advances the ref; both journaled;
 *   - paths()/switchPath()/renamePath()/newPathAt() (plain names);
 *   - compare() = the branches/ foldDiff enriched with per-side ROW COUNTS
 *     (memory provider);
 *   - bringOver()/undo() plan via branches/ and execute via NORMAL dispatch —
 *     the landed commit's cause carries replayedFrom/revertOf (+ conflicts),
 *     surviving serializeLog → JSON → validateCause round-trips;
 *   - overview() surfaces paths (current, list, detachedAt, ref-events).
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import { serializeLog, deserializeLog } from '../log/index.js';
import { validateCause } from '../cause/index.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });

function freshSession() {
  return buildDashboard(makeDashboardDef()).createSession();
}

/** select Formal on bar (a) → filter price [60,130] on scatter (b) — the shared two-step main line. */
async function mainLine(s: ReturnType<typeof freshSession>) {
  const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
  const b = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 130], cause: userCause() });
  return { aId: a.ok ? a.commit!.id : '', bId: b.ok ? b.commit!.id : '' };
}

describe('BR-1 — act-at-tip advances the ref; act-from-detached creates a NAMED ref; both journaled', () => {
  it('the first commit births "main"; linear commits advance it', async () => {
    const s = freshSession();
    expect(s.paths()).toEqual([]); // unborn main — no tip yet
    expect((await s.overview()).paths.current).toBe('main');

    const { aId, bId } = await mainLine(s);
    expect(s.paths()).toEqual([{ name: 'main', tip: bId, steps: 2, lastTs: 1, active: true }]);

    const events = (await s.overview()).paths.events;
    expect(events[0]).toMatchObject({ type: 'create', name: 'main', at: aId, auto: true });
    expect(events[1]).toMatchObject({ type: 'advance', name: 'main', at: bId });
  });

  it('seek detaches HEAD; the next act auto-creates a cause-slugged path and attaches', async () => {
    const s = freshSession();
    const { aId, bId } = await mainLine(s);

    s.seek(aId); // travel by id → detached (journaled switch)
    const ovDetached = await s.overview();
    expect(ovDetached.paths.current).toBeNull();
    expect(ovDetached.paths.detachedAt).toBe(aId);
    expect(ovDetached.paths.events.at(-1)).toMatchObject({ type: 'switch', to: null, at: aId });

    const c = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('premium focus') });
    const cId = c.ok ? c.commit!.id : '';
    const ov = await s.overview();
    expect(ov.paths.current).toBe('premium-focus'); // named branch-on-act
    expect(ov.paths.events.at(-1)).toMatchObject({ type: 'create', name: 'premium-focus', at: cId, auto: true });
    expect(s.paths()).toEqual(
      expect.arrayContaining([
        { name: 'main', tip: bId, steps: 2, lastTs: 1, active: false },
        { name: 'premium-focus', tip: cId, steps: 2, lastTs: 2, active: true },
      ]),
    );
  });

  it('two same-intent branch-on-acts get UNIQUE names (counter suffix)', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('premium focus') });
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('premium focus') });
    const names = s.paths().map((p) => p.name).sort();
    expect(names).toEqual(['main', 'premium-focus', 'premium-focus-2']);
  });

  it('the fork VERB detaches too — its sibling act auto-names (branch-on-act is one story)', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    const forked = await s.dispatch({ verb: 'fork', fromCommitId: aId, cause: userCause() });
    expect(forked.ok).toBe(true);
    expect((await s.overview()).paths.detachedAt).toBe(aId);
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [130, 200], cause: userCause('try the high band') });
    expect((await s.overview()).paths.current).toBe('try-the-high-band');
  });
});

describe('BR-1 — switchPath / renamePath / newPathAt (plain names, typed gaps)', () => {
  it('switchPath seeks to the tip, attaches HEAD, and ACTIVATES the lineage (next act advances, not branches)', async () => {
    const s = freshSession();
    const { aId, bId } = await mainLine(s);
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('premium focus') });

    const switched = s.switchPath('main');
    expect(switched).toEqual({ ok: true, name: 'main', cursor: bId });
    expect(s.cursor()).toBe(bId);
    expect(s.head).toBe(bId); // activated — not "viewing the past"
    expect((await s.overview()).time.viewingPast).toBe(false);
    // the fold is main's: Formal + the price band
    expect((await s.overview()).activeSelections).toEqual(
      expect.arrayContaining([
        { viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' },
        { viewId: 'scatter', field: 'price', kind: 'interval', value: [60, 130] },
      ]),
    );

    // the next act EXTENDS main (ref advance — no new path is born)
    const d = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Work', cause: userCause() });
    const dId = d.ok ? d.commit!.id : '';
    expect(s.paths().find((p) => p.name === 'main')).toMatchObject({ tip: dId, steps: 3, active: true });
    expect(s.paths()).toHaveLength(2); // main + premium-focus, nothing new
  });

  it('switchPath to an unknown name is a typed guard-failed gap on op "switchPath"', async () => {
    const s = freshSession();
    await mainLine(s);
    const res = s.switchPath('ghost');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap.code).toBe('guard-failed');
      expect(res.gap.op).toBe('switchPath');
    }
    expect(s.gaps().at(-1)?.op).toBe('switchPath');
  });

  it('renamePath renames (journaled); unknown old name is a typed gap', async () => {
    const s = freshSession();
    await mainLine(s);
    expect(s.renamePath('main', 'baseline')).toEqual({ ok: true, name: 'baseline' });
    expect(s.paths().map((p) => p.name)).toEqual(['baseline']);
    expect((await s.overview()).paths.current).toBe('baseline'); // HEAD followed
    expect((await s.overview()).paths.events.at(-1)).toMatchObject({ type: 'rename', from: 'main', to: 'baseline' });

    const bad = s.renamePath('ghost', 'x');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.gap.op).toBe('renamePath');
  });

  it('newPathAt starts a named path at a prior commit; the next act EXTENDS it; auto-name slugs from that commit', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);

    const named = s.newPathAt(aId, 'experiment');
    expect(named).toEqual({ ok: true, name: 'experiment', cursor: aId });
    expect(s.cursor()).toBe(aId);
    expect((await s.overview()).paths.current).toBe('experiment');

    const c = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause() });
    const cId = c.ok ? c.commit!.id : '';
    expect(s.paths().find((p) => p.name === 'experiment')).toMatchObject({ tip: cId, steps: 2 });

    // auto-name: slug from the anchor commit's cause/field-value
    const auto = s.newPathAt(aId);
    expect(auto.ok && auto.name).toBe('category-formal');

    const dup = s.newPathAt(aId, 'experiment');
    expect(dup.ok).toBe(false); // taken → typed gap
    if (!dup.ok) expect(dup.gap.op).toBe('newPathAt');
    const ghost = s.newPathAt('nope');
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.gap.detail).toContain('nope');
  });
});

describe('BR-1 — compare(): the log-alone diff enriched with per-side row counts (memory provider)', () => {
  it('compares two named paths: ancestor, changed/onlyA/onlyB, and REAL row counts', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s); // main: Formal + price [60,130]
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('premium focus') });

    const cmp = await s.compare('main', 'premium-focus');
    expect(cmp.ok).toBe(true);
    if (!cmp.ok) return;
    expect(cmp.ancestor).toBe(aId);
    expect(cmp.changed.map((c) => c.key)).toEqual(['selection:bar']); // Formal vs Casual
    expect(cmp.onlyA.map((e) => e.key)).toEqual(['selection:scatter']); // the price band exists only on main
    expect(cmp.onlyB).toEqual([]);
    // ROW COUNTS (fixture: 40 rows, category cycles 5, price = 50+2i+(i%5)):
    // main = Formal ∧ price∈[60,130] → 7 rows; premium-focus = Casual → 8 rows.
    expect(cmp.a).toEqual({ ref: 'main', tip: cmp.a.tip, rows: 7 });
    expect(cmp.b).toEqual({ ref: 'premium-focus', tip: cmp.b.tip, rows: 8 });
  });

  it('accepts raw commit ids too, and an unknown ref is a typed gap on op "compare"', async () => {
    const s = freshSession();
    const { aId, bId } = await mainLine(s);
    const cmp = await s.compare(aId, bId);
    expect(cmp.ok).toBe(true);
    if (cmp.ok) {
      expect(cmp.ancestor).toBe(aId); // same-path: the upstream commit
      expect(cmp.a.rows).toBe(8); // Formal alone
      expect(cmp.b.rows).toBe(7); // Formal ∧ price band
    }

    const bad = await s.compare('main', 'ghost');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.gap.op).toBe('compare');
      expect(bad.gap.detail).toContain('ghost');
    }
  });
});

describe('BR-1 — bringOver(): plan via branches/, execute via NORMAL dispatch, cause carries replayedFrom', () => {
  it('clean case: no conflicts; the landed commit is ordinary and its cause tag survives serializeLog → JSON', async () => {
    const s = freshSession();
    const { aId, bId } = await mainLine(s);
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('premium focus') });

    // bring main's price band over to premium-focus — scatter untouched here since the LCA
    const res = await s.bringOver(bId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.conflicts).toEqual([]);
    expect(res.recipe).toEqual({ apply: 'selection', viewId: 'scatter', kind: 'interval', field: 'price', value: [60, 130] });
    expect(res.commit?.cause.replayedFrom).toBe(bId);
    expect(res.commit?.cause.conflicts).toBeUndefined();

    // the branch now filters Casual ∧ [60,130] — the fold applied it for real
    expect((await s.overview()).activeSelections).toEqual(
      expect.arrayContaining([
        { viewId: 'bar', field: 'category', kind: 'point', value: 'Casual' },
        { viewId: 'scatter', field: 'price', kind: 'interval', value: [60, 130] },
      ]),
    );
    // the ref ADVANCED (an ordinary commit on the named path)
    expect(s.paths().find((p) => p.name === 'premium-focus')).toMatchObject({ tip: res.commit!.id, steps: 3 });

    // wire round-trip: serializeLog → JSON.parse → the cause validates with the tag intact
    const wire = deserializeLog(serializeLog(s.log.records));
    const landed = wire.find((r) => r.id === res.commit!.id)!;
    expect(validateCause(landed.cause).replayedFrom).toBe(bId);
    expect(structuredClone(landed.cause)).toEqual(landed.cause);
  });

  it('conflict case: the same key was touched on this path since the LCA — named in the RESULT and in the CAUSE', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.seek(aId);
    const c = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('premium focus') });
    const cId = c.ok ? c.commit!.id : '';

    // bring main's ROOT bar-select (aId) over — but this path re-selected bar at cId since the LCA
    const res = await s.bringOver(aId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.conflicts).toEqual([cId]); // returned result names the overriding commit…
    expect(res.commit?.cause.conflicts).toEqual([cId]); // …and the landed cause carries it (audited forever)
    expect(res.commit?.cause.replayedFrom).toBe(aId);
    // …and the plan still executed: bar is Formal again on this path
    expect((await s.overview()).activeSelections).toEqual(
      expect.arrayContaining([{ viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' }]),
    );

    // the conflict note survives the wire byte-for-byte
    const wire = deserializeLog(serializeLog(s.log.records));
    const landed = wire.find((r) => r.id === res.commit!.id)!;
    expect(validateCause(landed.cause).conflicts).toEqual([cId]);
  });

  it('bringing over an ANALYSIS commit re-declares it (new FDR row — p-values are never copied)', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    const t1 = await s.declareAnalysis('correlation');
    expect(t1.commit).toBeDefined();
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('premium focus') });

    const res = await s.bringOver(t1.commit!.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.recipe).toEqual({ apply: 'analysis', analysisId: 'correlation' });
    expect(res.commit?.cause.replayedFrom).toBe(t1.commit!.id);
    expect((await s.overview()).fdr.tests).toBe(2); // re-ran and stepped the ledger — no copy
  });

  it('an unknown commit id is a typed gap on op "bringOver"', async () => {
    const s = freshSession();
    await mainLine(s);
    const res = await s.bringOver('ghost');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap.op).toBe('bringOver');
      expect(res.gap.code).toBe('guard-failed');
    }
  });
});

describe('BR-1 — undo(): restore the key\'s value at the commit\'s parent; cause carries revertOf', () => {
  it('restores the parent value: undo(re-select) lands the ORIGINAL selection again', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const e = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause() });
    const eId = e.ok ? e.commit!.id : '';

    const res = await s.undo(eId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.recipe).toEqual({ apply: 'selection', viewId: 'bar', kind: 'point', field: 'category', value: 'Formal' });
    expect(res.commit?.cause.revertOf).toBe(eId);
    expect((await s.overview()).activeSelections).toEqual([{ viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' }]);

    // round-trip: the revert tag survives the wire
    const wire = deserializeLog(serializeLog(s.log.records));
    expect(validateCause(wire.find((r) => r.id === res.commit!.id)!.cause).revertOf).toBe(eId);
  });

  it('absent at parent → CLEAR recipe (filter null), with later touches named as conflicts', async () => {
    const s = freshSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    const e = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause() });
    const eId = e.ok ? e.commit!.id : '';

    const res = await s.undo(aId); // parent of a is the root — nothing there → clear
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.recipe).toEqual({ apply: 'clear-selection', viewId: 'bar', field: 'category' });
    expect(res.conflicts).toEqual([eId]); // e touched the same key after a — explicit, still executed
    expect(res.commit?.cause.revertOf).toBe(aId);
    expect(res.commit?.cause.conflicts).toEqual([eId]);
    expect((await s.overview()).activeSelections).toEqual([]); // cleared for real
  });

  it('undo of a reencode restores the PRIOR binding; undo of the FIRST reencode restores the declared initial', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const u1 = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'rating', cause: userCause() });
    const u1Id = u1.ok ? u1.commit!.id : '';
    const u2 = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'id', cause: userCause() });
    const u2Id = u2.ok ? u2.commit!.id : '';
    expect(s.viewEncodings('scatter')).toEqual({ x: 'id', y: 'rating' });

    // prior binding exists → restore it
    const res2 = await s.undo(u2Id);
    expect(res2.ok && res2.recipe).toEqual({ apply: 'encoding', viewId: 'scatter', channel: 'x', field: 'rating' });
    expect(s.viewEncodings('scatter')).toEqual({ x: 'rating', y: 'rating' });

    // absent at parent → clear-encoding → the session restores the DECLARED initial (x: price)
    const res1 = await s.undo(u1Id);
    expect(res1.ok && res1.recipe).toEqual({ apply: 'clear-encoding', viewId: 'scatter', channel: 'x' });
    expect(s.viewEncodings('scatter')).toEqual({ x: 'price', y: 'rating' });
    if (res1.ok) expect(res1.commit?.cause.revertOf).toBe(u1Id);
  });

  it('REGRESSION (root-cause fix): two DIFFERENT actors can reencode the same view — the shared encoding source has a stable meta', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const byUser = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'rating', cause: userCause() }, { as: 'user' });
    expect(byUser.ok).toBe(true);
    // Before the fix this threw SourceRegistryError: `encoding:scatter` had been
    // registered with actor-dependent meta. WHO acted lives in the cause.
    const byAgent = await s.dispatch(
      { verb: 'reencode', viewId: 'scatter', channel: 'y', field: 'price', cause: { requestedBy: 'agent', computedBy: 'agent' } },
      { as: 'agent' },
    );
    expect(byAgent.ok).toBe(true);
    if (byUser.ok && byAgent.ok) {
      expect(byUser.commit!.cause.requestedBy).toBe('user');
      expect(byAgent.commit!.cause.requestedBy).toBe('agent');
      expect(byUser.commit!.actorMeta).toEqual(byAgent.commit!.actorMeta); // stable source identity
    }
  });

  it('an analysis commit is honestly NOT undoable — typed gap, ledger untouched', async () => {
    const s = freshSession();
    await mainLine(s);
    const t = await s.declareAnalysis('correlation');
    const res = await s.undo(t.commit!.id);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap.op).toBe('undo');
      expect(res.gap.detail).toContain('never refunds');
    }
    expect((await s.overview()).fdr.tests).toBe(1); // nothing rewound
  });

  it('an unknown commit id is a typed gap on op "undo"', async () => {
    const s = freshSession();
    await mainLine(s);
    const res = await s.undo('ghost');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.gap.op).toBe('undo');
  });
});
