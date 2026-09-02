/**
 * TL-1 acceptance (session tier) — the trail LIFECYCLE over a live
 * `InteractionSession`: archive / restore / discardFromHere / adoptPath.
 *
 * One principle, tested from every side: **never erase the record — erase the
 * VIEW.** Refs move and hide; commits are forever, and the statistics remember.
 *
 *   1. archivePath / restorePath — hidden from `paths()`, listed with
 *      `{includeArchived:true}` and flagged, HEAD detaches at the tip when it
 *      rode the archived path, the LAST visible path cannot be archived;
 *   2. discardFromHere — the ref moves back, the abandoned future is kept as a
 *      system-named archived path, and the old tip STILL FOLDS IDENTICALLY
 *      (the fold-proof); a commit on someone else's path is a typed gap;
 *   3. adoptPath — merge by replay: every step since the common ancestor
 *      re-lands as an ordinary `replayedFrom` commit, in order, with conflicts
 *      noted per step and unreplayable kinds honestly skipped; the source path
 *      is untouched;
 *   4. the HONESTY INVARIANTS — archiving and discarding never change global
 *      FDR wealth or the test count, the two-truths ledger still counts an
 *      archived branch's tests, compare()/why() still accept archived ids, a
 *      restore round-trips byte-identically, and every lifecycle event lands in
 *      the ref journal with its actor.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import { foldStateAt } from '../branches/index.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });

function freshSession() {
  return buildDashboard(makeDashboardDef()).createSession();
}

type Session = ReturnType<typeof freshSession>;

/** select Formal on bar (a) → filter price [60,130] on scatter (b) — the shared main line. */
async function mainLine(s: Session): Promise<{ aId: string; bId: string }> {
  const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
  const b = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 130], cause: userCause() });
  return { aId: a.ok ? a.commit!.id : '', bId: b.ok ? b.commit!.id : '' };
}

/** main (a→b) plus a sibling path "premium-focus" forked at `a`. Leaves HEAD on the sibling. */
async function twoPaths(s: Session): Promise<{ aId: string; bId: string; cId: string }> {
  const { aId, bId } = await mainLine(s);
  s.seek(aId);
  const c = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('premium focus') });
  return { aId, bId, cId: c.ok ? c.commit!.id : '' };
}

describe('TL-1 archivePath / restorePath — hidden from the listing, never erased', () => {
  it('an archived path leaves paths() but is listed, flagged, with includeArchived', async () => {
    const s = freshSession();
    const { bId, cId } = await twoPaths(s);

    const res = s.archivePath('main');
    expect(res).toEqual({ ok: true, name: 'main', tip: bId, detached: false });
    expect(s.paths()).toEqual([{ name: 'premium-focus', tip: cId, steps: 2, lastTs: 2, active: true }]);
    expect(s.paths({ includeArchived: true })).toEqual(
      expect.arrayContaining([
        { name: 'main', tip: bId, steps: 2, lastTs: 1, active: false, archived: true },
        { name: 'premium-focus', tip: cId, steps: 2, lastTs: 2, active: true },
      ]),
    );
  });

  it('whats_here reports the archived COUNT without listing them; the journal names the actor', async () => {
    const s = freshSession();
    await twoPaths(s);
    s.archivePath('main', { as: 'agent' });

    const ov = await s.overview();
    expect(ov.paths.archived).toBe(1);
    expect(ov.paths.list.map((p) => p.name)).toEqual(['premium-focus']);
    expect(ov.paths.events.at(-1)).toMatchObject({ type: 'archive', name: 'main', by: 'agent' });
  });

  it('archiving the path HEAD rides detaches HEAD at its tip; acting there starts a NEW path', async () => {
    const s = freshSession();
    const { cId } = await twoPaths(s); // HEAD on premium-focus

    const res = s.archivePath('premium-focus');
    expect(res).toEqual({ ok: true, name: 'premium-focus', tip: cId, detached: true });
    const ov = await s.overview();
    expect(ov.paths.current).toBeNull();
    expect(ov.paths.detachedAt).toBe(cId);
    expect(s.cursor()).toBe(cId); // you are still standing exactly where you were

    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('second look') });
    expect((await s.overview()).paths.current).toBe('second-look');
    expect(s.paths({ includeArchived: true }).find((p) => p.name === 'premium-focus')!.tip).toBe(cId); // frozen
  });

  it('switching to an archived path is a typed gap (restore it first)', async () => {
    const s = freshSession();
    await twoPaths(s);
    s.archivePath('main');
    const res = s.switchPath('main');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.gap.detail).toContain('archived');
  });

  it('the LAST visible path cannot be archived; unknown / already-archived file typed gaps', async () => {
    const s = freshSession();
    await twoPaths(s);

    const ghost = s.archivePath('ghost');
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.gap).toMatchObject({ code: 'guard-failed', op: 'archivePath', target: 'ghost' });

    expect(s.archivePath('main').ok).toBe(true);
    expect(s.archivePath('main').ok).toBe(false); // already archived
    const last = s.archivePath('premium-focus');
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.gap.detail).toContain('only visible path');
  });

  it('renaming an ARCHIVED path is a typed gap — never a silent resurrection (regression)', async () => {
    const s = freshSession();
    const { bId } = await twoPaths(s);
    s.archivePath('main');

    const res = s.renamePath('main', 'trunk');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap).toMatchObject({ code: 'guard-failed', op: 'renamePath', target: 'main' });
      expect(res.gap.detail).toBe('path "main" is archived — restore it first');
    }
    // still hidden, still unswitchable, still at its own tip — nothing resurrected
    expect(s.paths().map((p) => p.name)).toEqual(['premium-focus']);
    expect(s.paths({ includeArchived: true }).find((p) => p.name === 'main')).toMatchObject({ tip: bId, archived: true });
    expect(s.switchPath('main').ok).toBe(false);
    // and the journal recorded no rename (bookkeeping stays truthful)
    expect((await s.overview()).paths.events.filter((e) => e.type === 'rename')).toEqual([]);

    // restore first, then rename — the honest route works
    expect(s.restorePath('main').ok).toBe(true);
    expect(s.renamePath('main', 'trunk')).toEqual({ ok: true, name: 'trunk' });
    expect(s.switchPath('trunk').ok).toBe(true);
  });

  it('INVARIANT through the session API: archived names stay live refs, and HEAD never rides one', async () => {
    const s = freshSession();
    const { aId } = await twoPaths(s);
    const check = async (): Promise<void> => {
      const all = s.paths({ includeArchived: true });
      const current = (await s.overview()).paths.current;
      for (const p of all.filter((x) => x.archived === true)) {
        // "a live ref" — it still resolves, and compare() can still reach it
        expect((await s.compare(p.name, p.tip)).ok, `archived "${p.name}" must still resolve`).toBe(true);
      }
      if (current !== null) {
        expect(all.find((p) => p.name === current)?.archived, `HEAD must never ride archived "${current}"`).toBeUndefined();
      }
    };

    await check();
    s.archivePath('main');
    await check();
    s.renamePath('main', 'trunk'); // refused
    await check();
    s.restorePath('main');
    s.renamePath('main', 'trunk');
    await check();
    // the freed name, re-used: born VISIBLE, and HEAD may ride it
    s.newPathAt(aId, 'main');
    await check();
    expect(s.paths().map((p) => p.name).sort()).toEqual(['main', 'premium-focus', 'trunk']);
    expect((await s.overview()).paths.current).toBe('main');
    // archiving the one HEAD rides detaches — so the invariant holds there too
    s.archivePath('main');
    await check();
    expect((await s.overview()).paths.current).toBeNull();
  });

  it('restore is the exact inverse — the full listing round-trips byte-identically', async () => {
    const s = freshSession();
    await twoPaths(s);
    const before = JSON.stringify(s.paths({ includeArchived: true }));

    s.archivePath('main');
    expect(JSON.stringify(s.paths({ includeArchived: true }))).not.toBe(before);

    const res = s.restorePath('main');
    expect(res.ok).toBe(true);
    expect(JSON.stringify(s.paths({ includeArchived: true }))).toBe(before);
    expect((await s.overview()).paths.archived).toBe(0);
    expect(s.switchPath('main').ok).toBe(true); // switchable again
  });

  it('restoring an unknown or un-archived path files a typed gap', async () => {
    const s = freshSession();
    await twoPaths(s);
    const ghost = s.restorePath('ghost');
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.gap.op).toBe('restorePath');
    const live = s.restorePath('main');
    expect(live.ok).toBe(false);
    if (!live.ok) expect(live.gap.detail).toContain('not archived');
  });
});

describe('TL-1 discardFromHere — the ref rewinds, the future is kept', () => {
  it('moves the path back and archives the abandoned future under a findable name', async () => {
    const s = freshSession();
    const { aId, bId } = await mainLine(s);
    s.seek(aId);

    const res = s.discardFromHere();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path).toBe('main');
    expect(res.at).toBe(aId);
    expect(res.keptTip).toBe(bId);
    expect(res.steps).toBe(1);
    expect(res.kept).toMatch(/^discarded-/);

    // main now ends at `a`; the abandoned future is hidden but listed on request
    expect(s.paths()).toEqual([{ name: 'main', tip: aId, steps: 1, lastTs: 0, active: true }]);
    expect(s.paths({ includeArchived: true }).find((p) => p.name === res.kept)).toEqual({
      name: res.kept,
      tip: bId,
      steps: 2,
      lastTs: 1,
      active: false,
      archived: true,
    });
    expect(s.cursor()).toBe(aId);
    expect(s.head).toBe(aId);
  });

  it('works WITHOUT seeking first — point at an earlier step of the path you are on', async () => {
    const s = freshSession();
    const { aId, bId } = await mainLine(s); // HEAD attached to main, standing at b
    expect((await s.overview()).paths.current).toBe('main');

    const res = s.discardFromHere({ at: aId }); // the branch-map gesture: no seek, just aim
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res).toMatchObject({ path: 'main', at: aId, keptTip: bId, steps: 1 });
    expect((await s.overview()).paths.current).toBe('main'); // still on your path, now rewound
    expect(s.cursor()).toBe(aId);
    // the fold rebuilt at the rewound tip: the discarded price filter is gone from view…
    expect((await s.overview()).activeSelections).toMatchObject([
      { viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' },
    ]);
    // …but its commit is still there, and still folds
    expect(foldStateAt(s.log.records, bId).size).toBe(2);
  });

  it('FOLD-PROOF — the old tip still folds byte-identically after the discard', async () => {
    const s = freshSession();
    const { aId, bId } = await mainLine(s);
    const foldBefore = JSON.stringify([...foldStateAt(s.log.records, bId)]);

    s.seek(aId);
    const res = s.discardFromHere();
    expect(res.ok).toBe(true);

    expect(JSON.stringify([...foldStateAt(s.log.records, bId)])).toBe(foldBefore); // nothing was deleted
    expect(s.log.records.some((r) => r.id === bId)).toBe(true);
    // and one restore brings the whole line back into the listing
    if (res.ok) expect(s.restorePath(res.kept).ok).toBe(true);
    expect(s.paths().map((p) => p.name).sort()).toEqual([...s.paths().map((p) => p.name)].sort());
    expect(s.paths()).toHaveLength(2);
  });

  it('the next act extends the rewound path (it does not re-fork)', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.seek(aId);
    expect(s.discardFromHere().ok).toBe(true);

    const next = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Work', cause: userCause() });
    expect((await s.overview()).paths.current).toBe('main');
    expect(s.paths().find((p) => p.name === 'main')!.tip).toBe(next.ok ? next.commit!.id : '');
  });

  it('while detached, discarding works from the one path that continues past here', async () => {
    const s = freshSession();
    const { aId, cId } = await twoPaths(s); // HEAD on premium-focus (a → c)
    s.seek(cId); // detached at the sibling's own tip
    const nothing = s.discardFromHere();
    expect(nothing.ok).toBe(false);
    if (!nothing.ok) expect(nothing.gap.detail).toContain('no path continues past');

    // aim at the fork point instead: TWO paths continue past it — honest refusal
    const ambiguous = s.discardFromHere({ at: aId });
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.gap.detail).toContain('branches into 2 paths');
  });

  it('a commit on ANOTHER path is a typed gap — only your own future is discardable', async () => {
    const s = freshSession();
    const { bId } = await twoPaths(s); // HEAD on premium-focus; bId lives only on main
    const res = s.discardFromHere({ at: bId });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap.op).toBe('discardFromHere');
      expect(res.gap.detail).toContain('only your own future is discardable');
    }
  });

  it('standing at the end of your own path, or before any step, is an honest gap', async () => {
    const empty = freshSession();
    const none = empty.discardFromHere();
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.gap.detail).toContain('no steps yet');

    const s = freshSession();
    await mainLine(s);
    const atTip = s.discardFromHere();
    expect(atTip.ok).toBe(false);
    if (!atTip.ok) expect(atTip.gap.detail).toContain('nothing after here to discard');

    const unknown = s.discardFromHere({ at: 'nope' });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.gap.detail).toContain('no commit "nope"');
  });

  it('two discards down the same line get UNIQUE kept names (counter suffix)', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.seek(aId);
    const first = s.discardFromHere();
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 130], cause: userCause() });
    s.seek(aId);
    const second = s.discardFromHere();
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.kept).not.toBe(first.kept);
    expect(s.paths({ includeArchived: true }).filter((p) => p.archived)).toHaveLength(2);
  });
});

describe('TL-1 adoptPath — merge by replay, in order, honestly', () => {
  it('replays every step since the common ancestor as ordinary replayedFrom commits', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    // a sibling line with two steps of its own
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('party lane') });
    await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'rating', cause: userCause() });
    const sideTip = s.head!;
    s.switchPath('main');

    const res = await s.adoptPath('party-lane');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ancestor).toBe(aId);
    expect(res.applied).toBe(2);
    expect(res.skipped).toBe(0);
    expect(res.steps.map((st) => st.recipe?.apply)).toEqual(['selection', 'encoding']);

    // each landed as a NORMAL commit tagged with the step it replays
    for (const step of res.steps) {
      const landed = s.log.records.find((r) => r.id === step.landedAs)!;
      expect(landed.cause.replayedFrom).toBe(step.commitId);
    }
    // the source path is untouched (never archived, never moved)
    expect(s.paths().find((p) => p.name === 'party-lane')).toEqual({
      name: 'party-lane',
      tip: sideTip,
      steps: 3,
      lastTs: 3,
      active: false,
    });
    // and its work is now live here
    const ov = await s.overview();
    expect(ov.activeSelections.map(({ commitId: _c, ...sel }) => sel)).toEqual(
      expect.arrayContaining([{ viewId: 'bar', field: 'category', kind: 'point', value: 'Party' }]),
    );
    expect(ov.encodings['scatter']).toMatchObject({ color: 'rating' });
  });

  it('a step your path already overrode is noted as a CONFLICT (measured from where the adopt started)', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('party lane') });
    s.switchPath('main');
    const override = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Work', cause: userCause() });
    const overrideId = override.ok ? override.commit!.id : '';

    const res = await s.adoptPath('party-lane');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.conflicts).toEqual([overrideId]);
    expect(res.steps[0]!.conflicts).toEqual([overrideId]);
    // the conflict rides into the landed commit's cause — audited forever
    expect(s.log.records.find((r) => r.id === res.steps[0]!.landedAs)!.cause.conflicts).toEqual([overrideId]);
  });

  it('an agent-authored chart is honestly SKIPPED (proposed, never replayed)', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.seek(aId);
    await s.dispatch({ verb: 'annotate', target: 'scatter', note: 'a lane of its own', cause: userCause('chart lane') });
    await s.proposeChart({
      id: 'price-rating',
      spec: { mark: 'circle', encoding: { x: { field: 'price', type: 'quantitative' }, y: { field: 'rating', type: 'quantitative' } } },
      claim: 'price vs rating',
    });
    s.switchPath('main');

    const res = await s.adoptPath('chart-lane');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.applied).toBe(1); // the annotation replays
    expect(res.skipped).toBe(2); // the chart's hypothesis + spec commits do not
    for (const skipped of res.steps.filter((st) => !st.applied)) {
      expect(skipped.skippedReason).toContain('propose it again');
    }
  });

  it('a step the dispatch layer rejects is skipped WITH its reason, and the run continues', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('party lane') });
    await s.dispatch({ verb: 'annotate', target: 'scatter', note: 'after the bar click', cause: userCause() });
    s.switchPath('main');
    // the bar is now mounted as a DISPLAY-ONLY view: its capability refuses every
    // probe, so the replayed bar select cannot land here (an honest guard, not a
    // silent drop) while the annotation after it still replays fine.
    s.mountView('bar', { capabilities: { canProbe: false } });

    const res = await s.adoptPath('party-lane');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.steps[0]).toMatchObject({ applied: false, skippedReason: 'view "bar" declares no-probe capability' });
    expect(res.steps.at(-1)!.applied).toBe(true); // the run went on to the annotation
    expect(res).toMatchObject({ applied: 1, skipped: 1 });
    // R14: the refusal is also filed in the gap ledger — never dropped
    expect(s.gaps().at(-1)).toMatchObject({ code: 'guard-failed', op: 'select', target: 'bar' });
  });

  it('a step whose replay THROWS is reported as a skip and the run carries on (no lost report)', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('party lane') });
    await s.dispatch({ verb: 'annotate', target: 'scatter', note: 'and a note after it', cause: userCause() });
    s.switchPath('main');
    // a mounted view whose inbound render THROWS — real third-party code the
    // replay calls (R3 applyClause). The bar select cannot land; the annotation
    // after it must still be attempted.
    s.mountView('bar', {
      capabilities: { canProbe: true },
      applyClause: () => {
        throw new Error('renderer blew up');
      },
    });

    const res = await s.adoptPath('party-lane');
    expect(res.ok).toBe(true); // the caller ALWAYS gets its report
    if (!res.ok) return;
    expect(res.steps[0]).toMatchObject({ applied: false, skippedReason: 'replaying this step threw: renderer blew up' });
    expect(res.steps.at(-1)!.applied).toBe(true); // the run went on to the annotation
    expect(res).toMatchObject({ applied: 1, skipped: 1 });
    // R14: the throw is filed, never dropped
    expect(s.gaps().at(-1)).toMatchObject({ code: 'guard-failed', op: 'adoptPath', target: res.steps[0]!.commitId });
  });

  it('a non-Error throw is reported honestly too (never "[object Object]" with no message)', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('party lane') });
    s.switchPath('main');
    s.mountView('bar', {
      capabilities: { canProbe: true },
      applyClause: () => {
        throw 'plain string blow-up'; // eslint-disable-line no-throw-literal
      },
    });

    const res = await s.adoptPath('party-lane');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.steps[0]!.skippedReason).toBe('replaying this step threw: plain string blow-up');
  });

  it('a replayed analysis RE-RUNS here — degenerate on this path, it lands nothing and spends nothing', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.seek(aId);
    await s.dispatch({ verb: 'annotate', target: 'scatter', note: 'worth a test', cause: userCause('stat lane') });
    await s.declareAnalysis('correlation'); // a real test on the source lane
    s.switchPath('main');
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [53, 53], cause: userCause() });
    const before = (await s.overview()).fdr;

    const res = await s.adoptPath('stat-lane');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const analysisStep = res.steps.find((st) => st.recipe?.apply === 'analysis')!;
    expect(analysisStep.applied).toBe(true); // it genuinely re-ran here
    expect(analysisStep.landedAs).toBeUndefined(); // …and honestly landed nothing
    const after = (await s.overview()).fdr;
    expect(after.tests).toBe(before.tests); // a degenerate fit spends no wealth
    expect(after.wealth).toBe(before.wealth);
  });

  it('adopting a path that is already contained in yours applies nothing (honest zero)', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.newPathAt(aId, 'earlier');
    s.switchPath('main');
    const res = await s.adoptPath('earlier');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res).toMatchObject({ applied: 0, skipped: 0, ancestor: aId, steps: [] });
  });

  it('an unknown path, or the path you are on, is a typed gap', async () => {
    const s = freshSession();
    await mainLine(s);
    const ghost = await s.adoptPath('ghost');
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.gap).toMatchObject({ op: 'adoptPath', target: 'ghost' });
    const self = await s.adoptPath('main');
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.gap.detail).toContain('the path you are on');
  });

  it('adopting onto an EMPTY position replays the whole source line, with no ancestor', async () => {
    const s = freshSession();
    await mainLine(s);
    s.newPathAt(s.log.records[0]!.id, 'later'); // a path to leave from
    // travel before the very first commit: nothing here shares a root with main
    s.seek(s.log.records[0]!.id);

    const res = await s.adoptPath('main', { as: 'agent' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ancestor).toBe(s.log.records[0]!.id);
    expect(res.applied).toBe(1);
    expect(s.log.records.find((r) => r.id === res.steps[0]!.landedAs)!.cause.requestedBy).toBe('agent');
  });

  it('an ARCHIVED path can still be adopted — hidden is not gone', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('party lane') });
    s.switchPath('main');
    s.archivePath('party-lane');

    const res = await s.adoptPath('party-lane');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.applied).toBe(1);
  });
});

describe('TL-1 honesty invariants — the statistics remember', () => {
  it('archiving NEVER changes global FDR wealth, the test count, or the discoveries', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('dead end') });
    await s.declareAnalysis('correlation'); // a real test on the dead-end lane
    s.switchPath('main');

    const before = (await s.overview()).fdr;
    expect(before.tests).toBeGreaterThan(0);

    expect(s.archivePath('dead-end').ok).toBe(true);

    const after = (await s.overview()).fdr;
    expect(after.wealth).toBe(before.wealth); // alpha spent on a hidden branch is never refunded
    expect(after.tests).toBe(before.tests);
    expect(after.discoveries).toBe(before.discoveries);
    expect(after.ledger).toEqual(before.ledger);
    expect(s.ledger()).toHaveLength(before.tests);
  });

  it('discarding NEVER changes global FDR wealth or the test count', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    await s.declareAnalysis('correlation'); // a test lands on the future about to be discarded

    const before = (await s.overview()).fdr;
    s.seek(aId);
    expect(s.discardFromHere().ok).toBe(true);

    const after = (await s.overview()).fdr;
    expect(after.wealth).toBe(before.wealth);
    expect(after.tests).toBe(before.tests);
    expect(after.ledger).toEqual(before.ledger);
  });

  it('the two-truths ledger still counts an ARCHIVED branch (global) while the cursor stays local', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('dead end') });
    await s.declareAnalysis('correlation');
    s.switchPath('main');
    s.archivePath('dead-end');

    const ov = await s.overview();
    expect(ov.fdr.tests).toBe(1); // the GLOBAL truth counts the hidden branch's test
    expect(ov.time.cursorTests).toBe(0); // the CURSOR-LOCAL truth does not — you are not on it
    expect(ov.time.branches).toBe(2); // the DAG still has both lineages; only the NAME was hidden
  });

  it('the two-truths ledger after a DISCARD: global keeps the parked test, cursor-local drops it', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    await s.declareAnalysis('correlation'); // a real test on the future about to be parked
    expect((await s.overview()).time.cursorTests).toBe(1);

    s.seek(aId);
    const res = s.discardFromHere();
    expect(res.ok).toBe(true);

    const ov = await s.overview();
    expect(ov.fdr.tests).toBe(1); // GLOBAL: the parked branch's test is still counted
    expect(ov.time.cursorTests).toBe(0); // CURSOR-LOCAL: it is no longer on this path
    expect(ov.time.branches).toBe(1); // one lineage in the DAG — the rewind added no leaf
    // and standing back on the parked tip counts it locally again — nothing was erased
    if (res.ok) s.seek(res.keptTip);
    expect((await s.overview()).time.cursorTests).toBe(1);
  });

  it('compare() reaches a commit strictly INSIDE a parked segment (not just its tip)', async () => {
    const s = freshSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    const mid = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 130], cause: userCause() });
    const midId = mid.ok ? mid.commit!.id : '';
    const tip = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'rating', cause: userCause() });
    const tipId = tip.ok ? tip.commit!.id : '';

    s.seek(aId);
    expect(s.discardFromHere().ok).toBe(true); // parks midId AND tipId

    // the MIDDLE commit of the parked segment — no ref points at it at all
    const cmp = await s.compare(midId, aId);
    expect(cmp.ok).toBe(true);
    if (!cmp.ok) return;
    expect(cmp.ancestor).toBe(aId);
    expect(cmp.a).toMatchObject({ tip: midId, rows: 7 }); // its own fold still evaluates (Formal ∩ price 60–130)
    expect(cmp.onlyA.map((e) => e.key)).toEqual(['selection:scatter']);
    // and the parked TIP's later encoding is still readable too
    const deep = await s.compare(tipId, midId);
    expect(deep.ok).toBe(true);
    if (deep.ok) expect(deep.onlyA.map((e) => e.key)).toEqual(['encoding:scatter:color']);
  });

  it('compare() and why() still accept an archived path and its commit ids', async () => {
    const s = freshSession();
    const { aId, bId } = await mainLine(s);
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('dead end') });
    await s.declareAnalysis('clustering'); // a materialized column to ask why() about
    const deadTip = s.head!;
    s.switchPath('main');
    s.archivePath('dead-end');

    const byName = await s.compare('dead-end', 'main');
    expect(byName.ok).toBe(true);
    if (byName.ok) expect(byName.a.tip).toBe(deadTip);

    const byId = await s.compare(deadTip, bId);
    expect(byId.ok).toBe(true);
    if (byId.ok) expect(byId.ancestor).toBe(aId);

    expect(s.why({ kind: 'column', column: 'cluster_id' }).ok).toBe(true);
  });

  it('every lifecycle event lands in the ref journal with its actor, and none of them is a commit', async () => {
    const s = freshSession();
    const { aId } = await mainLine(s);
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('dead end') });
    s.switchPath('main');

    const commitsBefore = s.log.records.length;
    s.archivePath('dead-end', { as: 'agent' });
    s.restorePath('dead-end', { as: 'user' });
    s.archivePath('dead-end', { as: 'user' });
    s.seek(aId);
    s.discardFromHere({ as: 'agent' });

    const events = (await s.overview()).paths.events;
    expect(events.filter((e) => e.type === 'archive').map((e) => (e as { by: string }).by)).toEqual(['agent', 'user', 'agent']);
    expect(events.filter((e) => e.type === 'restore')).toMatchObject([{ name: 'dead-end', by: 'user' }]);
    expect(events.filter((e) => e.type === 'discard')).toMatchObject([{ name: 'main', by: 'agent' }]);
    expect(s.log.records.length).toBe(commitsBefore); // bookkeeping is NEVER a commit
  });
});
