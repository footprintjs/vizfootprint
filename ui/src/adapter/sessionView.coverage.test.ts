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
      checkpoints: () => [{ label: 'start', commitId: 'r1', ts: 1 }], // exercises the checkpoints.map body
      seek: (commitId: string) => ({ ok: true, cursor: commitId }) as unknown as ReturnType<SessionLike['seek']>,
      dispatch: () => ({ ok: true, verb: 'analyze', intent: 'x' }) as unknown as ReturnType<SessionLike['dispatch']>,
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
