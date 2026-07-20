// @vitest-environment jsdom
/**
 * The conformance kit against a REAL scripted session (the gallery-smoke
 * discipline — a live `InteractionSession`, never a mocked loop):
 *
 *   - ALL SIX first-party renderers (scatter · line · bar · map · table ·
 *     histogram) pass the full loop — the reference claim is proven, not
 *     asserted;
 *   - a synthetic canPanZoom renderer proves the navigate-records +
 *     non-filtering arm;
 *   - a bestiary of HOSTILE renderers proves the kit actually catches every
 *     contract violation: declared transforms, version lies, garbage
 *     versions, bad emission kinds, empty renders, throwing updates, silent
 *     gestures, undeclared emission kinds, unaddressable self clauses,
 *     static re-renders, dirty unmounts, and commits that never land.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { fireEvent } from '@testing-library/dom';

// jsdom ships no PointerEvent — polyfill it as a MouseEvent subclass so the
// scatter/line brush handlers receive clientX/pointerId (charts.test.tsx pattern).
beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    class PE extends MouseEvent {
      pointerId: number;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 1;
      }
    }
    (window as unknown as { PointerEvent: typeof PE }).PointerEvent = PE;
  }
});

import { buildDashboard } from '../../../src/agent/index.js';
import { equalWidthBins, recountBins } from '../../../src/data/index.js';
import type { Cause } from '../../../src/cause/index.js';
import { createSessionView, sessionSource, type SessionView } from '../adapter/sessionView.js';
import type { SessionViewState } from '../adapter/types.js';
import { runConformance, type ConformancePlan, type ConformanceReport } from './conformance.js';
import { bindRenderer } from './bind.js';
import { selectionForView, keepPredicate } from './selection.js';
import { scatterRenderer, lineRenderer, barRenderer, mapRenderer, tableRenderer, histogramRenderer, heatmapRenderer } from './renderers.js';
import {
  RENDERER_PROTOCOL_VERSION,
  type ChartEmission,
  type Renderer,
  type RendererCapabilities,
  type RenderRow,
  type RenderState,
} from './types.js';
import type { GeoFeatureCollection } from '../charts/VizMap.js';

// ── the scripted fixture ────────────────────────────────────────────────────────

const CATS = ['Casual', 'Formal', 'Party'] as const;
const REGIONS = ['North', 'South', 'Isles'] as const;

/** 12 deterministic rows: id/category/price/rating/date/region. */
const ROWS: RenderRow[] = Array.from({ length: 12 }, (_, i) => ({
  id: `d${String(i + 1).padStart(2, '0')}`,
  category: CATS[i % 3]!,
  price: 60 + i * 20,
  rating: (i % 5) + 1,
  date: `2026-05-${String(i + 1).padStart(2, '0')}`,
  region: REGIONS[i % 3]!,
}));

const GEO: GeoFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'North' }, geometry: { type: 'Polygon', coordinates: [[[0, 6], [8, 6], [8, 10], [0, 10], [0, 6]]] } },
    { type: 'Feature', properties: { name: 'South' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [8, 0], [8, 6], [0, 6], [0, 0]]] } },
    { type: 'Feature', properties: { name: 'Isles' }, geometry: { type: 'Polygon', coordinates: [[[9, 1], [11, 1], [11, 6], [9, 6], [9, 1]]] } },
  ],
};

function cause(requestedBy: 'user' | 'agent', intent: string): Cause {
  return { requestedBy, computedBy: requestedBy, intent };
}

/** A REAL session with every fixture view declared, plus one scripted agent clause on 'other'. */
async function buildFixture(): Promise<{ view: SessionView }> {
  const dashboard = buildDashboard({
    meta: { title: 'conformance fixture' },
    data: { data: { rows: ROWS as Record<string, unknown>[] } },
    actors: {
      scatter: { actor: 'user', label: 'Price × rating' },
      line: { actor: 'user', label: 'Price over time' },
      bar: { actor: 'user', label: 'Category' },
      map: { actor: 'user', label: 'Rows by region' },
      table: { actor: 'user', label: 'Rows' },
      histogram: { actor: 'user', label: 'Price distribution' },
      heatmap: { actor: 'user', label: 'Price × category heatmap' },
      other: { actor: 'agent', label: 'The scripted co-driver' },
      zoomy: { actor: 'user', label: 'A pan/zoom-capable view' },
      dirty: { actor: 'user', label: 'A view with a dirty unmount' },
      clearer: { actor: 'user', label: 'A view whose gesture clears' },
      static: { actor: 'user', label: 'A view that never re-renders' },
    },
    encodings: [
      { viewId: 'scatter', chartKind: 'point', channels: ['x', 'y', 'color'], initial: { x: 'price', y: 'rating' } },
      { viewId: 'line', chartKind: 'line', channels: ['x', 'y', 'color'], initial: { x: 'date', y: 'price' } },
      { viewId: 'bar', chartKind: 'bar', channels: ['category'], initial: { category: 'category' } },
      { viewId: 'map', chartKind: 'map', channels: ['region'], initial: { region: 'region' } },
      { viewId: 'histogram', chartKind: 'histogram', channels: ['x'], initial: { x: 'price' } },
      { viewId: 'heatmap', chartKind: 'heatmap', channels: ['x', 'y'], initial: { x: 'price', y: 'category' } },
    ],
    defaultTable: 'data',
  });
  const session = dashboard.createSession({ as: 'user' });
  // one pre-existing clause from ANOTHER view, agent-authored — the loop's other voice
  await session.dispatch(
    { verb: 'filter', viewId: 'other', field: 'price', range: [40, 400], cause: cause('agent', 'scripted price window') },
    { as: 'agent' },
  );
  const view = createSessionView(sessionSource(session), { as: 'user' });
  await view.refresh();
  return { view };
}

function mountEl(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}
afterEach(() => {
  document.body.innerHTML = '';
});

const SIZE = { width: 520, height: 340 };
const THEME = { '--vzf-brand': '#7c5cff' };

// HOST-owned state shaping, per view (rows crossfiltered/aggregated by the host)
function stateFor(viewId: string, st: SessionViewState): RenderState {
  const selection = selectionForView(st.selections, viewId);
  const keep = keepPredicate(selection);
  if (viewId === 'bar') {
    const rows = CATS.map((category) => ({ category, count: ROWS.filter((r) => r.category === category && keep(r)).length }));
    return { rows, encodings: { category: 'category' }, selection, hover: null, theme: THEME, size: SIZE };
  }
  if (viewId === 'map') {
    const rows = REGIONS.map((region) => ({ region, value: ROWS.filter((r) => r.region === region && keep(r)).length }));
    return { rows, encodings: { region: 'region' }, selection, hover: null, theme: THEME, size: SIZE };
  }
  if (viewId === 'line') {
    return { rows: ROWS.filter(keep), encodings: st.encodings['line'] ?? {}, selection, hover: null, theme: THEME, size: SIZE };
  }
  if (viewId === 'histogram') {
    // HOST-owned binning (src/data): fixed edges over ALL rows, counts under the keep
    const all = equalWidthBins(ROWS.map((r) => r.price as number));
    const rows = recountBins(all, ROWS.filter(keep).map((r) => r.price as number)).bins.map((b) => ({ ...b }));
    return { rows, encodings: st.encodings['histogram'] ?? {}, selection, hover: null, theme: THEME, size: SIZE };
  }
  if (viewId === 'heatmap') {
    // HOST-owned 2-D binning (D29): the same fixed x edges for EVERY category
    // row, counts recomputed under the keep — one row per (bucket, category)
    const all = equalWidthBins(ROWS.map((r) => r.price as number), { buckets: 4 });
    const rows = CATS.flatMap((category) =>
      recountBins(all, ROWS.filter((r) => r.category === category && keep(r)).map((r) => r.price as number)).bins.map(
        (b) => ({ x0: b.x0, x1: b.x1, y: category, count: b.count }),
      ),
    );
    return { rows, encodings: st.encodings['heatmap'] ?? {}, selection, hover: null, theme: THEME, size: SIZE };
  }
  // scatter, table, and the synthetic fixtures read the raw rows
  return { rows: ROWS, encodings: st.encodings[viewId] ?? {}, selection, hover: null, theme: THEME, size: SIZE };
}

function brushGesture(selector: string) {
  return (el: HTMLElement): void => {
    const svg = el.querySelector(selector)!;
    fireEvent.pointerDown(svg, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 300, pointerId: 1 });
  };
}

async function runFor(renderer: Renderer, viewId: string, extras: Partial<ConformancePlan>): Promise<ConformanceReport> {
  const { view } = await buildFixture();
  const report = await runConformance({
    renderer,
    viewId,
    el: mountEl(),
    view,
    buildState: (st) => stateFor(viewId, st),
    gesture: () => {},
    ...extras,
  });
  return report;
}

/** Pretty failure dump so a red run names the exact step in plain words. */
function explain(report: ConformanceReport): string {
  return report.steps.map((s) => `${s.ok ? '✓' : '✗'} ${s.step}: ${s.detail}`).join('\n');
}

// ── the five first-party reference renderers PASS the full loop ────────────────

describe('conformance — all six first-party charts pass (the reference claim, proven)', () => {
  it('VizScatter (interval brush + an axis reencodeRequest riding the same handshake)', async () => {
    const report = await runFor(scatterRenderer(), 'scatter', {
      gesture: (el) => {
        // the re-encode affordance asks the HOST through the contract callback…
        fireEvent.click(el.querySelector('[data-axis-channel="y"]')!);
        // …and the brush is the selecting gesture
        brushGesture('svg.vzf-scatter')(el);
      },
    });
    expect(report.ok, explain(report)).toBe(true);
    expect(report.steps).toHaveLength(10);
    // a renderer with no cell declaration skips the D29 arm honestly
    expect(report.steps.find((s) => s.step === 'cell')!.detail).toContain('honestly skipped');
    expect(report.emissions[0]!.encoding.kind).toBe('interval');
    expect(report.reencodeRequests).toEqual(['y']); // the host owns the picker — the request was surfaced, not swallowed
    // the five are canPanZoom:false — the ONLY contract gap is the navigate one, typed
    expect(report.gaps.map((g) => g.code)).toEqual(['navigate-unsupported']);
  });

  it('VizLine (date-interval brush)', async () => {
    const report = await runFor(lineRenderer(), 'line', { gesture: brushGesture('svg.vzf-line') });
    expect(report.ok, explain(report)).toBe(true);
    const [emission] = report.emissions;
    expect(emission!.encoding).toEqual({ kind: 'interval', field: 'date' });
    const range = emission!.rawValue as unknown as [string, string];
    expect(range[0] < range[1]).toBe(true); // ISO bounds, snapped to real data dates
  });

  it('VizBar (point select on the category)', async () => {
    const report = await runFor(barRenderer(), 'bar', {
      gesture: (el) => {
        fireEvent.click(el.querySelector('rect.vzf-barrect')!);
      },
      verifyUpdate: (el) => el.querySelector('rect.vzf-selected') !== null,
    });
    expect(report.ok, explain(report)).toBe(true);
    expect(report.emissions[0]).toEqual({ rawValue: 'Casual', encoding: { kind: 'point', field: 'category' } });
  });

  it('VizMap (point select on a region)', async () => {
    const report = await runFor(mapRenderer({ geo: GEO }), 'map', {
      gesture: (el) => {
        fireEvent.click(el.querySelector('path.vzf-region')!);
      },
      verifyUpdate: (el) => el.querySelector('path.vzf-selected') !== null,
    });
    expect(report.ok, explain(report)).toBe(true);
    expect(report.emissions[0]).toEqual({ rawValue: 'North', encoding: { kind: 'point', field: 'region' } });
  });

  it('VizHistogram (bucket-snapping interval brush over HOST-computed bins)', async () => {
    const report = await runFor(histogramRenderer(), 'histogram', {
      gesture: brushGesture('svg.vzf-histogram'),
      verifyUpdate: (el) => el.querySelector('rect.vzf-histbar.vzf-selected') !== null,
    });
    expect(report.ok, explain(report)).toBe(true);
    const [emission] = report.emissions;
    expect(emission!.encoding).toEqual({ kind: 'interval', field: 'price' });
    // the interval is SNAPPED to bucket edges the HOST computed: equal width
    // 22 over the fixture's price range [60, 280] (10 buckets)
    const [lo, hi] = emission!.rawValue as [number, number];
    expect(lo).toBeLessThan(hi);
    expect((lo - 60) % 22).toBe(0);
    expect((hi - 60) % 22).toBe(0);
  });

  it('VizHeatmap (the D29 cell arm: one cell click = ONE compound two-field commit)', async () => {
    const report = await runFor(heatmapRenderer(), 'heatmap', {
      gesture: (el) => {
        fireEvent.click(el.querySelector('[data-cell="60|Casual"]')!);
      },
      // the cell arm clicks a DIFFERENT cell (the same one again would clear)
      cellGesture: (el) => {
        fireEvent.click(el.querySelector('[data-cell="115|Formal"]')!);
      },
      verifyUpdate: (el) => el.querySelector('rect.vzf-heatcell.vzf-selected') !== null,
    });
    expect(report.ok, explain(report)).toBe(true);
    // the base gesture emitted the compound: both fields, one emission
    expect(report.emissions[0]).toEqual({
      rawValue: [[60, 115], 'Casual'],
      encoding: { kind: 'cell', fields: ['price', 'category'] },
    });
    const cellStep = report.steps.find((s) => s.step === 'cell')!;
    expect(cellStep.ok).toBe(true);
    expect(cellStep.detail).toContain('ONE compound cell commit');
    expect(cellStep.detail).toContain('price AND category');
  });

  it('VizTable (point select on a row)', async () => {
    const report = await runFor(tableRenderer({ columns: ['id', 'category', 'price'] }), 'table', {
      gesture: (el) => {
        fireEvent.click(el.querySelector('tbody tr')!);
      },
      verifyUpdate: (el) => el.querySelector('tr.vzf-selected') !== null,
    });
    expect(report.ok, explain(report)).toBe(true);
    expect(report.emissions[0]).toEqual({ rawValue: 'd01', encoding: { kind: 'point', field: 'id' } });
  });
});

// ── a synthetic contract renderer (no React) proves the framework-agnostic +
//    canPanZoom arms ─────────────────────────────────────────────────────────────

interface StubOptions {
  /** The hello's protocol version; 'echo' answers whatever the host speaks (a liar). */
  readonly version?: string;
  readonly transforms?: readonly string[];
  readonly capabilities?: Partial<RendererCapabilities>;
  readonly renderMode?: 'normal' | 'nothing' | 'throw' | 'static';
  /** What its button click emits (null = an emitting gesture that clears). */
  readonly emission?: ChartEmission;
  /** What its SECOND button (the "cell" probe) emits, in order — the D29 hostile arm. */
  readonly cellEmissions?: readonly ChartEmission[];
  readonly dirtyUnmount?: boolean;
}

/** A minimal hand-rolled renderer — pure DOM, no framework (the contract is framework-agnostic). */
function stubRenderer(options: StubOptions = {}): Renderer {
  const capabilities: RendererCapabilities = {
    canBrush: false,
    canPointSelect: true,
    canHighlight: false,
    canReencode: false,
    canPanZoom: false,
    emissionKinds: ['point'],
    ...options.capabilities,
  };
  return {
    mount(el, handshake) {
      const host = el as HTMLElement;
      const mode = options.renderMode ?? 'normal';
      return {
        hello: {
          protocolVersion: options.version === 'echo' ? handshake.protocolVersion : options.version ?? RENDERER_PROTOCOL_VERSION,
          capabilities,
          ...(options.transforms !== undefined ? { transforms: options.transforms } : {}),
        },
        update(state) {
          if (mode === 'nothing') return;
          if (mode === 'throw') throw new TypeError('this renderer cannot draw');
          let button = host.querySelector('button');
          if (!button) {
            button = document.createElement('button');
            button.textContent = 'probe';
            button.addEventListener('click', () => {
              handshake.callbacks.hover(['probe']); // ephemeral — the kit records, the session never sees it
              if (options.emission) handshake.callbacks.emit(options.emission);
              handshake.callbacks.hover(null);
            });
            host.appendChild(button);
            host.appendChild(document.createElement('span'));
            if (options.cellEmissions) {
              const cellButton = document.createElement('button');
              cellButton.className = 'cell';
              cellButton.textContent = 'cell probe';
              cellButton.addEventListener('click', () => {
                for (const e of options.cellEmissions!) handshake.callbacks.emit(e);
              });
              host.appendChild(cellButton);
            }
          }
          if (mode === 'normal') {
            host.querySelector('span')!.textContent = `rows ${state.rows.length} · clauses ${state.selection.clauses.size}`;
          }
        },
        unmount() {
          if (!options.dirtyUnmount) host.textContent = '';
        },
      };
    },
  };
}

const clickProbe = (el: HTMLElement): void => {
  fireEvent.click(el.querySelector('button')!);
};

describe('conformance — the synthetic canPanZoom renderer (framework-agnostic, navigate arm)', () => {
  it('a canPanZoom renderer passes: navigate is recorded and deliberately non-filtering', async () => {
    const report = await runFor(
      stubRenderer({ capabilities: { canPanZoom: true }, emission: { rawValue: 120, encoding: { kind: 'point', field: 'price' } } }),
      'zoomy',
      { gesture: clickProbe, navigateState: { x: [10, 20], y: ['2026-05-01', '2026-06-01'] } },
    );
    expect(report.ok, explain(report)).toBe(true);
    expect(report.gaps).toEqual([]); // navigate was capable — no gap anywhere
    const nav = report.steps.find((s) => s.step === 'navigate')!;
    expect(nav.detail).toContain('non-filtering');
    expect(report.hovers).toEqual([['probe'], null]); // hover recorded, never committed
  });
});

// ── the hostile bestiary: the kit CATCHES every violation, in plain words ──────

describe('conformance — hostile renderers are caught at the exact step', () => {
  const point = (field: string, value: unknown): ChartEmission => ({ rawValue: value, encoding: { kind: 'point', field } });

  async function expectFailAt(report: ConformanceReport, step: string, detailContains: string): Promise<void> {
    const last = report.steps[report.steps.length - 1]!;
    expect(report.ok).toBe(false);
    expect(last.step, explain(report)).toBe(step);
    expect(last.ok).toBe(false);
    expect(last.detail).toContain(detailContains);
  }

  it('a renderer declaring internal transforms fails transform-ownership', async () => {
    const report = await runFor(stubRenderer({ transforms: ['bin', 'aggregate'] }), 'static', {});
    await expectFailAt(report, 'transform-ownership', 'the host owns aggregation/decimation');
    expect(report.steps[0]).toMatchObject({ step: 'version-guard', ok: true }); // bind's version check fires first, so the alien probe was still refused
  });

  it('a renderer that echoes ANY host version fails the version guard (it must refuse an alien major)', async () => {
    const report = await runFor(stubRenderer({ version: 'echo' }), 'static', {});
    await expectFailAt(report, 'version-guard', 'must be refused');
    expect(report.steps).toHaveLength(1);
  });

  it('a renderer speaking a garbage version fails the handshake with the typed mismatch detail', async () => {
    const report = await runFor(stubRenderer({ version: 'latest-and-greatest' }), 'static', {});
    await expectFailAt(report, 'handshake', 'the bind was refused');
    expect(report.steps.map((s) => s.ok)).toEqual([true, true, false]); // alien-major probe + transforms both fine
  });

  it('an unknown emission kind fails the handshake capability sanity check', async () => {
    const report = await runFor(
      stubRenderer({ capabilities: { emissionKinds: ['sparkle' as 'point'] } }),
      'static',
      {},
    );
    await expectFailAt(report, 'handshake', 'undeclared kind(s): sparkle');
  });

  it('an EMPTY emissionKinds declaration fails the handshake (a mute chart is not a view)', async () => {
    const report = await runFor(stubRenderer({ capabilities: { emissionKinds: [] } }), 'static', {});
    await expectFailAt(report, 'handshake', 'none declared');
  });

  it('a renderer whose update draws nothing fails renders', async () => {
    const report = await runFor(stubRenderer({ renderMode: 'nothing' }), 'static', {});
    await expectFailAt(report, 'renders', 'left the mount empty');
  });

  it('a throwing update is reported honestly (threw:), not swallowed', async () => {
    const report = await runFor(stubRenderer({ renderMode: 'throw' }), 'static', {});
    await expectFailAt(report, 'renders', 'threw: TypeError: this renderer cannot draw');
  });

  it('a gesture that never emits fails gesture-emits', async () => {
    const report = await runFor(stubRenderer({}), 'static', { gesture: () => {} }); // no click — silence
    await expectFailAt(report, 'gesture-emits', 'got: none');
  });

  it('an emission of an UNDECLARED kind fails gesture-emits', async () => {
    const report = await runFor(
      stubRenderer({ emission: { rawValue: [1, 2], encoding: { kind: 'interval', field: 'price' } } }), // declares point only
      'static',
      { gesture: clickProbe },
    );
    await expectFailAt(report, 'gesture-emits', 'got: undeclared');
  });

  it('an emission against an UNDECLARED view never lands a commit — commit-lands fails (and the session filed needs-view)', async () => {
    const report = await runFor(stubRenderer({ emission: point('price', 100) }), 'ghost', { gesture: clickProbe });
    await expectFailAt(report, 'commit-lands', 'never landed a commit');
  });

  it('a CLEARING gesture leaves no self clause to address — crossfilter-returns fails', async () => {
    const report = await runFor(
      stubRenderer({
        capabilities: { emissionKinds: ['interval'] },
        emission: { rawValue: null, encoding: { kind: 'interval', field: 'price' } },
      }),
      'clearer',
      { gesture: clickProbe },
    );
    await expectFailAt(report, 'crossfilter-returns', 'self-missing');
  });

  it('a renderer that never visibly re-renders fails crossfilter-returns', async () => {
    const report = await runFor(stubRenderer({ renderMode: 'static', emission: point('category', 'Casual') }), 'static', {
      gesture: clickProbe,
    });
    await expectFailAt(report, 'crossfilter-returns', 'renderer-static');
  });

  it('a dirty unmount fails the final step', async () => {
    const report = await runFor(stubRenderer({ emission: point('price', 100), dirtyUnmount: true }), 'dirty', {
      gesture: clickProbe,
    });
    await expectFailAt(report, 'unmount', 'left');
    expect(report.steps.filter((s) => s.ok)).toHaveLength(9); // everything else passed (incl. the honest cell skip)
  });

  it('a renderer DECLARING the cell kind but given no cellGesture fails the cell arm honestly', async () => {
    const report = await runFor(
      stubRenderer({
        capabilities: { emissionKinds: ['point', 'cell'] },
        emission: point('category', 'Casual'),
      }),
      'static',
      { gesture: clickProbe, verifyUpdate: () => true },
    );
    await expectFailAt(report, 'cell', 'no cellGesture');
  });

  it('a cell gesture that emits a NON-cell emission fails the cell arm', async () => {
    const report = await runFor(
      stubRenderer({
        capabilities: { emissionKinds: ['point', 'cell'] },
        emission: point('category', 'Casual'),
      }),
      'static',
      { gesture: clickProbe, verifyUpdate: () => true, cellGesture: clickProbe }, // the "cell" gesture emits a point
    );
    await expectFailAt(report, 'cell', 'no cell emission');
  });

  const clickCellProbe = (el: HTMLElement): void => {
    fireEvent.click(el.querySelector('button.cell')!);
  };

  it('a cell emission the session REFUSES (a ghost field) lands zero commits — the one-commit ruling fails honestly', async () => {
    const report = await runFor(
      stubRenderer({
        capabilities: { emissionKinds: ['point', 'cell'] },
        emission: point('category', 'Casual'),
        cellEmissions: [{ rawValue: [[1, 2], 'x'], encoding: { kind: 'cell', fields: ['price', 'ghost'] } }],
      }),
      'static',
      { gesture: clickProbe, verifyUpdate: () => true, cellGesture: clickCellProbe },
    );
    await expectFailAt(report, 'cell', 'landed 0 commit(s) — the D29 ruling is exactly ONE');
  });

  it('a "cell" gesture whose refused cell is shadowed by a stray point commit is caught by the descriptor', async () => {
    const report = await runFor(
      stubRenderer({
        capabilities: { emissionKinds: ['point', 'cell'] },
        emission: point('category', 'Casual'),
        cellEmissions: [
          { rawValue: [[1, 2], 'x'], encoding: { kind: 'cell', fields: ['price', 'ghost'] } }, // refused (ghost column)
          point('category', 'Party'), // lands — ONE commit, but not a cell
        ],
      }),
      'static',
      { gesture: clickProbe, verifyUpdate: () => true, cellGesture: clickCellProbe },
    );
    await expectFailAt(report, 'cell', 'kind:point · fields-missing · self-missing');
  });
});

// ── the bridge surfaces the other two verbs ────────────────────────────────────

describe('the React bridge surfaces reencodeRequest through the contract (host owns the picker)', () => {
  it('an axis-label click on a bound scatter asks the HOST — no built-in picker opens', async () => {
    const { view } = await buildFixture();
    const el = mountEl();
    const callbacks = { emit: vi.fn(), hover: vi.fn(), reencodeRequest: vi.fn(), navigate: vi.fn() };
    const res = bindRenderer(scatterRenderer(), el, { viewId: 'scatter', callbacks });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    res.view.update(stateFor('scatter', view.getState()));
    fireEvent.click(el.querySelector('[data-axis-channel="y"]')!);
    expect(callbacks.reencodeRequest).toHaveBeenCalledWith('y');
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    res.view.unmount();
    expect(el.childElementCount).toBe(0);
  });
});
