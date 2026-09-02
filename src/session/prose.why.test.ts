/**
 * `why()` over a view's words, and the human-edit re-stamp: the describe
 * commit is the anchor, the selections live when the words landed are the
 * input, the proposal / basis / cited commits ride as related, an analysis the
 * words quote lends its ledger row — and a person's edit of an agent's words
 * is judged on the screen it was made on.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';
import type { ProseRecord } from '../prose/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const agentCause: Cause = { requestedBy: 'agent', computedBy: 'agent', intent: 'caption' };
const withProse = (): DashboardDef => ({ ...makeDashboardDef(), prose: [{ viewId: 'scatter', slots: { title: { text: 'Price against rating', author: { kind: 'human', by: 'sanjay' } } } }] });
const id = (r: { ok: boolean; commit?: { id: string } }): string => (r.ok && r.commit ? r.commit.id : '');

describe('why({ kind: prose })', () => {
  it('the declaration\'s own words have no commit (declared-in-def); an unknown slot is no target; null = back to the def', async () => {
    const s = buildDashboard(withProse()).createSession();
    expect(s.why({ kind: 'prose', viewId: 'scatter', slot: 'title' })).toEqual({ ok: false, missing: 'declared-in-def', target: { kind: 'prose', viewId: 'scatter', slot: 'title' } });
    expect(s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' })).toEqual({ ok: false, missing: 'no-such-target', target: { kind: 'prose', viewId: 'scatter', slot: 'caption' } });
    await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'title', record: { text: 'Prices', author: { kind: 'human' } }, cause: userCause('retitle') });
    expect(s.why({ kind: 'prose', viewId: 'scatter', slot: 'title' }).ok).toBe(true);
    await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'title', record: null, cause: userCause('back to the def') });
    expect(s.why({ kind: 'prose', viewId: 'scatter', slot: 'title' })).toMatchObject({ ok: false, missing: 'declared-in-def' });
  });
  it('the describe commit anchors; the live selections are the input; a proposal, a basis commit and a cited commit ride as related; a bare string is dropped', async () => {
    const s = buildDashboard(withProse()).createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const proposal: ProseRecord = { text: 'Formal wear rates higher.', author: { kind: 'agent', model: 'm' }, levels: ['statistic'], basis: { filters: { bar: 'Formal' }, columns: ['rating'], atCommit: id(pick) } };
    const proposed = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: proposal, proposal: true, cause: agentCause, correlationId: 'call-7' });
    expect(proposed.ok).toBe(true);
    const accepted = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: null, accept: id(proposed), cause: userCause('accept'), correlationId: 'call-9' });
    expect(accepted.ok).toBe(true);
    const cited = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'Formal wear rates higher, see the pick.', author: { kind: 'human' }, refs: [{ span: [0, 6], commit: id(pick) }, { span: [8, 12], commit: 'ghost' }] }, cause: userCause('cite') });
    expect(cited.ok).toBe(false); // a ref must name a commit in the log
    const res = s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.targetKind).toBe('prose');
    expect(res.key).toBe('scatter.caption');
    expect(res.viz.commitId).toBe(id(accepted));
    expect(res.correlationId).toBe('call-9');
    // the pick is both the live input and the basis commit — one row, its first role
    expect(res.commits).toEqual([
      { tier: 'viz', id: id(accepted), kind: 'declaring' },
      { tier: 'viz', id: id(pick), kind: 'input-selection' },
      { tier: 'viz', id: id(proposed), kind: 'proposal' },
    ]);
    expect(res.misses.map((m) => m.missing)).toEqual(['no-agent-tier', 'no-kernel-snapshot']);
    // a human's words with a ref that exists ride the ref as related
    // a citation of a commit not already in the set rides as a ref (citing the live pick again would add no row: one row per commit)
    const ok = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'Formal wear rates higher, see the proposal.', author: { kind: 'human' }, refs: [{ span: [0, 6], commit: id(proposed) }] }, cause: userCause('cite') });
    expect(ok.ok).toBe(true);
    const cite = s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' });
    expect(cite.ok && cite.commits.map((c) => c.kind)).toEqual(['declaring', 'input-selection', 'ref']);
  });
  it('the set is minimal: one row per commit, the first role wins', async () => {
    const s = buildDashboard(withProse()).createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'Formal, twice cited, once picked.', author: { kind: 'human' }, basis: { atCommit: id(pick) }, refs: [{ span: [0, 6], commit: id(pick) }, { span: [8, 13], commit: id(pick) }] }, cause: userCause('write') });
    const res = s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' });
    expect(res.ok && res.commits.map((c) => [c.id, c.kind])).toEqual([[res.ok ? res.viz.commitId : '', 'declaring'], [id(pick), 'input-selection']]);
  });
  it('a basis commit that is not in the log is dropped, never faked; a null atCommit is not a commit', async () => {
    const s = buildDashboard(withProse()).createSession();
    await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'Words.', author: { kind: 'human' }, basis: { columns: ['price'], atCommit: 'ghost' } }, cause: userCause('write') });
    const ghost = s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' });
    expect(ghost.ok && ghost.commits.map((c) => c.kind)).toEqual(['declaring']);
    await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'Words.', author: { kind: 'human' }, basis: { columns: ['price'], atCommit: null } }, cause: userCause('write') });
    const nul = s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' });
    expect(nul.ok && nul.commits.map((c) => c.kind)).toEqual(['declaring']);
  });
  it('a ref to a beat is not a commit; an agent event log offered by the caller threads the agent tier', async () => {
    const s = buildDashboard(withProse()).createSession();
    await s.dispatch({ verb: 'checkpoint', label: 'start', cause: userCause('mark') });
    const landed = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'At the start.', author: { kind: 'human' }, refs: [{ span: [0, 5], beat: 'start' }] }, cause: userCause('write') });
    expect(landed.ok).toBe(true);
    const res = s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' }, { agentEventLog: [] });
    expect(res.ok && res.commits.map((c) => c.kind)).toEqual(['declaring']);
    expect(res.ok && res.misses.map((m) => m.missing)).toContain('no-join-key');
  });
  it('words that quote a table-shaped analysis inherit its run but no scalar key', async () => {
    const s = buildDashboard(withProse()).createSession();
    const ran = await s.dispatch({ verb: 'analyze', analysisId: 'groupby', cause: userCause('group') });
    expect(ran.ok).toBe(true);
    await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'Per category.', author: { kind: 'agent', model: 'm' }, levels: ['statistic'], basis: { analysisId: 'groupby' } }, cause: agentCause });
    const res = s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.key).toBe('scatter.caption');
  });
  it('words that quote an analysis inherit its ledger row and kernel', async () => {
    const s = buildDashboard(withProse()).createSession();
    const ran = await s.dispatch({ verb: 'analyze', analysisId: 'correlation', cause: userCause('correlate') });
    expect(ran.ok).toBe(true);
    const landed = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'Price and rating move together.', author: { kind: 'agent', model: 'm' }, levels: ['statistic'], basis: { analysisId: 'correlation' } }, cause: agentCause });
    expect(landed.ok).toBe(true);
    const res = s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fdr).toBeDefined();
    expect(res.misses.map((m) => m.missing)).not.toContain('no-kernel-snapshot');
  });
});

describe('a person edits an agent\'s words', () => {
  it('the basis keeps its keys but is re-stamped to the screen the edit was made on — fresh now, stale on its own terms later', async () => {
    const s = buildDashboard(withProse()).createSession();
    const agentWords: ProseRecord = { text: 'Higher prices rate higher.', author: { kind: 'agent', model: 'm' }, levels: ['statistic'], basis: { encodings: { x: 'price', y: 'rating' }, filters: {}, columns: ['price', 'rating'] } };
    await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: agentWords, cause: agentCause });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const before = (await s.overview()).views.find((v) => v.viewId === 'scatter')!.prose.find((p) => p.slot === 'caption')!;
    expect(before.status).toBe('stale');
    const edited: ProseRecord = { ...agentWords, text: 'Among formal wear, higher prices rate higher.', author: { kind: 'humanEdited', by: 'sanjay', model: 'm' } };
    const res = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: edited, cause: userCause('edit') });
    expect(res.ok).toBe(true);
    const after = (await s.overview()).views.find((v) => v.viewId === 'scatter')!.prose.find((p) => p.slot === 'caption')!;
    expect(after.status).toBe('current');
    expect(after.record.basis).toMatchObject({ encodings: { x: 'price', y: 'rating' }, filters: { bar: { field: 'category', kind: 'point', value: 'Formal' } }, columns: ['price', 'rating'] });
    // the agent's own evidence survives the edit, as it was
    expect(after.record.basis?.editedFrom).toEqual(agentWords.basis);
    // a second edit keeps the agent's ORIGINAL evidence, once, never nested
    const again = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { ...after.record, text: 'Edited twice.' }, cause: userCause('edit again') });
    expect(again.ok).toBe(true);
    const twice = (await s.overview()).views.find((v) => v.viewId === 'scatter')!.prose.find((p) => p.slot === 'caption')!;
    expect(twice.record.basis?.editedFrom).toEqual(agentWords.basis);
    expect(twice.record.basis?.editedFrom?.editedFrom).toBeUndefined();
    expect(after.record.basis?.atCommit).toBe(res.ok && res.commit ? res.commit.parent : null);
    // and it goes stale on its own terms when the screen moves again
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: undefined, cause: userCause('clear') });
    expect((await s.overview()).views.find((v) => v.viewId === 'scatter')!.prose.find((p) => p.slot === 'caption')!.status).toBe('stale');
    // a human edit with no basis is left alone
    const plain = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'Plain words.', author: { kind: 'humanEdited', model: 'm' } }, cause: userCause('edit') });
    expect(plain.ok).toBe(true);
    // a basis that states neither encodings nor filters keeps exactly what it states, on a view with no encoding surface
    const columnsOnly = await s.dispatch({ verb: 'describe', viewId: 'cluster', slot: 'title', record: { text: 'Clusters, by hand.', author: { kind: 'humanEdited', model: 'm' }, basis: { columns: ['price'] } }, cause: userCause('edit') });
    expect(columnsOnly.ok).toBe(true);
    const clusterTitle = (await s.overview()).views.find((v) => v.viewId === 'cluster')!.prose.find((p) => p.slot === 'title')!;
    expect(clusterTitle.record.basis).toEqual({ columns: ['price'], atCommit: columnsOnly.ok && columnsOnly.commit ? columnsOnly.commit.parent : null, editedFrom: { columns: ['price'] } });
  });
});
