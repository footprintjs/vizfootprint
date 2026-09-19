// @vitest-environment node
/**
 * A DOOR HANDS BACK WHAT THE SESSION SAID.
 *
 * `setLayoutNote` and `seek` were widened one at a time, each because one
 * consumer had to re-read the fold to learn its act was refused. Every other
 * door over the same `dispatch` had the same answer in its hand and dropped it.
 * This file is the ONE table of them, and it asserts three things per door:
 *
 * 1. the happy path answers `{ ok: true }`;
 * 2. a refusal reaches the CALLER, in the session's own words — asserted AT THE
 *    DOOR, never by re-reading the fold, because re-reading the fold is exactly
 *    the workaround this removes;
 * 3. what the door LANDS is byte-identical to what it landed before — the
 *    dispatch body is pinned per door, beside its answer.
 *
 * And the negative half: the doors that answer NOTHING still answer nothing,
 * each with its reason beside it — a door with no session answer to give would
 * have to invent one, and an invented outcome is a claim nobody made.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSessionView, pollingSource, type RawPollState, type SessionView, type DescribeOutcome } from './sessionView.js';

const RAW: RawPollState = {
  records: [
    { id: 'root', parent: null, viewId: 'scatter', kind: 'point', field: 'category', value: 'A', cause: { requestedBy: 'user' } },
    { id: 'mid', parent: 'root', viewId: 'scatter', kind: 'point', field: 'category', value: 'B', cause: { requestedBy: 'user' } },
    { id: 'leaf', parent: 'mid', viewId: 'scatter', kind: 'point', field: 'category', value: 'C', cause: { requestedBy: 'user' } },
  ],
  defaultTable: 'data',
  views: [{ viewId: 'scatter', actor: 'user', encodings: { x: 'price' } }],
  activeSelections: [{ viewId: 'scatter', field: 'category', kind: 'point', value: 'A' }],
  columns: { data: [] },
  cursor: 'mid',
  head: 'leaf',
};

/** A fake `/api/*` that answers every POST with the SAME body, so one table can be run twice. */
function server(answer: Record<string, unknown>) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    if (!init || init.method !== 'POST') return { ok: true, json: async () => RAW } as unknown as Response;
    posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return { ok: true, json: async () => answer } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, posts };
}

/**
 * EVERY DOOR THAT ANSWERS, with the one act it lands. The table is the point:
 * a door added here without an outcome, or with an outcome of its own shape,
 * is the drift this packet exists to prevent.
 */
const DOORS: readonly { name: string; run: (v: SessionView) => Promise<DescribeOutcome>; url: string; body: Record<string, unknown> }[] = [
  { name: 'emit', url: '/api/dispatch', run: (v) => v.emit('scatter', { rawValue: 'A', encoding: { kind: 'point', field: 'category' } }), body: { verb: 'select', viewId: 'scatter', field: 'category', value: 'A', intent: 'point category' } },
  { name: 'clear', url: '/api/dispatch', run: (v) => v.clear('scatter'), body: { verb: 'select', viewId: 'scatter', field: 'category', value: null, intent: 'clear scatter' } },
  { name: 'clearAll', url: '/api/dispatch', run: (v) => v.clearAll(), body: { verb: 'select', viewId: 'scatter', field: 'category', value: null, intent: 'clear all' } },
  { name: 'link', url: '/api/dispatch', run: (v) => v.link({ source: 'map', kind: 'point', target: 'bar', response: 'highlight' }), body: { verb: 'link', source: 'map', kind: 'point', target: 'bar', response: 'highlight', intent: 'map point → bar: highlight' } },
  { name: 'setPolarity', url: '/api/dispatch', run: (v) => v.setPolarity('scatter', true), body: { verb: 'select', viewId: 'scatter', field: 'category', values: ['A'], exclude: true, intent: 'exclude category' } },
  { name: 'reencode', url: '/api/dispatch', run: (v) => v.reencode('scatter', 'x', 'price'), body: { verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'price', intent: 'reencode scatter.x → price' } },
  { name: 'reencodeSet', url: '/api/dispatch', run: (v) => v.reencodeSet('scatter', { x: 'price', y: 'cases' }), body: { verb: 'reencode', viewId: 'scatter', bindings: { x: 'price', y: 'cases' }, intent: 'reencode scatter x → price, y → cases' } },
  { name: 'propose', url: '/api/dispatch', run: (v) => v.propose('scatter', 'title', { text: 'a better title' }), body: { verb: 'describe', viewId: 'scatter', slot: 'title', record: { text: 'a better title' }, proposal: true, intent: 'propose scatter.title' } },
  { name: 'acceptProposal', url: '/api/dispatch', run: (v) => v.acceptProposal('scatter', 'title', 'c1'), body: { verb: 'describe', viewId: 'scatter', slot: 'title', record: null, accept: 'c1', intent: 'accept the proposal for scatter.title' } },
  { name: 'declineProposal', url: '/api/dispatch', run: (v) => v.declineProposal('scatter', 'title', 'c1', 'not the words'), body: { verb: 'describe', viewId: 'scatter', slot: 'title', record: null, decline: { proposal: 'c1', reason: 'not the words' }, intent: 'decline the proposal for scatter.title' } },
  { name: 'navigate', url: '/api/dispatch', run: (v) => v.navigate('scatter'), body: { verb: 'navigate', viewId: 'scatter', intent: 'navigate scatter' } },
  { name: 'setLayout', url: '/api/dispatch', run: (v) => v.setLayout({ preset: 'grid' }), body: { verb: 'navigate', viewId: 'layout:dashboard', field: 'preset', value: 'grid', intent: 'layout = grid' } },
  { name: 'setLayoutNote', url: '/api/dispatch', run: (v) => v.setLayoutNote({ scope: 'desk', prop: 'panes', value: 'a,b', words: 'moved a beside b' }), body: { verb: 'navigate', viewId: 'layout:desk', field: 'panes', value: 'a,b', intent: 'moved a beside b' } },
  { name: 'setSheetArrangement', url: '/api/dispatch', run: (v) => v.setSheetArrangement('cells', 'frozen', 2), body: { verb: 'navigate', viewId: 'layout:sheet:cells', field: 'frozen', value: '2', intent: 'cells: froze 2 columns' } },
  { name: 'setSheetSort', url: '/api/dispatch', run: (v) => v.setSheetSort('cells', [{ field: 'cases', dir: 'desc' }]), body: { verb: 'navigate', viewId: 'layout:sheet:cells', field: 'sort', value: '[{"field":"cases","dir":"desc"}]', intent: 'cells: sorted by cases ↓' } },
  { name: 'analyze', url: '/api/dispatch', run: (v) => v.analyze('correlation'), body: { verb: 'analyze', analysisId: 'correlation', intent: 'analyze correlation' } },
  // the three cursor steps ride `seek`, which has answered since it was widened —
  // and then dropped that answer on the floor one call further out
  { name: 'stepBack', url: '/api/seek', run: (v) => v.stepBack(), body: { commitId: 'root' } },
  { name: 'stepForward', url: '/api/seek', run: (v) => v.stepForward(), body: { commitId: 'leaf' } },
  { name: 'returnToNow', url: '/api/seek', run: (v) => v.returnToNow(), body: { commitId: 'leaf' } },
];

describe('every door that lands an act hands back what the session said', () => {
  it('the set is the MEASURED one — EIGHTEEN widened here, beside the precedent that was widened first', () => {
    // 19 rows = the 18 doors this packet widened + `setLayoutNote`, which was
    // already answering and is here so the precedent is tested by the same
    // table as its eighteen followers rather than beside them.
    expect(DOORS).toHaveLength(19);
    expect(DOORS.filter((d) => d.name !== 'setLayoutNote')).toHaveLength(18);
    expect(new Set(DOORS.map((d) => d.name)).size).toBe(19);
  });

  it.each(DOORS.map((d) => [d.name, d] as const))('%s — it landed: `{ ok: true }`, and the act is byte-identical', async (_name, door) => {
    const { impl, posts } = server({ ok: true });
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    const out = await door.run(view);
    expect(out).toEqual({ ok: true });
    // byte identity: the ONE act, to the endpoint it always went to, with the body it always carried
    expect(posts.filter((p) => p.url !== '/api/state')).toEqual([{ url: door.url, body: door.body }]);
    view.dispose();
  });

  it.each(DOORS.map((d) => [d.name, d] as const))('%s — a REFUSAL reaches the caller in the session’s own words, read at the door', async (_name, door) => {
    // the library refuses in two shapes — a dispatch answers `rejection`, a
    // navigation a typed `gap` — and a caller must not have to know which
    const { impl } = server({ ok: false, rejection: { detail: 'the session said no' }, gap: { detail: 'the session said no' } });
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    const out = await door.run(view);
    // ONE SHAPE: a caller reads a refusal the same way at all eighteen
    expect(out).toEqual({ ok: false, sentence: 'the session said no' });
    expect(Object.keys(out).sort()).toEqual(['ok', 'sentence']);
    view.dispose();
  });
});

describe('a door with nothing to ask answers that nothing was refused — and asks nothing', () => {
  const EMPTY: RawPollState = { records: [], defaultTable: 'data', views: [], activeSelections: [], columns: { data: [] }, cursor: null, head: null };
  function emptyServer() {
    const posts: string[] = [];
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method !== 'POST') return { ok: true, json: async () => EMPTY } as unknown as Response;
      posts.push(url);
      return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
    });
    return { impl: impl as unknown as typeof fetch, posts };
  }

  it('clear / clearAll / setPolarity on a view holding no clause, and the three steps at the edges of the log', async () => {
    const { impl, posts } = emptyServer();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    for (const out of [await view.clear('scatter'), await view.clearAll(), await view.setPolarity('scatter', true), await view.stepBack(), await view.stepForward(), await view.returnToNow()]) {
      expect(out).toEqual({ ok: true });
    }
    // and the documented no-op is still a no-op: NOTHING was dispatched, and nothing was sought
    expect(posts).toEqual([]);
    view.dispose();
  });

  it('a batch answers the FIRST refusal and still lands every part of itself', async () => {
    const { impl, posts } = server({ ok: false, rejection: { detail: 'no' }, gap: { detail: 'no' } });
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    // two props, both refused, both still attempted — the widening changed a
    // return type and not what a batch does
    expect(await view.setLayout({ preset: 'grid', focusId: 'scatter' })).toEqual({ ok: false, sentence: 'no' });
    expect(posts.map((p) => p.body['field'])).toEqual(['preset', 'focus']);
    view.dispose();
  });
});

describe('the doors that answer NOTHING still answer nothing', () => {
  // Each is here because the SESSION gives it no answer to hand on, never
  // because the answer was inconvenient:
  //   • refresh          — a read, not an act: there is no gesture to refuse.
  //   • bookmark         — its own endpoint (`endpoints.bookmark`), whose
  //                        contract is fire-and-reconcile: no body comes back.
  //   • the path + trail actions — `endpoints.paths` / `bringOver` / `undo`,
  //                        all POSTed through `postJson`, which reads nothing
  //                        off the wire by design; a refusal is served as a
  //                        typed gap in the next snapshot instead.
  // Widening any of them is a WIRE change, in its own packet. Inventing an
  // outcome here would be a claim the session never made.
  it('refresh, bookmark and the eight path / trail actions', async () => {
    const { impl } = server({ ok: true });
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    const answers = [
      await view.refresh(),
      await view.bookmark('here'),
      await view.switchPath('main'),
      await view.renamePath('main', 'trunk'),
      await view.newPathAt('root', 'side'),
      await view.bringOver('root'),
      await view.undo('root'),
      await view.archivePath('side'),
      await view.restorePath('side'),
      await view.discardFromHere('root'),
    ];
    expect(answers).toEqual(Array.from({ length: 10 }, () => undefined));
    view.dispose();
  });
});
