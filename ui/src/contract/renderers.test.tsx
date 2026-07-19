// @vitest-environment jsdom
/**
 * The React bridge + the six reference factories — the option/default arms
 * the conformance suite doesn't reach: custom id/count/value/edge fields,
 * encoding fallbacks, colour hooks, series splits, theme tokens on the mount
 * wrapper.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  reactRenderer,
  scatterRenderer,
  lineRenderer,
  barRenderer,
  mapRenderer,
  tableRenderer,
  histogramRenderer,
} from './renderers.js';
import { emptySelection } from './selection.js';
import {
  RENDERER_PROTOCOL_VERSION,
  type MountedRenderer,
  type Renderer,
  type RendererCallbacks,
  type RenderRow,
  type RenderState,
} from './types.js';
import type { GeoFeatureCollection } from '../charts/VizMap.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function callbacks(): RendererCallbacks {
  return { emit: vi.fn(), hover: vi.fn(), reencodeRequest: vi.fn(), navigate: vi.fn() };
}

function mounted(renderer: Renderer): { el: HTMLElement; m: MountedRenderer } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const m = renderer.mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks() });
  return { el, m };
}

function state(rows: readonly RenderRow[], encodings: Readonly<Record<string, string>> = {}, theme: Readonly<Record<string, string>> = {}): RenderState {
  return { rows, encodings, selection: emptySelection('v'), hover: null, theme, size: { width: 400, height: 300 } };
}

describe('reactRenderer (the bridge)', () => {
  it('answers the hello (version, capabilities, transforms: []), renders synchronously, applies theme tokens, unmounts clean', () => {
    const caps = { canBrush: false, canPointSelect: false, canHighlight: false, canReencode: false, canPanZoom: false, emissionKinds: ['point'] as const };
    const r = reactRenderer({ capabilities: caps, render: (s) => <p>rows: {s.rows.length}</p> });
    const { el, m } = mounted(r);
    expect(m.hello.protocolVersion).toBe(RENDERER_PROTOCOL_VERSION);
    expect(m.hello.capabilities).toEqual(caps);
    expect(m.hello.transforms).toEqual([]);
    m.update(state([{ a: 1 }], {}, { '--vzf-brand': '#123456' }));
    // synchronous: the DOM is settled on the next line (flushSync)
    const wrapper = el.querySelector('div.vzf') as HTMLElement;
    expect(wrapper.textContent).toBe('rows: 1');
    expect(wrapper.style.getPropertyValue('--vzf-brand')).toBe('#123456');
    m.unmount();
    expect(el.childElementCount).toBe(0);
  });
});

const ROWS: RenderRow[] = [
  { id: 'a', key: 'k1', price: 60, rating: 2, category: 'Casual', date: '2026-05-01', value: 3, count: 4, n: 7 },
  { key: 'k2', price: 'oops', rating: 4, category: 'Formal', date: '2026-05-02', value: 5, count: 'oops', n: 2 },
];

describe('scatterRenderer', () => {
  it('encodes via the state encodings; a custom idField wins; a row without it falls back to its index; non-numbers draw at 0; colorOf colours by the color encoding', () => {
    const colorOf = vi.fn((c: string | undefined) => (c === 'Casual' ? '#111111' : '#222222'));
    const r = scatterRenderer({ idField: 'key', colorOf });
    const { el, m } = mounted(r);
    m.update(state(ROWS, { x: 'price', y: 'rating', color: 'category' }));
    const dots = el.querySelectorAll('circle.vzf-dot');
    expect(dots).toHaveLength(2);
    expect(colorOf).toHaveBeenCalledWith('Casual');
    expect(dots[0]!.getAttribute('fill')).toBe('#111111');
    // row 2's price is not a number → x renders at the 0 coordinate, honestly
    expect(el.querySelector('svg')!.getAttribute('aria-label')).toBe('scatter of rating against price');
    m.unmount();
  });

  it('falls back to x/y field names and index ids when encodings and idField are absent', () => {
    const r = scatterRenderer();
    const { el, m } = mounted(r);
    m.update(state([{ x: 1, y: 2 }, { x: 3, y: 4, id: 'named' }]));
    expect(el.querySelectorAll('circle.vzf-dot')).toHaveLength(2);
    // the first row has no 'id' → index key; the second keeps its own
    expect(el.querySelector('svg')!.getAttribute('aria-label')).toBe('scatter of y against x');
    m.unmount();
  });
});

describe('lineRenderer', () => {
  it('encodes date/value/series from the state encodings (series split via color)', () => {
    const r = lineRenderer({ colorOf: (s) => (s === 'Casual' ? '#101010' : '#202020') });
    const { el, m } = mounted(r);
    m.update(state(ROWS, { x: 'date', y: 'price', color: 'category' }));
    expect(el.querySelectorAll('.vzf-line-dot').length).toBeGreaterThan(0);
    // two categories → two series groups
    expect(el.querySelectorAll('.vzf-line-series')).toHaveLength(2);
    m.unmount();
  });

  it('falls back to date/value fields with no series when encodings are absent', () => {
    const r = lineRenderer();
    const { el, m } = mounted(r);
    m.update(state([{ date: '2026-05-01', value: 1 }, { date: '2026-05-02', value: 2 }]));
    expect(el.querySelectorAll('.vzf-line-series')).toHaveLength(1); // one unnamed series
    m.unmount();
  });
});

describe('barRenderer', () => {
  it('reads the category from the encoding and the count from a custom countField; non-numbers count 0', () => {
    const r = barRenderer({ countField: 'n' });
    const { el, m } = mounted(r);
    m.update(state([{ kind: 'A', n: 7 }, { kind: 'B', n: 'oops' }], { category: 'kind' }));
    const bars = el.querySelectorAll('rect.vzf-barrect');
    expect(bars).toHaveLength(2);
    expect(bars[0]!.getAttribute('aria-label')).toBe('select A (7)');
    expect(bars[1]!.getAttribute('aria-label')).toBe('select B (0)');
    m.unmount();
  });

  it('defaults to category/count field names', () => {
    const r = barRenderer();
    const { el, m } = mounted(r);
    m.update(state([{ category: 'A', count: 4 }]));
    expect(el.querySelector('rect.vzf-barrect')!.getAttribute('aria-label')).toBe('select A (4)');
    m.unmount();
  });
});

const GEO: GeoFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { title: 'North' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]] } },
  ],
};

describe('mapRenderer', () => {
  it('reads the region from the encoding, the value from a custom valueField, and honours nameProperty/valueLabel', () => {
    const r = mapRenderer({ geo: GEO, nameProperty: 'title', valueField: 'n', valueLabel: 'sales' });
    const { el, m } = mounted(r);
    m.update(state([{ zone: 'North', n: 7 }], { region: 'zone' }));
    const region = el.querySelector('path.vzf-region')!;
    expect(region.getAttribute('aria-label')).toBe('North · 7 sales');
    expect(el.querySelector('.vzf-map-field')!.textContent).toBe('zone');
    m.unmount();
  });

  it('defaults to region/value field names', () => {
    const geo: GeoFeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { name: 'South' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]] } }],
    };
    const r = mapRenderer({ geo });
    const { el, m } = mounted(r);
    m.update(state([{ region: 'South', value: 3 }]));
    expect(el.querySelector('path.vzf-region')!.getAttribute('aria-label')).toBe('South · 3 rows');
    m.unmount();
  });
});

describe('histogramRenderer', () => {
  it('reads bucket edges/counts from custom fields and the emit field from the x encoding; junk edges fall to 0, junk counts to 0', () => {
    const r = histogramRenderer({ x0Field: 'lo', x1Field: 'hi', countField: 'n', countLabel: 'sales' });
    const { el, m } = mounted(r);
    m.update(
      state(
        [
          { lo: 0, hi: 10, n: 4 },
          { lo: 10, hi: 20, n: 'oops' }, // junk count → 0 (an honest empty bucket)
          { lo: { bad: true }, hi: 30, n: 9 }, // junk edge → 0 (still a positionable number)
        ],
        { x: 'price' },
      ),
    );
    const hits = el.querySelectorAll('rect.vzf-hist-hit');
    expect(hits).toHaveLength(3);
    expect(hits[0]!.getAttribute('aria-label')).toBe('price 0–10 (4 sales)');
    expect(hits[1]!.getAttribute('aria-label')).toBe('price 10–20 (0 sales)');
    m.unmount();
  });

  it('defaults to x0/x1/count field names and the "value" emit field', () => {
    const r = histogramRenderer();
    const { el, m } = mounted(r);
    m.update(state([{ x0: 0, x1: 5, count: 2 }]));
    expect(el.querySelector('rect.vzf-hist-hit')!.getAttribute('aria-label')).toBe('value 0–5 (2 rows)');
    m.unmount();
  });
});

describe('tableRenderer', () => {
  it('passes columns, idField, and labels through', () => {
    const r = tableRenderer({ columns: ['key', 'price'], idField: 'key', labels: { price: 'Price ($)' } });
    const { el, m } = mounted(r);
    m.update(state(ROWS));
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(el.querySelector('th[aria-label="sort by Price ($)"]')).not.toBeNull();
    expect(el.querySelector('tbody tr')!.getAttribute('aria-label')).toBe('row k1');
    m.unmount();
  });
});
