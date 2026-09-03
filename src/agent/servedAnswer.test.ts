/**
 * What the SERVED answer owes its reader (src/agent/README.md).
 *
 * Four laws, one test file: the answer owes everything the session decided;
 * it owes the POSITION of anything that is not a claim about now; it owes a
 * word about what it could not honour; and it owes no repetition it can avoid.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, vizAsTools } from './index.js';
import { discreteCoercer } from '../def/index.js';
import type { DashboardDef, VizToolResult, VizToolsPort } from './index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const get = (r: VizToolResult, k: string): unknown => (r as Record<string, unknown>)[k];
const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });

/** A def with a second view to link to, prose declared, and grains so a crossing edge must state its fold. */
const linkableDef = (): DashboardDef => ({
  ...makeDashboardDef(),
  grains: [{ viewId: 'bar', keys: ['category'] }, { viewId: 'scatter', keys: [] }],
  prose: [{ viewId: 'scatter', slots: { title: { text: 'Declared words', author: { kind: 'human' } } } }],
});

const portOf = (def: DashboardDef = linkableDef(), ports?: Parameters<typeof buildDashboard>[1]): VizToolsPort =>
  vizAsTools(buildDashboard(def, ports).createSession({ as: 'agent' }), { as: 'agent' });

// ── Law 1 — the answer owes everything the session decided ────────────────────

describe('the served answer owes everything the session decided', () => {
  it('a COERCED rebind says so — the surface is showing something other than what was asked for', async () => {
    const def: DashboardDef = { ...makeDashboardDef(), encodingRules: { onInvalid: 'discrete' } };
    const p = portOf(def, { encoding: { coercers: [discreteCoercer] } });
    const res = await p.call('viz.dispatch', { verb: 'reencode', viewId: 'bar', channel: 'x', field: 'price' });
    expect(get(res, 'ok')).toBe(true);
    expect(get(res, 'reencoded')).toEqual({ viewId: 'bar', channel: 'x', field: 'price' });
    const coerced = get(res, 'coerced') as { severity: string; sentence: string; coercedTo: unknown }[];
    expect(coerced).toHaveLength(1);
    expect(coerced[0]!.severity).toBe('coerced');
    expect(coerced[0]!.sentence).toBe('"price" is continuous; the x channel of a bar needs a discrete column');
    expect(coerced[0]!.coercedTo).toMatchObject({ field: 'price', scale: 'discrete' });
  });

  it('a LINKED edge comes back as it now stands — including the def rule an un-declare fell back to', async () => {
    const p = portOf();
    const edited = await p.call('viz.dispatch', {
      verb: 'link', source: 'bar', kind: 'point', target: 'scatter',
      response: 'highlight', onClear: 'excludeAll', fold: 'every row of the lit category',
    });
    const linked = get(edited, 'linked') as { response: string; onClear: string };
    expect(linked.response).toBe('highlight');
    expect(linked.onClear).toBe('excludeAll');
    // null un-declares the edit; the answer names the edge the def's rule shows through as
    const undone = await p.call('viz.dispatch', { verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: null });
    expect((get(undone, 'linked') as { response: string }).response).not.toBe('highlight');
  });

  it('a DESCRIBED slot comes back with its staleness; going back to the def answers null, and null is an answer', async () => {
    const p = portOf();
    // `bar` declares no words of its own, so going back leaves the slot genuinely empty
    const set = await p.call('viz.dispatch', {
      verb: 'describe', viewId: 'bar', slot: 'title',
      record: { text: 'Prices', author: { kind: 'agent', model: 'm' }, basis: { columns: ['price'] } },
    });
    const described = get(set, 'described') as { slot: string; status: string; text: string };
    expect(described).toMatchObject({ slot: 'title', status: 'current', text: 'Prices' });
    // back to the def's own words: `described` is null, and the key is PRESENT — null is the answer, not an absence
    const back = await p.call('viz.dispatch', { verb: 'describe', viewId: 'bar', slot: 'title', record: null });
    expect('described' in back).toBe(true);
    expect(get(back, 'described')).toBeNull();
  });

  it('a PROPOSAL comes back with the proposing commit id, so the agent can cite the words it just put on the table', async () => {
    const p = portOf();
    const res = await p.call('viz.dispatch', {
      verb: 'describe', viewId: 'scatter', slot: 'caption', proposal: true,
      record: { text: 'Price rises with rating.', author: { kind: 'agent', model: 'm' }, levels: ['statistic'], basis: { columns: ['price', 'rating'] } },
    });
    const proposed = get(res, 'proposed') as { slot: string; proposal: string; status: string; by: string };
    expect(proposed).toMatchObject({ slot: 'caption', status: 'open', by: 'agent' });
    // it is the id of a commit this log holds — a citation, not a label
    const commit = get(res, 'commit') as { id: string };
    expect(proposed.proposal).toBe(commit.id);
  });

  it('propose_chart names the commit its claim landed on — and still never echoes the spec', async () => {
    const p = portOf();
    const res = await p.call('viz.propose_chart', {
      id: 'c1',
      spec: {
        mark: 'circle',
        encoding: { x: { field: 'price', type: 'quantitative' }, y: { field: 'rating', type: 'quantitative' } },
        params: [{ name: 'sel', select: { type: 'interval', encodings: ['x'] } }],
      },
      rationale: 'price against rating',
    });
    expect(get(res, 'ok')).toBe(true);
    expect(get(res, 'commitId')).toMatch(/^s\d+$/);
    expect(JSON.stringify(res)).not.toContain('circle'); // the id, never the record whose VALUE is the spec
    // the same moment whats_here reports for that chart
    const here = await p.call('viz.whats_here');
    const charts = get(here, 'charts') as { chartId: string; commitId: string }[];
    expect(charts[0]!.commitId).toBe(get(res, 'commitId'));
  });
});

// ── Law 2 — the answer owes the position of anything that is not a claim about now ─

describe('a proposed chart says which moment it was proposed at', () => {
  it('a chart proposed on a path you have since left is still listed, still ledgered — and says it is not about here', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession({ as: 'agent' });
    const root = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const proposed = await s.proposeChart({ id: 'onA', spec: { mark: 'circle', encoding: { x: { field: 'price', type: 'quantitative' } }, params: [{ name: 'sel', select: { type: 'interval', encodings: ['x'] } }] }, claim: 'the A claim' });
    expect(proposed.ok).toBe(true);

    const here = await s.overview();
    expect(here.charts[0]).toMatchObject({ chartId: 'onA', onPath: true });
    expect(here.charts[0]!.commitId).toBe(proposed.ok ? proposed.commit.id : '');

    // walk back and take another path: the claim was made somewhere this position never saw
    s.seek(root.ok && root.commit ? root.commit.id : '');
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('the other end') });
    const elsewhere = await s.overview();
    expect(elsewhere.charts).toHaveLength(1); // NOT hidden — the ledger is still charging for it
    expect(elsewhere.charts[0]).toMatchObject({ chartId: 'onA', ledgered: true, onPath: false });
    expect(elsewhere.fdr.tests).toBe(1); // and the alpha it spent is not refunded by walking away
  });
});

// ── Law 3 — the answer owes a word about what it could not honour ─────────────

describe('a basis the answer could not honour is named, not silently dropped', () => {
  const words = (text: string, basis: Record<string, unknown>) => ({ text, author: { kind: 'human' as const }, basis });

  it('an off-branch basis is dropped from the commit set AND disclosed as off-branch', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const root = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const rootId = root.ok && root.commit ? root.commit.id : '';
    const a = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [30, 120], cause: userCause('cheap') });
    const aId = a.ok && a.commit ? a.commit.id : '';
    s.seek(rootId);
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [120, 220], cause: userCause('premium') });

    // `basis.atCommit` is inert data the describe door does not judge — an off-branch id LANDS
    const wrote = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', cause: userCause('write'), record: words('The premium end.', { columns: ['price'], atCommit: aId }) });
    expect(wrote.ok).toBe(true);

    const why = s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' });
    expect(why.ok).toBe(true);
    if (!why.ok) return;
    // the law that stands: it is NOT reported as provenance
    expect(why.commits.some((c) => c.id === aId)).toBe(false);
    // the law that is new: the reader is told it was named and could not be honoured
    expect(why.dropped).toEqual([{ id: aId, kind: 'basis', reason: 'off-branch' }]);
  });

  it('one unhonoured commit is ONE row, however many times the words named it', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const root = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const rootId = root.ok && root.commit ? root.commit.id : '';
    const a = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [30, 120], cause: userCause('cheap') });
    const aId = a.ok && a.commit ? a.commit.id : '';
    s.seek(rootId);
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [120, 220], cause: userCause('premium') });
    // the SAME off-branch commit named twice: once as the basis, once by a span.
    // (a `refs[]` citation is refused at the door, so this record is committed
    // straight to the log — the shape a restored-from-the-wire history has.)
    s.log.commit({
      id: 'restored-1', parent: s.cursor(), viewId: 'prose:scatter', actorMeta: { actor: 'user' },
      kind: 'point', field: 'caption',
      value: { text: 'The premium end.', author: { kind: 'human' }, basis: { columns: ['price'], atCommit: aId }, refs: [{ span: [0, 3], commit: aId }] },
      cause: { requestedBy: 'user', computedBy: 'user' },
    });
    s.seek('restored-1');
    const why = s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' });
    expect(why.ok && why.dropped).toEqual([{ id: aId, kind: 'basis', reason: 'off-branch' }]); // one row, the first role it was named in
  });

  it('a basis naming a commit no branch of this log holds is disclosed as unverified', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', cause: userCause('write'), record: words('Words.', { columns: ['price'], atCommit: 'ghost' }) });
    const why = s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' });
    expect(why.ok && why.dropped).toEqual([{ id: 'ghost', kind: 'basis', reason: 'unverified' }]);
  });

  it('an answer with nothing to disclose carries no key at all — the disclosure costs nothing when there is none', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const note = await s.dispatch({ verb: 'annotate', target: '', note: 'a marker', cause: userCause('mark') });
    const noteId = note.ok && note.commit ? note.commit.id : '';
    await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', cause: userCause('write'), record: words('Written here.', { columns: ['price'], atCommit: noteId }) });
    const why = s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' });
    expect(why.ok).toBe(true);
    if (!why.ok) return;
    expect('dropped' in why).toBe(false);
    expect(why.commits).toContainEqual({ tier: 'viz', id: noteId, kind: 'basis' }); // an honoured basis is provenance, as before
  });
});

// ── Law 4 — the answer owes the reader no repetition it can avoid ─────────────

describe('the answer states each fact once', () => {
  it('the offer POSITION rides once; the offer list itself does not move when the cursor does', async () => {
    const p = portOf();
    const before = await p.call('viz.whats_here');
    await p.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' });
    const after = await p.call('viz.whats_here');
    expect(JSON.stringify(get(after, 'offers'))).toBe(JSON.stringify(get(before, 'offers'))); // byte-identical
    expect(get(after, 'offerId')).not.toBe(get(before, 'offerId')); // one field moved, and it is the one that had to
  });

  it('a view carries no copy of the table column list; `columns` states it once and `accepts` answers per channel', async () => {
    const p = portOf();
    const here = await p.call('viz.whats_here');
    const views = get(here, 'views') as { viewId: string; accepts?: Record<string, readonly string[]> }[];
    for (const v of views) expect('columns' in v).toBe(false);
    const byTable = get(here, 'columns') as Record<string, { field: string }[]>;
    expect(byTable[get(here, 'defaultTable') as string]!.map((c) => c.field).sort()).toEqual(['category', 'id', 'price', 'rating']);
    expect(views.find((v) => v.viewId === 'scatter')!.accepts!['x']).toContain('rating');
  });

  it('the tool list is byte-identical before and after acts — the disclosure rides the RESULT channel, never the tool channel', async () => {
    const p = portOf();
    const menu = JSON.stringify(p.tools());
    await p.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' });
    await p.call('viz.dispatch', { verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'rating' });
    await p.call('viz.whats_here');
    expect(JSON.stringify(p.tools())).toBe(menu);
  });
});
