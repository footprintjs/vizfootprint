/**
 * `why()` over what a view HOLDS and what a view SHOWS — the two view-shaped
 * targets (R1: the same join, a different anchor law each).
 *
 * The laws under test live at their symbols and in `../why/README.md`:
 *   - a SELECTION's anchor is the commit that landed it; a cleared view holds
 *     nothing and says so (`nothing-live`); the other views' clauses live at
 *     that moment are the input; `origin` / `replaced` / `sibling` name the act
 *     that put it there;
 *   - a CHART's anchor is the newest commit on this branch that shaped what it
 *     shows, everything that shaped it rides as a related commit, and an
 *     untouched chart looks the way its definition says (`declared-in-def`);
 *   - and both are built at the TARGET's own position, so an id from a branch
 *     this cursor has left is dropped, never credited.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, layerAddress } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import { NETWORK_RELATIONS, edgesLayer, makeNetworkDef, nodesLayer } from '../def/network.fixture.js';
import type { Cause } from '../cause/index.js';
import type { WhyResult } from '../why/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const fresh = () => buildDashboard(makeDashboardDef()).createSession();
const id = (r: { ok: boolean; commit?: { id: string } }): string => (r.ok && r.commit ? r.commit.id : '');
/** The answer's commit set as flat rows — the shape a triage surface branches on. */
const rows = (r: WhyResult): unknown[] => (r.ok ? r.commits : []).map((c) => [c.id, c.kind, ...(c.response !== undefined ? [c.response] : [])]);

/** A def whose scatter colours by a column an ACT makes — the encoding is declared, the column is computed. */
const colourByCluster = (): DashboardDef => ({
  ...makeDashboardDef(),
  encodings: [
    { viewId: 'scatter', chartKind: 'point', channels: ['x', 'y', 'color'], initial: { x: 'price', y: 'rating', color: 'cluster_id' } },
    { viewId: 'bar', chartKind: 'bar', channels: ['x', 'color'], initial: { x: 'category' } },
  ],
});

describe("why({ kind: 'selection' }) — what a view holds", () => {
  it('the commit that landed it is the anchor; a view that is not here is no target; a view holding nothing says nothing-live', async () => {
    const s = fresh();
    expect(s.why({ kind: 'selection', viewId: 'ghost' })).toEqual({ ok: false, missing: 'no-such-target', target: { kind: 'selection', viewId: 'ghost' } });
    // a view that IS here and holds nothing is a different sentence: the brush is gone, not the chart
    expect(s.why({ kind: 'selection', viewId: 'bar' })).toEqual({ ok: false, missing: 'nothing-live', target: { kind: 'selection', viewId: 'bar' } });
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const res = s.why({ kind: 'selection', viewId: 'bar' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.targetKind).toBe('selection');
    expect(res.key).toBe('bar'); // there is no column under a selection — the view names the answer
    expect(res.viz.commitId).toBe(id(pick));
    expect(rows(res)).toEqual([[id(pick), 'declaring']]); // one act, alone: nothing else formed it
    expect(res.misses.map((m) => m.missing)).toEqual(['no-agent-tier', 'no-kernel-snapshot']);
    // CLEARED is not a selection: a cleared brush has nothing to be the reason for
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: null, cause: userCause('clear') });
    expect(s.why({ kind: 'selection', viewId: 'bar' })).toMatchObject({ ok: false, missing: 'nothing-live' });
  });

  it('a walk taken under another view\'s filter names that filter as the input — read at the WALK\'s position', async () => {
    const def = makeNetworkDef([nodesLayer, edgesLayer], {
      relations: NETWORK_RELATIONS,
      capabilities: [{ viewId: 'net', canProbe: true, encodings: ['point', 'interval', 'match', 'neighbourhood'] }],
    });
    const s = buildDashboard(def).createSession();
    const nodes = layerAddress('net', 'nodes');
    const edges = layerAddress('net', 'edges');
    const filter = await s.dispatch({ verb: 'select', viewId: nodes, field: 'group', value: 'viral', cause: userCause('viral only') });
    const walk = await s.dispatch({ verb: 'select', viewId: edges, field: 'source', seed: 'cold', walk: { derivation: 'ego', hops: 1 }, cause: userCause('walk from cold') });
    const res = s.why({ kind: 'selection', viewId: edges });
    expect(rows(res)).toEqual([[id(walk), 'declaring'], [id(filter), 'input-selection']]);
  });

  it('an undo names the commit it took back as origin', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('one') });
    const second = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('two') });
    const back = await s.undo(id(second));
    expect(back.ok).toBe(true);
    const res = s.why({ kind: 'selection', viewId: 'bar' });
    expect(rows(res)).toEqual([[id(back), 'declaring'], [id(second), 'origin']]);
  });

  it('an applySaved of two conditions: each names the other as sibling, and the clear that made room is replaced', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('a') });
    await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'price', value: [50, 90], cause: userCause('b') });
    expect(s.saveSelection('two', { live: 'all' }).ok).toBe(true);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: null, cause: userCause('clear bar') });
    await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'price', value: null, cause: userCause('clear scatter') });
    // a live clause on a view the picture does not name — `replace` clears it, and that clear is what made room
    const other = await s.dispatch({ verb: 'select', viewId: 'cluster', field: 'category', value: 'Work', cause: userCause('an unnamed one') });
    const applied = await s.applySaved('two', userCause('bring it back'));
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const [bar, scatter] = applied.applied.map((r) => r.id) as [string, string];
    // the CLEAR is its own commit — it is what made room, and it is what `replaced` names
    const roomMade = applied.cleared.map((r) => r.id);
    expect(roomMade).toHaveLength(1);
    expect(applied.cleared[0]!.viewId).toBe('cluster');
    expect(applied.cleared[0]!.cause.replacedBy).toBe('two');
    expect(id(other)).not.toBe(roomMade[0]);
    const onBar = s.why({ kind: 'selection', viewId: 'bar' });
    expect(rows(onBar)).toEqual([[bar, 'declaring'], [roomMade[0], 'replaced'], [scatter, 'sibling']]);
    // and from the other end of the same gesture, the first condition is the sibling
    const onScatter = s.why({ kind: 'selection', viewId: 'scatter' });
    expect(rows(onScatter)).toEqual([[scatter, 'declaring'], [bar, 'input-selection'], [roomMade[0], 'replaced']]);
    expect(onScatter.ok && onScatter.correlationId).toBe(applied.correlationId); // one batch, one join key — the agent tier threads a saved picture like any act
  });

  it('a correlationId reused on a branch this cursor left is DROPPED off-branch; the one on this lineage is admitted (R5)', async () => {
    const s = fresh();
    const first = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('one'), correlationId: 'turn-1' });
    const left = await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'price', value: [50, 90], cause: userCause('two'), correlationId: 'turn-1' });
    expect(s.seek(id(first))).toEqual({ ok: true, cursor: id(first) });
    const here = await s.dispatch({ verb: 'select', viewId: 'cluster', field: 'category', value: 'Work', cause: userCause('three'), correlationId: 'turn-1' });
    const res = s.why({ kind: 'selection', viewId: 'bar' });
    expect(rows(res)).toEqual([[id(first), 'declaring'], [id(here), 'sibling']]);
    expect(res.ok && res.dropped).toEqual([{ id: id(left), kind: 'sibling', reason: 'off-branch' }]);
  });

  it('a caller-harvested agent event log threads the agent tier for BOTH view-shaped targets', async () => {
    const s = fresh();
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick'), correlationId: 'call-4' });
    const frame = { toolCallId: 'tc-1', runId: 'run-1', runtimeStageId: 'tool-calls#2', correlationId: 'call-4' };
    // the batch's own join key is what threads the tool call — the same key a chart's anchor carries
    const held = s.why({ kind: 'selection', viewId: 'bar' }, { agentEventLog: [frame] });
    expect(held.ok && held.threaded).toBe(true);
    expect(rows(held)).toEqual([[id(pick), 'declaring'], ['tc-1', 'agent-frame']]);
    const shown = s.why({ kind: 'chart', viewId: 'scatter' }, { agentEventLog: [frame] });
    expect(shown.ok && shown.agent).toEqual({ toolCallId: 'tc-1', runtimeStageId: 'tool-calls#2', runId: 'run-1' });
    expect(rows(shown)).toEqual([[id(pick), 'declaring', 'filter'], ['tc-1', 'agent-frame']]);
  });

  it('the answer moves with the cursor: seek back past the brush and the view holds nothing again', async () => {
    const s = fresh();
    const note = await s.dispatch({ verb: 'annotate', target: 'bar', note: 'a moment to come back to', cause: userCause('mark') });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    expect(s.why({ kind: 'selection', viewId: 'bar' }).ok).toBe(true);
    expect(s.seek(id(note)).ok).toBe(true);
    expect(s.why({ kind: 'selection', viewId: 'bar' })).toMatchObject({ ok: false, missing: 'nothing-live' });
  });
});

describe("why({ kind: 'chart' }) — what a view shows", () => {
  it('an untouched chart looks the way its definition says (declared-in-def); a view that is not here is no target', () => {
    const s = fresh();
    expect(s.why({ kind: 'chart', viewId: 'scatter' })).toEqual({ ok: false, missing: 'declared-in-def', target: { kind: 'chart', viewId: 'scatter' } });
    expect(s.why({ kind: 'chart', viewId: 'ghost' })).toEqual({ ok: false, missing: 'no-such-target', target: { kind: 'chart', viewId: 'ghost' } });
  });

  it('a filter that REACHES it anchors the picture and keeps its response; an older reaching clause rides as reaching-clause; the view\'s own brush is an input', async () => {
    const s = fresh();
    const older = await s.dispatch({ verb: 'select', viewId: 'cluster', field: 'category', value: 'Work', cause: userCause('the agent picks') });
    const own = await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'price', value: [50, 90], cause: userCause('brush the scatter itself') });
    const newest = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick'), correlationId: 'turn-3' });
    const res = s.why({ kind: 'chart', viewId: 'scatter' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.key).toBe('scatter');
    expect(res.viz.commitId).toBe(id(newest));
    // the anchor is reported ONCE — as `declaring` — but it keeps the qualifier that says what it does here
    expect(rows(res)).toEqual([
      [id(newest), 'declaring', 'filter'],
      [id(own), 'input-selection'],
      [id(older), 'reaching-clause', 'filter'],
    ]);
    expect(res.correlationId).toBe('turn-3'); // the anchor's own join key threads the agent tier
  });

  it('a highlight edge qualifies the clause that reaches, and the edit of that edge rides as link-edit', async () => {
    const s = fresh();
    const edit = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight', cause: userCause('the bar lights the scatter') });
    // the edit alone is what shaped the picture last
    expect(rows(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual([[id(edit), 'declaring']]);
    // and it shapes THIS view, not the one it points out of
    expect(s.why({ kind: 'chart', viewId: 'bar' })).toMatchObject({ ok: false, missing: 'declared-in-def' });
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    expect(rows(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual([
      [id(pick), 'declaring', 'highlight'],
      [id(edit), 'link-edit'],
    ]);
    // Edit the edge again and THAT is the newest shaping act: it anchors — a
    // link edit carries no qualifier of its own — and the clause it re-qualifies
    // rides as the one that reaches, speaking the edge's new word.
    const requalified = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'mirror', cause: userCause('outline it instead') });
    expect(rows(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual([
      [id(requalified), 'declaring'],
      [id(pick), 'reaching-clause', 'mirror'],
    ]);
    // Un-declaring the edit takes it OUT of the picture: the edge is the default
    // rule again, so nothing about it was edited and the pick is what shaped the
    // chart last — filtering, as the rule says. The same answer after a seek,
    // because the commit-id fold is cleared with its value fold (R4).
    const back = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: null, cause: userCause('back to the rule') });
    expect(back.ok).toBe(true);
    expect(rows(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual([[id(pick), 'declaring', 'filter']]);
    expect(s.seek(id(back)).ok).toBe(true);
    expect(rows(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual([[id(pick), 'declaring', 'filter']]);
  });

  it('a binding change rides as binding, and a sheet sort as arrangement — the cockpit\'s own scope is nobody\'s chart', async () => {
    const s = fresh();
    const bind = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'category', cause: userCause('colour it') });
    const sort = await s.dispatch({ verb: 'navigate', viewId: 'layout:sheet:scatter', field: 'order', value: 'price desc', cause: userCause('sort the sheet') });
    const cockpit = await s.dispatch({ verb: 'navigate', viewId: 'layout:dashboard', field: 'preset', value: 'wide', cause: userCause('rearrange the cockpit') });
    expect(cockpit.ok).toBe(true);
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    expect(rows(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual([
      [id(pick), 'declaring', 'filter'],
      [id(bind), 'binding'],
      [id(sort), 'arrangement'],
    ]);
    // the cockpit preset shaped the COCKPIT, not the bar chart: the bar's own
    // picture is its own brush and nothing else (no reach, no binding of its own)
    expect(rows(s.why({ kind: 'chart', viewId: 'bar' }))).toEqual([[id(pick), 'declaring']]);
    // and a scope that merely LOOKS like this view's is not this view's: the id
    // is matched after the colon, never as a prefix — or this newer sort would
    // have taken the anchor from the pick
    expect((await s.dispatch({ verb: 'navigate', viewId: 'layout:sheet:scatterx', field: 'order', value: 'rating desc', cause: userCause('sort a lookalike') })).ok).toBe(true);
    expect(rows(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual([
      [id(pick), 'declaring', 'filter'],
      [id(bind), 'binding'],
      [id(sort), 'arrangement'],
    ]);
    // the same answer after a seek, because the two commit-id folds are rebuilt with their value folds (R4)
    expect(s.seek(id(pick)).ok).toBe(true);
    expect(rows(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual([
      [id(pick), 'declaring', 'filter'],
      [id(bind), 'binding'],
      [id(sort), 'arrangement'],
    ]);
  });

  it('a cleared source that still reaches (onClear: leave) is named by its CLEARING commit', async () => {
    const s = fresh();
    const edit = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'filter', onClear: 'leave', cause: userCause('keep the last pick') });
    expect(edit.ok).toBe(true);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const cleared = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: null, cause: userCause('clear') });
    // the clause still reaches, so the act that shaped the picture last is the CLEAR
    expect(rows(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual([
      [id(cleared), 'declaring', 'filter'],
      [id(edit), 'link-edit'],
    ]);
  });

  it('a chart drawing a DERIVED column names the act that computed it — and drops it when that act is on a branch this cursor left', async () => {
    const s = buildDashboard(colourByCluster()).createSession();
    const root = await s.dispatch({ verb: 'select', viewId: 'cluster', field: 'category', value: 'Work', cause: userCause('a first act') });
    const made = await s.declareAnalysis('clustering');
    expect(made.materialized).toEqual(['cluster_id']);
    const bind = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'cluster_id', cause: userCause('colour by cluster') });
    const onBranch = s.why({ kind: 'chart', viewId: 'scatter' });
    expect(rows(onBranch)).toEqual([
      [id(bind), 'declaring'],
      [id(root), 'reaching-clause', 'filter'],
      [made.commit!.id, 'derived-column'],
    ]);
    // step back and take another path: the chart still DRAWS cluster_id (the def
    // binds it), but the act that computed it is not on this lineage — it is
    // disclosed as dropped, never credited as this picture's provenance
    expect(s.seek(id(root)).ok).toBe(true);
    const elsewhere = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick on the other branch') });
    const offBranch = s.why({ kind: 'chart', viewId: 'scatter' });
    expect(rows(offBranch)).toEqual([
      [id(elsewhere), 'declaring', 'filter'],
      [id(root), 'reaching-clause', 'filter'],
    ]);
    expect(offBranch.ok && offBranch.dropped).toEqual([{ id: made.commit!.id, kind: 'derived-column', reason: 'off-branch' }]);
  });

  it('an act on this lineage that is NEWER than the anchor is still named — never called another branch\'s', async () => {
    const s = buildDashboard(colourByCluster()).createSession();
    const reach = await s.dispatch({ verb: 'select', viewId: 'cluster', field: 'category', value: 'Work', cause: userCause('the one shaping act') });
    // the analysis lands AFTER the anchor and is deliberately not a candidate for
    // it (it made a column, it did not shape this picture) — and it is on this
    // very lineage, so saying "another branch" would have been false
    const made = await s.declareAnalysis('clustering');
    const res = s.why({ kind: 'chart', viewId: 'scatter' });
    expect(res.ok && res.viz.commitId).toBe(id(reach));
    expect(rows(res)).toEqual([
      [id(reach), 'declaring', 'filter'],
      [made.commit!.id, 'derived-column'],
    ]);
    expect(res.ok && res.dropped).toBeUndefined();
  });
});
