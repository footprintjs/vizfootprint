// @vitest-environment node
/**
 * LY-1 — the adapter's layout surface: `state.layout` (parsed from the
 * session's `layout:dashboard` fold) + `setLayout` (the action that wraps the
 * `navigate` dispatch verb), over BOTH sources. The cockpit is DRIVEN by
 * `state.layout` — it never keeps its own arrangement state.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSessionView, sessionSource, pollingSource, mapPollState, LAYOUT_DASHBOARD_VIEW_ID, type SessionLike, type RawPollState } from './sessionView.js';
import { parseLayout, defaultLayout, emptyState } from './types.js';

const BASE: RawPollState = { records: [] };

describe('parseLayout — defensive wire parsing', () => {
  it('no fold yet → the flow default', () => {
    expect(parseLayout(undefined)).toEqual({ preset: 'flow', order: [], focusId: null });
    expect(defaultLayout()).toEqual({ preset: 'flow', order: [], focusId: null });
    expect(emptyState().layout).toEqual(defaultLayout());
  });
  it('grid / focus presets parse; an unknown preset folds to flow (honest default, never a crash)', () => {
    expect(parseLayout({ preset: 'grid' }).preset).toBe('grid');
    expect(parseLayout({ preset: 'focus' }).preset).toBe('focus');
    expect(parseLayout({ preset: 'mosaic-of-the-future' }).preset).toBe('flow');
  });
  it('order splits on commas, trims, and drops empties; focus is null when blank', () => {
    expect(parseLayout({ order: 'bar, scatter ,,map,' }).order).toEqual(['bar', 'scatter', 'map']);
    expect(parseLayout({ focus: 'scatter' }).focusId).toBe('scatter');
    expect(parseLayout({ focus: '' }).focusId).toBeNull();
  });
});

describe('LY-1: the dashboard layout identity is pinned to the src wire prefix', () => {
  it('LAYOUT_DASHBOARD_VIEW_ID === LAYOUT_VIEW_PREFIX + "dashboard" (byte parity — the two layers cannot drift)', async () => {
    // test-only value import of the src constant (production ui code stays type-only)
    const { LAYOUT_VIEW_PREFIX } = await import('../../../src/branches/index.js');
    expect(LAYOUT_DASHBOARD_VIEW_ID).toBe(`${LAYOUT_VIEW_PREFIX}dashboard`);
  });
});

describe('mapPollState — the layouts slice', () => {
  it('parses layouts.dashboard into state.layout', () => {
    const s = mapPollState({ ...BASE, layouts: { dashboard: { preset: 'focus', focus: 'scatter', order: 'bar,scatter' } } });
    expect(s.layout).toEqual({ preset: 'focus', order: ['bar', 'scatter'], focusId: 'scatter' });
  });
  it('a pre-LY-1 payload (no layouts) renders the flow default', () => {
    expect(mapPollState(BASE).layout).toEqual(defaultLayout());
  });
});

describe('setLayout — poll source POSTs navigate dispatches with plain-words intents', () => {
  function fakeFetch() {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
      if (!init || init.method !== 'POST') return { ok: true, json: async () => BASE } as unknown as Response;
      return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }

  it('each provided prop lands its OWN navigate body (preset / focus / order)', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.setLayout({ preset: 'focus', focusId: 'scatter', order: ['bar', 'scatter'] });
    const posts = calls.filter((c) => c.url === '/api/dispatch').map((c) => c.body);
    expect(posts).toEqual([
      { verb: 'navigate', viewId: LAYOUT_DASHBOARD_VIEW_ID, field: 'preset', value: 'focus', intent: 'layout = focus' },
      { verb: 'navigate', viewId: LAYOUT_DASHBOARD_VIEW_ID, field: 'focus', value: 'scatter', intent: 'layout = focus on scatter' },
      { verb: 'navigate', viewId: LAYOUT_DASHBOARD_VIEW_ID, field: 'order', value: 'bar,scatter', intent: 'layout order: bar, scatter' },
    ]);
    view.dispose();
  });

  it('an empty change posts nothing (no phantom commits)', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.setLayout({});
    expect(calls.filter((c) => c.url === '/api/dispatch')).toHaveLength(0);
    view.dispose();
  });
});

describe('setLayout — REAL InteractionSession end to end (fold-carried view-state)', () => {
  async function liveView() {
    // test-only value import of the real L5 grammar (production ui code stays type-only)
    const { buildDashboard } = await import('../../../src/agent/index.js');
    const rows = [
      { id: 'a', category: 'Casual', price: 20, rating: 3 },
      { id: 'b', category: 'Formal', price: 120, rating: 5 },
    ];
    const dashboard = buildDashboard({
      meta: { title: 'ui layout integration' },
      data: { data: { rows } },
      actors: { scatter: { actor: 'user', label: 'Scatter' }, bar: { actor: 'user', label: 'Bar' } },
      defaultTable: 'data',
    });
    const session = dashboard.createSession({ as: 'user' });
    return createSessionView(sessionSource(session), { as: 'user' });
  }

  it('setLayout lands recorded commits; the commit log tells it in plain words', async () => {
    const view = await liveView();
    await view.refresh();
    await view.setLayout({ preset: 'focus', focusId: 'scatter' });
    const s = view.getState();
    expect(s.layout).toEqual({ preset: 'focus', order: [], focusId: 'scatter' });
    const focusCommit = s.commits.find((c) => c.field === 'focus')!;
    expect(focusCommit.viewId).toBe(LAYOUT_DASHBOARD_VIEW_ID);
    expect(focusCommit.intent).toBe('layout = focus on scatter'); // the plain words
    expect(focusCommit.label).toBe('layout'); // the timeline/branch-map dot label
    expect(focusCommit.actor).toBe('user');
    // deliberately non-filtering: no selection appeared
    expect(s.selections).toEqual([]);
    view.dispose();
  });

  it('time-travel restores the arrangement: back → flow default, return to now → focus again', async () => {
    const view = await liveView();
    await view.refresh();
    // a first real commit to travel back to
    await view.emit('scatter', { rawValue: [10, 100], encoding: { kind: 'interval', field: 'price' } }, 'opening brush');
    const before = view.getState().commits[0]!.id;
    await view.setLayout({ preset: 'grid' });
    await view.setLayout({ preset: 'focus', focusId: 'bar' });
    expect(view.getState().layout).toEqual({ preset: 'focus', order: [], focusId: 'bar' });

    await view.seek(before); // BACK: before any layout note
    expect(view.getState().layout).toEqual(defaultLayout());
    await view.returnToNow(); // FORWARD: the arrangement returns
    expect(view.getState().layout).toEqual({ preset: 'focus', order: [], focusId: 'bar' });
    view.dispose();
  });

  it('fork keeps its own arrangement; switching paths swaps it back and forth', async () => {
    const view = await liveView();
    await view.refresh();
    await view.emit('scatter', { rawValue: [10, 100], encoding: { kind: 'interval', field: 'price' } }, 'opening brush');
    const forkPoint = view.getState().commits[0]!.id;
    await view.setLayout({ preset: 'grid' });
    const mainName = view.getState().paths.current!;

    // detach at the fork point, act with a DIFFERENT arrangement → an auto-named fork
    await view.seek(forkPoint);
    await view.setLayout({ preset: 'focus', focusId: 'scatter' });
    const forkName = view.getState().paths.current!;
    expect(forkName).not.toBe(mainName);
    expect(view.getState().layout).toEqual({ preset: 'focus', order: [], focusId: 'scatter' });

    await view.switchPath(mainName);
    expect(view.getState().layout).toEqual({ preset: 'grid', order: [], focusId: null });
    await view.switchPath(forkName);
    expect(view.getState().layout).toEqual({ preset: 'focus', order: [], focusId: 'scatter' });
    view.dispose();
  });

  it('a duck-typed session whose overview has no layouts yet renders the flow default', async () => {
    const view = await liveView();
    await view.refresh();
    const s = view.getState(); // the fresh session has an EMPTY layouts fold
    expect(s.layout).toEqual(defaultLayout());
    // and a hand-rolled SessionLike with a pre-LY-1 overview (no layouts key at all)
    const relic: SessionLike = {
      overview: () => ({ defaultTable: 'data', views: [], activeSelections: [], analyses: [], fdr: {}, columns: {}, encodings: {}, gaps: 0, currentView: null, engines: {}, time: { cursor: null, head: null, branches: 0, bookmarks: 0, cursorTests: 0, viewingPast: false }, paths: { current: null, detachedAt: null, list: [], events: [] }, charts: [] }) as never,
      gaps: () => [],
      branches: () => [],
      bookmarkViews: () => [],
      // a session holding no pictures: the WRITE doors exist and refuse in words (never a silent empty).
      // Reading is not here: `overview.saved` serves the store (adapter README, Law 1).
      saveSelection: (name: string) => ({ ok: false as const, rejected: `nothing is selected to save as "${name}"` }),
      renameSaved: (from: string) => ({ ok: false as const, rejected: `no saved selection "${from}" — the saved ones are none` }),
      applySaved: (name: string) => ({ ok: false as const, rejected: `no saved selection "${name}" — the saved ones are none` }),
      seek: () => ({ ok: true, cursor: 'x' }),
      dispatch: async () => ({ ok: true }) as never,
      switchPath: () => ({ ok: true, name: 'main', cursor: 'x' }),
      renamePath: () => ({ ok: true, name: 'main' }),
      newPathAt: () => ({ ok: true, name: 'main', cursor: 'x' }),
      compare: async () => ({ ok: false, gap: { code: 'guard-failed', op: 'compare', detail: 'n/a', ts: 0 } }) as never,
      bringOver: async () => ({ ok: false, gap: { code: 'guard-failed', op: 'bringOver', detail: 'n/a', ts: 0 } }) as never,
      undo: async () => ({ ok: false, gap: { code: 'guard-failed', op: 'undo', detail: 'n/a', ts: 0 } }) as never,
      paths: () => [],
      archivePath: () => ({ ok: false }),
      restorePath: () => ({ ok: false }),
      discardFromHere: () => ({ ok: false }),
      adoptPath: async () => ({ ok: false }),
      log: { records: [] },
    };
    const relicView = createSessionView(sessionSource(relic));
    await relicView.refresh();
    expect(relicView.getState().layout).toEqual(defaultLayout());
    relicView.dispose();
    view.dispose();
  });
});
