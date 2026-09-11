// @vitest-environment jsdom
/**
 * The React bridge + the eight reference factories — the option/default arms
 * the conformance suite doesn't reach: custom id/count/value/edge fields,
 * encoding fallbacks, colour hooks, series splits, theme tokens on the mount
 * wrapper.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent } from '@testing-library/dom';
import {
  reactRenderer,
  scatterRenderer,
  lineRenderer,
  barRenderer,
  mapRenderer,
  tableRenderer,
  histogramRenderer,
  heatmapRenderer,
  boxPlotRenderer,
  networkRenderer,
  layeredRenderer,
  NETWORK_EDGE_CEILING,
  NETWORK_NODE_CEILING,
} from './renderers.js';
import { emptySelection } from './selection.js';
import {
  RENDERER_PROTOCOL_VERSION,
  type HostHandshake,
  type MountedRenderer,
  type Renderer,
  type RendererCallbacks,
  type RenderLayer,
  type RenderRow,
  type RenderState,
  type ResolvedChannel,
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

describe('heatmapRenderer (D30 — the cell renderer)', () => {
  it('declares emissionKinds: ["cell"] honestly and reads cells from custom fields', () => {
    const r = heatmapRenderer({ x0Field: 'lo', x1Field: 'hi', yRowField: 'cat', countField: 'n', countLabel: 'sales' });
    const { el, m } = mounted(r);
    expect(m.hello.capabilities.emissionKinds).toEqual(['cell']);
    m.update(
      state(
        [
          { lo: 0, hi: 10, cat: 'A', n: 4 },
          { lo: 0, hi: 10, cat: 'B', n: 'oops' }, // junk count → 0 (an honest empty cell)
        ],
        { x: 'price', y: 'category' },
      ),
    );
    const cells = el.querySelectorAll('rect.vzf-heatcell');
    expect(cells).toHaveLength(2);
    expect(cells[0]!.getAttribute('aria-label')).toBe('price 0–10 and category A · 4 sales');
    expect(cells[1]!.getAttribute('aria-label')).toBe('price 0–10 and category B · no sales');
    m.unmount();
  });

  it('defaults to x0/x1/y/count field names and the value/category emit fields', () => {
    const r = heatmapRenderer();
    const { el, m } = mounted(r);
    m.update(state([{ x0: 0, x1: 5, y: 'A', count: 2 }]));
    expect(el.querySelector('rect.vzf-heatcell')!.getAttribute('aria-label')).toBe('value 0–5 and category A · 2 rows');
    m.unmount();
  });
});

describe('boxPlotRenderer', () => {
  it('reads the category from a custom categoryField, box stats by their canonical names, and drops junk outliers', () => {
    const r = boxPlotRenderer({ categoryField: 'kind', countLabel: 'sales' });
    const { el, m } = mounted(r);
    m.update(
      state(
        [{ kind: 'A', q1: 10, median: 20, q3: 30, whiskerLo: 5, whiskerHi: 35, outliers: [50, 'oops', 60], count: 9 }],
        { x: 'category', y: 'price' },
      ),
    );
    const hit = el.querySelector('rect.vzf-box-hit')!;
    expect(hit.getAttribute('aria-label')).toBe('category A · 9 sales · median 20');
    expect(el.querySelectorAll('circle.vzf-box-outlier')).toHaveLength(2); // the junk outlier value is dropped, not guessed
    m.unmount();
  });

  it('a date-domain stat (an ISO string) passes through; a non-number/string stat degrades to 0', () => {
    const r = boxPlotRenderer();
    const { el, m } = mounted(r);
    m.update(
      state([
        {
          category: 'A',
          q1: '2026-04-03',
          median: '2026-04-05',
          q3: '2026-04-07',
          whiskerLo: '2026-04-01',
          whiskerHi: { bad: true }, // junk stat → 0, honestly, never guessed
          outliers: [],
          count: 5,
        },
      ]),
    );
    const hit = el.querySelector('rect.vzf-box-hit')!;
    expect(hit.getAttribute('aria-label')).toBe('category A · 5 rows · median 2026-04-05');
    m.unmount();
  });

  it('defaults to the "category" row field, the category/value emit fields, and "rows" as the count label; a malformed row degrades honestly', () => {
    const r = boxPlotRenderer();
    const { el, m } = mounted(r);
    m.update(state([{ category: 'A', q1: 1, median: 2, q3: 3, whiskerLo: 0, whiskerHi: 4, outliers: 'not-an-array', count: 'oops' }]));
    const hit = el.querySelector('rect.vzf-box-hit')!;
    expect(hit.getAttribute('aria-label')).toBe('category A · 0 rows · median 2');
    expect(el.querySelectorAll('circle.vzf-box-outlier')).toHaveLength(0); // a non-array outliers field degrades to none, never a crash
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

// ── networkRenderer (protocol 1.2: the layer partition, the voice, the ceiling) ──

/** Three nodes with the layout act's positions, and a group to colour by. */
const NET_NODES: RenderRow[] = [
  { disease: 'flu', px: 0, py: 0, grp: 'viral' },
  { disease: 'cold', px: 10, py: 4, grp: 'viral' },
  { disease: 'strep', px: 4, py: 10, grp: 'bacterial' },
];
/** Two edges, both endpoints carried over by `bringOver`. */
const NET_EDGES: RenderRow[] = [
  { src: 'flu', tgt: 'cold', source_x: 0, source_y: 0, target_x: 10, target_y: 4 },
  { src: 'cold', tgt: 'strep', source_x: 10, source_y: 4, target_x: 4, target_y: 10 },
];

const NODES_LAYER: RenderLayer = { layerId: 'nodes', table: 'nodes', rows: NET_NODES, encodings: { x: 'px', y: 'py', key: 'disease', color: 'grp' } };
const EDGES_LAYER: RenderLayer = {
  layerId: 'edges',
  table: 'edges',
  rows: NET_EDGES,
  encodings: { source: 'src', target: 'tgt', sourceX: 'source_x', sourceY: 'source_y', targetX: 'target_x', targetY: 'target_y' },
};

function layered(layers: readonly RenderLayer[], rows: readonly RenderRow[] = NET_NODES, encodings: Readonly<Record<string, string>> = {}): RenderState {
  return { ...state(rows, encodings), layers };
}

/** Mount with a callback bundle per layer — what `bindRenderer` hands a canLayer renderer. */
function mountNet(handshake: Partial<HostHandshake> = {}): { el: HTMLElement; m: MountedRenderer; view: RendererCallbacks; bundles: { nodes: RendererCallbacks; edges: RendererCallbacks } } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = callbacks();
  const bundles = { nodes: callbacks(), edges: callbacks() };
  const m = networkRenderer().mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'net', callbacks: view, layers: bundles, ...handshake });
  return { el, m, view, bundles };
}

describe('networkRenderer — which layer is which', () => {
  it('the layer binding all four endpoint positions is the EDGES; the other is the NODES', () => {
    const { el, m } = mountNet();
    m.update(layered([EDGES_LAYER, NODES_LAYER]));
    expect(el.querySelectorAll('g.vzf-net-nodes circle')).toHaveLength(3);
    expect(el.querySelectorAll('g.vzf-net-links line')).toHaveLength(2);
    // the nodes layer's own bindings positioned them, and its `key` named them
    expect(el.querySelector('circle[data-node="flu"]')!.getAttribute('aria-label')).toBe('flu · viral · 1 link');
    expect(el.querySelector('g.vzf-net-links line')!.getAttribute('aria-label')).toBe('flu — cold');
    m.unmount();
  });

  it('draw order decides nothing — the CHANNELS do, whichever layer comes first', () => {
    const { el, m } = mountNet();
    m.update(layered([NODES_LAYER, EDGES_LAYER]));
    expect(el.querySelectorAll('g.vzf-net-nodes circle')).toHaveLength(3);
    expect(el.querySelectorAll('g.vzf-net-links line')).toHaveLength(2);
    m.unmount();
  });

  it('a layer binding THREE of the four endpoints draws no links — and is still never mistaken for the NODES', () => {
    const { el, m } = mountNet();
    const { targetY, ...three } = EDGES_LAYER.encodings;
    void targetY;
    m.update(layered([{ ...EDGES_LAYER, encodings: three }, NODES_LAYER]));
    expect(el.querySelectorAll('g.vzf-net-links line')).toHaveLength(0);
    // the nodes layer is chosen POSITIVELY — the layer carrying NO endpoint
    // column — so a partial carry-over loses the links and never steals the
    // node circles from the real node table
    expect(el.querySelectorAll('g.vzf-net-nodes circle')).toHaveLength(3);
    expect(el.querySelector('circle[data-node="strep"]')).not.toBeNull();
    m.unmount();
  });

  it('a SECOND edge layer is an edge table too — a multiplex frame never draws edge rows as nodes', () => {
    const { el, m } = mountNet();
    // two relations over one node set: both bind the four, so both are edges
    m.update(layered([EDGES_LAYER, { ...EDGES_LAYER, layerId: 'transmission' }, NODES_LAYER]));
    // …and a frame carrying more than the two tables this renderer draws is refused by name
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('p.vzf-chart-refusal')!.textContent).toBe(
      'this node-link draws two tables — the nodes and the edges — and this frame carried 3: edges, transmission, nodes. Draw the extra layers on a frame of their own.',
    );
    m.unmount();
  });

  it('an endpoint `bringOver` could not follow is an ABSENCE, not a link from the origin', () => {
    const { el, m } = mountNet();
    // five rows: one good, and one per end that carries no number — `bringOver`
    // writes null for an endpoint naming nothing, and a zero would draw a hub
    // where no node is AND drag the shared frame's extent to it
    const rows: RenderRow[] = [
      { src: 'flu', tgt: 'cold', source_x: 0, source_y: 0, target_x: 10, target_y: 4 },
      { src: 'a', tgt: 'b', source_x: null, source_y: 0, target_x: 10, target_y: 4 },
      { src: 'c', tgt: 'd', source_x: 0, source_y: null, target_x: 10, target_y: 4 },
      { src: 'e', tgt: 'f', source_x: 0, source_y: 0, target_x: null, target_y: 4 },
      { src: 'g', tgt: 'h', source_x: 0, source_y: 0, target_x: 10, target_y: Number.NaN },
    ];
    m.update(layered([{ ...EDGES_LAYER, rows }, NODES_LAYER]));
    expect(el.querySelectorAll('g.vzf-net-links line')).toHaveLength(1);
    m.unmount();
  });

  it('refuses a nodes table with no key column rather than minting a node called "undefined"', () => {
    const { el, m } = mountNet();
    m.update(layered([EDGES_LAYER, { ...NODES_LAYER, encodings: { x: 'px', y: 'py' } }]));
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('p.vzf-chart-refusal')!.textContent).toBe(
      'this network keys its nodes by "id", which no row carries — the first row\'s columns are disease, px, py, grp. ' +
        'Bind the `key` channel on the nodes layer, or name the column with the renderer\u2019s `keyField` option.',
    );
    // an EMPTY frame is not a missing key — there is no row to have carried one
    m.update(layered([EDGES_LAYER, { ...NODES_LAYER, rows: [], encodings: { x: 'px', y: 'py' } }]));
    expect(el.querySelector('svg')).not.toBeNull();
    m.unmount();
  });

  it('a frame with NO layers is a nodes-only network over the view\'s own rows', () => {
    const { el, m } = mountNet();
    m.update(state(NET_NODES, { x: 'px', y: 'py', key: 'disease' }));
    expect(el.querySelectorAll('g.vzf-net-nodes circle')).toHaveLength(3);
    expect(el.querySelectorAll('g.vzf-net-links line')).toHaveLength(0);
    expect(el.querySelector('circle[data-node="flu"]')!.getAttribute('aria-label')).toBe('flu · 0 links');
    m.unmount();
  });

  it('the edge layer\'s source/target default to `source`/`target` when it binds neither', () => {
    const { el, m } = mountNet();
    const plain: RenderLayer = {
      layerId: 'edges',
      table: 'edges',
      rows: [{ source: 'flu', target: 'cold', source_x: 0, source_y: 0, target_x: 10, target_y: 4 }],
      encodings: { sourceX: 'source_x', sourceY: 'source_y', targetX: 'target_x', targetY: 'target_y' },
    };
    m.update(layered([plain, NODES_LAYER]));
    expect(el.querySelector('g.vzf-net-links line')!.getAttribute('aria-label')).toBe('flu — cold');
    m.unmount();
  });

  it('the node key falls back to the option, then to `id`, and the colour channel is optional', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const m = networkRenderer({ keyField: 'disease' }).mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'net', callbacks: callbacks() });
    m.update(state(NET_NODES, { x: 'px', y: 'py' })); // no `key` binding, no `color` binding
    expect(el.querySelector('circle[data-node="flu"]')!.getAttribute('aria-label')).toBe('flu · 0 links'); // no group in the label
    m.unmount();
    const bare = document.createElement('div');
    document.body.appendChild(bare);
    const m2 = networkRenderer().mount(bare, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'net', callbacks: callbacks() });
    m2.update(state([{ id: 'n1', x: 1, y: 2 }])); // every default: id, x, y
    expect(bare.querySelector('circle[data-node="n1"]')).not.toBeNull();
    m2.unmount();
  });
});

describe('networkRenderer — the substrate is the LIBRARY\'s fold, and the host\'s wins when it pushed one (protocol 1.5)', () => {
  /** Where two nodes landed in pixels — the substrate is whatever put them there. */
  const spanOf = (el: Element): number => {
    const at = (id: string): number => Number(el.querySelector(`circle[data-node="${id}"]`)!.getAttribute('cx'));
    return Math.abs(at('cold') - at('flu'));
  };

  it('with no frame pushed it folds the union of node positions and BOTH ends of every edge', () => {
    const { el, m } = mountNet();
    m.update(layered([NODES_LAYER]));
    const nodesOnly = spanOf(el);
    // an edge whose far end is a node this frame does NOT carry (a filtered-away endpoint): it is still
    // part of the substrate, because a link running off the plot is a lie about where its far end is
    const reaching: RenderLayer = {
      ...EDGES_LAYER,
      rows: [{ src: 'flu', tgt: 'gone', source_x: 0, source_y: 0, target_x: 400, target_y: 400 }],
    };
    m.update(layered([reaching, NODES_LAYER]));
    expect(spanOf(el)).toBeLessThan(nodesOnly);
    m.unmount();
  });

  it("the HOST's fold wins when it carries BOTH axes as shared quantitative domains — it read the whole table, not just what is on screen", () => {
    const { el, m } = mountNet();
    m.update(layered([EDGES_LAYER, NODES_LAYER]));
    const own = spanOf(el);
    m.update({
      ...layered([EDGES_LAYER, NODES_LAYER]),
      frame: {
        x: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain: [0, 100] },
        y: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain: [0, 100] },
      },
    });
    // ten times the span in layout units puts the same two nodes ten times closer together
    expect(spanOf(el)).toBeLessThan(own);
    m.unmount();
  });

  it('half a fold is no fold: a frame missing an axis, or one that is not shared quantitative, falls back to the library fold', () => {
    const { el, m } = mountNet();
    m.update(layered([EDGES_LAYER, NODES_LAYER]));
    const own = spanOf(el);
    const shared = { mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain: [0, 100] } as const;
    const halves: readonly Readonly<Record<string, ResolvedChannel>>[] = [
      { x: shared }, // no y at all
      { x: shared, y: { mode: 'independent', guide: 'per-layer' } as const }, // y left to the layers
      { x: shared, y: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'categorical', domain: ['a'] } as const }, // y is not a magnitude
    ];
    for (const frame of halves) {
      m.update({ ...layered([EDGES_LAYER, NODES_LAYER]), frame });
      expect(spanOf(el)).toBe(own);
    }
    m.unmount();
  });

  it('a host fold covers BOTH the node channels and the EDGE ENDPOINTS — half the channels is not a substrate', () => {
    const { el, m } = mountNet();
    // one edge reaching far outside the node extent, exactly as in the library-fold test above
    const reaching: RenderLayer = { ...EDGES_LAYER, rows: [{ src: 'flu', tgt: 'gone', source_x: 0, source_y: 0, target_x: 400, target_y: 400 }] };
    m.update(layered([reaching, NODES_LAYER]));
    const folded = spanOf(el); // the library's own fold: nodes ∪ both ends of every edge
    const q = (lo: number, hi: number) => ({ mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain: [lo, hi] }) as const;
    // the host folded every channel the two layers bind: `x`/`y` on the nodes, the ENDPOINT channels on the edges
    m.update({
      ...layered([reaching, NODES_LAYER]),
      frame: { x: q(0, 10), y: q(0, 10), sourceX: q(0, 0), sourceY: q(0, 0), targetX: q(0, 400), targetY: q(0, 400) },
    });
    // the same span: an endpoint is part of the substrate whoever folded it, or a link runs off the plot
    expect(spanOf(el)).toBeCloseTo(folded, 5);
    m.unmount();
  });

  it('a frame with no layers at all still folds, and a frame with no positions folds nothing rather than a substrate of one point', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const m = networkRenderer({ keyField: 'disease' }).mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'net', callbacks: callbacks() });
    // no `layers`: the layer ids the fold names fall back, and the nodes still land on one substrate
    m.update(state(NET_NODES, { x: 'px', y: 'py' }));
    expect(spanOf(el)).toBeGreaterThan(0);
    // no rows at all: nothing to fold, and the chart keeps its own empty frame rather than being handed one
    m.update(state([], { x: 'px', y: 'py' }));
    expect(el.querySelectorAll('circle[data-node]')).toHaveLength(0);
    m.unmount();
  });
});

describe('networkRenderer — whose voice a node click is', () => {
  it('a node gesture speaks through the NODES layer\'s bundle, never the view\'s callbacks', () => {
    const { el, m, view, bundles } = mountNet();
    m.update(layered([EDGES_LAYER, NODES_LAYER]));
    fireEvent.click(el.querySelector('circle[data-node="cold"]')!);
    expect(bundles.nodes.emit).toHaveBeenCalledWith({ rawValue: 'cold', encoding: { kind: 'point', field: 'disease' } });
    expect(view.emit).not.toHaveBeenCalled();
    expect(bundles.edges.emit).not.toHaveBeenCalled();
    m.unmount();
  });

  it('with no bundle for that layer the view speaks — a 1.1 host loses the address, not the gesture', () => {
    const { el, m, view } = mountNet({ layers: undefined });
    m.update(layered([EDGES_LAYER, NODES_LAYER]));
    fireEvent.click(el.querySelector('circle[data-node="flu"]')!);
    expect(view.emit).toHaveBeenCalledWith({ rawValue: 'flu', encoding: { kind: 'point', field: 'disease' } });
    m.unmount();
  });

  it('an unlayered frame speaks through the view — there is no layer to speak for', () => {
    const { el, m, view, bundles } = mountNet();
    m.update(state(NET_NODES, { x: 'px', y: 'py', key: 'disease' }));
    fireEvent.click(el.querySelector('circle[data-node="strep"]')!);
    expect(view.emit).toHaveBeenCalledWith({ rawValue: 'strep', encoding: { kind: 'point', field: 'disease' } });
    expect(bundles.nodes.emit).not.toHaveBeenCalled();
    m.unmount();
  });
});

describe('networkRenderer — the WALK PICKER (protocol 1.4): the reader chooses which walk an alt-click asks for', () => {
  it('the picker is drawn only where there is a walk to choose — and it offers the four walks by name', () => {
    const { el, m } = mountNet();
    m.update(layered([EDGES_LAYER, NODES_LAYER]));
    const select = el.querySelector('select[aria-label="which walk an alt-click asks for"]') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['neighbours', 'two hops', 'component', 'path']);
    m.unmount();

    // an unlayered frame carries no edges, so there is no walk door and no choice to offer
    const bare = mountNet();
    bare.m.update(state(NET_NODES, { x: 'px', y: 'py', key: 'disease' }));
    expect(bare.el.querySelector('select')).toBeNull();
    bare.m.unmount();
  });

  it('the pick changes what the NEXT alt-click ASKS, and nothing else — and it survives the next update', () => {
    const { el, m, bundles } = mountNet();
    m.update(layered([EDGES_LAYER, NODES_LAYER]));
    const select = el.querySelector('select') as HTMLSelectElement;
    // the default asks what it always asked: no `walk` on the encoding at all
    fireEvent.click(el.querySelector('circle[data-node="cold"]')!, { altKey: true });
    expect(bundles.edges.emit).toHaveBeenLastCalledWith({ rawValue: 'cold', encoding: { kind: 'neighbourhood', field: 'src' } });

    fireEvent.change(select, { target: { value: '2' } }); // component
    // a pick lands NOTHING by itself: it is a question nobody has asked yet
    expect(bundles.edges.emit).toHaveBeenCalledTimes(1);
    fireEvent.click(el.querySelector('circle[data-node="cold"]')!, { altKey: true });
    expect(bundles.edges.emit).toHaveBeenLastCalledWith({ rawValue: 'cold', encoding: { kind: 'neighbourhood', field: 'src', walk: { derivation: 'component' } } });

    // a re-render (new rows, a crossfilter tick) keeps the reader's choice: the pick is the frame's, not the state's
    m.update(layered([EDGES_LAYER, NODES_LAYER]));
    expect((el.querySelector('select') as HTMLSelectElement).value).toBe('2');
    fireEvent.change(el.querySelector('select') as HTMLSelectElement, { target: { value: '1' } }); // two hops
    fireEvent.click(el.querySelector('circle[data-node="flu"]')!, { altKey: true });
    expect(bundles.edges.emit).toHaveBeenLastCalledWith({ rawValue: 'flu', encoding: { kind: 'neighbourhood', field: 'src', walk: { derivation: 'ego', hops: 2 } } });
    m.unmount();
  });

  it('picking the PATH puts the two-click gesture in the chart\'s own words', () => {
    const { el, m } = mountNet();
    m.update(layered([EDGES_LAYER, NODES_LAYER]));
    fireEvent.change(el.querySelector('select') as HTMLSelectElement, { target: { value: '3' } }); // path
    expect(el.querySelector('desc')!.textContent).toContain('to start a path, then alt-click another node for the path between them');
    expect(el.querySelector('circle[data-node="flu"]')!.querySelector('title')!.textContent).toContain('alt-click to start a path here');
    m.unmount();
  });
});

describe('networkRenderer — the SVG ceiling lives in the wrapper', () => {
  const manyNodes = (n: number): RenderRow[] => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, x: i, y: i }));

  it('draws a frame exactly AT the ceiling', () => {
    const { el, m } = mountNet();
    m.update(state(manyNodes(NETWORK_NODE_CEILING)));
    expect(el.querySelectorAll('g.vzf-net-nodes circle')).toHaveLength(NETWORK_NODE_CEILING);
    m.unmount();
  });

  it('past it, refuses in a sentence naming the count, the ceiling and the reading that still works', () => {
    const { el, m } = mountNet();
    m.update(state(manyNodes(NETWORK_NODE_CEILING + 1)));
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('p.vzf-chart-refusal')!.textContent).toBe(
      'this network has 1001 nodes, past the 1000 one SVG frame draws legibly — read it as a matrix instead (a heatmap of source × target), which stays readable where a node-link is a hairball',
    );
    m.unmount();
  });

  it('the ceiling counts the NODES layer, not the view\'s rows', () => {
    const { el, m } = mountNet();
    // 3 rows on the frame, 1001 on the nodes layer: the layer is what is drawn, so the layer is what is judged
    m.update(layered([EDGES_LAYER, { ...NODES_LAYER, rows: manyNodes(NETWORK_NODE_CEILING + 1) }]));
    expect(el.querySelector('p.vzf-chart-refusal')!.textContent).toContain('this network has 1001 nodes');
    m.unmount();
  });

  it('and the LINKS are judged too — the half that usually bites first', () => {
    const manyEdges = (n: number): RenderRow[] =>
      Array.from({ length: n }, (_, i) => ({ src: `a${i}`, tgt: `b${i}`, source_x: 0, source_y: 0, target_x: 1, target_y: 1 }));
    const { el, m } = mountNet();
    // three nodes, well under their ceiling, and one link past its own
    m.update(layered([{ ...EDGES_LAYER, rows: manyEdges(NETWORK_EDGE_CEILING + 1) }, NODES_LAYER]));
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('p.vzf-chart-refusal')!.textContent).toBe(
      `this network has ${NETWORK_EDGE_CEILING + 1} links, past the ${NETWORK_EDGE_CEILING} one SVG frame draws legibly — ` +
        'read it as a matrix instead (a heatmap of source × target), which stays readable where a node-link is a hairball',
    );
    // and exactly AT the ceiling it draws
    m.update(layered([{ ...EDGES_LAYER, rows: manyEdges(NETWORK_EDGE_CEILING) }, NODES_LAYER]));
    expect(el.querySelectorAll('g.vzf-net-links line')).toHaveLength(NETWORK_EDGE_CEILING);
    m.unmount();
  });

  it('a refusal is a live region — the frame it replaced carried the only accessible reading', () => {
    const { el, m } = mountNet();
    m.update(state(manyNodes(NETWORK_NODE_CEILING + 1)));
    expect(el.querySelector('p.vzf-chart-refusal')!.getAttribute('role')).toBe('status');
    m.unmount();
  });
});

// ── layeredRenderer (R6): the def's stack of 2D marks over ONE frame ──────────

const SHARED = (scale: 'quantitative' | 'temporal' | 'categorical', domain: unknown): ResolvedChannel =>
  ({ mode: 'shared', basis: 'table', guide: 'merged', scale, domain } as ResolvedChannel);

/** A frame's state: the layers, plus the resolved channels the HOST folded (protocol 1.5). */
function framed(layers: readonly RenderLayer[], frame?: Readonly<Record<string, ResolvedChannel>>): RenderState {
  return { ...state([]), layers, ...(frame === undefined ? {} : { frame }) };
}

/** Mount the frame renderer with a callback bundle per layer — what `bindRenderer` hands a canLayer renderer. */
function mountFrame(options: Parameters<typeof layeredRenderer>[0], layerIds: readonly string[] = ['a', 'b']): { el: HTMLElement; m: MountedRenderer; view: RendererCallbacks; bundles: Record<string, RendererCallbacks> } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = callbacks();
  const bundles: Record<string, RendererCallbacks> = {};
  for (const id of layerIds) bundles[id] = callbacks();
  const m = layeredRenderer(options).mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: view, layers: bundles });
  return { el, m, view, bundles };
}

const POINT_ROWS: RenderRow[] = [
  { id: 'p1', price: 10, rating: 2 },
  { id: 'p2', price: 90, rating: 8 },
];
const LINE_ROWS: RenderRow[] = [
  { price: 20, rating: 3 },
  { price: 80, rating: 7 },
];
const POINTS_LAYER: RenderLayer = { layerId: 'a', table: 'shoes', rows: POINT_ROWS, encodings: { x: 'price', y: 'rating' } };
const LINE_LAYER: RenderLayer = { layerId: 'b', table: 'trend', rows: LINE_ROWS, encodings: { x: 'price', y: 'rating' } };
/** The 2D frame's own fold: one x span and one y span over both layers. */
const XY_FRAME = { x: SHARED('quantitative', [0, 100]), y: SHARED('quantitative', [0, 10]) };

const refusalOf = (el: Element): string => el.querySelector('.vzf-chart-refusal')?.textContent ?? '';
const guidesOf = (el: Element): number => el.querySelectorAll('.vzf-frame-guide').length;

describe('layeredRenderer — the capabilities are the marks it was told to draw', () => {
  it('a frame of BARS does not brush, and a frame with a line in it does — the union of its marks, never a blanket claim', () => {
    const bars = layeredRenderer({ layers: { a: { kind: 'bar' }, b: { kind: 'bar' } } }).mount(document.createElement('div'), { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks() });
    expect(bars.hello.capabilities).toMatchObject({ canBrush: false, canPointSelect: true, canLayer: true, emissionKinds: ['point', 'match'] });
    const mixed = layeredRenderer({ layers: { a: { kind: 'point' }, b: { kind: 'line' } } }).mount(document.createElement('div'), { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks() });
    expect(mixed.hello.capabilities).toMatchObject({ canBrush: true, canPointSelect: false, canHighlight: true, emissionKinds: ['interval'] });
    // a bar's highlight is a promise about the SPEC: it can only draw the share the host aggregated
    expect(bars.hello.capabilities.canHighlight).toBe(false);
    const bright = layeredRenderer({ layers: { a: { kind: 'bar', highlightCountField: 'bright' } } }).mount(document.createElement('div'), { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks() });
    expect(bright.hello.capabilities.canHighlight).toBe(true);
    // a kind no frame can draw promises nothing on its behalf (it is refused at update, in words)
    const none = layeredRenderer({ layers: { a: { kind: 'heatmap' } } }).mount(document.createElement('div'), { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks() });
    expect(none.hello.capabilities).toMatchObject({ canBrush: false, canPointSelect: false, emissionKinds: [] });
    // and a frame told NOTHING promises nothing — every layer it is pushed is refused in words
    const bare = layeredRenderer().mount(document.createElement('div'), { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks() });
    expect(bare.hello.capabilities).toMatchObject({ canBrush: false, canPointSelect: false, canHighlight: false, emissionKinds: [], canLayer: true });
    for (const mounted of [bars, mixed, bright, none, bare]) mounted.unmount();
  });
});

describe('layeredRenderer — the marks, the box and the guide', () => {
  it('declares canLayer and draws the layers in DECLARATION order, each on the frame’s scales with no guide of its own', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' }, b: { kind: 'line' } } });
    expect(m.hello.capabilities.canLayer).toBe(true);
    m.update(framed([POINTS_LAYER, LINE_LAYER], XY_FRAME));
    expect(Array.from(el.querySelectorAll('[data-layer]')).map((n) => n.getAttribute('data-layer'))).toEqual(['a', 'b']);
    // ONE guide for the stack — and the scatter/line drew none of their own
    expect(guidesOf(el)).toBe(1);
    expect(el.querySelectorAll('.vzf-scatter .vzf-axis, .vzf-line .vzf-axis')).toHaveLength(0);
    // the guide's ticks are the frame's fold, not either layer's own extent
    expect(Array.from(el.querySelectorAll('.vzf-frame-guide text.vzf-tick')).map((t) => t.textContent)).toEqual(['0', '33.3', '66.7', '100', '0', '3.3', '6.7', '10', 'price', 'rating']);
    m.unmount();
  });

  it('a per-layer guide gives a single layer its own axes and the frame none (a chart draws both axes or neither) — two-or-more layers under per-layer is refused, below', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' } } }, ['a']);
    m.update(framed([POINTS_LAYER], { x: { ...XY_FRAME.x, guide: 'per-layer' } as ResolvedChannel, y: XY_FRAME.y }));
    expect(guidesOf(el)).toBe(0);
    expect(el.querySelectorAll('.vzf-scatter .vzf-axis').length).toBeGreaterThan(0);
    m.unmount();
  });

  it('a frame that folded NOTHING draws a single layer on its own extents, with its own guide — the honest independent picture', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' } } }, ['a']);
    m.update(framed([POINTS_LAYER]));
    expect(guidesOf(el)).toBe(0);
    expect(el.querySelectorAll('.vzf-scatter .vzf-axis').length).toBeGreaterThan(0);
    m.unmount();
  });

  it('the axis label is the field every layer agrees on; two fields have no one name, and the host’s label wins', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' }, b: { kind: 'line' } } });
    // b binds a DIFFERENT y field: the merged y axis carries no name
    m.update(framed([POINTS_LAYER, { ...LINE_LAYER, encodings: { x: 'price', y: 'stars' } }], XY_FRAME));
    expect(Array.from(el.querySelectorAll('.vzf-frame-axislabel')).map((t) => t.textContent)).toEqual(['price']);
    m.update({ ...framed([POINTS_LAYER, LINE_LAYER], XY_FRAME) });
    expect(Array.from(el.querySelectorAll('.vzf-frame-axislabel')).map((t) => t.textContent)).toEqual(['price', 'rating']);
    m.unmount();
    const named = mountFrame({ layers: { a: { kind: 'point' }, b: { kind: 'line' } }, xLabel: 'price (USD)', yLabel: 'stars' });
    named.m.update(framed([POINTS_LAYER, LINE_LAYER], XY_FRAME));
    expect(Array.from(named.el.querySelectorAll('.vzf-frame-axislabel')).map((t) => t.textContent)).toEqual(['price (USD)', 'stars']);
    named.m.unmount();
  });

  it('draws all five framed marks — the three RUN marks on one frame, the two BAND marks each on theirs', () => {
    const runs: RenderLayer[] = [
      { layerId: 'l', table: 't', rows: [{ x: '2026-01-01', y: 1 }], encodings: { x: 'x', y: 'y' } },
      { layerId: 'p', table: 't', rows: POINT_ROWS, encodings: { x: 'price', y: 'rating' } },
      { layerId: 'h', table: 't', rows: [{ x0: 0, x1: 5, count: 2 }], encodings: { x: 'price' } },
    ];
    const { el, m } = mountFrame({ layers: { l: { kind: 'line' }, p: { kind: 'point' }, h: { kind: 'histogram' } } }, ['l', 'p', 'h']);
    // a merged guide, not the (per-layer, now refused for 3 layers) default of an unfolded frame — see "per-layer guides on two or more layers" below
    m.update(framed(runs, XY_FRAME));
    for (const cls of ['.vzf-line', '.vzf-scatter', '.vzf-histogram']) expect(el.querySelectorAll(cls).length, cls).toBeGreaterThan(0);
    m.unmount();
    // a bar, with the fold's category list — the band mark that reads one
    const bars = mountFrame({ layers: { a: { kind: 'bar' } } }, ['a']);
    bars.m.update(framed([{ layerId: 'a', table: 't', rows: [{ shelf: 'Casual', count: 4 }], encodings: { category: 'shelf' } }], { category: SHARED('categorical', ['Casual']) }));
    expect(bars.el.querySelectorAll('.vzf-barrect')).toHaveLength(1);
    bars.m.unmount();
    // a box plot, alone on its frame: its own order IS the fold's order for one layer
    const box = mountFrame({ layers: { a: { kind: 'boxplot' } } }, ['a']);
    box.m.update(framed([{ layerId: 'a', table: 't', rows: [{ category: 'Casual', q1: 1, median: 2, q3: 3, whiskerLo: 0, whiskerHi: 4, outliers: [], count: 3 }], encodings: { x: 'shelf', y: 'price' } }], { x: SHARED('categorical', ['Casual']), y: SHARED('quantitative', [0, 5]) }));
    expect(box.el.querySelectorAll('.vzf-box-hit')).toHaveLength(1);
    box.m.unmount();
  });
});

describe('layeredRenderer — two bands off ONE category list', () => {
  it('both bar layers lay their slots out in the FRAME’s order, and a category a layer has no row for stays an empty band', () => {
    const a: RenderLayer = { layerId: 'a', table: 'ta', rows: [{ shelf: 'Casual', count: 4 }, { shelf: 'Formal', count: 9 }], encodings: { category: 'shelf' } };
    const b: RenderLayer = { layerId: 'b', table: 'tb', rows: [{ shelf: 'Formal', count: 2 }, { shelf: 'Sporty', count: 6 }], encodings: { category: 'shelf' } };
    const { el, m } = mountFrame({ layers: { a: { kind: 'bar' }, b: { kind: 'bar' } } });
    // the fold's union, in first-seen order across the layers in declaration order
    m.update(framed([a, b], { category: SHARED('categorical', ['Casual', 'Formal', 'Sporty']) }));
    const barsOf = (layerId: string): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const rect of Array.from(el.querySelectorAll(`[data-layer="${layerId}"] rect.vzf-barrect`))) out[rect.getAttribute('aria-label') ?? ''] = rect.getAttribute('x') ?? '';
      return out;
    };
    const first = barsOf('a');
    const second = barsOf('b');
    // each layer draws only the categories it HAS rows for — two of the three bands
    expect(Object.keys(first)).toEqual(['select Casual (4)', 'select Formal (9)']);
    expect(Object.keys(second)).toEqual(['select Formal (2)', 'select Sporty (6)']);
    // …and "Formal" is at the SAME x in both, which is the whole point of one band order
    expect(second['select Formal (2)']).toBe(first['select Formal (9)']);
    m.unmount();
  });

  it('a layer whose rows carry a category the frame’s fold did not name still lines up with the merged guide — the APPENDED band never narrows every OTHER band off its tick', () => {
    // the frame folded only 'Casual' — narrower than layer a's own rows, which is what `bandOrder` calls an APPEND
    const a: RenderLayer = { layerId: 'a', table: 'ta', rows: [{ shelf: 'Casual', count: 4 }, { shelf: 'Formal', count: 9 }], encodings: { category: 'shelf' } };
    const { el, m } = mountFrame({ layers: { a: { kind: 'bar' } } }, ['a']);
    m.update(framed([a], { category: SHARED('categorical', ['Casual']) }));
    // the guide draws the APPENDED category too — the union, not just the fold (excluding the axis LABEL, also a `.vzf-tick`)
    const ticks = Array.from(el.querySelectorAll('.vzf-frame-guide text.vzf-tick:not(.vzf-frame-axislabel)'));
    expect(ticks.map((t) => t.textContent)).toEqual(['Casual', 'Formal']);
    const tickX: Record<string, number> = {};
    for (const t of ticks) tickX[t.textContent ?? ''] = parseFloat(t.getAttribute('x') ?? '');
    for (const rect of Array.from(el.querySelectorAll('[data-layer="a"] rect.vzf-barrect'))) {
      const category = rect.getAttribute('aria-label')?.replace(/^select (\S+).*$/, '$1') ?? '';
      const x = parseFloat(rect.getAttribute('x') ?? '0');
      const w = parseFloat(rect.getAttribute('width') ?? '0');
      // the bar's own centre lands exactly on its tick's x — including 'Casual', the band the fold DID name
      expect(x + w / 2, category).toBeCloseTo(tickX[category]!, 5);
    }
    m.unmount();
  });

  it('a band layer that binds no category channel at all contributes nothing to the union — "never declared that axis", not a crash', () => {
    const a: RenderLayer = { layerId: 'a', table: 'ta', rows: [{ shelf: 'Casual', count: 4 }], encodings: { category: 'shelf' } };
    const b: RenderLayer = { layerId: 'b', table: 'tb', rows: [{ count: 9 }], encodings: {} }; // no `category` encoding
    const { el, m } = mountFrame({ layers: { a: { kind: 'bar' }, b: { kind: 'bar' } } });
    m.update(framed([a, b], { category: SHARED('categorical', ['Casual']) }));
    const ticks = el.querySelectorAll('.vzf-frame-guide text.vzf-tick:not(.vzf-frame-axislabel)');
    expect(Array.from(ticks).map((t) => t.textContent)).toEqual(['Casual']); // b named no category, so it named nothing to append
    m.unmount();
  });
});

describe('layeredRenderer — whose voice a gesture is', () => {
  it('a click on layer b lands through b’s OWN bundle, never the view’s or a’s', () => {
    const a: RenderLayer = { layerId: 'a', table: 'ta', rows: [{ shelf: 'Casual', count: 4 }], encodings: { category: 'shelf' } };
    const b: RenderLayer = { layerId: 'b', table: 'tb', rows: [{ shelf: 'Formal', count: 2 }], encodings: { category: 'shelf' } };
    const { el, m, view, bundles } = mountFrame({ layers: { a: { kind: 'bar' }, b: { kind: 'bar' } } });
    m.update(framed([a, b], { category: SHARED('categorical', ['Casual', 'Formal']) }));
    fireEvent.click(el.querySelector('[data-layer="b"] rect.vzf-barrect')!);
    expect(bundles['b']?.emit).toHaveBeenCalledTimes(1);
    expect(bundles['a']?.emit).not.toHaveBeenCalled();
    expect(view.emit).not.toHaveBeenCalled();
    m.unmount();
  });

  it('with no bundle for a layer the VIEW speaks — a 1.1 host loses the address, not the gesture', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const view = callbacks();
    const m = layeredRenderer({ layers: { a: { kind: 'bar' } } }).mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: view });
    m.update(framed([{ layerId: 'a', table: 'ta', rows: [{ shelf: 'Casual', count: 4 }], encodings: { category: 'shelf' } }]));
    fireEvent.click(el.querySelector('rect.vzf-barrect')!);
    expect(view.emit).toHaveBeenCalledTimes(1);
    m.unmount();
  });
});

describe('layeredRenderer — what a stack may not be, in words', () => {
  it('a layer with no mark named for it', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' } } });
    m.update(framed([POINTS_LAYER, LINE_LAYER], XY_FRAME));
    expect(refusalOf(el)).toContain('layer "b": no mark was named for it');
    m.unmount();
  });

  it('a kind that owns its own frame', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' }, b: { kind: 'heatmap' } } });
    m.update(framed([POINTS_LAYER, LINE_LAYER], XY_FRAME));
    expect(refusalOf(el)).toBe('layer "b": a heatmap owns its own frame — a frame draws line, bar, point, histogram and boxplot marks. Draw it on a frame of its own.');
    m.unmount();
  });

  it('a RUN over bands — a line whose x COLUMN is a number or a date, over a bar — is refused, naming the column and its type (a line whose x is a category is a band, below)', () => {
    const bar: RenderLayer = { layerId: 'a', table: 'ta', rows: [{ shelf: 'Casual', count: 4 }], encodings: { category: 'shelf' } };
    const { el, m } = mountFrame({ layers: { a: { kind: 'bar' }, b: { kind: 'line' } } });
    // a NUMBER on the line's x
    m.update(framed([bar, LINE_LAYER], { ...XY_FRAME, category: SHARED('categorical', ['Casual']) }));
    expect(refusalOf(el)).toBe('layer "b" draws its x as a run — column "price" is a number — over layer "a"\'s bands; a line over bands must bind a category to x, or take a frame of its own.');
    // a DATE on the line's x — the very figure the old refusal argued from
    const dated: RenderLayer = { layerId: 'b', table: 'trend', rows: [{ when: '2026-01-01', v: 1 }], encodings: { x: 'when', y: 'v' } };
    m.update(framed([bar, dated], { category: SHARED('categorical', ['Casual']), x: SHARED('temporal', ['2026-01-01', '2026-01-04']), y: XY_FRAME.y }));
    expect(refusalOf(el)).toBe('layer "b" draws its x as a run — column "when" is a date — over layer "a"\'s bands; a line over bands must bind a category to x, or take a frame of its own.');
    // an x the frame folded NOTHING for is not a band either — the sentence says what it knows
    m.update(framed([bar, LINE_LAYER], { category: SHARED('categorical', ['Casual']) }));
    expect(refusalOf(el)).toContain('column "price" was not folded on this frame');
    // a line that binds NO x is a run too — a scale folded over somebody else's column says nothing about an
    // axis this layer never declared (the `layerDomain` law), even with `x` folded as categories on the frame
    m.update(framed([bar, { ...LINE_LAYER, encodings: { y: 'rating' } }], { category: SHARED('categorical', ['Casual']), x: SHARED('categorical', ['Casual']) }));
    expect(refusalOf(el)).toContain('draws its x as a run — it binds no column to x — over layer "a"');
    m.unmount();
    // a histogram is a run by its MARK (its bins sit on a number), whatever the column
    const hist: RenderLayer = { layerId: 'h', table: 't', rows: [{ x0: 0, x1: 5, count: 2 }], encodings: { x: 'shelf' } };
    const mixed = mountFrame({ layers: { a: { kind: 'bar' }, h: { kind: 'histogram' } } }, ['a', 'h']);
    mixed.m.update(framed([bar, hist], { category: SHARED('categorical', ['Casual']), x: SHARED('categorical', ['Casual']) }));
    expect(refusalOf(mixed.el)).toBe('layer "h" draws its x as a run — its bins sit on a number — over layer "a"\'s bands; a histogram over bands must bind a category to x, or take a frame of its own.');
    mixed.m.unmount();
  });

  it('two bands with no category list folded for them', () => {
    const a: RenderLayer = { layerId: 'a', table: 'ta', rows: [{ shelf: 'Casual', count: 4 }], encodings: { category: 'shelf' } };
    const b: RenderLayer = { layerId: 'b', table: 'tb', rows: [{ shelf: 'Formal', count: 2 }], encodings: { category: 'shelf' } };
    const { el, m } = mountFrame({ layers: { a: { kind: 'bar' }, b: { kind: 'bar' } } });
    m.update(framed([a, b]));
    expect(refusalOf(el)).toContain('the frame folded no category list for them');
    // …and a numeric fold is not a category list either
    m.update(framed([a, b], { category: SHARED('quantitative', [0, 10]) }));
    expect(refusalOf(el)).toContain('the frame folded no category list for them');
    m.unmount();
    // a stack whose two band marks name two different x CHANNELS — a bar's x is `category` and a
    // box plot's is `x` — is ONE band only when BOTH were folded as categories (`sharedAxis`: two
    // names meet as one axis the way `fullBandOrder` unions rows); with the box plot's `x` folded as
    // NUMBERS there is no one band, and the stack stays at this refusal
    const box: RenderLayer = { layerId: 'b', table: 'tb', rows: [{ category: 'Casual', q1: 1, median: 2, q3: 3, whiskerLo: 0, whiskerHi: 4, outliers: [], count: 3 }], encodings: { x: 'shelf', y: 'price' } };
    const mixed = mountFrame({ layers: { a: { kind: 'bar' }, b: { kind: 'boxplot' } } });
    mixed.m.update(framed([a, box], { category: SHARED('categorical', ['Casual']), x: SHARED('quantitative', [0, 10]) }));
    expect(refusalOf(mixed.el)).toContain('the frame folded no category list for them');
    // …and with both folded as categories the two names ARE one band, so the stack reaches the box plot's own refusal
    mixed.m.update(framed([a, box], { category: SHARED('categorical', ['Casual']), x: SHARED('categorical', ['Casual']) }));
    expect(refusalOf(mixed.el)).toContain('is a box plot on a shared band');
    mixed.m.unmount();
  });

  it('a box plot on a shared band — it orders its slots by its own rows in this version', () => {
    // both box plots bind the SAME channel (a box plot's x is `x`, a bar's is `category`), so this is
    // the stack where a shared band really was folded for two band layers — and one of them cannot read it
    const boxRow = { category: 'Casual', q1: 1, median: 2, q3: 3, whiskerLo: 0, whiskerHi: 4, outliers: [], count: 3 };
    const a: RenderLayer = { layerId: 'a', table: 'ta', rows: [boxRow], encodings: { x: 'shelf', y: 'price' } };
    const b: RenderLayer = { layerId: 'b', table: 'tb', rows: [boxRow], encodings: { x: 'shelf', y: 'price' } };
    const { el, m } = mountFrame({ layers: { a: { kind: 'boxplot' }, b: { kind: 'boxplot' } } });
    m.update(framed([a, b], { x: SHARED('categorical', ['Casual']), y: SHARED('quantitative', [0, 5]) }));
    expect(refusalOf(el)).toBe('layer "a" is a box plot on a shared band: a box plot orders its slots by its own rows in this version, so it cannot line up with layer "b". Give it a frame of its own.');
    m.unmount();
  });

  it('a line split into series — its legend would move its plot top off the frame’s', () => {
    const coloured: RenderLayer = { layerId: 'b', table: 'trend', rows: [{ price: 20, rating: 3, grp: 'x' }, { price: 80, rating: 7, grp: 'y' }], encodings: { x: 'price', y: 'rating', color: 'grp' } };
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' }, b: { kind: 'line' } } });
    m.update(framed([POINTS_LAYER, coloured], XY_FRAME));
    expect(refusalOf(el)).toContain('layer "b" is a line split into 2 series');
    // ONE series is fine: the legend is not drawn, so the box does not move
    m.update(framed([POINTS_LAYER, { ...coloured, rows: [{ price: 20, rating: 3, grp: 'x' }] }], XY_FRAME));
    expect(refusalOf(el)).toBe('');
    m.unmount();
  });

  it('per-layer guides on two or more layers — every layer’s plot rectangle is the SAME rectangle, so their axes would land on the SAME pixels', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' }, b: { kind: 'line' } } });
    m.update(framed([POINTS_LAYER, LINE_LAYER], { x: { ...XY_FRAME.x, guide: 'per-layer' } as ResolvedChannel, y: XY_FRAME.y }));
    expect(refusalOf(el)).toBe("per-layer guides overprint on one frame in this version — declare guide: 'merged', or draw one layer");
    // a SINGLE layer under per-layer has no second axis to collide with, so it stays legal
    m.update(framed([POINTS_LAYER], { x: { ...XY_FRAME.x, guide: 'per-layer' } as ResolvedChannel, y: XY_FRAME.y }));
    expect(refusalOf(el)).toBe('');
    m.unmount();
  });

  it('a frame with no layers at all', () => {
    const { el, m } = mountFrame({ layers: {} }, []);
    m.update(state([]));
    expect(refusalOf(el)).toContain('this frame carried no layers');
    m.unmount();
  });
});

describe('layeredRenderer — a temporal frame', () => {
  const ROWS: RenderRow[] = [
    { when: '2026-01-01', v: 1 },
    { when: '2026-01-04', v: 5 },
  ];
  const LAYER: RenderLayer = { layerId: 'a', table: 't', rows: ROWS, encodings: { x: 'when', y: 'v' } };

  it('a shared temporal x is spelled as DAYS on the guide — folded as ISO strings, drawn on the epoch milliseconds the charts position dates on', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'line' } } }, ['a']);
    m.update(framed([LAYER], { x: SHARED('temporal', ['2026-01-01', '2026-01-04']), y: SHARED('quantitative', [0, 10]) }));
    const ticks = Array.from(el.querySelectorAll('.vzf-frame-guide text.vzf-tick')).map((t) => t.textContent);
    expect(ticks.slice(0, 4)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
    m.unmount();
  });

  it('a date pair nothing can parse is NO axis — the guide draws its line and no ticks, and the layer keeps its own extent', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'line' } } }, ['a']);
    m.update(framed([LAYER], { x: SHARED('temporal', ['not-a-date', 'nor-this']), y: SHARED('quantitative', [0, 10]) }));
    const ticks = Array.from(el.querySelectorAll('.vzf-frame-guide text.vzf-tick')).map((t) => t.textContent);
    // the y ticks and the axis labels survive; not one x tick was invented
    expect(ticks).toEqual(['0', '3.3', '6.7', '10', 'when', 'v']);
    m.unmount();
  });
});

describe('layeredRenderer — an INDEPENDENT channel', () => {
  it('a channel the def left to the layer gets no merged guide and no domain: the layer keeps its own scale', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' } } }, ['a']);
    m.update(framed([POINTS_LAYER], { x: { mode: 'independent', guide: 'per-layer' }, y: XY_FRAME.y }));
    // an independent channel's guide is per-layer by definition, and a chart draws both axes or neither
    expect(guidesOf(el)).toBe(0);
    // the scatter's own x extent is its rows' (10..90 padded), NOT the frame's 0..100 — its first tick says so
    expect(el.querySelector('.vzf-scatter text.vzf-tick')?.textContent).not.toBe('0');
    m.unmount();
  });
});

describe('layeredRenderer — a line on a BAND (band versus run is the x COLUMN’s)', () => {
  /** A bar layer of counts per shelf, and a line of a mean per shelf — the same categories, the same table. */
  const BARS: RenderLayer = { layerId: 'a', table: 'ta', rows: [{ shelf: 'Casual', count: 4 }, { shelf: 'Formal', count: 9 }, { shelf: 'Sporty', count: 2 }], encodings: { category: 'shelf' } };
  const MEANS: RenderLayer = { layerId: 'b', table: 'tb', rows: [{ shelf: 'Formal', mean: 7 }, { shelf: 'Casual', mean: 3 }], encodings: { x: 'shelf', y: 'mean' } };
  /** A bar's slot centre and a line's dot, each in the FRAME's pixels (its layer's own svg x plus the layer box's left offset). */
  const slotCentresOf = (el: Element, layerId: string): Record<string, number> => {
    const box = el.querySelector<HTMLElement>(`[data-layer="${layerId}"]`)!;
    const left = Number.parseFloat(box.style.left);
    const out: Record<string, number> = {};
    for (const rect of box.querySelectorAll('rect.vzf-barrect')) {
      const category = rect.getAttribute('aria-label')!.replace(/^select (\S+).*$/, '$1');
      out[category] = left + Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2;
    }
    for (const dot of box.querySelectorAll('circle.vzf-line-dot')) {
      out[dot.querySelector('title')!.textContent!.split(' · ')[0]!] = left + Number(dot.getAttribute('cx'));
    }
    return out;
  };

  it('a bar and a line whose x column is CATEGORICAL are two bands on ONE x: one guide, and the line’s point for a category sits at the bar’s slot centre', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'bar' }, b: { kind: 'line' } } });
    // the host folded the bar's `category` and the line's `x` — two channel NAMES, both categories, so one band
    m.update(framed([BARS, MEANS], { category: SHARED('categorical', ['Casual', 'Formal', 'Sporty']), x: SHARED('categorical', ['Formal', 'Casual']), y: SHARED('quantitative', [0, 10]) }));
    expect(refusalOf(el)).toBe('');
    expect(guidesOf(el)).toBe(1);
    // the merged guide's band is the frame's order, and the axis is named by the field both layers bind
    expect(Array.from(el.querySelectorAll('.vzf-frame-guide text.vzf-tick')).map((t) => t.textContent)).toEqual(['Casual', 'Formal', 'Sporty', '0', '3.3', '6.7', '10', 'shelf', 'mean']);
    // neither layer drew an axis of its own
    expect(el.querySelectorAll('.vzf-frame-layer .vzf-axis')).toHaveLength(0);
    // THE SHARED X, per category: the bar's slot centre and the line's dot are one pixel, in the frame's pixels
    const bars = slotCentresOf(el, 'a');
    const line = slotCentresOf(el, 'b');
    expect(Object.keys(line).sort()).toEqual(['Casual', 'Formal']);
    for (const category of Object.keys(line)) expect(line[category], category).toBeCloseTo(bars[category]!, 5);
    // and the line's points are in the FRAME's order (Casual before Formal), not the line's own (Formal first)
    const dots = Array.from(el.querySelectorAll('[data-layer="b"] circle.vzf-line-dot'));
    expect(dots.map((d) => d.querySelector('title')!.textContent!.split(' · ')[0])).toEqual(['Casual', 'Formal']);
    // 'Sporty' — a slot the line has no point for — is a GAP: no dot, and the one path joins only the two adjacent slots
    expect(el.querySelectorAll('[data-layer="b"] path.vzf-line-path')).toHaveLength(1);
    m.unmount();
  });

  it('a line’s own category the frame did not name is APPENDED to the band, and the bar’s slots move with it (one union for the guide and every layer)', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'bar' }, b: { kind: 'line' } } });
    const extra: RenderLayer = { ...MEANS, rows: [...MEANS.rows, { shelf: 'Vintage', mean: 5 }] };
    m.update(framed([BARS, extra], { category: SHARED('categorical', ['Casual', 'Formal', 'Sporty']), x: SHARED('categorical', ['Formal', 'Casual']), y: SHARED('quantitative', [0, 10]) }));
    const ticks = Array.from(el.querySelectorAll('.vzf-frame-guide text.vzf-tick')).map((t) => t.textContent);
    expect(ticks.slice(0, 4)).toEqual(['Casual', 'Formal', 'Sporty', 'Vintage']);
    // four bands now, and the bar's Casual still sits under the line's Casual
    const bars = slotCentresOf(el, 'a');
    const line = slotCentresOf(el, 'b');
    expect(line['Casual']).toBeCloseTo(bars['Casual']!, 5);
    m.unmount();
  });

  it('two band LINES share the band order the way two bars do — and with no category list folded for them, the existing two-bands refusal', () => {
    const other: RenderLayer = { layerId: 'a', table: 'ta', rows: [{ shelf: 'Sporty', mean: 1 }, { shelf: 'Casual', mean: 2 }], encodings: { x: 'shelf', y: 'mean' } };
    const { el, m } = mountFrame({ layers: { a: { kind: 'line' }, b: { kind: 'line' } } });
    m.update(framed([other, MEANS], { x: SHARED('categorical', ['Casual', 'Formal', 'Sporty']), y: SHARED('quantitative', [0, 10]) }));
    expect(refusalOf(el)).toBe('');
    const first = slotCentresOf(el, 'a');
    const second = slotCentresOf(el, 'b');
    expect(first['Casual']).toBeCloseTo(second['Casual']!, 5);
    // the same two lines with their x folded as NOTHING: neither is a band (the column's kind is unknown to the
    // frame), so they are two runs of dates — drawn, each on its own extent, exactly as two dated lines are
    m.update(framed([other, MEANS], { y: SHARED('quantitative', [0, 10]) }));
    expect(refusalOf(el)).toBe('');
    m.unmount();
  });

  it('a POINT layer whose x column is categorical classifies as a band too — and is refused in words, because a point chart draws no band in this version', () => {
    const points: RenderLayer = { layerId: 'b', table: 'tb', rows: [{ id: 'p', shelf: 'Casual', rating: 3 }], encodings: { x: 'shelf', y: 'rating' } };
    const { el, m } = mountFrame({ layers: { a: { kind: 'bar' }, b: { kind: 'point' } } });
    m.update(framed([BARS, points], { category: SHARED('categorical', ['Casual']), x: SHARED('categorical', ['Casual']), y: SHARED('quantitative', [0, 10]) }));
    // NOT the run-over-bands refusal: the point IS a band by its column
    expect(refusalOf(el)).toBe('layer "b" is a point on a band — column "shelf" is a category — and a point chart draws no band in this version. Draw it as a line, or give it a frame of its own.');
    // a point whose x is a NUMBER stays the run it always was
    m.update(framed([BARS, { ...POINTS_LAYER, layerId: 'b' }], { category: SHARED('categorical', ['Casual']), x: SHARED('quantitative', [0, 100]), y: SHARED('quantitative', [0, 10]) }));
    expect(refusalOf(el)).toContain('draws its x as a run — column "price" is a number');
    m.unmount();
  });

  it('a plain line VIEW (no frame) is the dated line it always was — a band exists only where the fold says the column is categorical', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const m = lineRenderer().mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks() });
    m.update(state([{ date: '2026-01-01', value: 1 }, { date: '2026-01-03', value: 3 }], { x: 'date', y: 'value' }));
    // date ticks, not band labels
    expect(Array.from(el.querySelectorAll('text.vzf-tick')).map((t) => t.textContent).slice(0, 2)).toEqual(['2026-01-01', '2026-01-03']);
    m.unmount();
  });
});
