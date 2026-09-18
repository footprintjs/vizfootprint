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
import { sheetSortOf } from '../sheet/arrangement.js';

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
    const { LAYOUT_VIEW_PREFIX } = await import('vizfootprint/branches');
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
  it('carries EVERY scope, not only the dashboard — a sheet reads its own arrangement off the same state', () => {
    const s = mapPollState({ ...BASE, layouts: { dashboard: { preset: 'grid' }, 'sheet:cells': { sort: '[{"field":"cases","dir":"desc"}]' } } });
    expect(s.layout.preset).toBe('grid');
    expect(sheetSortOf(s.layouts, 'cells')).toEqual([{ field: 'cases', dir: 'desc' }]);
    // and a payload that predates the fold has none, rather than an invented empty one
    expect(mapPollState(BASE).layouts).toBeUndefined();
  });
});

describe('setSheetSort — a sheet’s order lands as an act, over the poll source too', () => {
  it('POSTs ONE navigate dispatch under the sheet’s own layout identity, words and all', async () => {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
      if (!init || init.method !== 'POST') return { ok: true, json: async () => BASE } as unknown as Response;
      return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
    });
    const view = createSessionView(pollingSource({ fetchImpl: impl as unknown as typeof fetch }));
    await view.refresh();
    await view.setSheetSort('cells', [{ field: 'cases', dir: 'desc' }]);
    expect(calls.filter((c) => c.url === '/api/dispatch').map((c) => c.body)).toEqual([
      { verb: 'navigate', viewId: 'layout:sheet:cells', field: 'sort', value: '[{"field":"cases","dir":"desc"}]', intent: 'cells: sorted by cases \u2193' },
    ]);
    view.dispose();
  });
});

describe('setSheetArrangement \u2014 the other three props POST the same shape, over the poll source too', () => {
  it('hidden / order / frozen each land their OWN navigate body, field named for the prop', async () => {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
      if (!init || init.method !== 'POST') return { ok: true, json: async () => BASE } as unknown as Response;
      return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
    });
    const view = createSessionView(pollingSource({ fetchImpl: impl as unknown as typeof fetch }));
    await view.refresh();
    await view.setSheetArrangement('cells', 'hidden', ['region']);
    await view.setSheetArrangement('cells', 'order', ['cases']);
    await view.setSheetArrangement('cells', 'frozen', 2);
    expect(calls.filter((c) => c.url === '/api/dispatch').map((c) => c.body)).toEqual([
      { verb: 'navigate', viewId: 'layout:sheet:cells', field: 'hidden', value: '["region"]', intent: 'cells: hid region' },
      { verb: 'navigate', viewId: 'layout:sheet:cells', field: 'order', value: '["cases"]', intent: 'cells: moved cases first' },
      { verb: 'navigate', viewId: 'layout:sheet:cells', field: 'frozen', value: '2', intent: 'cells: froze 2 columns' },
    ]);
    view.dispose();
  });
});

describe('setLayoutNote — the GENERIC door: a scope nobody here declared, in the host’s own words', () => {
  function fakePost(answer: Record<string, unknown> = { ok: true }) {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
      if (!init || init.method !== 'POST') return { ok: true, json: async () => BASE } as unknown as Response;
      return { ok: true, json: async () => answer } as unknown as Response;
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }

  it('lands ONE navigate under `layout:${scope}` carrying the HOST’S words, and answers that it landed', async () => {
    const { impl, calls } = fakePost();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    const out = await view.setLayoutNote({ scope: 'protein-desk', prop: 'panes', value: 'surface,contacts', words: 'moved the contacts beside the surface' });
    expect(out).toEqual({ ok: true });
    expect(calls.filter((c) => c.url === '/api/dispatch').map((c) => c.body)).toEqual([
      // the words are the HOST's — nothing composed a machine sentence for a vocabulary it does not know
      { verb: 'navigate', viewId: 'layout:protein-desk', field: 'panes', value: 'surface,contacts', intent: 'moved the contacts beside the surface' },
    ]);
    view.dispose();
  });

  it('HANDS BACK THE REFUSAL the session gave, verbatim — a host never has to re-read the fold to learn its act did not land', async () => {
    const { impl } = fakePost({ ok: false, gap: { detail: 'a layout navigate needs a scope — use "layout:dashboard", not bare "layout:"' } });
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    expect(await view.setLayoutNote({ scope: '', prop: 'panes', value: 'a', words: 'rearranged the desk' })).toEqual({
      ok: false,
      sentence: 'a layout navigate needs a scope — use "layout:dashboard", not bare "layout:"',
    });
    view.dispose();
  });

  it('REFUSES A NOTE WITH NO WORDS at the door, and nothing is dispatched — the one thing the session cannot see', async () => {
    const { impl, calls } = fakePost();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    const out = await view.setLayoutNote({ scope: 'protein-desk', prop: 'panes', value: 'a,b', words: '   ' });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.sentence).toBe('a layout note needs the words that say what it did — a rail is the only account a reader has of an act, and this door will not write them for you');
    expect(calls.filter((c) => c.url === '/api/dispatch')).toHaveLength(0);
    view.dispose();
  });
});

describe('setLayoutNote — a REAL session answers the door in its own words', () => {
  async function liveNoteView() {
    const { buildDashboard } = await import('vizfootprint/agent');
    const dashboard = buildDashboard({
      meta: { title: 'ui layout note integration' },
      data: { data: { rows: [{ id: 'a', price: 20 }] } },
      actors: { scatter: { actor: 'user', label: 'Scatter' } },
      defaultTable: 'data',
    });
    return createSessionView(sessionSource(dashboard.createSession({ as: 'user' })), { as: 'user' });
  }

  it('a scope nobody named, a prop nobody named, and a value the session will not carry each come back with the SESSION’s sentence', async () => {
    const view = await liveNoteView();
    await view.refresh();
    const bare = await view.setLayoutNote({ scope: '', prop: 'panes', value: 'a', words: 'rearranged the desk' });
    expect(bare.ok === false && bare.sentence).toContain('needs a scope');
    const noProp = await view.setLayoutNote({ scope: 'desk', prop: '   ', value: 'a', words: 'rearranged the desk' });
    expect(noProp.ok === false && noProp.sentence).toContain('needs a field');
    const tooLong = await view.setLayoutNote({ scope: 'desk', prop: 'panes', value: 'x'.repeat(501), words: 'rearranged the desk' });
    expect(tooLong.ok === false && tooLong.sentence).toContain('too long');
    // and nothing landed for any of the three
    expect(view.getState().commits).toHaveLength(0);
    view.dispose();
  });

  it('a scope this library never heard of lands, folds and reads back — which is the whole point of the door', async () => {
    const view = await liveNoteView();
    await view.refresh();
    expect(await view.setLayoutNote({ scope: 'protein-desk', prop: 'panes', value: 'surface,contacts', words: 'moved the contacts beside the surface' })).toEqual({ ok: true });
    const s = view.getState();
    expect(s.layouts?.['protein-desk']).toEqual({ panes: 'surface,contacts' });
    expect(s.commits[0]!.intent).toBe('moved the contacts beside the surface');
    // INERT, and said out loud: a desk's arrangement moved no row's standing
    expect(s.selections).toEqual([]);
    view.dispose();
  });

  it('A FILTER DOOR REFUSES A LAYOUT NOTE AT THE TYPE LEVEL, and at run time', async () => {
    const view = await liveNoteView();
    await view.refresh();
    // @ts-expect-error a `layout:${scope}` identity is `never` at a filter door (src/branches/fold.ts · DataViewId)
    await view.emit('layout:dashboard', { rawValue: 1, encoding: { kind: 'point', field: 'price' } });
    // @ts-expect-error the same law at the clear door
    await view.clear('layout:dashboard');
    // …and the run-time half, for an id no type could have seen: nothing landed
    const built = ['layout', 'dashboard'].join(':');
    await view.emit(built, { rawValue: 1, encoding: { kind: 'point', field: 'price' } });
    expect(view.getState().commits).toHaveLength(0);
    expect(view.getState().selections).toEqual([]);
    view.dispose();
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

  it('BYTE IDENTITY: an order of ids holding no separator posts exactly the bytes it always posted', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.setLayout({ order: ['bar', 'scatter', 'map'] });
    expect(calls.filter((c) => c.url === '/api/dispatch').map((c) => c.body)).toEqual([
      { verb: 'navigate', viewId: LAYOUT_DASHBOARD_VIEW_ID, field: 'order', value: 'bar,scatter,map', intent: 'layout order: bar, scatter, map' },
    ]);
    view.dispose();
  });

  it('and an id that HOLDS the separator now round-trips, where the joined list made it two cells', async () => {
    const { impl, calls } = fakeFetch();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.setLayout({ order: ['a,b', 'map'] });
    const body = calls.filter((c) => c.url === '/api/dispatch').map((c) => c.body)[0]!;
    expect(body['value']).toBe('["a,b","map"]');
    // …and the cockpit's own reader gets its two cells back, with their names intact
    expect(parseLayout({ order: String(body['value']) }).order).toEqual(['a,b', 'map']);
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
    const { buildDashboard } = await import('vizfootprint/agent');
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
      commits: () => [],
    };
    const relicView = createSessionView(sessionSource(relic));
    await relicView.refresh();
    expect(relicView.getState().layout).toEqual(defaultLayout());
    relicView.dispose();
    view.dispose();
  });
});
