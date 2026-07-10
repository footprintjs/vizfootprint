// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createSessionView, sessionSource, pollingSource, mapPollState, type SessionLike, type RawPollState } from './sessionView.js';

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
      columns: [{ field: 'price', type: 'number' }, { field: 'rating', type: 'number' }],
    },
  ],
  activeSelections: [{ viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' }],
  analyses: [{ id: 'correlation', kind: 'test', produces: 'evidence', ready: true }],
  fdr: { procedure: 'LORD++', alpha: 0.05, tests: 2, discoveries: 1, wealth: 0.031, ledger: [{ step: 1, hypothesisId: 'h1', pValue: 0.004, alphaThreshold: 0.02, reject: true, wealthAfter: 0.03 }] },
  columns: { data: [{ field: 'price', type: 'number' }, { field: 'category', type: 'string' }] },
  gaps: [{ code: 'needs-column', op: 'analyze', detail: 'cluster_id not present', target: 'cluster_id' }],
  branches: [{ tip: '2', length: 2, actor: 'agent', active: false }, { tip: '3', length: 2, actor: 'user', active: true }],
  checkpoints: [{ label: 'before-cluster', commitId: '1', ts: 100 }],
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
  it('maps UI-0 view shapes: selectionKinds, per-view encoding+columns, derived top-level encodings', () => {
    const scatter = s.views.find((v) => v.viewId === 'scatter')!;
    expect(scatter.selectionKinds).toEqual(['interval']);
    expect(scatter.encoding).toEqual({ x: 'price', y: 'rating' });
    expect(scatter.columns.map((c) => c.field)).toEqual(['price', 'rating']);
    // no top-level encodings in the payload → derived from views[].encodings
    expect(s.encodings['scatter']).toEqual({ x: 'price', y: 'rating' });
  });
  it('carries columns, gaps, readiness, branches, checkpoints', () => {
    expect(s.columns['data']!.map((c) => c.field)).toEqual(['price', 'category']);
    expect(s.gaps[0]!.code).toBe('needs-column');
    expect(s.readiness[0]!.ready).toBe(true);
    expect(s.branches.filter((b) => b.active)).toHaveLength(1);
    expect(s.checkpoints[0]!.label).toBe('before-cluster');
    expect(s.viewingPast).toBe(true);
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

  it('checkpoint posts to its OWN endpoint (endpoints.checkpoint), never endpoints.dispatch (UI-2 regression — found dogfooding)', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.checkpoint('opening brush');
    const ckptCall = calls.find((c) => c.url === '/api/checkpoint');
    expect(ckptCall?.body).toMatchObject({ label: 'opening brush' });
    // never fell through to the generic dispatch endpoint
    expect(calls.some((c) => c.url === '/api/dispatch' && (c.body as { label?: string } | undefined)?.label === 'opening brush')).toBe(false);
    view.dispose();
  });

  it('checkpoint honors a custom endpoints override, same as seek/dispatch', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl, endpoints: { checkpoint: '/custom/checkpoint' } }));
    await view.refresh();
    await view.checkpoint('custom point');
    expect(calls.some((c) => c.url === '/custom/checkpoint' && (c.body as { label?: string })?.label === 'custom point')).toBe(true);
    view.dispose();
  });
});

describe('createSessionView — in-process session source', () => {
  function fakeSession(): SessionLike & { dispatched: unknown[] } {
    const dispatched: unknown[] = [];
    return {
      dispatched,
      log: { records: [] },
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
        time: { cursor: null, head: null, branches: 0, checkpoints: 0, cursorTests: 0, viewingPast: false },
      }) as unknown as ReturnType<SessionLike['overview']>,
      gaps: () => [],
      branches: () => [],
      checkpoints: () => [],
      seek: (commitId: string) => ({ ok: true, cursor: commitId }) as ReturnType<SessionLike['seek']>,
      dispatch: (action) => {
        dispatched.push(action);
        return { ok: true, verb: action.verb, intent: 'requested' } as unknown as ReturnType<SessionLike['dispatch']>;
      },
    };
  }

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

  it('checkpoint dispatches the checkpoint verb over an in-process session too', async () => {
    const session = fakeSession();
    const view = createSessionView(sessionSource(session), { as: 'user' });
    await view.refresh();
    await view.checkpoint('opening brush');
    expect(session.dispatched[0]).toMatchObject({ verb: 'checkpoint', label: 'opening brush', cause: { requestedBy: 'user' } });
    view.dispose();
  });
});

// ── the LIVE end-to-end integration (UI-0 landed: real buildDashboard session) ──
describe('createSessionView — REAL InteractionSession (UI-0 reencode end-to-end)', () => {
  async function liveView() {
    // test-only value import of the real L5 grammar (production ui code stays type-only)
    const { buildDashboard } = await import('../../../src/agent/index.js');
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
    expect(scatter.columns.map((c) => c.field)).toContain('rating');
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

  it('an invalid channel is an honest typed gap, never a silent drop', async () => {
    const view = await liveView();
    await view.refresh();
    await view.reencode('scatter', 'theta', 'price'); // 'theta' not in the declared channels
    const s = view.getState();
    expect(s.encodings['scatter']).toEqual({ x: 'price', y: 'rating' }); // unchanged
    expect(s.gaps.some((g) => g.op === 'reencode')).toBe(true); // filed, not dropped
    view.dispose();
  });
});
