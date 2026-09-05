// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createSessionView, sessionSource, pollingSource, mapPollState, type SessionLike, type RawPollState } from './sessionView.js';
import type { SavedSelection } from 'vizfootprint/def';

const RAW: RawPollState = {
  defaultTable: 'data',
  records: [
    { id: '1', parent: null, viewId: 'scatter', kind: 'interval', field: 'price', value: [10, 90], cause: { requestedBy: 'user', intent: 'brush price' } },
    { id: '2', parent: '1', viewId: 'bar', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'agent', intent: 'select formal' } },
    { id: '3', parent: '1', viewId: 'scatter', kind: 'interval', field: 'price', value: [40, 60], cause: { requestedBy: 'user', intent: 'narrower' } },
  ],
  views: [
    {
      viewId: 'scatter',
      actor: 'user',
      label: 'Price',
      selectionKinds: ['interval'],
      canProbe: true,
      mounted: true,
      encodings: { x: 'price', y: 'rating' },
      columns: [{ field: 'price', type: 'number', role: 'measure' }, { field: 'rating', type: 'number' }],
    },
  ],
  activeSelections: [{ viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' }],
  analyses: [{ id: 'correlation', kind: 'test', produces: 'evidence', ready: true }],
  fdr: { procedure: 'LORD++', alpha: 0.05, tests: 2, discoveries: 1, wealth: 0.031, ledger: [{ step: 1, hypothesisId: 'h1', pValue: 0.004, alphaThreshold: 0.02, reject: true, wealthAfter: 0.03 }] },
  columns: { data: [{ field: 'price', type: 'number', role: 'measure' }, { field: 'category', type: 'string' }] },
  gaps: [{ code: 'needs-column', op: 'analyze', detail: 'cluster_id not present', target: 'cluster_id' }],
  branches: [{ tip: '2', length: 2, actor: 'agent', active: false }, { tip: '3', length: 2, actor: 'user', active: true }],
  bookmarks: [{ label: 'before-cluster', commitId: '1', ts: 100 }],
  cursor: '1',
  head: '3',
  cursorTests: 0,
  viewingPast: true,
  mode: 'scripted',
};

describe('mapPollState — normalization + derivations', () => {
  const s = mapPollState(RAW);
  it('derives per-commit flags (onBranch / isCursor / label) from cursor+head', () => {
    const c1 = s.commits.find((c) => c.id === '1')!;
    const c2 = s.commits.find((c) => c.id === '2')!;
    const c3 = s.commits.find((c) => c.id === '3')!;
    expect(c1.isCursor).toBe(true);
    expect(c3.isHead).toBe(true);
    expect(c1.onBranch).toBe(true); // on root→head(3) path
    expect(c3.onBranch).toBe(true);
    expect(c2.onBranch).toBe(false); // the abandoned sibling
    expect(c1.actor).toBe('user');
    expect(c2.actor).toBe('agent');
    expect(s.activePathIds).toEqual(['1', '3']);
  });
  it('projects the two-truths ledger with the verbatim honesty line', () => {
    expect(s.ledger.tests).toBe(2); // global
    expect(s.ledger.cursorTests).toBe(0); // cursor-local
    expect(s.ledger.discoveries).toBe(1);
    expect(s.ledger.honesty).toBe('alpha spent on abandoned branches is never refunded');
  });
  it('maps UI-0 view shapes: selectionKinds, per-view encoding, derived top-level encodings', () => {
    const scatter = s.views.find((v) => v.viewId === 'scatter')!;
    expect(scatter.selectionKinds).toEqual(['interval']);
    expect(scatter.encoding).toEqual({ x: 'price', y: 'rating' });
    // a view carries no copy of the table's column list — the picker reads `columns[table]` (below)
    expect('columns' in scatter).toBe(false);
    // no top-level encodings in the payload → derived from views[].encodings
    expect(s.encodings['scatter']).toEqual({ x: 'price', y: 'rating' });
  });
  it('carries columns, gaps, readiness, branches, bookmarks', () => {
    expect(s.columns['data']!.map((c) => c.field)).toEqual(['price', 'category']);
    expect(s.columns['data']!.map((c) => c.role)).toEqual(['measure', undefined]);
    expect(s.gaps[0]!.code).toBe('needs-column');
    expect(s.readiness[0]!.ready).toBe(true);
    expect(s.branches.filter((b) => b.active)).toHaveLength(1);
    expect(s.bookmarks[0]!.label).toBe('before-cluster');
    expect(s.viewingPast).toBe(true);
  });

  it('D30: a cell commit + cell selection carry kind/fields/value through the poll wire verbatim', () => {
    const withCell = mapPollState({
      ...RAW,
      records: [
        ...RAW.records,
        {
          id: '4',
          parent: '3',
          viewId: 'heatmap',
          kind: 'cell',
          field: 'price × category',
          fields: ['price', 'category'],
          value: [[100, 150], 'Formal'],
          cause: { requestedBy: 'user', intent: 'click the 100–150 × Formal cell' },
        },
      ],
      activeSelections: [
        { viewId: 'heatmap', field: 'price × category', kind: 'cell', value: [[100, 150], 'Formal'], fields: ['price', 'category'] },
      ],
    });
    const c4 = withCell.commits.find((c) => c.id === '4')!;
    expect(c4.kind).toBe('cell');
    expect(c4.fields).toEqual(['price', 'category']);
    expect(c4.value).toEqual([[100, 150], 'Formal']);
    expect(c4.label).toBe('price × category'); // the joint label is the chip label
    const sel = withCell.selections[0]!;
    expect(sel.kind).toBe('cell');
    expect(sel.fields).toEqual(['price', 'category']);
  });
});

describe('createSessionView — poll source with injected fetch', () => {
  function fakeFetch() {
    const calls: { url: string; body?: unknown }[] = [];
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (!init || init.method !== 'POST') return { ok: true, json: async () => RAW } as unknown as Response;
      return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }

  it('describe answers with what the door said: landed, the session\'s rejection sentence, a plain error, a bare status, or an unreachable door', async () => {
    const answers: unknown[] = [];
    const impl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method !== 'POST') return { ok: true, json: async () => RAW } as unknown as Response;
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next as Response;
    });
    const view = createSessionView(pollingSource({ fetchImpl: impl as unknown as typeof fetch }));
    await view.refresh();
    const record = { text: 'x', author: { kind: 'human' } };
    answers.push({ ok: true, status: 200, json: async () => ({ ok: true, verb: 'describe' }) });
    expect(await view.describe('note:n1', 'caption', record)).toEqual({ ok: true });
    answers.push({ ok: true, status: 200, json: async () => ({ ok: false, verb: 'describe', rejection: { code: 'guard-failed', detail: 'a note carries a title and a caption — "howToRead" is not a note slot' } }) });
    expect(await view.describe('note:n1', 'howToRead', record)).toEqual({ ok: false, sentence: 'a note carries a title and a caption — "howToRead" is not a note slot' });
    answers.push({ ok: false, status: 400, json: async () => ({ ok: false, error: 'describe needs viewId' }) });
    expect(await view.describe('', 'caption', record)).toEqual({ ok: false, sentence: 'describe needs viewId' });
    answers.push({ ok: false, status: 500, json: async () => ({ ok: false }) });
    expect(await view.describe('note:n1', 'caption', record)).toEqual({ ok: false, sentence: 'the session answered 500' });
    answers.push(new Error('offline'));
    expect(await view.describe('note:n1', 'caption', null)).toEqual({ ok: false, sentence: 'could not reach the session' });
    view.dispose();
  });

  it('seek answers with what the door said — a typed GAP\'s sentence is a refusal like any other', async () => {
    const answers: unknown[] = [];
    const impl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method !== 'POST') return { ok: true, json: async () => RAW } as unknown as Response;
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next as Response;
    });
    const view = createSessionView(pollingSource({ fetchImpl: impl as unknown as typeof fetch }));
    await view.refresh();
    answers.push({ ok: true, status: 200, json: async () => ({ ok: true, cursor: 'c1' }) });
    expect(await view.seek('c1')).toEqual({ ok: true });
    // the navigation doors refuse with a typed gap, not a `rejection` — one reader knows both shapes
    answers.push({ ok: true, status: 200, json: async () => ({ ok: false, gap: { code: 'guard-failed', op: 'seek', detail: 'no commit "c9" to seek to' } }) });
    expect(await view.seek('c9')).toEqual({ ok: false, sentence: 'no commit "c9" to seek to' });
    answers.push(new Error('offline'));
    expect(await view.seek('c1')).toEqual({ ok: false, sentence: 'could not reach the session' });
    view.dispose();
  });

  it('refreshes on construction and notifies subscribers', async () => {
    const { impl } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    const seen: number[] = [];
    view.subscribe(() => seen.push(view.getState().commits.length));
    await view.refresh();
    expect(view.getState().commits).toHaveLength(3);
    expect(seen.at(-1)).toBe(3);
    view.dispose();
  });

  it('emit(interval) posts a filter dispatch; emit(point) posts a select', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.emit('scatter', { rawValue: [20, 80], encoding: { kind: 'interval', field: 'price' } }, 'brush');
    await view.emit('bar', { rawValue: 'Party', encoding: { kind: 'point', field: 'category' } });
    const posts = calls.filter((c) => c.body);
    expect(posts[0]!.body).toMatchObject({ verb: 'filter', viewId: 'scatter', field: 'price', range: [20, 80] });
    expect(posts[1]!.body).toMatchObject({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party' });
    view.dispose();
  });

  it('emit(cell) posts the SELECT verb\'s cell form — fields + values, one dispatch (D30)', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.emit('heatmap', { rawValue: [[100, 150], 'Formal'], encoding: { kind: 'cell', fields: ['price', 'category'] } });
    await view.emit('heatmap', { rawValue: null, encoding: { kind: 'cell', fields: ['price', 'category'] } }, 'clear the cell');
    const posts = calls.filter((c) => c.body);
    expect(posts).toHaveLength(2); // one gesture = ONE dispatch, and the clear is one more
    expect(posts[0]!.body).toMatchObject({
      verb: 'select',
      viewId: 'heatmap',
      fields: ['price', 'category'],
      values: [[100, 150], 'Formal'],
      intent: 'cell price × category',
    });
    expect(posts[1]!.body).toMatchObject({ verb: 'select', viewId: 'heatmap', fields: ['price', 'category'], values: null, intent: 'clear the cell' });
    view.dispose();
  });

  it('seek + stepBack post to the seek endpoint using the tree rule', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh(); // cursor=1, head=3
    await view.stepForward(); // 1 → 3 (active child)
    const seekCall = calls.find((c) => c.url === '/api/seek');
    expect(seekCall?.body).toMatchObject({ commitId: '3' });
    view.dispose();
  });

  it('reencode rides the DISPATCH endpoint as the 8th verb (UI-0, fe6e5b5)', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.reencode('scatter', 'y', 'rating');
    const re = calls.find((c) => c.url === '/api/dispatch' && (c.body as { verb?: string })?.verb === 'reencode');
    expect(re?.body).toMatchObject({ verb: 'reencode', viewId: 'scatter', channel: 'y', field: 'rating' });
    view.dispose();
  });

  it('navigate rides the DISPATCH endpoint with the view state serialized into the intent (RP-1)', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.navigate('scatter', { x: [0, 100], y: ['2026-05-01', '2026-06-30'] });
    const nav = calls.find((c) => c.url === '/api/dispatch' && (c.body as { verb?: string })?.verb === 'navigate');
    expect(nav?.body).toMatchObject({ verb: 'navigate', viewId: 'scatter' });
    expect((nav?.body as { intent?: string }).intent).toBe('navigate scatter x:[0, 100] y:[2026-05-01, 2026-06-30]');
    view.dispose();
  });

  it('bookmark posts to its OWN endpoint (endpoints.bookmark), never endpoints.dispatch (UI-2 regression — found dogfooding)', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.bookmark('opening brush');
    const bookmarkCall = calls.find((c) => c.url === '/api/bookmark');
    expect(bookmarkCall?.body).toMatchObject({ label: 'opening brush' });
    // never fell through to the generic dispatch endpoint
    expect(calls.some((c) => c.url === '/api/dispatch' && (c.body as { label?: string } | undefined)?.label === 'opening brush')).toBe(false);
    view.dispose();
  });

  it('bookmark honors a custom endpoints override, same as seek/dispatch', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl, endpoints: { bookmark: '/custom/bookmark' } }));
    await view.refresh();
    await view.bookmark('custom point');
    expect(calls.some((c) => c.url === '/custom/bookmark' && (c.body as { label?: string })?.label === 'custom point')).toBe(true);
    view.dispose();
  });
});

describe('createSessionView — in-process session source', () => {
  function fakeSession(): SessionLike & { dispatched: unknown[]; pathCalls: unknown[]; savedCalls: unknown[]; savedStore: SavedSelection[] } {
    const dispatched: unknown[] = [];
    const pathCalls: unknown[] = [];
    const savedCalls: unknown[] = [];
    const savedStore: SavedSelection[] = [];
    return {
      dispatched,
      pathCalls,
      savedCalls,
      savedStore,
      commits: () => [],
      overview: () => ({
        defaultTable: 'data',
        views: [],
        activeSelections: [],
        analyses: [],
        fdr: { procedure: 'LORD++', alpha: 0.05, tests: 0, discoveries: 0, wealth: 0, ledger: [] },
        columns: { data: [{ field: 'price', type: 'number' }] },
        encodings: {},
        gaps: 0,
        currentView: null,
        engines: {},
        time: { cursor: null, head: null, branches: 0, bookmarks: 0, cursorTests: 0, viewingPast: false },
        paths: { current: 'main', detachedAt: null, list: [{ name: 'main', tip: '1', steps: 1, lastTs: 0, active: true }], events: [] },
      }) as unknown as ReturnType<SessionLike['overview']>,
      gaps: () => [],
      branches: () => [],
      bookmarkViews: () => [],
      // ── saved pictures: the store's WRITE doors (a picture is not a commit, so none of these ride `dispatch`).
      //    Reading rides `overview.saved`, not a door — adapter README, Law 1. ──
      saveSelection: (name, source, as) => {
        savedCalls.push({ op: 'save', name, source, as });
        const picture = { id: `p${savedStore.length + 1}`, name, conditions: [{ viewId: 'bar', kind: 'point' as const, field: 'category', value: 'Formal' }], by: as ?? 'user', at: '2026-01-01T00:00:00.000Z' };
        savedStore.push(picture);
        return { ok: true, saved: picture };
      },
      renameSaved: (from, to, as) => {
        savedCalls.push({ op: 'rename', from, to, as });
        const at = savedStore.findIndex((c) => c.name === from);
        if (at < 0) return { ok: false, rejected: `no saved selection "${from}"` };
        savedStore[at] = { ...savedStore[at]!, name: to };
        return { ok: true, saved: savedStore[at]! };
      },
      applySaved: (name, cause, opts) => {
        savedCalls.push({ op: 'apply', name, intent: cause.intent, mode: opts?.mode, as: opts?.as });
        return { ok: true, name, correlationId: 'k1', applied: [{ id: 'c1' }], cleared: [], refused: [{ viewId: 'gone', rejected: '"gone" is no longer on the dashboard' }] } as unknown as ReturnType<SessionLike['applySaved']>;
      },
      seek: (commitId: string) => ({ ok: true, cursor: commitId }) as ReturnType<SessionLike['seek']>,
      dispatch: (action) => {
        dispatched.push(action);
        return { ok: true, verb: action.verb, intent: 'requested' } as unknown as ReturnType<SessionLike['dispatch']>;
      },
      switchPath: (name) => {
        pathCalls.push({ op: 'switch', name });
        return { ok: true, name, cursor: '1' } as ReturnType<SessionLike['switchPath']>;
      },
      renamePath: (from, to) => {
        pathCalls.push({ op: 'rename', from, to });
        return { ok: true, name: to } as ReturnType<SessionLike['renamePath']>;
      },
      newPathAt: (commitId, name) => {
        pathCalls.push({ op: 'new', commitId, name });
        return { ok: true, name: name ?? 'auto', cursor: commitId } as ReturnType<SessionLike['newPathAt']>;
      },
      compare: (aRef, bRef) => {
        pathCalls.push({ op: 'compare', aRef, bRef });
        return {
          ok: true,
          a: { ref: aRef, tip: '1', rows: 3 },
          b: { ref: bRef, tip: '2', rows: 5 },
          ancestor: '1',
          changed: [],
          onlyA: [],
          onlyB: [],
        } as unknown as ReturnType<SessionLike['compare']>;
      },
      bringOver: (commitId, opts) => {
        pathCalls.push({ op: 'bringOver', commitId, as: opts?.as });
        return { ok: true } as unknown as ReturnType<SessionLike['bringOver']>;
      },
      undo: (commitId, opts) => {
        pathCalls.push({ op: 'undo', commitId, as: opts?.as });
        return { ok: true } as unknown as ReturnType<SessionLike['undo']>;
      },
      // ── TL-1 lifecycle: the four ACTIONS are recorded (so routing is
      // assertable); `paths` is a READ the snapshot mapper makes, not an act. ──
      paths: () => [{ name: 'dead-end', tip: '9', steps: 2, lastTs: 3, active: false, archived: true as const }],
      archivePath: (name, opts) => {
        pathCalls.push({ op: 'archive', name, as: opts?.as });
        return { ok: true, name, tip: '9', detached: false };
      },
      restorePath: (name, opts) => {
        pathCalls.push({ op: 'restore', name, as: opts?.as });
        return { ok: true, name, tip: '9' };
      },
      discardFromHere: (opts) => {
        pathCalls.push({ op: 'discard', at: opts?.at, as: opts?.as });
        return { ok: true, path: 'main', at: opts?.at ?? null, kept: 'discarded-x', keptTip: '3', steps: 1 };
      },
      adoptPath: (name, opts) => {
        pathCalls.push({ op: 'adopt', name, as: opts?.as });
        return {
          ok: true,
          path: name,
          applied: 2,
          skipped: 1,
          conflicts: ['c1'],
          steps: [{ applied: true }, { applied: true }, { applied: false, skippedReason: 'a chart is proposed, not replayed' }],
        };
      },
    };
  }

  it('describe over an in-process session answers with the session\'s own verdict — its rejection sentence when refused', async () => {
    const session = fakeSession();
    const refusing = { ...session, dispatch: (() => ({ ok: false, verb: 'describe', intent: 'requested', rejection: { code: 'guard-failed', detail: 'no words' } })) as unknown as SessionLike['dispatch'] };
    const view = createSessionView(sessionSource(refusing as unknown as SessionLike));
    await view.refresh();
    expect(await view.describe('note:n1', 'caption', { text: '', author: { kind: 'human' } })).toEqual({ ok: false, sentence: 'no words' });
    const ok = createSessionView(sessionSource(session as unknown as SessionLike));
    await ok.refresh();
    expect(await ok.describe('note:n1', 'caption', { text: 'x', author: { kind: 'human' } })).toEqual({ ok: true });
    view.dispose();
    ok.dispose();
  });

  it('emit routes to session.dispatch as the configured principal', async () => {
    const session = fakeSession();
    const view = createSessionView(sessionSource(session), { as: 'user' });
    await view.refresh();
    await view.emit('scatter', { rawValue: [1, 2], encoding: { kind: 'interval', field: 'price' } }, 'brush');
    expect(session.dispatched).toHaveLength(1);
    expect(session.dispatched[0]).toMatchObject({ verb: 'filter', viewId: 'scatter', field: 'price', cause: { requestedBy: 'user' } });
    expect(view.getState().columns['data']).toBeTruthy();
    view.dispose();
  });

  it('emit(cell) routes the SELECT verb\'s cell form to session.dispatch — one action, both fields (D30)', async () => {
    const session = fakeSession();
    const view = createSessionView(sessionSource(session), { as: 'user' });
    await view.refresh();
    await view.emit('heatmap', { rawValue: [[100, 150], 'Formal'], encoding: { kind: 'cell', fields: ['price', 'category'] } });
    expect(session.dispatched).toHaveLength(1); // one gesture = one dispatch
    expect(session.dispatched[0]).toMatchObject({
      verb: 'select',
      viewId: 'heatmap',
      fields: ['price', 'category'],
      values: [[100, 150], 'Formal'],
      cause: { requestedBy: 'user', intent: 'cell price × category' },
    });
    view.dispose();
  });

  it('reencode dispatches the 8th verb with a two-slot cause', async () => {
    const session = fakeSession();
    const view = createSessionView(sessionSource(session), { as: 'user' });
    await view.refresh();
    await view.reencode('scatter', 'x', 'rating');
    expect(session.dispatched[0]).toMatchObject({
      verb: 'reencode',
      viewId: 'scatter',
      channel: 'x',
      field: 'rating',
      cause: { requestedBy: 'user' },
    });
    view.dispose();
  });

  it('navigate dispatches the navigate verb with a two-slot cause — with and without a view state (RP-1)', async () => {
    const session = fakeSession();
    const view = createSessionView(sessionSource(session), { as: 'user' });
    await view.refresh();
    await view.navigate('scatter', { x: [0, 100] });
    await view.navigate('map');
    expect(session.dispatched[0]).toMatchObject({
      verb: 'navigate',
      viewId: 'scatter',
      cause: { requestedBy: 'user', intent: 'navigate scatter x:[0, 100]' },
    });
    expect(session.dispatched[1]).toMatchObject({ verb: 'navigate', viewId: 'map', cause: { intent: 'navigate map' } });
    view.dispose();
  });

  it('bookmark dispatches the bookmark verb over an in-process session too', async () => {
    const session = fakeSession();
    const view = createSessionView(sessionSource(session), { as: 'user' });
    await view.refresh();
    await view.bookmark('opening brush');
    expect(session.dispatched[0]).toMatchObject({ verb: 'bookmark', label: 'opening brush', cause: { requestedBy: 'user' } });
    view.dispose();
  });

  it('paths state rides overview().paths into state.paths', async () => {
    const session = fakeSession();
    const view = createSessionView(sessionSource(session), { as: 'user' });
    await view.refresh();
    expect(view.getState().paths.current).toBe('main');
    expect(view.getState().paths.list).toEqual([{ name: 'main', tip: '1', steps: 1, lastTs: 0, active: true }]);
    view.dispose();
  });

  it('switchPath / renamePath / newPathAt route to the BR-1 session methods', async () => {
    const session = fakeSession();
    const view = createSessionView(sessionSource(session), { as: 'user' });
    await view.refresh();
    await view.switchPath('premium');
    await view.renamePath('premium', 'premium-end');
    await view.newPathAt('1', 'from-the-top');
    await view.newPathAt('1'); // auto-named
    expect(session.pathCalls).toEqual([
      { op: 'switch', name: 'premium' },
      { op: 'rename', from: 'premium', to: 'premium-end' },
      { op: 'new', commitId: '1', name: 'from-the-top' },
      { op: 'new', commitId: '1', name: undefined },
    ]);
    view.dispose();
  });

  it('bringOver / undo route to the session as the configured principal', async () => {
    const session = fakeSession();
    const view = createSessionView(sessionSource(session), { as: 'agent' });
    await view.refresh();
    await view.bringOver('2');
    await view.undo('2');
    expect(session.pathCalls).toEqual([
      { op: 'bringOver', commitId: '2', as: 'agent' },
      { op: 'undo', commitId: '2', as: 'agent' },
    ]);
    view.dispose();
  });

  it('TL-1: archive / restore / discard / adopt route to the session as the configured principal', async () => {
    const session = fakeSession();
    const view = createSessionView(sessionSource(session), { as: 'user' });
    await view.refresh();
    await view.archivePath('dead-end');
    await view.restorePath('dead-end');
    await view.discardFromHere('1');
    await view.discardFromHere(); // omitted = from the cursor
    const summary = await view.adoptPath('premium');

    expect(session.pathCalls).toEqual([
      { op: 'archive', name: 'dead-end', as: 'user' },
      { op: 'restore', name: 'dead-end', as: 'user' },
      { op: 'discard', at: '1', as: 'user' },
      { op: 'discard', at: undefined, as: 'user' },
      { op: 'adopt', name: 'premium', as: 'user' },
    ]);
    // the adopt ANSWER is summarized for the UI, reasons and all
    expect(summary).toEqual({
      ok: true,
      path: 'premium',
      applied: 2,
      skipped: 1,
      conflicts: 1,
      skippedReasons: ['a chart is proposed, not replayed'],
    });
    // the session's archived rows ride the snapshot for the modal's reveal
    expect(view.getState().paths.archivedList.map((p) => p.name)).toEqual(['dead-end']);
    view.dispose();
  });

  it('compare returns the normalized plain-language diff and never refreshes (read-only)', async () => {
    const session = fakeSession();
    const view = createSessionView(sessionSource(session), { as: 'user' });
    await view.refresh();
    const before = session.pathCalls.length;
    const diff = await view.compare('main', 'premium');
    expect(diff).toMatchObject({ ok: true, ancestor: '1', a: { ref: 'main', rows: 3 }, b: { ref: 'premium', rows: 5 } });
    expect(session.pathCalls.length).toBe(before + 1); // exactly the one compare call — no extra overview() churn is asserted below via dispatched
    expect(session.dispatched).toHaveLength(0);
    view.dispose();
  });
});

describe('createSessionView — paths actions over a POLL source (the BR-3 endpoint contract)', () => {
  function fakeFetch(compareResponse?: unknown, compareOk = true) {
    const calls: { url: string; body?: unknown }[] = [];
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (!init || init.method !== 'POST') return { ok: true, json: async () => RAW } as unknown as Response;
      if (url.endsWith('/compare')) return { ok: compareOk, status: compareOk ? 200 : 500, json: async () => compareResponse } as unknown as Response;
      return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }

  it('switch/rename/new all POST to the ONE paths endpoint with a discriminated action body', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.switchPath('premium');
    await view.renamePath('premium', 'premium-end');
    await view.newPathAt('1', 'named');
    await view.newPathAt('1'); // name omitted → key absent from the JSON body
    const posts = calls.filter((c) => c.url === '/api/paths').map((c) => c.body);
    expect(posts).toEqual([
      { action: 'switch', name: 'premium' },
      { action: 'rename', from: 'premium', to: 'premium-end' },
      { action: 'new', commitId: '1', name: 'named' },
      { action: 'new', commitId: '1' },
    ]);
    view.dispose();
  });

  it('bringOver and undo POST { commitId } to their OWN endpoints', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.bringOver('2');
    await view.undo('3');
    expect(calls.find((c) => c.url === '/api/bring-over')?.body).toEqual({ commitId: '2' });
    expect(calls.find((c) => c.url === '/api/undo')?.body).toEqual({ commitId: '3' });
    view.dispose();
  });

  it('compare POSTs { a, b } and normalizes the CompareResult JSON the endpoint returns', async () => {
    const { impl, calls } = fakeFetch({
      ok: true,
      a: { ref: 'main', tip: '3', rows: 10 },
      b: { ref: 'premium', tip: '5', rows: 4 },
      ancestor: '1',
      changed: [],
      onlyA: [],
      onlyB: [{ key: 'selection|scatter', value: { kind: 'selection', viewId: 'scatter', clause: { kind: 'interval', field: 'price', value: [120, 220] }, commitId: '5' } }],
    });
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    const diff = await view.compare('main', 'premium');
    expect(calls.find((c) => c.url === '/api/compare')?.body).toEqual({ a: 'main', b: 'premium' });
    expect(diff.ok).toBe(true);
    if (diff.ok) {
      expect(diff.onlyB[0]).toEqual({ key: 'selection|scatter', kind: 'selection', label: 'scatter', detail: 'price between 120 and 220' });
    }
    view.dispose();
  });

  it('compare surfaces an honest reason when the endpoint answers not-ok or is unreachable', async () => {
    const { impl } = fakeFetch(undefined, false);
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    expect(await view.compare('a', 'b')).toEqual({ ok: false, reason: 'the compare endpoint answered 500' });
    view.dispose();

    const throwing = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('network down');
      return { ok: true, json: async () => RAW } as unknown as Response;
    });
    const view2 = createSessionView(pollingSource({ fetchImpl: throwing as unknown as typeof fetch }));
    await view2.refresh();
    expect(await view2.compare('a', 'b')).toEqual({ ok: false, reason: 'could not reach the compare endpoint' });
    view2.dispose();
  });

  it('paths state + BR-1 cause tags ride /api/state into the snapshot', async () => {
    const bookmarked: RawPollState = {
      ...RAW,
      records: [
        ...RAW.records,
        { id: '4', parent: '3', viewId: 'bar', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'user', replayedFrom: '2', conflicts: ['3'] } },
        { id: '5', parent: '4', viewId: 'scatter', kind: 'interval', field: 'price', value: null, cause: { requestedBy: 'user', revertOf: '3' } },
      ],
      paths: {
        current: null,
        detachedAt: '1',
        list: [{ name: 'main', tip: '3', steps: 2, lastTs: 2, active: false }],
        events: [{ type: 'create', name: 'main', at: '1', auto: true, ts: 0 }],
      },
    };
    const impl = vi.fn(async () => ({ ok: true, json: async () => bookmarked }) as unknown as Response);
    const view = createSessionView(pollingSource({ fetchImpl: impl as unknown as typeof fetch }));
    await view.refresh();
    const s = view.getState();
    expect(s.paths.current).toBeNull();
    expect(s.paths.detachedAt).toBe('1');
    expect(s.paths.list[0]).toMatchObject({ name: 'main', tip: '3' });
    expect(s.paths.events[0]).toMatchObject({ type: 'create', auto: true });
    expect(s.commits.find((c) => c.id === '4')).toMatchObject({ replayedFrom: '2', conflicts: ['3'] });
    expect(s.commits.find((c) => c.id === '5')).toMatchObject({ revertOf: '3' });
    view.dispose();
  });

  it('a pre-BR-1 payload (no paths at all) maps to the honest empty surface', async () => {
    const { impl } = fakeFetch(); // RAW has no `paths`
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    expect(view.getState().paths).toEqual({ current: null, detachedAt: null, list: [], archivedList: [], events: [] });
    view.dispose();
  });

  it('a partial paths payload falls back field by field (defensive wire mapping)', async () => {
    const impl = vi.fn(async () => ({ ok: true, json: async () => ({ ...RAW, paths: {} }) }) as unknown as Response);
    const view = createSessionView(pollingSource({ fetchImpl: impl as unknown as typeof fetch }));
    await view.refresh();
    expect(view.getState().paths).toEqual({ current: null, detachedAt: null, list: [], archivedList: [], events: [] });
    view.dispose();
  });
});

// ── the LIVE end-to-end integration (UI-0 landed: real buildDashboard session) ──
describe('createSessionView — REAL InteractionSession (UI-0 reencode end-to-end)', () => {
  async function liveView() {
    // test-only value import of the real L5 grammar (production ui code stays type-only)
    const { buildDashboard } = await import('vizfootprint/agent');
    const rows = [
      { id: 'a', category: 'Casual', price: 20, rating: 3 },
      { id: 'b', category: 'Formal', price: 120, rating: 5 },
      { id: 'c', category: 'Party', price: 60, rating: 4 },
    ];
    const dashboard = buildDashboard({
      meta: { title: 'ui integration' },
      data: { data: { rows } },
      actors: { scatter: { actor: 'user', label: 'Scatter' } },
      encodings: [{ viewId: 'scatter', chartKind: 'point', channels: ['x', 'y', 'color'], initial: { x: 'price', y: 'rating' } }],
      defaultTable: 'data',
    });
    const session = dashboard.createSession({ as: 'user' });
    return createSessionView(sessionSource(session), { as: 'user' });
  }

  it('projects the declared initial encodings + columns into state', async () => {
    const view = await liveView();
    await view.refresh();
    const s = view.getState();
    expect(s.encodings['scatter']).toEqual({ x: 'price', y: 'rating' });
    const scatter = s.views.find((v) => v.viewId === 'scatter')!;
    expect(scatter.encoding).toEqual({ x: 'price', y: 'rating' });
    expect(s.columns['data']!.map((c) => c.field)).toContain('rating'); // the table's list, stated once
    view.dispose();
  });

  it('reencode lands a cause-tagged commit and the fold updates the channel map', async () => {
    const view = await liveView();
    await view.refresh();
    await view.reencode('scatter', 'x', 'rating');
    const s = view.getState();
    // the encoding fold moved
    expect(s.encodings['scatter']).toEqual({ x: 'rating', y: 'rating' });
    // and it landed as a REAL commit in the provenance log (R1)
    const encCommit = s.commits.find((c) => c.viewId === 'encoding:scatter');
    expect(encCommit).toBeTruthy();
    expect(encCommit!.actor).toBe('user');
    expect(encCommit!.field).toBe('x'); // field carries the channel
    expect(encCommit!.value).toBe('rating'); // value carries the target field
    view.dispose();
  });

  it('seeking back in time restores the OLD encoding (branch-scoped fold)', async () => {
    const view = await liveView();
    await view.refresh();
    // land a first commit to seek back to
    await view.emit('scatter', { rawValue: [10, 100], encoding: { kind: 'interval', field: 'price' } }, 'brush');
    const firstCommit = view.getState().commits[0]!.id;
    await view.reencode('scatter', 'x', 'rating');
    expect(view.getState().encodings['scatter']!['x']).toBe('rating');
    // seek to before the reencode → the initial map is restored
    await view.seek(firstCommit);
    expect(view.getState().encodings['scatter']!['x']).toBe('price');
    view.dispose();
  });

  it('a seek the session refuses comes back as the SESSION\'s sentence, with nothing moved', async () => {
    const view = await liveView();
    await view.refresh();
    await view.emit('scatter', { rawValue: [10, 100], encoding: { kind: 'interval', field: 'price' } }, 'brush');
    const landed = view.getState().commits[0]!.id;
    expect(await view.seek(landed)).toEqual({ ok: true });
    const cursor = view.getState().cursor;
    // the session judges first and moves nothing (session README, law 1) — the adapter carries its words out
    expect(await view.seek('no-such-commit')).toEqual({ ok: false, sentence: 'no commit "no-such-commit" to seek to' });
    expect(view.getState().cursor).toBe(cursor);
    view.dispose();
  });

  it('an invalid channel is an honest typed gap, never a silent drop', async () => {
    const view = await liveView();
    await view.refresh();
    await view.reencode('scatter', 'theta', 'price'); // 'theta' not in the declared channels
    const s = view.getState();
    expect(s.encodings['scatter']).toEqual({ x: 'price', y: 'rating' }); // unchanged
    expect(s.gaps.some((g) => g.op === 'reencode')).toBe(true); // filed, not dropped
    view.dispose();
  });

  it('BR-2 full loop: fork-on-act names a path; rename/switch/compare/bringOver/undo all land end to end', async () => {
    const view = await liveView();
    await view.refresh();

    // two commits on the first lineage
    await view.emit('scatter', { rawValue: [10, 100], encoding: { kind: 'interval', field: 'price' } }, 'opening brush');
    const first = view.getState().commits[0]!.id;
    await view.emit('scatter', { rawValue: [10, 50], encoding: { kind: 'interval', field: 'price' } }, 'narrower');
    expect(view.getState().paths.list.map((p) => p.name)).toEqual(['main']); // the root birth named the default path

    // seek back (detaches) then act → the fork auto-creates a SECOND named path
    await view.seek(first);
    expect(view.getState().paths.current).toBeNull();
    expect(view.getState().paths.detachedAt).toBe(first);
    await view.emit('scatter', { rawValue: [80, 100], encoding: { kind: 'interval', field: 'price' } }, 'premium end');
    const afterFork = view.getState();
    expect(afterFork.paths.list).toHaveLength(2);
    const forkName = afterFork.paths.current!;
    expect(forkName).not.toBe('main');
    expect(afterFork.paths.events.some((e) => e.type === 'create' && e.auto)).toBe(true);

    // rename the fork, then switch back to main and verify the pill-facing state
    await view.renamePath(forkName, 'premium');
    expect(view.getState().paths.current).toBe('premium');
    await view.switchPath('main');
    expect(view.getState().paths.current).toBe('main');

    // compare the two named paths — a real structured diff with row counts
    const diff = await view.compare('main', 'premium');
    expect(diff.ok).toBe(true);
    if (diff.ok) {
      expect(diff.ancestor).toBe(first);
      expect(diff.changed).toHaveLength(1); // the same scatter selection key, two different brushes
      expect(diff.changed[0]!.kind).toBe('selection');
      expect(typeof diff.a.rows).toBe('number');
    }

    // bring the premium brush over to main → an ordinary commit tagged replayedFrom
    const premiumTip = view.getState().paths.list.find((p) => p.name === 'premium')!.tip;
    await view.bringOver(premiumTip);
    const brought = view.getState().commits.at(-1)!;
    expect(brought.replayedFrom).toBe(premiumTip);

    // undo that step → an ordinary commit tagged revertOf
    await view.undo(brought.id);
    expect(view.getState().commits.at(-1)!.revertOf).toBe(brought.id);
    view.dispose();
  });
});

describe('SET-1 — emit(match), clear, clearAll, setPolarity', () => {
  const STATE: RawPollState = {
    ...RAW,
    activeSelections: [
      { viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' },
      { viewId: 'scatter', field: 'price', kind: 'interval', value: [40, 60] },
      { viewId: 'heatmap', field: 'price × category', kind: 'cell', value: [[100, 150], 'Formal'], fields: ['price', 'category'] },
      { viewId: 'map', field: 'region', kind: 'match', value: { values: ['North', 'South'], exclude: true } },
      { viewId: 'line', field: 'date', kind: 'point', value: null },
      { viewId: 'cleared', field: 'region', kind: 'match', value: null },
    ],
  };
  function fetchOf(state: RawPollState) {
    const posts: Record<string, unknown>[] = [];
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method !== 'POST') return { ok: true, json: async () => state } as unknown as Response;
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
    });
    return { impl: impl as unknown as typeof fetch, posts };
  }
  it('emit(match) posts the select verb\'s values form — polarity only when excluding, null to clear', async () => {
    const { impl, posts } = fetchOf(RAW);
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.emit('bar', { rawValue: { values: ['Formal', 'Party'] }, encoding: { kind: 'match', field: 'category' } });
    await view.emit('bar', { rawValue: { values: ['Formal'], exclude: true }, encoding: { kind: 'match', field: 'category' } }, 'all but Formal');
    await view.emit('bar', { rawValue: null, encoding: { kind: 'match', field: 'category' } });
    expect(posts[0]).toEqual({ verb: 'select', viewId: 'bar', field: 'category', values: ['Formal', 'Party'], intent: 'match category' });
    expect(posts[1]).toEqual({ verb: 'select', viewId: 'bar', field: 'category', values: ['Formal'], exclude: true, intent: 'all but Formal' });
    expect(posts[2]).toEqual({ verb: 'select', viewId: 'bar', field: 'category', values: null, intent: 'match category' });
    view.dispose();
  });
  it('clear(viewId) is kind-faithful: a point clears with NO value on the wire, an interval with range null, a cell with values null, a match with values null; an unknown view is a no-op', async () => {
    const { impl, posts } = fetchOf(STATE);
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.clear('bar');
    await view.clear('scatter', 'let go of the brush');
    await view.clear('heatmap');
    await view.clear('map');
    await view.clear('nowhere');
    expect(posts).toEqual([
      { verb: 'select', viewId: 'bar', field: 'category', intent: 'clear bar' },
      { verb: 'filter', viewId: 'scatter', field: 'price', range: null, intent: 'let go of the brush' },
      { verb: 'select', viewId: 'heatmap', fields: ['price', 'category'], values: null, intent: 'clear heatmap' },
      { verb: 'select', viewId: 'map', field: 'region', values: null, intent: 'clear map' },
    ]);
    expect('value' in posts[0]!).toBe(false); // the cleared point carries NO value key — undefined, never null (IS NULL)
    view.dispose();
  });
  it('clearAll clears every live selection, one commit each', async () => {
    const { impl, posts } = fetchOf(STATE);
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.clearAll();
    expect(posts.map((p) => p['viewId'])).toEqual(['bar', 'scatter', 'heatmap', 'map', 'line', 'cleared']);
    expect(posts.every((p) => p['intent'] === 'clear all')).toBe(true);
    view.dispose();
  });
  it('setPolarity flips a point (as a one-value set — a null point is a live IS-NULL one) or a match; an interval, a cell, an unknown view are no-ops', async () => {
    const { impl, posts } = fetchOf(STATE);
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.setPolarity('bar', true);
    await view.setPolarity('map', false);
    await view.setPolarity('map', false, 'keep the north and south');
    await view.setPolarity('scatter', true);
    await view.setPolarity('heatmap', true);
    await view.setPolarity('line', true);
    await view.setPolarity('cleared', true);
    await view.setPolarity('nowhere', true);
    expect(posts).toEqual([
      { verb: 'select', viewId: 'bar', field: 'category', values: ['Formal'], exclude: true, intent: 'exclude category' },
      { verb: 'select', viewId: 'map', field: 'region', values: ['North', 'South'], intent: 'keep region' },
      { verb: 'select', viewId: 'map', field: 'region', values: ['North', 'South'], intent: 'keep the north and south' },
      { verb: 'select', viewId: 'line', field: 'date', values: [null], exclude: true, intent: 'exclude date' }, // IS NULL → everything but the empties
    ]);
    view.dispose();
  });
});

describe('layer 4 — the link graph rides the wire into state', () => {
  it('a well-shaped links object is carried; a malformed or absent one leaves links undefined (the old rule)', async () => {
    const graph = { default: 'crossfilter', views: [{ viewId: 'bar', voice: ['point', 'match'] }], edges: [{ id: 'bar:point→scatter', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight', origin: 'declared' }] };
    const state = mapPollState({ ...RAW, links: graph });
    expect(state.links).toEqual(graph);
    expect(mapPollState(RAW).links).toBeUndefined();
    expect(mapPollState({ ...RAW, links: { default: 'sometimes', views: [], edges: [] } }).links).toBeUndefined();
    expect(mapPollState({ ...RAW, links: 'nope' }).links).toBeUndefined();
  });
});

describe('layer 4 — a link commit on the wire wears the label link', () => {
  it('labels link:<edgeId> records as "link" and keeps the edge as the value', () => {
    const state = mapPollState({ ...RAW, records: [...RAW.records, { id: '9', parent: '3', viewId: 'link:map:point→bar', kind: 'point', field: 'response', value: { source: 'map', kind: 'point', target: 'bar', response: 'highlight' }, cause: { requestedBy: 'user', intent: 'the map lights the bar' } }] });
    const c = state.commits.find((x) => x.id === '9')!;
    expect(c.label).toBe('link');
    expect(c.value).toEqual({ source: 'map', kind: 'point', target: 'bar', response: 'highlight' });
  });
});


describe('the dashboard words (overview.dashboard)', () => {
  it('rides the state as `dashboard` with the same two mappers a view uses; absent or malformed wires yield nothing invented', () => {
    const prose = [{ slot: 'caption', text: 'Formal items only.', status: 'stale', changed: ['filters'], record: { author: { kind: 'agent', model: 'm' }, levels: ['statistic'], basis: { filters: {} } }, refs: [] }];
    const proposals = [{ slot: 'caption', proposal: 'p1', status: 'open', by: 'agent', record: { text: 'draft', author: { kind: 'agent' } } }];
    const state = mapPollState({ ...RAW, dashboard: { prose, proposals } });
    expect(state.dashboard?.prose.map((p) => [p.slot, p.status, p.text, p.changed])).toEqual([['caption', 'stale', 'Formal items only.', ['filters']]]);
    expect(state.dashboard?.proposals.map((p) => [p.slot, p.proposal, p.status])).toEqual([['caption', 'p1', 'open']]);
    expect(mapPollState(RAW).dashboard).toBeUndefined();
    expect(mapPollState({ ...RAW, dashboard: 'nope' }).dashboard).toEqual({ prose: [], proposals: [] });
    expect(mapPollState({ ...RAW, dashboard: { prose: 'x' } }).dashboard).toEqual({ prose: [], proposals: [] });
  });
});

describe('prose commit labels', () => {
  it('a describe commit is "describe view.slot"; a proposal-lane commit is "propose view.slot"', () => {
    const state = mapPollState({
      ...RAW,
      records: [
        ...RAW.records,
        { id: '4', parent: '3', viewId: 'prose:dashboard', kind: 'point', field: 'caption', value: { text: 'x', author: { kind: 'human' } } },
        { id: '5', parent: '4', viewId: 'prose:map', kind: 'point', field: 'caption:proposal', value: { text: 'y', author: { kind: 'agent' } } },
      ],
    });
    expect(state.commits.slice(-2).map((c) => c.label)).toEqual(['describe dashboard.caption', 'propose map.caption']);
  });
});

describe('the declared tables and the data journal (overview.tables, overview.journal)', () => {
  it('ride the state; a table always counts (an unreadable source is unstated), an outcome off its three arms is dropped; absent on an older wire', () => {
    const tables = [
      { name: 'cells', source: { format: 'rows', via: 'inline' }, engine: 'memory', key: 'id', absence: { field: 'state', states: ['present', 'unknown'] }, grain: { bucket: 'week', reducer: 7, collapsedFrom: 3, note: 'n' }, declaredColumns: 3 },
      { name: 'plain', source: { inline: 'rows', rows: 40 }, engine: 'memory', declaredColumns: 0 },
      { name: 'remote', source: { format: 'csv', via: 'http', at: 'https://x/y.csv' }, engine: 'memory', declaredColumns: 2 },
      { name: 'text', source: { inline: 'csv' }, engine: 'memory', declaredColumns: 0 },
      { name: 'broken', source: { nothing: true }, engine: 'memory', declaredColumns: 1, grain: 'weekly' },
      { name: 'nosrc', engine: 'memory', declaredColumns: 0, grain: { bucket: 'week', reducer: 'sum' } },
      { name: 'noted', source: { inline: 'csv' }, engine: 'memory', declaredColumns: 0, grain: { note: 'only a note' } },
      { name: 'ghost' },
    ];
    const journal = [
      { at: '2026-09-02T10:00:00Z', asked: ['cells'], tables: { cells: { unchanged: true, version: 'v1' } } },
      {
        at: '2026-09-02T11:00:00Z',
        tables: {
          remote: { refused: true, reason: 'unavailable', message: '503' },
          keyed: { changed: true, from: 'a', to: 'b', retrievedAt: 't', rows: 3, delta: { keyed: true, key: 'id', added: 1, updated: 1, removed: 1, unkeyed: 0 }, materialisedLost: ['x'] },
          replaced: { changed: true, from: 'a', to: 'b', retrievedAt: 't', rows: 3, delta: { keyed: false, replaced: 3, keyAbsent: 'id' } },
          plain: { changed: true, from: 'a', to: 'b', retrievedAt: 't', rows: 3, delta: { keyed: false, replaced: 3 } },
          bare: 5,
          half: { changed: true },
          nodelta: { changed: true, from: 'a', to: 'b', retrievedAt: 't', rows: 3, delta: { keyed: 'maybe' } },
        },
      },
      { tables: {} },
      'nope',
    ];
    const state = mapPollState({ ...RAW, tables, journal });
    expect(state.tables?.map((t) => t.name)).toEqual(['cells', 'plain', 'remote', 'text', 'broken', 'nosrc', 'noted']);
    expect(state.tables?.[6]?.grain).toEqual({ note: 'only a note' }); // a grain may state only its note
    expect(state.tables?.[5]).toEqual({ name: 'nosrc', source: { unstated: true }, engine: 'memory', grain: { bucket: 'week', reducer: 'sum' }, declaredColumns: 0 }); // no source at all is unstated too
    expect(state.tables?.[0]).toEqual({ name: 'cells', source: { format: 'rows', via: 'inline' }, engine: 'memory', key: 'id', absence: { field: 'state', states: ['present', 'unknown'] }, grain: { bucket: 'week', collapsedFrom: 3, note: 'n' }, declaredColumns: 3 }); // a reducer that is not a string is dropped
    expect(state.tables?.[1]?.source).toEqual({ inline: 'rows', rows: 40 });
    expect(state.tables?.[2]?.source).toEqual({ format: 'csv', via: 'http', at: 'https://x/y.csv' });
    expect(state.tables?.[3]?.source).toEqual({ inline: 'csv' });
    expect(state.tables?.[4]).toEqual({ name: 'broken', source: { unstated: true }, engine: 'memory', declaredColumns: 1 }); // a grain that is not a record is dropped
    expect(state.journal).toEqual([
      { at: '2026-09-02T10:00:00Z', asked: ['cells'], tables: { cells: { unchanged: true, version: 'v1' } } },
      {
        at: '2026-09-02T11:00:00Z',
        asked: ['remote', 'keyed', 'replaced', 'plain', 'bare', 'half', 'nodelta'], // asked falls back to every table that answered
        tables: {
          remote: { refused: true, reason: 'unavailable', message: '503' },
          keyed: { changed: true, from: 'a', to: 'b', retrievedAt: 't', rows: 3, delta: { keyed: true, key: 'id', added: 1, updated: 1, removed: 1, unkeyed: 0 }, materialisedLost: ['x'] },
          replaced: { changed: true, from: 'a', to: 'b', retrievedAt: 't', rows: 3, delta: { keyed: false, replaced: 3, keyAbsent: 'id' } },
          plain: { changed: true, from: 'a', to: 'b', retrievedAt: 't', rows: 3, delta: { keyed: false, replaced: 3 } },
          bare: { unreadable: true }, // an answer off its three arms is kept as a fact that could not be read, never dropped
          half: { unreadable: true },
          nodelta: { unreadable: true },
        },
      },
    ]);
    expect(mapPollState(RAW).tables).toBeUndefined();
    expect(mapPollState(RAW).journal).toBeUndefined();
    expect(mapPollState({ ...RAW, tables: 'x', journal: 'y' })).toMatchObject({ tables: [], journal: [] });
    expect(mapPollState({ ...RAW, journal, journalTotal: 80 }).journalTotal).toBe(80);
    expect(mapPollState({ ...RAW, journal, journalTotal: 'many' }).journalTotal).toBeUndefined();
  });
});

describe('the notes and the basis-shaped filters (overview.notes, overview.filters)', () => {
  it('ride the state through the same word mappers a view uses; a note without an id is dropped; filters must be a record', () => {
    const notes = [
      { id: 'n1', prose: [{ slot: 'caption', text: 'See #s1', status: 'current', changed: [], record: { author: { kind: 'human', by: 'me' } }, refs: [{ span: [4, 7], commit: 's1', label: 'first' }] }], proposals: [] },
      { id: '', prose: [] },
      { prose: [] },
      { id: 'n2' },
    ];
    const state = mapPollState({ ...RAW, notes, filters: { bar: { field: 'category', kind: 'point', value: 'Formal' } } });
    expect(state.notes?.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(state.notes?.[0]?.prose[0]?.refs).toEqual([{ span: [4, 7], commit: 's1', label: 'first' }]);
    expect(state.notes?.[1]).toEqual({ id: 'n2', prose: [], proposals: [] });
    expect(state.filters).toEqual({ bar: { field: 'category', kind: 'point', value: 'Formal' } });
    expect(mapPollState({ ...RAW, filters: ['no'] }).filters).toBeUndefined();
    expect(mapPollState(RAW).notes).toBeUndefined();
    expect(mapPollState({ ...RAW, notes: 'x' }).notes).toEqual([]);
  });
});

describe('mapPollState — a note ref to a SAVED selection rides the wire', () => {
  it('keeps a saved ref (by name), and drops a ref that names two targets or none', () => {
    const st = mapPollState({
      ...RAW,
      notes: [
        {
          id: 'n1',
          prose: [{ slot: 'caption', text: 'see @[coastal] and #s1', status: 'current', changed: [], record: { author: { kind: 'human' } }, refs: [{ span: [4, 14], saved: 'coastal', label: 'coastal' }, { span: [19, 22], commit: 's1' }, { span: [0, 1], saved: 'x', bookmark: 'y' }, { span: [0, 1] }] }],
          proposals: [],
        },
      ],
    } as RawPollState);
    expect(st.notes?.[0]?.prose[0]?.refs).toEqual([
      { span: [4, 14], saved: 'coastal', label: 'coastal' },
      { span: [19, 22], commit: 's1' },
    ]);
  });
});
