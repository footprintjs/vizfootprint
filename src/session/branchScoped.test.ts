/**
 * "A read at a cursor answers about that cursor" (src/session/README.md, law 5).
 *
 * Two branches, and the wrong answer is the dangerous kind: confident, and
 * wearing this library's own provenance. A note written on one path cited a
 * pick made on the other; `why()` reported that pick as the words' evidence;
 * and a hypothesis asked for by name answered with whichever branch happened to
 * run it last. Each of those is a sentence about a moment, built out of a
 * moment that never happened there.
 *
 * The other half of the law is here too: the reads that legitimately see the
 * WHOLE log — seeking, bookmarking, comparing, bringing a step over — still do,
 * because those ask what EXISTS, not what is true here.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';
import type { InteractionSession } from './session.js';
import type { ProseRecord } from '../prose/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const idOf = (r: { ok: boolean; commit?: { id: string } }): string => (r.ok && r.commit ? r.commit.id : '');

/**
 * Two lineages off one root pick:
 *
 *   root ── formal ──┬── priceA   (the path we call A)
 *                    └── priceB   (the path we call B)
 *
 * The cursor is left on B, which is where a person walking this dashboard
 * would be standing after the second brush.
 */
async function twoBranches(): Promise<{ s: InteractionSession; root: string; a: string; b: string }> {
  const s = buildDashboard(makeDashboardDef()).createSession();
  const root = idOf(await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick formal') }));
  const a = idOf(await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [30, 120], cause: userCause('the affordable end') }));
  s.seek(root);
  const b = idOf(await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [120, 220], cause: userCause('the premium end') }));
  return { s, root, a, b };
}

describe('a read at a cursor answers about that cursor', () => {
  it('a note may not cite a commit from another branch — and the refusal says which of the two things went wrong', async () => {
    const { s, root, a, b } = await twoBranches();
    expect(s.cursor()).toBe(b);

    // Standing on B, citing A's brush: the commit is REAL, and that is exactly
    // the problem — these words stand at a moment that never saw it.
    const words: ProseRecord = { text: 'The premium end is where the ratings are, see the cheap brush.', author: { kind: 'human', by: 'sanjay' }, refs: [{ span: [46, 51], commit: a, label: 'the cheap brush' }] };
    const acrossBranches = await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: words, cause: userCause('write it up') });
    expect(acrossBranches.ok).toBe(false);
    expect(!acrossBranches.ok && acrossBranches.rejection.detail).toBe(
      `"note:n1".caption.refs[0] cites commit "${a}", which is on another branch — these words stand at a moment that never saw it; seek to it (or bring it over) and write them there`,
    );
    expect((await s.overview()).notes).toEqual([]); // judged first: nothing landed

    // a commit that does not exist AT ALL still says so in its own words — the
    // two failures are different, and a writer sent looking for a commit that is
    // sitting in the rail would waste the afternoon
    const ghost = await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: { ...words, refs: [{ span: [46, 51], commit: 's999' }] }, cause: userCause('write it up') });
    expect(!ghost.ok && ghost.rejection.detail).toBe('"note:n1".caption.refs[0] points at a commit the log does not hold: "s999"');

    // the root, and B's own brush, are both on this path — they cite fine
    const here = await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: { ...words, refs: [{ span: [46, 51], commit: root }] }, cause: userCause('write it up') });
    expect(here.ok).toBe(true);

    // and the SAME words land on A — nothing about them was wrong, only where they were being written
    s.seek(a);
    const onA = await s.dispatch({ verb: 'describe', viewId: 'note:n2', slot: 'caption', record: words, cause: userCause('write it up here instead') });
    expect(onA.ok).toBe(true);
    expect((await s.overview()).notes.map((n) => n.id)).toEqual(['n2']); // n1's words are on B, not here
  });

  it('a proposal is judged by the same world as the words it proposes', async () => {
    const { s, a } = await twoBranches();
    const proposal: ProseRecord = { text: 'Premium dresses rate higher.', author: { kind: 'agent', model: 'm' }, levels: ['statistic'], basis: { filters: {}, columns: ['rating'] }, refs: [{ span: [0, 7], commit: a }] };
    const res = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: proposal, proposal: true, cause: { requestedBy: 'agent', computedBy: 'agent', intent: 'caption' } });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.rejection.detail).toContain('is on another branch');
  });

  it('why() over words never reports a commit the words never stood in front of — even one the door did not judge', async () => {
    const { s, a, b } = await twoBranches();
    // `basis.atCommit` is inert data the door does not judge (a ghost is
    // dropped, never faked — the same law); an agent can therefore state one
    // from another branch. The answer must not dress it up as provenance.
    const landed = await s.dispatch({
      verb: 'describe',
      viewId: 'scatter',
      slot: 'caption',
      record: { text: 'The premium end.', author: { kind: 'human' }, basis: { columns: ['price'], atCommit: a } },
      cause: userCause('write it up'),
    });
    expect(landed.ok).toBe(true);

    const res = s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.viz.commitId).toBe(idOf(landed));
    // B's own brush is the input; A's commit is nowhere in the answer
    expect(res.commits.map((c) => c.id)).toContain(b);
    expect(res.commits.map((c) => c.id)).not.toContain(a);
    expect(res.commits.map((c) => c.kind)).not.toContain('basis');
  });

  it('why() over a hypothesis answers with the run on YOUR branch, not whichever branch ran it last', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const root = idOf(await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick formal') }));
    const onA = await s.declareAnalysis('correlation', { cause: userCause('is price correlated with rating?') });
    s.seek(root);
    const onB = await s.declareAnalysis('correlation', { cause: userCause('ask again over here') });
    expect(onA.commit && onB.commit).toBeTruthy();
    const aId = onA.commit!.id;
    const bId = onB.commit!.id;
    expect(aId).not.toBe(bId);

    // standing on B (where the second run landed): B's run, B's ledger row
    expect(s.cursor()).toBe(bId);
    const fromB = s.why({ kind: 'hypothesis', analysisId: 'correlation' });
    expect(fromB.ok && fromB.viz.commitId).toBe(bId);
    expect(fromB.ok && fromB.fdr?.step).toBe(onB.fdrStep!.step);

    // walk back to A: the run in front of you is A's, and so is its ledger row
    s.seek(aId);
    const fromA = s.why({ kind: 'hypothesis', analysisId: 'correlation' });
    expect(fromA.ok && fromA.viz.commitId).toBe(aId);
    expect(fromA.ok && fromA.fdr?.step).toBe(onA.fdrStep!.step);
    expect(onA.fdrStep!.step).not.toBe(onB.fdrStep!.step);

    // standing BEFORE either run, with two runs to choose from, there is no
    // answer — any one of them would be a guess
    s.seek(root);
    expect(s.why({ kind: 'hypothesis', analysisId: 'correlation' })).toEqual({ ok: false, missing: 'no-such-target', target: { kind: 'hypothesis', analysisId: 'correlation' } });
  });

  it('one run, asked from anywhere, still answers — parking a path must not destroy the statistics', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const root = idOf(await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick formal') }));
    const only = await s.declareAnalysis('correlation', { cause: userCause('ask once') });
    s.seek(root); // walked away from the branch that ran it
    const res = s.why({ kind: 'hypothesis', analysisId: 'correlation' });
    expect(res.ok && res.viz.commitId).toBe(only.commit!.id);
    expect(s.why({ kind: 'hypothesis', analysisId: 'regression' })).toMatchObject({ ok: false, missing: 'no-such-target' });
  });

  it('what EXISTS anywhere is still answered from the whole log: seeking, bookmarking, comparing, bringing over', async () => {
    const { s, root, a, b } = await twoBranches();

    // seek: travelling to another branch is the whole point of a cursor
    expect(s.seek(a)).toEqual({ ok: true, cursor: a });
    expect(s.seek(b).ok).toBe(true);

    // a bookmark is a name on a MOMENT, and the store is dashboard-wide: it may
    // name a commit on a path you are not standing on
    expect(s.bookmark('the cheap end', a).ok).toBe(true);
    expect(s.bookmarkViews().map((v) => v.commitId)).toEqual([a]);

    // comparing two branches reads both, by definition
    const diff = await s.compare(a, b);
    expect(diff.ok && diff.ancestor).toBe(root);

    // and a step can be carried across — that is what planning a bring-over IS
    const carried = await s.bringOver(a);
    expect(carried.ok).toBe(true);
    expect(s.log.records.at(-1)!.cause.replayedFrom).toBe(a);

    // having carried it over, the citation that was refused above is now honest here
    const words: ProseRecord = { text: 'Both ends, one path.', author: { kind: 'human' }, refs: [{ span: [0, 4], commit: s.log.records.at(-1)!.id }] };
    expect((await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: words, cause: userCause('now it is here') })).ok).toBe(true);
  });

  it('`commits(scope)` is the door, and the scope is the whole point: the PATH is root->cursor, the HISTORY is every branch', async () => {
    const { s, root, a, b } = await twoBranches();

    // standing on B: the path is what THIS position could have seen, and A's brush is not on it
    expect(s.cursor()).toBe(b);
    expect(s.commits('path').map((r) => r.id)).toEqual([root, b]);
    // the history is the whole tree, in arrival order — a branch map's list, and an existence check's
    expect(s.commits('anywhere').map((r) => r.id)).toEqual([root, a, b]);

    // seek across, and the path answers about where you now stand
    s.seek(a);
    expect(s.commits('path').map((r) => r.id)).toEqual([root, a]);
    expect(s.commits('anywhere').map((r) => r.id)).toEqual([root, a, b]); // unmoved: the history is not a position

    // detached: a null cursor has seen nothing, and says so rather than falling back to the log
    const fresh = buildDashboard(makeDashboardDef()).createSession();
    expect(fresh.cursor()).toBeNull();
    expect(fresh.commits('path')).toEqual([]);
    expect(fresh.commits('anywhere')).toEqual([]);

    // detached either way — a reader never holds something the session is still writing to
    expect(Object.isFrozen(s.commits('path'))).toBe(true);
    expect(Object.isFrozen(s.commits('anywhere'))).toBe(true);
  });

  it('an agent-authored chart is deliberately NOT branch-scoped — the ledger already charged for it', async () => {
    const { s, a } = await twoBranches();
    const proposed = await s.proposeChart({ id: 'pr', claim: 'price vs rating', spec: { mark: 'circle', encoding: { x: { field: 'price', type: 'quantitative' }, y: { field: 'rating', type: 'quantitative' } } } }, { as: 'agent' });
    expect(proposed.ok).toBe(true);
    const spent = s.ledger().length;
    s.seek(a); // a different path entirely
    // the claim is still visible, because the alpha it spent is still spent
    expect(s.charts().map((c) => c.chartId)).toEqual(['pr']);
    expect((await s.overview()).charts.map((c) => c.ledgered)).toEqual([true]);
    expect(s.ledger().length).toBe(spent);
    // and the id it was proposed under stays taken, everywhere
    const again = await s.proposeChart({ id: 'pr', claim: 'again', spec: { mark: 'circle', encoding: { x: { field: 'price', type: 'quantitative' } } } }, { as: 'agent' });
    expect(!again.ok && again.gap.detail).toContain('already proposed');
  });
});
