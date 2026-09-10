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
