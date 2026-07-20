// @vitest-environment jsdom
/**
 * The bridge renderer, seam by seam, against REAL vega Views under jsdom
 * (svg renderer — vega's dataflow and signal graph run faithfully headless;
 * text metrics fall back to estimates, and the PIXEL paint settles on
 * microtasks after `view.run()`, so DOM-paint assertions await `runAsync()`
 * while dataflow assertions read synchronously — the honest jsdom/browser
 * split; the real-browser gallery smoke covers live pointer gestures).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { TopLevelSpec } from 'vega-lite';
import { changeset, type View } from 'vega';
import { keepPredicate, selectionForView } from '../../../ui/src/contract/selection.js';
import type { RenderRow, RenderSelection, RenderState, RendererCallbacks } from '../../../ui/src/contract/types.js';
import { bindRenderer } from '../../../ui/src/contract/bind.js';
import type { SelectionView } from '../../../ui/src/adapter/types.js';
import { foldKeep, vegaLiteRenderer, VEGA_LITE_DATA_NAME, VEGA_LITE_KEEP_FIELD } from './vegaLiteRenderer.js';
import { VegaLiteSpecError } from './specGate.js';

beforeAll(() => {
  // jsdom has no canvas; vega estimates text metrics without one — stub the
  // probe so jsdom's "not implemented" noise never hits the test log
  (HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext = () => null;
});

const ROWS: RenderRow[] = Array.from({ length: 12 }, (_, i) => ({
  id: `d${String(i + 1).padStart(2, '0')}`,
  category: ['Casual', 'Formal', 'Party'][i % 3]!,
  price: 60 + i * 20,
  rating: (i % 5) + 1,
  date: `2026-05-${String(i + 1).padStart(2, '0')}`,
}));

const BRUSH_SPEC: TopLevelSpec = {
  mark: 'circle',
  params: [{ name: 'vzfBrush', select: { type: 'interval', encodings: ['x'] } }],
  encoding: {
    x: { field: 'price', type: 'quantitative' },
    y: { field: 'rating', type: 'quantitative' },
  },
} as unknown as TopLevelSpec;

const POINT_SPEC: TopLevelSpec = {
  mark: 'tick',
  params: [{ name: 'vzfPick', select: { type: 'point', fields: ['category'] } }],
  encoding: {
    x: { field: 'price', type: 'quantitative' },
    y: { field: 'category', type: 'nominal' },
  },
} as unknown as TopLevelSpec;

const EVERYTHING_SPEC: TopLevelSpec = {
  mark: 'circle',
  params: [
    { name: 'vzfBrush', select: { type: 'interval', encodings: ['x'] } },
    { name: 'vzfPick', select: { type: 'point', fields: ['category'] } },
    { name: 'vzfGrid', select: 'interval', bind: 'scales' },
  ],
  encoding: {
    x: { field: 'price', type: 'quantitative' },
    y: { field: 'date', type: 'temporal' },
  },
} as unknown as TopLevelSpec;

function noopCallbacks(): RendererCallbacks & { emissions: unknown[]; navigations: unknown[] } {
  const emissions: unknown[] = [];
  const navigations: unknown[] = [];
  return {
    emissions,
    navigations,
    emit: (e) => emissions.push(e),
    hover: () => {},
    reencodeRequest: () => {},
    navigate: (v) => navigations.push(v),
  };
}

function emptySelection(self: string | null = 'vl'): RenderSelection {
  return { clauses: new Map(), resolve: 'intersect', selfClauseId: self };
}

function state(overrides: Partial<RenderState> = {}): RenderState {
  return {
    rows: ROWS,
    encodings: {},
    selection: emptySelection(),
    hover: null,
    theme: {},
    size: { width: 400, height: 300 },
    ...overrides,
  };
}

/** A host-shaped selection over adapter SelectionView rows (the real derivation). */
function hostSelection(selections: readonly SelectionView[], self: string | null): RenderSelection {
  return selectionForView(selections, self);
}

const OTHER_PRICE_CLAUSE: SelectionView = {
  viewId: 'other',
  kind: 'interval',
  field: 'price',
  value: [40, 200],
};

function mountBridge(spec: TopLevelSpec, opts: { debounceMs?: number } = {}) {
  let view!: View;
  const renderer = vegaLiteRenderer(spec, {
    debounceMs: opts.debounceMs ?? 30,
    onView: (v) => {
      view = v;
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const callbacks = noopCallbacks();
  const mounted = renderer.mount(el, { protocolVersion: '1.0', viewId: 'vl', callbacks });
  return { renderer, el, callbacks, mounted, view: () => view };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pointerUp = () => window.dispatchEvent(new Event('pointerup'));

// ── the factory's typed refusals ────────────────────────────────────────────────

describe('vegaLiteRenderer — the factory throws typed VegaLiteSpecError for unsupported specs', () => {
  it.each([
    ['multi-view', { hconcat: [] }],
    ['no mark', {}],
    ['a 2-axis brush', { mark: 'circle', params: [{ name: 'b', select: 'interval' }] }],
    ['a mute spec', { mark: 'circle', params: [] }],
  ])('%s', (_label, spec) => {
    let caught: unknown;
    try {
      vegaLiteRenderer(spec as unknown as TopLevelSpec);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VegaLiteSpecError);
    expect((caught as VegaLiteSpecError).issues.length).toBeGreaterThan(0);
  });
});

// ── the transforms path: declared in the hello, refused by the HOST ────────────

describe('a transform-carrying spec declares its transforms — the host refuses the bind', () => {
  const TRANSFORM_SPEC = {
    mark: 'bar',
    transform: [{ aggregate: [{ op: 'count', as: 'n' }], groupby: ['category'] }],
    params: [{ name: 'p', select: { type: 'point', fields: ['category'] } }],
    encoding: { x: { field: 'category', type: 'nominal' }, y: { field: 'n', type: 'quantitative' } },
  } as unknown as TopLevelSpec;

  it('bindRenderer lands the typed transforms-not-owned gap and unmounts the probe', () => {
    const renderer = vegaLiteRenderer(TRANSFORM_SPEC);
    const el = document.createElement('div');
    const res = bindRenderer(renderer, el, { viewId: 'vl', callbacks: noopCallbacks() });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap.code).toBe('transforms-not-owned');
      expect(res.gap.detail).toContain('aggregate');
    }
    expect(el.childElementCount).toBe(0);
  });

  it('driving update() past the refusal throws, never a silent no-op', () => {
    const renderer = vegaLiteRenderer(TRANSFORM_SPEC);
    const mounted = renderer.mount(document.createElement('div'), {
      protocolVersion: '1.0',
      viewId: 'vl',
      callbacks: noopCallbacks(),
    });
    expect(mounted.hello.transforms).toEqual(['aggregate']);
    expect(() => mounted.update(state())).toThrow(VegaLiteSpecError);
    mounted.unmount(); // a no-op — nothing was mounted
  });
});

// ── capabilities are read off the spec ──────────────────────────────────────────

describe('capability derivation', () => {
  it('brush + point + bind:scales → the full honest table', () => {
    const { mounted } = mountBridge(EVERYTHING_SPEC);
    expect(mounted.hello.protocolVersion).toBe('1.0');
    expect(mounted.hello.transforms).toEqual([]);
    expect(mounted.hello.capabilities).toEqual({
      canBrush: true,
      canPointSelect: true,
      canHighlight: true,
      canReencode: false,
      canPanZoom: true,
      emissionKinds: ['point', 'interval'],
    });
    mounted.unmount();
  });

  it('a brush-only spec: interval only, no pan/zoom', () => {
    const { mounted } = mountBridge(BRUSH_SPEC);
    expect(mounted.hello.capabilities.canBrush).toBe(true);
    expect(mounted.hello.capabilities.canPointSelect).toBe(false);
    expect(mounted.hello.capabilities.canPanZoom).toBe(false);
    expect(mounted.hello.capabilities.emissionKinds).toEqual(['interval']);
    mounted.unmount();
  });

  it('D29: the bridge NEVER declares the cell kind — a VL spec has no compound two-field gesture to derive', () => {
    // even the everything-spec (brush + point + scales) derives only the two
    // classic kinds; the gate admits one-axis intervals and one-field points,
    // so an honest 'cell' can never appear in the hello
    const { mounted } = mountBridge(EVERYTHING_SPEC);
    expect(mounted.hello.capabilities.emissionKinds).not.toContain('cell');
    mounted.unmount();
  });
});

// ── mount / update / unmount lifecycle ─────────────────────────────────────────

describe('mount → update → unmount', () => {
  it('a detached document has no window to hear pointer-up in — mount throws', () => {
    const detached = document.implementation.createHTMLDocument('detached');
    const el = detached.createElement('div');
    expect(() =>
      vegaLiteRenderer(BRUSH_SPEC).mount(el, { protocolVersion: '1.0', viewId: 'vl', callbacks: noopCallbacks() }),
    ).toThrow('window-attached');
  });

  it('update draws host rows; the injected keep-opacity encode dims under a NON-self clause', async () => {
    const { el, mounted, view } = mountBridge(BRUSH_SPEC);
    expect(el.querySelector('[data-vzf="vega-lite"]')).toBeTruthy(); // the bridge frame, synchronously

    mounted.update(state({ selection: hostSelection([OTHER_PRICE_CLAUSE], 'vl') }));
    // the dataflow is synchronous: the stamped keep flags are already readable
    const data = view().data(VEGA_LITE_DATA_NAME) as Record<string, unknown>[];
    expect(data).toHaveLength(12);
    expect(data.filter((d) => d[VEGA_LITE_KEEP_FIELD] === false)).toHaveLength(4); // prices 220–280
    // the PAINT settles async — await it, then the dim is visible in the svg
    await view().runAsync();
    const dimmed = Array.from(el.querySelectorAll('svg path')).filter((p) => p.getAttribute('opacity') === '0.25');
    expect(dimmed).toHaveLength(4);
    mounted.unmount();
    expect(el.childElementCount).toBe(0); // the frame (and vega inside it) is gone
  });

  it("the view's OWN clause is self-excluded (dim under everyone's brush but my own)", () => {
    const { mounted, view } = mountBridge(BRUSH_SPEC);
    const own: SelectionView = { viewId: 'vl', kind: 'interval', field: 'price', value: [60, 80] };
    mounted.update(state({ selection: hostSelection([own], 'vl') }));
    const data = view().data(VEGA_LITE_DATA_NAME) as Record<string, unknown>[];
    expect(data.every((d) => d[VEGA_LITE_KEEP_FIELD] === true)).toBe(true); // own clause never dims itself
    mounted.unmount();
  });

  it('theme tokens land as CSS variables on the frame; size changes reach the painted svg (autosize fit)', async () => {
    const { el, mounted, view } = mountBridge(BRUSH_SPEC);
    mounted.update(state({ theme: { '--vzf-brand': '#7c5cff' }, size: { width: 520, height: 320 } }));
    const frame = el.querySelector('[data-vzf="vega-lite"]') as HTMLElement;
    expect(frame.style.getPropertyValue('--vzf-brand')).toBe('#7c5cff');
    await view().runAsync(); // the paint settles async; fit resolves the OUTER box to the given size
    const svg = el.querySelector('svg')!;
    expect(Number(svg.getAttribute('width'))).toBe(520);
    expect(Number(svg.getAttribute('height'))).toBe(320);
    mounted.unmount();
  });

  it('an unchanged rows+selection update SKIPS the data push (one pulse per real change)', () => {
    const { mounted, view } = mountBridge(BRUSH_SPEC);
    let pushes = 0;
    view().addDataListener(VEGA_LITE_DATA_NAME, () => {
      pushes += 1;
    });
    const s = state();
    mounted.update(s);
    mounted.update(s); // same rows reference, same keep fold — skipped
    expect(pushes).toBe(1);
    mounted.update(state({ rows: [...ROWS] })); // a NEW host rows array — pushed
    expect(pushes).toBe(2);
    // same rows reference but a keep-changing selection — pushed
    mounted.update(state({ rows: ROWS, selection: hostSelection([OTHER_PRICE_CLAUSE], 'vl') }));
    expect(pushes).toBe(2 + 1);
    mounted.unmount();
  });

  it('update() after unmount throws; a second unmount is a no-op', () => {
    const { mounted } = mountBridge(BRUSH_SPEC);
    mounted.unmount();
    expect(() => mounted.update(state())).toThrow('after unmount');
    mounted.unmount(); // idempotent
  });
});

// ── the synthesized interval completion, end to end on a real view ─────────────

describe('interval emissions ride the synthesized completion signal', () => {
  it('N interim brush signals + pointer-up → exactly ONE emission; repeats dedupe; clear emits null once', async () => {
    const { mounted, callbacks, view } = mountBridge(BRUSH_SPEC);
    mounted.update(state());
    await view().runAsync();

    // the drag: five interim updates, no emission yet
    for (const px of [80, 120, 160, 200, 240]) {
      view().signal('vzfBrush_x', [40, px]);
      view().run();
    }
    expect(callbacks.emissions).toHaveLength(0); // mid-gesture: the commit log hears nothing
    pointerUp();
    expect(callbacks.emissions).toHaveLength(1);
    const emission = callbacks.emissions[0] as { rawValue: [number, number]; encoding: { kind: string; field: string } };
    expect(emission.encoding).toEqual({ kind: 'interval', field: 'price' });
    expect(emission.rawValue[0]).toBeLessThan(emission.rawValue[1]);

    // the same settled value completing again (pointer-up on the same range) — deduped
    view().signal('vzfBrush_x', [40, 240]);
    view().run();
    pointerUp();
    expect(callbacks.emissions).toHaveLength(1);

    // clearing the brush emits null ONCE; clearing again is silent
    view().signal('vzfBrush_x', [0, 0]);
    view().run();
    pointerUp();
    expect(callbacks.emissions).toHaveLength(2);
    expect((callbacks.emissions[1] as { rawValue: unknown }).rawValue).toBeNull();
    view().signal('vzfBrush_x', [0, 0]);
    view().run();
    pointerUp();
    expect(callbacks.emissions).toHaveLength(2);
    mounted.unmount();
  });

  it('the debounce fallback completes a pointer-less (agent-driven) gesture', async () => {
    const { mounted, callbacks, view } = mountBridge(BRUSH_SPEC, { debounceMs: 25 });
    mounted.update(state());
    await view().runAsync();
    view().signal('vzfBrush_x', [40, 240]);
    view().run();
    expect(callbacks.emissions).toHaveLength(0);
    await sleep(80);
    expect(callbacks.emissions).toHaveLength(1);
    mounted.unmount();
  });

  it('a cleared-at-rest view emits nothing (init noise is not a gesture)', async () => {
    const { mounted, callbacks, view } = mountBridge(BRUSH_SPEC, { debounceMs: 25 });
    mounted.update(state());
    await view().runAsync();
    pointerUp();
    await sleep(80);
    expect(callbacks.emissions).toHaveLength(0);
    mounted.unmount();
  });

  it('a completed gesture whose brush NEVER held a value flushes nothing (first-ever flush, still cleared)', async () => {
    const { mounted, callbacks, view } = mountBridge(BRUSH_SPEC, { debounceMs: 25 });
    mounted.update(state());
    await view().runAsync();
    // the interval param's OWN composite signal, set directly to an explicit
    // empty object — a real signal tick (noteUpdate fires, dirty=true) that
    // resolves to "still cleared": raw stays null on the very first flush,
    // distinct from the clear-AFTER-a-value path the dedupe test covers
    view().signal('vzfBrush', {});
    view().run();
    pointerUp();
    expect(callbacks.emissions).toHaveLength(0);
    mounted.unmount();
  });

  it("update()'s own signal echoes never emit (the applying flag) — host pushes are not gestures", async () => {
    const { mounted, callbacks, view } = mountBridge(BRUSH_SPEC, { debounceMs: 25 });
    mounted.update(state());
    await view().runAsync();
    view().signal('vzfBrush_x', [40, 240]);
    view().run();
    pointerUp();
    expect(callbacks.emissions).toHaveLength(1);
    // the host answers with new (narrower) rows — brush signals may recompute
    mounted.update(state({ rows: ROWS.slice(0, 6), selection: hostSelection([OTHER_PRICE_CLAUSE], 'vl') }));
    await sleep(80);
    expect(callbacks.emissions).toHaveLength(1); // no phantom gesture from the host's own update
    mounted.unmount();
  });
});

// ── point emissions are discrete (no completion needed) ────────────────────────

describe('point emissions', () => {
  it('a point signal that fires still-cleared (never held a value) is inert — no init-noise emission', async () => {
    const { mounted, callbacks, view } = mountBridge(POINT_SPEC);
    mounted.update(state());
    await view().runAsync();
    view().signal('vzfPick', {}); // a real signal tick, resolves to null on the very first firing
    view().run();
    expect(callbacks.emissions).toHaveLength(0);
    mounted.unmount();
  });

  it('a genuine store change that still resolves to the SAME most-recent value is deduped', async () => {
    const { mounted, callbacks, view } = mountBridge(POINT_SPEC);
    mounted.update(state());
    await view().runAsync();
    const fields = view().signal('vzfPick_tuple_fields') as unknown;
    view().change('vzfPick_store', changeset().insert([{ unit: '', fields, values: ['Formal'] }]));
    view().run();
    expect(callbacks.emissions).toHaveLength(1);
    // a SECOND, distinct tuple joins the store (a real signal pulse — the
    // toggle set itself changed) whose MOST RECENT value is still 'Formal':
    // the listener genuinely refires, but the resolved emission is identical
    view().change('vzfPick_store', changeset().insert([{ unit: '', fields, values: ['Formal'] }]));
    view().run();
    expect(callbacks.emissions).toHaveLength(1);
    mounted.unmount();
  });

  it('a toggle set emits its most recent value immediately; clearing emits null once', async () => {
    const { mounted, callbacks, view } = mountBridge(POINT_SPEC);
    mounted.update(state());
    await view().runAsync();

    const fields = view().signal('vzfPick_tuple_fields') as unknown;
    view().change('vzfPick_store', changeset().insert([{ unit: '', fields, values: ['Formal'] }]));
    view().run();
    expect(callbacks.emissions).toHaveLength(1);
    expect(callbacks.emissions[0]).toEqual({ rawValue: 'Formal', encoding: { kind: 'point', field: 'category' } });

    // a second toggle joins the store — the MOST RECENT value wins (one clause per view)
    view().change('vzfPick_store', changeset().insert([{ unit: '', fields, values: ['Party'] }]));
    view().run();
    expect(callbacks.emissions).toHaveLength(2);
    expect((callbacks.emissions[1] as { rawValue: unknown }).rawValue).toBe('Party');

    // clearing the store emits null once; the same cleared state never re-emits
    view()
      .change('vzfPick_store', changeset().remove(() => true))
      .run();
    expect(callbacks.emissions).toHaveLength(3);
    expect((callbacks.emissions[2] as { rawValue: unknown }).rawValue).toBeNull();
    mounted.unmount();
  });
});

// ── pan/zoom rides navigate, per channel, debounced ────────────────────────────

describe('bind:scales → the navigate verb', () => {
  it('a zoom gesture records ONE channel-keyed view state (ISO strings on the temporal axis)', async () => {
    const { mounted, callbacks, view } = mountBridge(EVERYTHING_SPEC, { debounceMs: 25 });
    mounted.update(state());
    await view().runAsync();
    const mayDays = (d: number) => Date.UTC(2026, 4, d);
    // the summary signal is derived from the param's store — a programmatic
    // pan/zoom drives the COMPONENT domain signals, exactly like vega's own
    // pan/zoom expressions do
    view().signal('vzfGrid_price', [80, 200]);
    view().signal('vzfGrid_date', [mayDays(2), mayDays(9)]);
    view().run();
    view().signal('vzfGrid_price', [90, 190]);
    view().signal('vzfGrid_date', [mayDays(3), mayDays(8)]);
    view().run();
    expect(callbacks.navigations).toHaveLength(0); // mid-gesture
    pointerUp();
    expect(callbacks.navigations).toHaveLength(1);
    expect(callbacks.navigations[0]).toEqual({ x: [90, 190], y: ['2026-05-03', '2026-05-08'] });

    // the same settled domain completing again — deduped
    view().signal('vzfGrid', { price: [90, 190], date: [mayDays(3), mayDays(8)] });
    view().run();
    pointerUp();
    expect(callbacks.navigations).toHaveLength(1);
    mounted.unmount();
  });

  it('an empty domain signal records nothing', async () => {
    const { mounted, callbacks, view } = mountBridge(EVERYTHING_SPEC, { debounceMs: 25 });
    mounted.update(state());
    await view().runAsync();
    view().signal('vzfGrid', {});
    view().run();
    pointerUp();
    await sleep(60);
    expect(callbacks.navigations).toHaveLength(0);
    mounted.unmount();
  });
});

// ── the selection fold: parity with the host's own keepPredicate, pinned ───────

describe('foldKeep — parity with ui keepPredicate (the fold is contract semantics, not a re-evaluator)', () => {
  const SELECTIONS: SelectionView[] = [
    { viewId: 'a', kind: 'interval', field: 'price', value: [100, 220] },
    { viewId: 'b', kind: 'point', field: 'category', value: 'Casual' },
    { viewId: 'vl', kind: 'interval', field: 'rating', value: [1, 2] },
  ];

  it('intersect + self-exclusion matches keepPredicate row for row', () => {
    const selection = selectionForView(SELECTIONS, 'vl');
    const ours = foldKeep(selection);
    const theirs = keepPredicate(selection);
    for (const row of ROWS) expect(ours(row)).toBe(theirs(row));
  });

  it('union resolve matches too', () => {
    const selection = selectionForView(SELECTIONS, 'vl', 'union');
    const ours = foldKeep(selection);
    const theirs = keepPredicate(selection);
    for (const row of ROWS) expect(ours(row)).toBe(theirs(row));
    // and the union arm actually differs from intersect on this matrix
    expect(ROWS.map(ours)).not.toEqual(ROWS.map(foldKeep(selectionForView(SELECTIONS, 'vl'))));
  });

  it('no non-self clauses → keep everything', () => {
    const onlySelf = selectionForView([SELECTIONS[2]!], 'vl');
    const keep = foldKeep(onlySelf);
    expect(ROWS.every((r) => keep(r))).toBe(true);
  });
});
