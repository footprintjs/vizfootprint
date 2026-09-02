// @vitest-environment node
//
// Fills the gaps sessionView.test.ts leaves: commitLabel's three special-cased
// fields, mapViews' per-field defaults, encodingsFromViews' empty-encoding
// skip, the actor/cursor/head "??" fallbacks on BOTH sources, subscribe's
// unsubscribe, refreshOnAction:false, poll-source error arms, analyze()'s
// intent default, stepBack/stepForward/returnToNow at the tree edges, and the
// poll-interval timer + its dispose() cleanup.
import { describe, it, expect, vi } from 'vitest';
import { createSessionView, sessionSource, pollingSource, mapPollState, type SessionLike, type RawPollState } from './sessionView.js';
import { emptyState } from './types.js';

// ── a small stateful fake `/api/*` server: GET /api/state reflects whatever
// cursor the last POST /api/seek set, so seek-driven tests observe REAL state
// changes rather than just "was fetch called" ────────────────────────────────
function fakeServer(initial: RawPollState) {
  let cursor = initial.cursor ?? null;
  const calls: { url: string; body?: unknown }[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, body });
    if (init?.method === 'POST') {
      if (url === '/api/seek' && typeof body?.['commitId'] === 'string') cursor = body['commitId'] as string;
      return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
    }
    return { ok: true, json: async () => ({ ...initial, cursor }) } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

// a minimal one-commit fixture for tests that only need "a working poll source"
const SIMPLE_RAW: RawPollState = {
  records: [{ id: '1', parent: null, viewId: 'scatter', kind: 'point', field: 'category', value: 'A', cause: { requestedBy: 'user' } }],
  views: [{ viewId: 'scatter', actor: 'user', encodings: { x: 'price' } }],
  cursor: '1',
  head: '1',
};
function fakeFetch() {
  return fakeServer(SIMPLE_RAW);
}

describe('mapPollState — edge branches the happy-path fixture never exercises', () => {
  const EDGE_RAW: RawPollState = {
    records: [
      { id: 'root', parent: null, viewId: 'analysis-view', kind: 'point', field: '__analysis__', value: 'corr', cause: { requestedBy: 'agent' } },
      { id: 'test', parent: 'root', viewId: 'analysis-view', kind: 'point', field: 'pValue', value: 0.01, cause: { requestedBy: 'agent' } },
      { id: 'note', parent: 'test', viewId: 'analysis-view', kind: 'point', field: '__annotation__', value: 'looks real', cause: { requestedBy: 'user' } },
      // no `cause` at all — actor must fall back to 'system'
      { id: 'anon', parent: 'note', viewId: 'analysis-view', kind: 'point', field: 'category', value: 'Formal' },
    ],
    views: [
      // full-featured view: nonempty encodings feeds the derived top-level map (true arm)
      { viewId: 'scatter', actor: 'user', label: 'Price', selectionKinds: ['interval'], canProbe: true, mounted: true, encodings: { x: 'price' }, columns: [{ field: 'price', type: 'number' }] },
      // minimal view: every optional field OMITTED — exercises every `?? default`
      { viewId: 'bare', actor: 'agent' },
    ],
    // no top-level `encodings` — forces the encodingsFromViews() derivation
    // no `cursor` / `head` — forces the `?? null` fallbacks
  };
  const s = mapPollState(EDGE_RAW);

  it('commitLabel gives the three special-cased fields their friendly label, else the field itself', () => {
    expect(s.commits.find((c) => c.id === 'root')!.label).toBe('analysis');
    expect(s.commits.find((c) => c.id === 'test')!.label).toBe('test');
    expect(s.commits.find((c) => c.id === 'note')!.label).toBe('note');
    expect(s.commits.find((c) => c.id === 'anon')!.label).toBe('category');
  });

  it('a commit with no `cause` at all falls back to actor "system"', () => {
    expect(s.commits.find((c) => c.id === 'anon')!.actor).toBe('system');
  });

  it('mapViews defaults every optional field the source omits', () => {
    const bare = s.views.find((v) => v.viewId === 'bare')!;
    expect(bare.selectionKinds).toEqual([]);
    expect(bare.canProbe).toBe(true);
    expect(bare.mounted).toBe(true);
    expect(bare.encoding).toEqual({});
    expect(bare.columns).toEqual([]);
  });

  it('encodingsFromViews lists only views with a NONEMPTY encoding fold', () => {
    expect(s.encodings['scatter']).toEqual({ x: 'price' });
    expect(s.encodings).not.toHaveProperty('bare');
  });

  it('missing cursor/head fall back to null, and activePathIds is empty with no head', () => {
    expect(s.cursor).toBeNull();
    expect(s.head).toBeNull();
    expect(s.activePathIds).toEqual([]);
  });
});

describe('createSessionView — in-process session edge branches', () => {
  function fakeSessionNoCauseNoEncodings(): SessionLike {
    return {
      log: {
        records: [
          // no `cause` -> actor falls back to 'system' on the SESSION path too
          { id: 'r1', parent: null, viewId: 'scatter', kind: 'point', field: 'category', value: 'A' } as unknown as SessionLike['log']['records'][number],
        ],
      },
      overview: () =>
        ({
          defaultTable: 'data',
          views: [{ viewId: 'scatter', actor: 'user', encodings: { x: 'price' }, columns: [] }],
          activeSelections: [],
          analyses: [],
          fdr: { procedure: 'LORD++', alpha: 0.05, tests: 0, discoveries: 0, wealth: 0, ledger: [] },
          columns: {},
          // `encodings` intentionally OMITTED -> derives from views[].encodings
          gaps: 0,
          currentView: null,
          engines: {},
          time: { cursor: null, head: null, branches: 0, checkpoints: 0, cursorTests: 0, viewingPast: false },
        }) as unknown as ReturnType<SessionLike['overview']>,
      gaps: () => [],
      branches: () => [],
      checkpoints: () => [{ label: 'start', commitId: 'r1', at: null, ts: 1 }], // exercises the checkpoints.map body
      seek: (commitId: string) => ({ ok: true, cursor: commitId }) as unknown as ReturnType<SessionLike['seek']>,
      dispatch: () => ({ ok: true, verb: 'analyze', intent: 'x' }) as unknown as ReturnType<SessionLike['dispatch']>,
      switchPath: (name: string) => ({ ok: true, name, cursor: 'r1' }) as unknown as ReturnType<SessionLike['switchPath']>,
      renamePath: (_from: string, to: string) => ({ ok: true, name: to }) as unknown as ReturnType<SessionLike['renamePath']>,
      newPathAt: (commitId: string) => ({ ok: true, name: 'auto', cursor: commitId }) as unknown as ReturnType<SessionLike['newPathAt']>,
      compare: () => ({ ok: false, gap: { code: 'guard-failed', op: 'compare', detail: 'nope' } }) as unknown as ReturnType<SessionLike['compare']>,
      bringOver: () => ({ ok: false, gap: { code: 'guard-failed', op: 'bringOver', detail: 'nope' } }) as unknown as ReturnType<SessionLike['bringOver']>,
      undo: () => ({ ok: false, gap: { code: 'guard-failed', op: 'undo', detail: 'nope' } }) as unknown as ReturnType<SessionLike['undo']>,
      paths: () => [],
      archivePath: () => ({ ok: false }),
      restorePath: () => ({ ok: false }),
      discardFromHere: () => ({ ok: false }),
      adoptPath: () => ({ ok: false }),
    };
  }

  it('a record with no `cause`, a checkpoints() list, and missing overview.encodings all fall back correctly', async () => {
    const session = fakeSessionNoCauseNoEncodings();
    const view = createSessionView(sessionSource(session));
    await view.refresh();
    const s = view.getState();
    expect(s.commits[0]!.actor).toBe('system');
    expect(s.encodings['scatter']).toEqual({ x: 'price' });
    expect(s.checkpoints[0]!.label).toBe('start');
    // no `paths` on this overview at all → the honest empty surface (defensive arm)
    expect(s.paths).toEqual({ current: null, detachedAt: null, list: [], archivedList: [], events: [] });
    view.dispose();
  });

  it('a rejected session compare maps to { ok:false } with the gap detail as the reason', async () => {
    const session = fakeSessionNoCauseNoEncodings();
    const view = createSessionView(sessionSource(session));
    await view.refresh();
    expect(await view.compare('a', 'b')).toEqual({ ok: false, reason: 'nope' });
    view.dispose();
  });
});

describe('createSessionView — subscribe/unsubscribe symmetry', () => {
  it('the returned unsubscribe actually removes the listener', async () => {
    const { impl } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    let calls = 0;
    const unsub = view.subscribe(() => {
      calls++;
    });
    unsub();
    await view.refresh(); // would notify — but the listener was removed
    expect(calls).toBe(0);
    view.dispose();
  });
});

describe('createSessionView — refreshOnAction:false', () => {
  it('skips the automatic re-fetch after an action, but the action itself still fires', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }), { refreshOnAction: false });
    await view.refresh();
    const getsBefore = calls.filter((c) => c.url === '/api/state').length;
    await view.reencode('scatter', 'x', 'price');
    const getsAfter = calls.filter((c) => c.url === '/api/state').length;
    expect(getsAfter).toBe(getsBefore); // no extra GET
    expect(calls.filter((c) => c.url === '/api/dispatch')).toHaveLength(1); // the POST still went out
    view.dispose();
  });
});

describe('createSessionView — poll-source error arms', () => {
  it('keeps the last good snapshot when the state endpoint responds not-ok', async () => {
    const impl = vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response);
    const view = createSessionView(pollingSource({ fetchImpl: impl as unknown as typeof fetch }));
    await view.refresh();
    expect(view.getState()).toEqual(emptyState());
    view.dispose();
  });

  it('swallows a network failure and keeps the last good snapshot', async () => {
    const impl = vi.fn(async () => {
      throw new Error('network down');
    });
    const view = createSessionView(pollingSource({ fetchImpl: impl as unknown as typeof fetch }));
    await view.refresh();
    expect(view.getState()).toEqual(emptyState());
    view.dispose();
  });
});

describe('createSessionView — analyze()', () => {
  it('dispatches with the given intent, or a default synthesized from the analysisId', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.analyze('correlation', 'check it');
    await view.analyze('correlation');
    const posts = calls.filter((c) => c.url === '/api/dispatch');
    expect(posts[0]!.body).toMatchObject({ verb: 'analyze', analysisId: 'correlation', intent: 'check it' });
    expect(posts[1]!.body).toMatchObject({ verb: 'analyze', analysisId: 'correlation', intent: 'analyze correlation' });
    view.dispose();
  });
});

describe('createSessionView — stepBack/stepForward/returnToNow at the tree edges', () => {
  const NAV_RAW: RawPollState = {
    records: [
      { id: 'root', parent: null, viewId: 'scatter', kind: 'point', field: 'category', value: 'A', cause: { requestedBy: 'user' } },
      { id: 'mid', parent: 'root', viewId: 'scatter', kind: 'point', field: 'category', value: 'B', cause: { requestedBy: 'user' } },
      { id: 'leaf', parent: 'mid', viewId: 'scatter', kind: 'point', field: 'category', value: 'C', cause: { requestedBy: 'user' } },
    ],
    cursor: 'mid',
    head: 'leaf',
  };

  it('stepBack walks to the parent, then stops honestly at the root (no further seek fired)', async () => {
    const { impl, calls } = fakeServer(NAV_RAW);
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    expect(view.getState().cursor).toBe('mid');

    await view.stepBack(); // mid -> root: a target exists
    expect(view.getState().cursor).toBe('root');
    expect(calls.filter((c) => c.url === '/api/seek')).toHaveLength(1);

    await view.stepBack(); // root has no parent: stepBackTarget is null, no-op
    expect(view.getState().cursor).toBe('root');
    expect(calls.filter((c) => c.url === '/api/seek')).toHaveLength(1); // unchanged
    view.dispose();
  });

  it('stepForward is a silent no-op at the leaf head (no target -> no seek fired)', async () => {
    const { impl, calls } = fakeServer({ ...NAV_RAW, cursor: 'leaf' });
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.stepForward();
    expect(calls.filter((c) => c.url === '/api/seek')).toHaveLength(0);
    expect(view.getState().cursor).toBe('leaf');
    view.dispose();
  });

  it('returnToNow seeks to head when one is set, and is a silent no-op with no head yet', async () => {
    const { impl, calls } = fakeServer(NAV_RAW);
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.returnToNow(); // head = 'leaf'
    expect(calls.find((c) => c.url === '/api/seek')?.body).toMatchObject({ commitId: 'leaf' });
    view.dispose();

    const { impl: impl2, calls: calls2 } = fakeServer({ records: NAV_RAW.records }); // no head at all
    const view2 = createSessionView(pollingSource({ fetchImpl: impl2 }));
    await view2.refresh();
    expect(view2.getState().head).toBeNull();
    await view2.returnToNow();
    expect(calls2.some((c) => c.url === '/api/seek')).toBe(false);
    view2.dispose();
  });
});

describe('createSessionView — poll-interval timer', () => {
  it('ticks its own interval, and dispose() clears it so no further ticks land', async () => {
    vi.useFakeTimers();
    try {
      const { impl, calls } = fakeFetch();
      const view = createSessionView(pollingSource({ fetchImpl: impl, intervalMs: 1000 }));
      await vi.advanceTimersByTimeAsync(0); // let the constructor's own refresh() settle
      const getsAfterConstruct = calls.filter((c) => c.url === '/api/state').length;

      await vi.advanceTimersByTimeAsync(1000); // one interval tick
      expect(calls.filter((c) => c.url === '/api/state').length).toBeGreaterThan(getsAfterConstruct);

      view.dispose();
      const getsAfterDispose = calls.filter((c) => c.url === '/api/state').length;
      await vi.advanceTimersByTimeAsync(5000); // well past several more intervals
      expect(calls.filter((c) => c.url === '/api/state').length).toBe(getsAfterDispose); // timer cleared
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RP-3 — agent-authored charts (mapCharts) flow through both sources', () => {
  it('mapPollState surfaces charts and labels a __chart__ commit "chart"', () => {
    const raw: RawPollState = {
      records: [
        { id: 'h', parent: null, viewId: 'chart:pr', kind: 'point', field: 'pValue', value: 1, cause: { requestedBy: 'agent' } },
        { id: 'spec', parent: 'h', viewId: 'chart:pr', kind: 'point', field: '__chart__', value: '{"mark":"circle"}', cause: { requestedBy: 'agent' } },
      ],
      charts: [{ chartId: 'pr', viewId: 'chart:pr', spec: { mark: 'circle' }, claim: 'price vs rating', authoredBy: 'agent', ledgerStep: 1 }],
    };
    const s = mapPollState(raw);
    expect(s.commits.find((c) => c.id === 'spec')!.label).toBe('chart');
    expect(s.charts).toEqual([{ chartId: 'pr', viewId: 'chart:pr', spec: { mark: 'circle' }, claim: 'price vs rating', authoredBy: 'agent', ledgerStep: 1 }]);
  });

  it('mapSession reads session.charts() when present (the optional-call present branch)', async () => {
    const session = {
      log: { records: [] as unknown as SessionLike['log']['records'] },
      overview: () =>
        ({
          defaultTable: 'data',
          views: [],
          activeSelections: [],
          analyses: [],
          fdr: { procedure: 'LORD++', alpha: 0.05, tests: 1, discoveries: 0, wealth: 0.02, ledger: [] },
          columns: {},
          gaps: 0,
          currentView: null,
          engines: {},
          time: { cursor: null, head: null, branches: 0, checkpoints: 0, cursorTests: 0, viewingPast: false },
          paths: { current: null, detachedAt: null, list: [], events: [] },
        }) as unknown as ReturnType<SessionLike['overview']>,
      gaps: () => [],
      branches: () => [],
      checkpoints: () => [],
      seek: (id: string) => ({ ok: true, cursor: id }) as unknown as ReturnType<SessionLike['seek']>,
      dispatch: () => ({ ok: true, verb: 'analyze', intent: 'x' }) as unknown as ReturnType<SessionLike['dispatch']>,
      switchPath: (name: string) => ({ ok: true, name, cursor: 'x' }) as unknown as ReturnType<SessionLike['switchPath']>,
      renamePath: (_f: string, to: string) => ({ ok: true, name: to }) as unknown as ReturnType<SessionLike['renamePath']>,
      newPathAt: (id: string) => ({ ok: true, name: 'a', cursor: id }) as unknown as ReturnType<SessionLike['newPathAt']>,
      compare: () => ({ ok: false, gap: { code: 'guard-failed', op: 'compare', detail: 'n' } }) as unknown as ReturnType<SessionLike['compare']>,
      bringOver: () => ({ ok: false, gap: { code: 'guard-failed', op: 'bringOver', detail: 'n' } }) as unknown as ReturnType<SessionLike['bringOver']>,
      undo: () => ({ ok: false, gap: { code: 'guard-failed', op: 'undo', detail: 'n' } }) as unknown as ReturnType<SessionLike['undo']>,
      paths: () => [],
      archivePath: () => ({ ok: false }),
      restorePath: () => ({ ok: false }),
      discardFromHere: () => ({ ok: false }),
      adoptPath: () => ({ ok: false }),
      charts: () => [{ chartId: 'pr', viewId: 'chart:pr', spec: { mark: 'circle' }, claim: 'c', authoredBy: 'agent' as const, ledgerStep: 1 }],
    };
    const view = createSessionView(sessionSource(session));
    await view.refresh();
    expect(view.getState().charts).toHaveLength(1);
    expect(view.getState().charts[0]!.chartId).toBe('pr');
    view.dispose();
  });
});

describe('P0 seams — absence on the column facet, beat labels, poll guards', () => {
  it('mapPollState carries a declared absence vocabulary onto the ColumnView, and only there', () => {
    const raw = {
      records: [],
      defaultTable: 'data',
      columns: { data: [{ field: 'state', type: 'string', absence: ['present', 'unknown'] }, { field: 'n', type: 'number' }] },
    } as unknown as Parameters<typeof mapPollState>[0];
    const cols = mapPollState(raw).columns['data']!;
    expect(cols.find((c) => c.field === 'state')).toEqual({ field: 'state', type: 'string', absence: ['present', 'unknown'] });
    expect(cols.find((c) => c.field === 'n')).toEqual({ field: 'n', type: 'number' });
  });

  it('a beat commit is labelled "beat", not its wire field', () => {
    const raw = {
      records: [{ id: 'b0', parent: null, viewId: 'beat:0', kind: 'point', field: '__beat__', value: 'after cleanup', cause: { requestedBy: 'user', computedBy: 'user' } }],
      defaultTable: 'data',
    } as unknown as Parameters<typeof mapPollState>[0];
    expect(mapPollState(raw).commits[0]!.label).toBe('beat');
  });

  it('a stale (out-of-order) poll never overwrites a newer one, and an unchanged poll does not re-notify', async () => {
    const same = { records: [], defaultTable: 'data', cursor: null, head: null };
    let calls = 0;
    const impl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
      calls += 1;
      const n = calls;
      // createSessionView fires poll 1 itself; poll 2 is the warm-up below. Poll 3 is
      // slow — it answers AFTER poll 4 has already landed.
      if (n === 3) await new Promise((r) => setTimeout(r, 25));
      const cursor = n === 3 ? 'stale' : n === 4 ? 'newest' : null;
      return { ok: true, json: async () => ({ ...same, cursor }) } as unknown as Response;
    });
    const view = createSessionView(pollingSource({ fetchImpl: impl as unknown as typeof fetch }), { refreshOnAction: false });
    await view.refresh(); // poll 2 (warm-up; poll 1 was the constructor's own)
    const slow = view.refresh(); // poll 3 (slow)
    await view.refresh(); // poll 4 lands first
    expect(view.getState().cursor).toBe('newest');
    await slow; // poll 2 arrives late — ignored
    expect(view.getState().cursor).toBe('newest');

    // unchanged bytes ⇒ no notification
    let notified = 0;
    const off = view.subscribe(() => {
      notified += 1;
    });
    await view.refresh(); // poll 5: cursor null — a change from 'newest' ⇒ notifies once
    await view.refresh(); // poll 6: identical to poll 5 ⇒ skipped
    expect(notified).toBe(1);
    off();
    view.dispose();
  });
});

describe('P0 — a beat names its parent: the `at` position rides the wire when present', () => {
  it('mapPollState carries `at` when the wire has it and omits it when it does not (older wires name themselves)', () => {
    const raw = {
      records: [],
      defaultTable: 'data',
      checkpoints: [
        { label: 'named', commitId: 'b1', at: 'c1', ts: 1 },
        { label: 'old-wire', commitId: 'b0', ts: 0 },
      ],
    } as unknown as Parameters<typeof mapPollState>[0];
    const cps = mapPollState(raw).checkpoints;
    expect(cps[0]).toEqual({ label: 'named', commitId: 'b1', at: 'c1', ts: 1 });
    expect(cps[1]).toEqual({ label: 'old-wire', commitId: 'b0', ts: 0 });
  });
});

describe('createSessionView — reencodeSet (the encoding plane\'s binding set)', () => {
  it('posts ONE dispatch with bindings, with the given intent word or a spelled-out one', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }), { refreshOnAction: false });
    await view.refresh();
    await view.reencodeSet('scatter', { x: 'rating', y: 'price' }, 'swap axes');
    await view.reencodeSet('scatter', { x: 'price' });
    const posts = calls.filter((c) => c.url === '/api/dispatch');
    expect(posts).toHaveLength(2);
    const bodies = posts.map((p) => p.body as { verb: string; viewId: string; bindings: Record<string, string>; intent: string });
    expect(bodies[0]).toMatchObject({ verb: 'reencode', viewId: 'scatter', bindings: { x: 'rating', y: 'price' }, intent: 'swap axes' });
    expect(bodies[1]!.intent).toBe('reencode scatter x → price');
    view.dispose();
  });
});

describe('mapPollState — the encoding plane on the wire', () => {
  it('labels a binding-set commit, keeps well-formed fits/rules/policy, and drops anything malformed without inventing', () => {
    const raw: RawPollState = {
      records: [{ id: 'set', parent: null, viewId: 'encoding:scatter', kind: 'point', field: '*', value: { x: 'rating', y: 'price' }, cause: { requestedBy: 'user' } }],
      views: [
        {
          viewId: 'scatter',
          actor: 'user',
          encodings: { x: 'rating' },
          fits: {
            x: [{ field: 'price', ok: true }, { field: 'category', ok: false, because: 'no' }, { field: 'bad', ok: 'yes' }, 7, { field: 'nb', ok: false, because: 3 }],
            y: 'not a list',
          },
        },
        { viewId: 'bar', actor: 'user', fits: 'nope' },
      ] as unknown as RawPollState['views'],
      rules: [{ id: 'r1', builtIn: true, sentence: 'one' }, { id: 'r2', sentence: 'two' }, { sentence: 'no id' }, null],
      encodingPolicy: { onInvalid: 'refuse', ruleScope: 'view' },
      cursor: 'set',
      head: 'set',
    } as unknown as RawPollState;
    const state = mapPollState(raw);
    expect(state.commits[0]!.label).toBe('reencode scatter (several channels)');
    const scatter = state.views.find((v) => v.viewId === 'scatter')!;
    expect(scatter.fits).toEqual({ x: [{ field: 'price', ok: true }, { field: 'category', ok: false, because: 'no' }, { field: 'nb', ok: false }] });
    expect(state.views.find((v) => v.viewId === 'bar')!.fits).toEqual({});
    expect(state.rules).toEqual([
      { id: 'r1', builtIn: true, sentence: 'one' },
      { id: 'r2', builtIn: false, sentence: 'two' },
    ]);
    expect(state.encodingPolicy).toEqual({ onInvalid: 'refuse', ruleScope: 'view' });
    // malformed policy / absent rules → absent, never guessed
    const bare = mapPollState({ ...raw, rules: 'x', encodingPolicy: { onInvalid: 'refuse', ruleScope: 'page' } } as unknown as RawPollState);
    expect(bare.rules).toBeUndefined();
    expect(bare.encodingPolicy).toBeUndefined();
  });
});

describe('mapPollState — encoding links on the wire', () => {
  it('keeps a well-formed effective block and the flat map; drops malformed parts, never invents', () => {
    const raw = {
      records: [],
      views: [
        { viewId: 'bar', actor: 'user', effective: { bindings: { x: 'k', color: 'z', bad: 1 }, followed: { color: { edge: 'a:encoding→bar', from: 'a', sourceChannel: 'color' }, nope: { edge: 1 } }, refused: { x: { edge: 'a:encoding→bar', field: 'v', sentence: 'no' }, junk: 'x' } } },
        { viewId: 'a', actor: 'user', effective: 'nope' },
      ],
      effectiveEncodings: { bar: { x: 'k', color: 'z', n: 2 }, junk: 3 },
      cursor: null,
      head: null,
    } as unknown as RawPollState;
    const state = mapPollState(raw);
    expect(state.views.find((v) => v.viewId === 'bar')!.effective).toEqual({
      bindings: { x: 'k', color: 'z' },
      followed: { color: { edge: 'a:encoding→bar', from: 'a', sourceChannel: 'color' } },
      refused: { x: { edge: 'a:encoding→bar', field: 'v', sentence: 'no' } },
    });
    expect(state.views.find((v) => v.viewId === 'a')!.effective).toBeUndefined();
    expect(state.effectiveEncodings).toEqual({ bar: { x: 'k', color: 'z' } });
    expect(mapPollState({ ...raw, effectiveEncodings: 'x' } as unknown as RawPollState).effectiveEncodings).toBeUndefined();
    // a block missing followed/refused still maps; a block missing bindings maps to none
    const bare = mapPollState({ ...raw, views: [{ viewId: 'bar', actor: 'user', effective: { bindings: { x: 'k' } } }, { viewId: 'c', actor: 'user', effective: { followed: {} } }] } as unknown as RawPollState);
    expect(bare.views[0]!.effective).toEqual({ bindings: { x: 'k' }, followed: {}, refused: {} });
    expect(bare.views[1]!.effective).toEqual({ bindings: {}, followed: {}, refused: {} });
  });
});

describe('createSessionView — link with channel pairs (an encoding edge)', () => {
  it('posts the pairs with the edit', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }), { refreshOnAction: false });
    await view.refresh();
    await view.link({ source: 'weeks', kind: 'encoding', target: 'trend', response: 'follow', channels: [{ from: 'color', to: 'color' }] });
    const post = calls.find((c) => c.url === '/api/dispatch')!;
    expect(post.body).toMatchObject({ verb: 'link', kind: 'encoding', response: 'follow', channels: [{ from: 'color', to: 'color' }] });
    view.dispose();
  });
});

describe('the prose plane on the wire', () => {
  it('maps well-formed slots, drops malformed ones, labels a describe commit, and posts describe with the record or null', async () => {
    const raw = {
      records: [{ id: 'p1', parent: null, viewId: 'prose:map', kind: 'point', field: 'title', value: { text: 'T', author: { kind: 'human' } }, cause: { requestedBy: 'user' } }],
      views: [
        {
          viewId: 'map',
          actor: 'user',
          prose: [
            { slot: 'title', text: 'Cases by state', status: 'current', changed: [], record: { author: { kind: 'human', by: 'sanjay' }, levels: ['construction'] } },
            { slot: 'caption', text: 'Oklahoma leads.', status: 'stale', changed: ['filters', 7], record: { author: { kind: 'agent', model: 'm', at: 'now' }, basis: { columns: ['cases'] } } },
            { slot: 'howToRead', status: 'derived', record: { author: { kind: 'derived' }, levels: 'x' } },
            { slot: 'poem', text: 'x', status: 'current', changed: [], record: { author: { kind: 'human' } } },
            { slot: 'altShort', text: 'x', status: 'weird', changed: [], record: { author: { kind: 'human' } } },
            { slot: 'altLong', text: 'x', status: 'current', changed: [], record: { author: { kind: 'ghost' } } },
            'nope',
          ],
        },
        { viewId: 'bar', actor: 'user', prose: 'x' },
      ],
      cursor: 'p1',
      head: 'p1',
    } as unknown as RawPollState;
    const state = mapPollState(raw);
    expect(state.views.find((v) => v.viewId === 'map')!.prose).toEqual([
      { slot: 'title', text: 'Cases by state', status: 'current', changed: [], author: { kind: 'human', by: 'sanjay' }, levels: ['construction'] },
      { slot: 'caption', text: 'Oklahoma leads.', status: 'stale', changed: ['filters'], author: { kind: 'agent', model: 'm', at: 'now' }, levels: [], basis: { columns: ['cases'] } },
      { slot: 'howToRead', text: '', status: 'derived', changed: [], author: { kind: 'derived' }, levels: [] },
    ]);
    expect(state.views.find((v) => v.viewId === 'bar')!.prose).toEqual([]);
    expect(state.commits[0]!.label).toBe('describe map.title');

    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }), { refreshOnAction: false });
    await view.refresh();
    await view.describe('map', 'title', { text: 'New', author: { kind: 'human' } }, 'retitle');
    await view.describe('map', 'title', null);
    await view.describe('map', 'caption', { text: 'C', author: { kind: 'human' } });
    const posts = calls.filter((c) => c.url === '/api/dispatch').map((c) => c.body as { verb: string; slot: string; record: unknown; intent: string });
    expect(posts[0]).toMatchObject({ verb: 'describe', slot: 'title', record: { text: 'New' }, intent: 'retitle' });
    expect(posts[1]).toMatchObject({ verb: 'describe', record: null, intent: 'map.title: back to the declaration' });
    expect(posts[2]!.intent).toBe('describe map.caption');
    view.dispose();
  });
});
