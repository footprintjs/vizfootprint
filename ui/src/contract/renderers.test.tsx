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
  twoScalesSentence,
  NETWORK_EDGE_CEILING,
  NETWORK_NODE_CEILING,
} from './renderers.js';
import { emptySelection, selectionForView } from './selection.js';
import { validateFrame, layerAddress, firstScaleTakenRefusal } from 'vizfootprint/def';
import type { LinkGraphView, SelectionView } from '../adapter/types.js';
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
// the bar's own margin — its plot's left edge is where its count axis stands (`VizBar` · `PAD`, the one owner)
import { PAD as BAR_PAD } from '../charts/VizBar.js';

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

describe('lineRenderer — a layerless line over a category (packet V, the blocking finding)', () => {
  const CATEGORICAL_X: Readonly<Record<string, ResolvedChannel>> = {
    x: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'categorical', domain: ['TX', 'CA'] },
  };
  const TEMPORAL_X: Readonly<Record<string, ResolvedChannel>> = {
    x: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'temporal', domain: ['2026-05-01', '2026-05-02'] },
  };

  // THE BUG: `viewDraw` gave a layerless view `domain: {}` unconditionally — the only signal
  // `lineMark` read for band-versus-run — so a line over a string x built DATED points no matter
  // what the door had just accepted (`CHART_REQUIREMENTS.line.x`, widened this packet),
  // `Date.parse` could not place "TX"/"CA", and every point was skipped: an svg with no line path.
  it('draws a band line with the slot labels when the x column was folded as a category — no line path is the bug', () => {
    const r = lineRenderer();
    const { el, m } = mounted(r);
    m.update({ ...state([{ area: 'TX', value: 3 }, { area: 'CA', value: 5 }], { x: 'area', y: 'value' }), frame: CATEGORICAL_X });
    expect(el.querySelectorAll('path.vzf-line-path')).toHaveLength(1);
    expect(el.querySelectorAll('.vzf-line-dot')).toHaveLength(2);
    expect(el.textContent).toContain('TX');
    expect(el.textContent).toContain('CA');
    m.unmount();
  });

  // a plain view with NO frame at all (a host that folds none, or a bare `RenderState`) is
  // completely unaffected: `sharedOn(undefined, 'x')` answers undefined, so `onBand` reduces to
  // exactly what it always was, and a date draws the dated line byte-identically either way.
  it('a date column still draws the dated line byte-identically, framed or not', () => {
    const rows = [{ date: '2026-05-01', value: 1 }, { date: '2026-05-02', value: 2 }];
    const bare = mounted(lineRenderer());
    bare.m.update(state(rows, { x: 'date', y: 'value' }));
    const barePath = bare.el.querySelector('path.vzf-line-path')!.getAttribute('d');
    bare.m.unmount();

    const withFrame = mounted(lineRenderer());
    withFrame.m.update({ ...state(rows, { x: 'date', y: 'value' }), frame: TEMPORAL_X });
    const framedPath = withFrame.el.querySelector('path.vzf-line-path')!.getAttribute('d');
    withFrame.m.unmount();

    expect(framedPath).toBe(barePath);
  });
});

describe('lineRenderer — a line over NUMBERS (the third arm, and the defect it closes)', () => {
  const QUANTITATIVE_X: Readonly<Record<string, ResolvedChannel>> = {
    x: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain: [10, 250] },
  };
  const RESIDUES: RenderRow[] = [
    { resnum: 13, rmsf: 1 },
    { resnum: 31, rmsf: 2 },
    { resnum: 107, rmsf: 3 },
    { resnum: 241, rmsf: 4 },
  ];

  // THE DEFECT: every non-band row became `{ date: String(value) }`, so a number reached the chart
  // as a date-shaped string. `Date.parse('13')` and `Date.parse('31')` answer NOTHING, so those two
  // residues were dropped in silence; residue 107 became the year 0107 and landed to the LEFT of a
  // residue 99 — and the drag landed date-shaped strings on a numeric column. Two earlier briefs
  // blamed a BAND x; the cause was here, in this one `String(…)`.
  it('passes a numeric x AS A NUMBER: every row is drawn, and in the axis\u2019s own order', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const m = lineRenderer().mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks() });
    m.update(state(RESIDUES, { x: 'resnum', y: 'rmsf' }));
    // all four residues drawn — the old arm drew two (`Date.parse` could place neither 13 nor 31)
    expect(el.querySelectorAll('.vzf-line-dot')).toHaveLength(4);
    expect(Number.isNaN(Date.parse('13'))).toBe(true);
    expect(Number.isNaN(Date.parse('31'))).toBe(true);
    // …and they sit in the residue number's own order (`conformance.test.tsx` drives the DRAG through
    // the whole loop — a real session, the landed clause asserted)
    const cx = [...el.querySelectorAll('.vzf-line-dot')].map((d) => Number(d.getAttribute('cx')));
    expect([...cx].sort((a, b) => a - b)).toEqual(cx);
    m.unmount();
  });

  it('the FOLD wins over the value’s runtime type: a quantitative channel makes a numeric run even where the rows carry text', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const m = lineRenderer().mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks() });
    m.update({ ...state([{ resnum: '13', rmsf: 1 }, { resnum: '31', rmsf: 2 }, { resnum: null, rmsf: 3 }], { x: 'resnum', y: 'rmsf' }), frame: QUANTITATIVE_X });
    // the two numbers are drawn (as dates neither string could be placed at all) — and the row
    // holding nothing a number can be read from is SKIPPED, never drawn at zero
    expect(el.querySelectorAll('.vzf-line-dot')).toHaveLength(2);
    m.unmount();
  });

  it('a CATEGORICAL fold still wins over a numeric value — a declared band is a band, and its slots are named by their numbers', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const m = lineRenderer().mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks() });
    m.update({
      ...state(RESIDUES, { x: 'resnum', y: 'rmsf' }),
      frame: { x: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'categorical', domain: ['13', '31', '107', '241'] } as ResolvedChannel },
    });
    expect(el.textContent).toContain('107');
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

// ── networkRenderer — the fold per layer (protocol 1.8) ───────────────────────

/** The two layers, each carrying the fold at ITS address — what a 1.8 host pushes. */
function netFolded(selections: readonly SelectionView[], links?: LinkGraphView): RenderState {
  const at = (layerId: string) => selectionForView(selections, layerAddress('net', layerId), 'intersect', links);
  return { ...layered([{ ...EDGES_LAYER, selection: at('edges') }, { ...NODES_LAYER, selection: at('nodes') }]), selection: selectionForView(selections, 'net', 'intersect', links) };
}

const classOf = (el: Element, selector: string): string | null => el.querySelector(selector)?.getAttribute('class') ?? null;

describe('networkRenderer — the fold per layer (protocol 1.8)', () => {
  const clicked: SelectionView = { viewId: 'net~nodes', field: 'disease', kind: 'point', value: 'flu' };

  it('with no link crossing the siblings, per-layer folds draw byte-identically to the one fold at the nodes address (the 1.7 host)', () => {
    const { el, m } = mountNet();
    // the nodes' own click, and another view's clause reaching BOTH layers (only the node rows carry `grp`)
    const selections: SelectionView[] = [clicked, { viewId: 'other', field: 'grp', kind: 'point', value: 'viral' }];
    const links: LinkGraphView = {
      default: 'crossfilter',
      views: [],
      edges: [
        { id: 'o-n', source: 'other', kind: 'point', target: 'net~nodes', response: 'filter', origin: 'default' },
        { id: 'o-e', source: 'other', kind: 'point', target: 'net~edges', response: 'filter', origin: 'default' },
      ],
    };
    // the 1.7 host: ONE fold, at the nodes address — the rule the header used to require
    m.update({ ...layered([EDGES_LAYER, NODES_LAYER]), selection: selectionForView(selections, 'net~nodes') });
    const oneFold = el.innerHTML;
    // flu is outlined (self), strep dims (bacterial), and the link into strep is as bright as its ends
    expect(classOf(el, 'circle[data-node="flu"]')).toBe('vzf-dot vzf-selected');
    expect(classOf(el, 'circle[data-node="strep"]')).toBe('vzf-dot vzf-dim');
    expect(classOf(el, 'line[aria-label="cold — strep"]')).toBe('vzf-net-link vzf-dim');
    expect(classOf(el, 'line[aria-label="flu — cold"]')).toBe('vzf-net-link');
    // the 1.8 host: the edges' fold carries `other` (unjudgeable on the edge rows) and NOT the nodes' click —
    // sibling layers hold no default edge between them, which is exactly what the one fold's self-skip drew
    m.update(netFolded(selections, links));
    expect(el.innerHTML).toBe(oneFold);
    m.unmount();
  });

  it('a declared highlight edge from net~nodes into net~edges is honoured at the links — which one fold could never say', () => {
    const { el, m } = mountNet();
    const links: LinkGraphView = {
      default: 'crossfilter',
      views: [],
      // the clicked node's id, read as the link's SOURCE end
      edges: [{ id: 'n-e', source: 'net~nodes', kind: 'point', target: 'net~edges', response: 'highlight', origin: 'declared', mapping: [{ from: 'disease', to: 'src' }] }],
    };
    m.update(netFolded([clicked], links));
    // the nodes: flu outlined, nobody dimmed (the click is the nodes layer's own clause)
    expect(classOf(el, 'circle[data-node="flu"]')).toBe('vzf-dot vzf-selected');
    expect(el.querySelectorAll('circle.vzf-dim')).toHaveLength(0);
    // the links: judged by THEIR rows under THEIR fold — the one flu is the source of stays bright, the other dims, though both its ends are bright
    expect(classOf(el, 'line[aria-label="flu — cold"]')).toBe('vzf-net-link');
    expect(classOf(el, 'line[aria-label="cold — strep"]')).toBe('vzf-net-link vzf-dim');
    // the 1.7 host, one fold at the nodes: the same declared edge reaches nothing, and neither link dims
    m.update({ ...layered([EDGES_LAYER, NODES_LAYER]), selection: selectionForView([clicked], 'net~nodes', 'intersect', links) });
    expect(el.querySelectorAll('line.vzf-dim')).toHaveLength(0);
    m.unmount();
  });

  // REVIEW (packet AI, FIRST TARGET b): the sibling mapping above lands on `src`
  // (flu is the SOURCE it dims by); the OTHER endpoint must work exactly the same
  // way, off the very same NetworkEdge.row (`tgt`) — proving `row` is the edge
  // TABLE's own row (it carries both endpoint columns, not just the one `src` used).
  it('the sibling mapping to the OTHER endpoint (disease → tgt) is honoured too — the row backing it is the edge table row, not a synthesized one', () => {
    const { el, m } = mountNet();
    const links: LinkGraphView = {
      default: 'crossfilter',
      views: [],
      edges: [{ id: 'n-e', source: 'net~nodes', kind: 'point', target: 'net~edges', response: 'highlight', origin: 'declared', mapping: [{ from: 'disease', to: 'tgt' }] }],
    };
    m.update(netFolded([clicked], links)); // clicked names 'flu'
    // flu is never a TARGET in either edge (tgt is 'cold' or 'strep') — both dim, the mirror of the `src` mapping's result
    expect(classOf(el, 'line[aria-label="flu — cold"]')).toBe('vzf-net-link vzf-dim');
    expect(classOf(el, 'line[aria-label="cold — strep"]')).toBe('vzf-net-link vzf-dim');
    // mapped onto the end that DOES read 'flu' as a tgt (`cold — strep`'s tgt is 'strep', so pick a clause that reads it)
    const stripClicked: SelectionView = { viewId: 'net~nodes', field: 'disease', kind: 'point', value: 'strep' };
    m.update(netFolded([stripClicked], links));
    expect(classOf(el, 'line[aria-label="cold — strep"]')).toBe('vzf-net-link'); // strep IS this row's tgt
    expect(classOf(el, 'line[aria-label="flu — cold"]')).toBe('vzf-net-link vzf-dim'); // this row's tgt is 'cold', not 'strep'
    m.unmount();
  });

  it('a layer that carries no fold reads the frame\'s — the nodes on their own, the links by their ends alone', () => {
    const { el, m } = mountNet();
    const selections: SelectionView[] = [clicked, { viewId: 'other', field: 'grp', kind: 'point', value: 'viral' }];
    // only the edges layer carries a fold — a clause on a column only the edge rows carry
    const edgesOnly: SelectionView[] = [{ viewId: 'other', field: 'target_x', kind: 'interval', value: [3, 5] }];
    m.update({ ...layered([{ ...EDGES_LAYER, selection: selectionForView(edgesOnly, 'net~edges') }, NODES_LAYER]), selection: selectionForView(selections, 'net~nodes') });
    // the nodes read the frame's fold: flu outlined, strep dimmed (bacterial)
    expect(classOf(el, 'circle[data-node="flu"]')).toBe('vzf-dot vzf-selected');
    expect(classOf(el, 'circle[data-node="cold"]')).toBe('vzf-dot');
    expect(classOf(el, 'circle[data-node="strep"]')).toBe('vzf-dot vzf-dim');
    // the links read their own: flu — cold dims by its ROW (target_x 10 fails [3, 5]) with both ends bright; cold — strep by its END
    expect(classOf(el, 'line[aria-label="flu — cold"]')).toBe('vzf-net-link vzf-dim');
    expect(classOf(el, 'line[aria-label="cold — strep"]')).toBe('vzf-net-link vzf-dim');
    m.unmount();
  });

  // REVIEW (packet AI, FIRST TARGET a): a neighbourhood clause is only ever really
  // sourced at net~edges (`VizNetwork`'s walk emits on the edges' own voice), so it
  // is always self there and `edgeBright` never runs it. This is the synthetic case
  // the law must still answer: a walk-kind clause sourced at net~nodes, reaching
  // net~edges over a DECLARED edge. Self means `viewId === selfClauseId`, so this
  // clause is NOT self at the edges' fold — it is judged there like any other.
  it('a neighbourhood clause sourced at net~nodes is NOT self at net~edges — the edges\' own fold judges it independently of the ego the nodes side already drew, and the two never disagree where both have evidence', () => {
    const { el, m } = mountNet();
    const walked: SelectionView = { viewId: 'net~nodes', field: 'disease', kind: 'neighbourhood', fields: ['src', 'tgt'], value: { seed: 'flu', derivation: 'ego', hops: 1, ids: ['flu', 'cold'] } };
    const links: LinkGraphView = {
      default: 'crossfilter',
      views: [],
      edges: [{ id: 'n-e', source: 'net~nodes', kind: 'neighbourhood', target: 'net~edges', response: 'highlight', origin: 'declared' }],
    };
    m.update(netFolded([walked], links));
    // the nodes: this clause IS the nodes' own (self at net~nodes) — the ego lights flu+cold, strep dims;
    // `withoutWalks` keeps it out of the row fold too, so nobody is dimmed twice on this side
    expect(classOf(el, 'circle[data-node="flu"]')).toBe('vzf-dot');
    expect(classOf(el, 'circle[data-node="cold"]')).toBe('vzf-dot');
    expect(classOf(el, 'circle[data-node="strep"]')).toBe('vzf-dot vzf-dim');
    // the links: both mechanisms agree where both have evidence — flu–cold's ends are both walked
    // (bright by `survivesById` already) AND its row is in the walked ids (bright by `survivesOwnFold`
    // too); cold–strep dims by its END (strep outside ego) AND independently by its ROW (tgt "strep"
    // outside ids) — redundant, not contradictory, and never a double-DIM of an otherwise-bright link
    expect(classOf(el, 'line[aria-label="flu — cold"]')).toBe('vzf-net-link');
    expect(classOf(el, 'line[aria-label="cold — strep"]')).toBe('vzf-net-link vzf-dim');
    m.unmount();
  });

  // A case where the two mechanisms are NOT redundant: with `strep` filtered out of the
  // NODES layer's own rows, `survivesById('strep')` has no row to judge and defaults bright
  // ("no evidence" — the law `survivesById`'s own comment states for a node the frame does
  // not carry). The edges' OWN fold still has the edge ROW, and judges it correctly — proving
  // the edges' fold is not a mere echo of the nodes' ego, and never draws a WRONG answer.
  it('with the far node missing from the nodes layer, the edges\' own fold still dims what the nodes-side ego cannot see', () => {
    const { el, m } = mountNet();
    const walked: SelectionView = { viewId: 'net~nodes', field: 'disease', kind: 'neighbourhood', fields: ['src', 'tgt'], value: { seed: 'flu', derivation: 'ego', hops: 1, ids: ['flu', 'cold'] } };
    const links: LinkGraphView = {
      default: 'crossfilter',
      views: [],
      edges: [{ id: 'n-e', source: 'net~nodes', kind: 'neighbourhood', target: 'net~edges', response: 'highlight', origin: 'declared' }],
    };
    const at = (layerId: string) => selectionForView([walked], layerAddress('net', layerId), 'intersect', links);
    // strep dropped from the NODES layer's own rows — its edge still carries the row (the edges table is untouched)
    m.update({ ...layered([{ ...EDGES_LAYER, selection: at('edges') }, { ...NODES_LAYER, rows: NET_NODES.slice(0, 2), selection: at('nodes') }]), selection: selectionForView([walked], 'net', 'intersect', links) });
    expect(el.querySelectorAll('circle[data-node="strep"]')).toHaveLength(0); // gone from the nodes layer, as set up
    // cold — strep: `survivesById('strep')` is `true` by default (no row, no evidence) — the edges'
    // own fold is what actually catches it (row.tgt "strep" is outside the walked ids)
    expect(classOf(el, 'line[aria-label="cold — strep"]')).toBe('vzf-net-link vzf-dim');
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
    // law 13: a LINE in the stack adds the `match` its band brush lands beside the `interval` its run brush
    // does — and the reachability law adds the `point` its band TAP lands, which is a point-select too
    expect(mixed.hello.capabilities).toMatchObject({ canBrush: true, canPointSelect: true, canHighlight: true, emissionKinds: ['interval', 'match', 'point'] });
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

describe('layeredRenderer — the fold per layer (protocol 1.8)', () => {
  /** A second point layer over the same x, so a brush on it has rows of its own to be self to. */
  const SECOND: RenderLayer = { layerId: 'b', table: 'trend', rows: [{ id: 'q1', price: 30, rating: 3 }, { id: 'q2', price: 70, rating: 7 }], encodings: { x: 'price', y: 'rating' } };
  /** Whether each dot of a layer is dimmed, in row order. */
  const dimsOf = (el: Element, layerId: string): boolean[] => [...el.querySelectorAll(`[data-layer="${layerId}"] circle.vzf-dot`)].map((dot) => dot.classList.contains('vzf-dim'));
  /** A brush on layer b: prices up to 50. */
  const brushOnB: SelectionView[] = [{ viewId: 'v~b', field: 'price', kind: 'interval', value: [0, 50] }];
  const at = (layerId: string) => selectionForView(brushOnB, layerAddress('v', layerId));

  it('a brush on layer b is b\'s SELF (never dimmed by it) and a\'s FOREIGN (dimmed) — two folds, one frame', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' }, b: { kind: 'point' } } });
    m.update({ ...framed([{ ...POINTS_LAYER, selection: at('a') }, { ...SECOND, selection: at('b') }], XY_FRAME), selection: selectionForView(brushOnB, 'v') });
    // b: its own brush dims nothing of its own — q2 at 70 is outside the brush and stays bright
    expect(dimsOf(el, 'b')).toEqual([false, false]);
    // a: the brush reached it as a foreign clause — p2 at 90 dims, p1 at 10 does not
    expect(dimsOf(el, 'a')).toEqual([false, true]);
    m.unmount();
  });

  it('a 1.7 host pushes no fold per layer, so every layer reads the frame\'s ONE fold — folded at a\'s address, b dims under its own brush', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' }, b: { kind: 'point' } } });
    // the old host's choice: the first layer is "self", and the second line's own brush is foreign to itself
    m.update({ ...framed([POINTS_LAYER, SECOND], XY_FRAME), selection: at('a') });
    expect(dimsOf(el, 'b')).toEqual([false, true]);
    expect(dimsOf(el, 'a')).toEqual([false, true]);
    const fallback = el.innerHTML;
    // the fallback IS the frame's fold: handing each layer that same fold draws byte-identically
    m.update({ ...framed([{ ...POINTS_LAYER, selection: at('a') }, { ...SECOND, selection: at('a') }], XY_FRAME), selection: at('a') });
    expect(el.innerHTML).toBe(fallback);
    m.unmount();
  });

  // REVIEW (packet AI, persona 2 — host author): the two tests above fold BOTH
  // layers or NEITHER; a host that folds only one is the documented mixed case
  // ("ABSENT = the layer reads RenderState.selection") and was untested for the
  // generic frame (only the network's nodes/edges pairing exercised it).
  it('layer a folds at its own address, layer b carries none — a is self-excluded from its own brush, b is not (it reads the frame\'s)', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' }, b: { kind: 'point' } } });
    const frameSelection = selectionForView(brushOnB, 'v'); // the view's own address — b's fallback, not a's
    m.update({ ...framed([{ ...POINTS_LAYER, selection: at('a') }, SECOND], XY_FRAME), selection: frameSelection });
    // a: its OWN fold — the brush (sourced 'v~b') is foreign at 'v~a', so it dims a's own rows, same as the two-folds test
    expect(dimsOf(el, 'a')).toEqual([false, true]);
    // b: NO `layer.selection` — falls back to `frameSelection` (self = 'v', not 'v~b'), so
    // b's OWN brush now reads as FOREIGN to itself too (today's pre-1.8 law, for the layer that opted out)
    expect(dimsOf(el, 'b')).toEqual([false, true]);
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

  it('a per-layer x on two or more layers — one frame has one x, so an x left to the layers is refused BY NAME (law 1)', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' }, b: { kind: 'line' } } });
    m.update(framed([POINTS_LAYER, LINE_LAYER], { x: { ...XY_FRAME.x, guide: 'per-layer' } as ResolvedChannel, y: XY_FRAME.y }));
    expect(refusalOf(el)).toBe(`x is per-layer on layers "a" and "b" — one frame has one x, drawn once by the frame. Declare guide: 'merged' on x, or draw one layer.`);
    // an INDEPENDENT x is per-layer by definition, and a frame that folded no x at all leaves it to the layers too
    m.update(framed([POINTS_LAYER, LINE_LAYER], { x: { mode: 'independent', guide: 'per-layer' }, y: XY_FRAME.y }));
    expect(refusalOf(el)).toContain('x is per-layer on layers "a" and "b"');
    m.update(framed([POINTS_LAYER, LINE_LAYER]));
    expect(refusalOf(el)).toContain('x is per-layer on layers "a" and "b"');
    // the old sentence is gone with the overprint it named
    expect(refusalOf(el)).not.toContain('overprint');
    // a SINGLE layer under per-layer draws its own pair, as it always did
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

describe('layeredRenderer — TWO SCALES ON ONE FRAME are two claims, and the frame has two sides to make them on', () => {
  /** A line of temperature and a line of rainfall over the same weeks — the honest dual-axis figure. */
  const TEMP: RenderLayer = { layerId: 'temp', table: 'weather', rows: [{ when: '2026-01-01', temperature: 3 }, { when: '2026-01-08', temperature: 9 }], encodings: { x: 'when', y: 'temperature' } };
  const RAIN: RenderLayer = { layerId: 'rain', table: 'weather', rows: [{ when: '2026-01-01', rainfall: 40 }, { when: '2026-01-08', rainfall: 12 }], encodings: { x: 'when', y: 'rainfall' } };
  const WIND: RenderLayer = { layerId: 'wind', table: 'weather', rows: [{ when: '2026-01-01', wind: 5 }, { when: '2026-01-08', wind: 7 }], encodings: { x: 'when', y: 'wind' } };
  /** x folded once for the frame (merged); y left to the layers — two scales. */
  const INDEPENDENT_Y: ResolvedChannel = { mode: 'independent', guide: 'per-layer' };
  const DUAL = { x: SHARED('temporal', ['2026-01-01', '2026-01-08']), y: INDEPENDENT_Y };
  const KINDS = { temp: { kind: 'line' }, rain: { kind: 'line' }, wind: { kind: 'line' } } as const;
  /** The interactive axis labels a LAYER drew — which channels it drew an axis for, and where its y label stands. */
  const layerAxes = (el: Element, layerId: string): { channels: string[]; yTransform: string | null } => {
    const box = el.querySelector(`[data-layer="${layerId}"]`)!;
    const groups = Array.from(box.querySelectorAll('.vzf-axis-group'));
    return { channels: groups.map((g) => g.getAttribute('data-axis-channel') ?? ''), yTransform: box.querySelector('.vzf-axis-group[data-axis-channel="y"]')?.getAttribute('transform') ?? null };
  };
  const captionOf = (el: Element): string => el.querySelector('.vzf-frame-caption')?.textContent ?? '';

  it('two per-layer lines: the first draws its y on the LEFT, the second on the RIGHT, the frame draws x ONCE, and the sentence names both fields', () => {
    const { el, m } = mountFrame({ layers: KINDS }, ['temp', 'rain']);
    m.update(framed([TEMP, RAIN], DUAL));
    expect(refusalOf(el)).toBe('');
    // x is the frame's: one guide, with the x label the two layers agree on and NO y of its own
    expect(guidesOf(el)).toBe(1);
    expect(Array.from(el.querySelectorAll('.vzf-frame-axislabel')).map((t) => t.textContent)).toEqual(['when']);
    // each layer drew ONLY its y — no x axis of its own to overprint the frame's
    const temp = layerAxes(el, 'temp');
    const rain = layerAxes(el, 'rain');
    expect(temp.channels).toEqual(['y']);
    expect(rain.channels).toEqual(['y']);
    // …the first on the left edge (the label reads upward), the second on the right (it reads downward, at the far edge)
    expect(temp.yTransform).toMatch(/^rotate\(-90 14 /);
    expect(rain.yTransform).toMatch(/^rotate\(90 /);
    const rainBox = el.querySelector<HTMLElement>('[data-layer="rain"]')!;
    expect(rain.yTransform).toContain(`rotate(90 ${String(parseFloat(rainBox.style.width) - 14)} `);
    // the right layer's ticks read rightward, the left layer's leftward
    expect(rainBox.querySelector('text.vzf-tick')?.getAttribute('text-anchor')).toBe('start');
    expect(el.querySelector('[data-layer="temp"] text.vzf-tick')?.getAttribute('text-anchor')).toBe('end');
    // law 3: the frame SAYS the scales are unrelated — in the caption a reader sees, and in the accessible label
    const sentence = twoScalesSentence('temperature', 'rainfall');
    expect(sentence).toBe('two scales — left is temperature, right is rainfall; heights are not comparable across them');
    expect(captionOf(el)).toBe(sentence);
    expect(el.querySelector('.vzf-frame')?.getAttribute('aria-label')).toContain(sentence);
    m.unmount();
  });

  it('the INK MATCHES THE SCALE (law 4): the left line and its axis are drawn in the left hue, the right line and its axis in the right one — through the whole consumer path', () => {
    const { el, m } = mountFrame({ layers: KINDS }, ['temp', 'rain']);
    m.update(framed([TEMP, RAIN], DUAL));
    expect(refusalOf(el)).toBe('');
    /** The vertical stroke of one layer's own y axis — the element the stylesheet paints with the hue. */
    const axisOf = (layerId: string): Element =>
      [...el.querySelectorAll(`[data-layer="${layerId}"] line.vzf-axis`)].find((l) => l.getAttribute('x1') === l.getAttribute('x2'))!;
    for (const [layerId, hue] of [['temp', 'var(--vzf-scale-left)'], ['rain', 'var(--vzf-scale-right)']] as const) {
      expect(axisOf(layerId).getAttribute('style')).toBe(`--vzf-scale-hue: ${hue};`);
      // …and the marks read against that axis wear the same hue, which is the whole point: a reader can
      // see which line belongs to which edge without reading the sentence first
      expect(el.querySelector(`[data-layer="${layerId}"] path.vzf-line-path`)?.getAttribute('stroke')).toBe(hue);
      expect(el.querySelector(`[data-layer="${layerId}"] .vzf-axis-group[data-axis-channel="y"]`)?.getAttribute('style')).toBe(`cursor: pointer; --vzf-scale-hue: ${hue};`);
    }
    // the frame's own x — the axis BOTH scales stand over — stays the ink: it belongs to neither
    expect(el.querySelectorAll('.vzf-frame-guide [style]')).toHaveLength(0);
    m.unmount();
  });

  it('two fields of the SAME NAME on two tables would read "left is value, right is value" — true and useless, so the sentence names the LAYER too when the fields collide (packet W review, attack 3)', () => {
    const priceA: RenderLayer = { layerId: 'shopA', table: 'shopA', rows: [{ when: '2026-01-01', value: 3 }, { when: '2026-01-08', value: 9 }], encodings: { x: 'when', y: 'value' } };
    const priceB: RenderLayer = { layerId: 'shopB', table: 'shopB', rows: [{ when: '2026-01-01', value: 40 }, { when: '2026-01-08', value: 12 }], encodings: { x: 'when', y: 'value' } };
    const { el, m } = mountFrame({ layers: { shopA: { kind: 'line' }, shopB: { kind: 'line' } } }, ['shopA', 'shopB']);
    m.update(framed([priceA, priceB], DUAL));
    expect(refusalOf(el)).toBe('');
    const sentence = twoScalesSentence('"value" on layer "shopA"', '"value" on layer "shopB"');
    expect(sentence).toBe('two scales — left is "value" on layer "shopA", right is "value" on layer "shopB"; heights are not comparable across them');
    expect(captionOf(el)).toBe(sentence);
    // two DIFFERENTLY named fields are untouched by this law — the bare field, exactly as the first test above pins
    // (`twoScalesSentence('temperature', 'rainfall')`)
    m.unmount();
  });

  it('a POINT takes a side too — the other position mark: two point layers on a merged x, one y each, and the sentence names their fields', () => {
    const stars: RenderLayer = { layerId: 'b', table: 'reviews', rows: [{ id: 'r1', price: 15, stars: 1 }, { id: 'r2', price: 85, stars: 5 }], encodings: { x: 'price', y: 'stars' } };
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' }, b: { kind: 'point' } } });
    m.update(framed([POINTS_LAYER, stars], { x: XY_FRAME.x, y: INDEPENDENT_Y }));
    expect(refusalOf(el)).toBe('');
    expect(layerAxes(el, 'a')).toEqual({ channels: ['y'], yTransform: expect.stringMatching(/^rotate\(-90 14 /) as string });
    expect(layerAxes(el, 'b')).toEqual({ channels: ['y'], yTransform: expect.stringMatching(/^rotate\(90 /) as string });
    // the dots are still drawn — a side is where the axis is, never where the data is
    expect(el.querySelectorAll('[data-layer="b"] circle.vzf-dot')).toHaveLength(2);
    expect(captionOf(el)).toBe(twoScalesSentence('rating', 'stars'));
    m.unmount();
  });

  it('ONE per-layer line is today’s single guide: the layer draws its own pair, the frame draws nothing, and there is no sentence', () => {
    const { el, m } = mountFrame({ layers: KINDS }, ['temp']);
    m.update(framed([TEMP], DUAL));
    expect(refusalOf(el)).toBe('');
    expect(guidesOf(el)).toBe(0);
    expect(layerAxes(el, 'temp').channels).toEqual(['x', 'y']);
    expect(captionOf(el)).toBe('');
    expect(el.querySelector('.vzf-frame')?.getAttribute('aria-label')).not.toContain('two scales');
    m.unmount();
  });

  it('THREE own y scales are refused, naming all three — a frame has two sides and no third (law 1)', () => {
    const { el, m } = mountFrame({ layers: KINDS }, ['temp', 'rain', 'wind']);
    m.update(framed([TEMP, RAIN, WIND], DUAL));
    expect(refusalOf(el)).toBe('layers "temp", "rain" and "wind" each draw a y of their own — a frame has two sides, left and right, and no third. Draw two of them here, and the rest on a frame of their own.');
    m.unmount();
  });

  it('a shared y with a per-layer guide is ONE scale on both edges: each layer draws it under its own field, and the frame says nothing false', () => {
    const { el, m } = mountFrame({ layers: KINDS }, ['temp', 'rain']);
    m.update(framed([TEMP, RAIN], { x: DUAL.x, y: { ...SHARED('quantitative', [0, 50]), guide: 'per-layer' } as ResolvedChannel }));
    expect(refusalOf(el)).toBe('');
    expect(layerAxes(el, 'temp').yTransform).toMatch(/^rotate\(-90 /);
    expect(layerAxes(el, 'rain').yTransform).toMatch(/^rotate\(90 /);
    // the same span on both edges — the first tick of each is the frame's floor
    expect(el.querySelector('[data-layer="temp"] text.vzf-tick')?.textContent).toBe('0');
    expect(el.querySelector('[data-layer="rain"] text.vzf-tick')?.textContent).toBe('0');
    // heights across ONE scale are comparable, so the "two scales" sentence would be a lie: none is said
    expect(captionOf(el)).toBe('');
    // and the ink says nothing either (law 4): two hues over one scale would claim two of them
    expect(el.querySelectorAll('[style*="--vzf-scale-hue"]')).toHaveLength(0);
    // and the frame does not draw that y a third time
    expect(el.querySelectorAll('.vzf-frame-guide line.vzf-axis').length).toBe(1 + 4); // the x line and its four ticks
    m.unmount();
  });

  // ── a BAR MAY TAKE THE FIRST SCALE (law 2) ──────────────────────────────────
  /** Counts per week (bars) and a mean per week (a line) over the same band — the classic bars-left, line-right figure. */
  const COUNTS: RenderLayer = { layerId: 'counts', table: 'weather', rows: [{ week: 'w1', count: 4 }, { week: 'w2', count: 9 }], encodings: { category: 'week', y: 'count' } };
  const MEANS: RenderLayer = { layerId: 'means', table: 'weather', rows: [{ week: 'w1', mean: 3 }, { week: 'w2', mean: 7 }], encodings: { x: 'week', y: 'mean' } };
  /** The fold that declares it: one band of weeks, drawn once by the frame (both names — the bar's `category` and the line's `x`), and y left to the layers. */
  const BAND_DUAL = { category: SHARED('categorical', ['w1', 'w2']), x: SHARED('categorical', ['w1', 'w2']), y: INDEPENDENT_Y };
  const barFrame = (layers: readonly RenderLayer[], layerIds: readonly string[]) =>
    mountFrame({ layers: { counts: { kind: 'bar' }, means: { kind: 'line' } } }, layerIds);

  it('BARS ON THE LEFT, A LINE ON THE RIGHT: the bar takes the FIRST scale — its own count axis, from ZERO, in the left hue — and the def door accepts the same declaration', () => {
    // the door: the figure is DECLARABLE now, and says nothing about it
    const problems: string[] = [];
    validateFrame({ y: { mode: 'independent' } }, 'encodings[0]', 'v', [
      { layerId: 'counts', table: 'weather', chartKind: 'bar', channels: ['category', 'y'] },
      { layerId: 'means', table: 'weather', chartKind: 'line', channels: ['x', 'y'] },
    ], undefined, { chartKind: 'bar', channels: ['category', 'y'], initial: undefined, table: 'weather' }, problems);
    expect(problems).toEqual([]);
    const { el, m } = barFrame([COUNTS, MEANS], ['counts', 'means']);
    m.update(framed([COUNTS, MEANS], BAND_DUAL));
    expect(refusalOf(el)).toBe('');
    // the frame draws x once (the band both layers stand on) and neither layer draws an x of its own
    expect(guidesOf(el)).toBe(1);
    expect(el.querySelectorAll('[data-layer="counts"] .vzf-axis-group')).toHaveLength(0); // a bar's count axis carries no label — the frame's sentence names it
    expect(layerAxes(el, 'means').channels).toEqual(['y']);
    // the BAR's own count axis: a vertical line at its plot's left edge, ticked from ZERO to its ceiling
    const barBox = el.querySelector('[data-layer="counts"]')!;
    const vertical = [...barBox.querySelectorAll('line.vzf-axis')].filter((l) => l.getAttribute('x1') === l.getAttribute('x2') && Math.abs(Number(l.getAttribute('y2')) - Number(l.getAttribute('y1'))) > 4);
    expect(vertical).toHaveLength(1);
    expect(Number(vertical[0]!.getAttribute('x1'))).toBe(BAR_PAD.l);
    expect([...barBox.querySelectorAll('text.vzf-tick')].map((t) => t.textContent)).toEqual(['0', '3', '6', '9']);
    // …and no baseline of its own across the plot: a bar's zero IS the frame's x axis, drawn once above
    const baseline = [...barBox.querySelectorAll('line.vzf-axis')].filter((l) => l.getAttribute('y1') === l.getAttribute('y2') && Math.abs(Number(l.getAttribute('x2')) - Number(l.getAttribute('x1'))) > 4);
    expect(baseline).toHaveLength(0);
    // law 3 and law 4 ride as they do on any two-scale frame: the sentence names both scales, left first …
    expect(captionOf(el)).toBe(twoScalesSentence('count', 'mean'));
    // … and the ink matches the scale — the bar's axis and its bars in the LEFT hue, the line in the right
    expect(vertical[0]!.getAttribute('style')).toBe('--vzf-scale-hue: var(--vzf-scale-left);');
    expect([...barBox.querySelectorAll('rect.vzf-barrect')].map((r) => r.getAttribute('fill'))).toEqual(['var(--vzf-scale-left)', 'var(--vzf-scale-left)']);
    expect(el.querySelector('[data-layer="means"] path.vzf-line-path')?.getAttribute('stroke')).toBe('var(--vzf-scale-right)');
    m.unmount();
  });

  it('a SHARED y drawn per-layer puts the FRAME’s own ceiling on the bar’s left axis — one scale on two edges, so no sentence and no hue', () => {
    const { el, m } = barFrame([COUNTS, MEANS], ['counts', 'means']);
    m.update(framed([COUNTS, MEANS], { ...BAND_DUAL, y: { ...SHARED('quantitative', [0, 20]), guide: 'per-layer' } as ResolvedChannel }));
    expect(refusalOf(el)).toBe('');
    // the bar's ticks are the FOLD's span, not its own rows' maximum (`layerDomain` → `domain.y`), still from zero
    expect([...el.querySelectorAll('[data-layer="counts"] text.vzf-tick')].map((t) => t.textContent)).toEqual(['0', '6.7', '13.3', '20']);
    // one scale drawn on both edges is comparable by height, so the frame says nothing and hands out no hue
    expect(captionOf(el)).toBe('');
    expect(el.querySelectorAll('[style*="--vzf-scale-hue"]')).toHaveLength(0);
    m.unmount();
  });

  it('THE SAME TWO LAYERS DECLARED THE OTHER WAY ROUND are refused — a bar reads its extent from the LEFT baseline — and the door and the frame say ONE sentence (law 2)', () => {
    const { el, m } = barFrame([MEANS, COUNTS], ['means', 'counts']);
    m.update(framed([MEANS, COUNTS], BAND_DUAL));
    const sentence = `layer "counts" is a bar with a y of its own, but layer "means" already takes the first scale — a bar reads its extent from the LEFT baseline, so declare it first, or give the line the independent y`;
    expect(refusalOf(el)).toBe(sentence);
    // THE TWINS SAY ONE SENTENCE: the def door's is this one with its address in front of it, nothing else
    const problems: string[] = [];
    validateFrame({ y: { mode: 'independent' } }, 'encodings[0]', 'v', [
      { layerId: 'means', table: 'weather', chartKind: 'line', channels: ['x', 'y'] },
      { layerId: 'counts', table: 'weather', chartKind: 'bar', channels: ['category', 'y'] },
    ], undefined, { chartKind: 'line', channels: ['x', 'y'], initial: undefined, table: 'weather' }, problems);
    expect(problems).toEqual([`encodings[0].frame.y: ${sentence}`]);
    // one owner for it, quoted by both (`firstScaleTakenRefusal`, `src/encoding/frame.ts`)
    expect(firstScaleTakenRefusal('layer "counts"', 'bar', 'layer "means"')).toBe(sentence);
    m.unmount();
  });

  it('a HISTOGRAM or a BOX PLOT with a y of its own still reaches NEITHER edge — the promotion is the bar’s alone, and its words are untouched', () => {
    // the frame's OWN defense — for a `RenderState.frame` a host folds by hand, skipping the door entirely
    // (a def built through `buildDashboard` never reaches this: the door refuses BOTH shapes, law 9)
    // both marks on a RUN of numbers here, so the band/run law has nothing to say first and this refusal is the one under test
    const bins: RenderLayer = { layerId: 'counts', table: 'weather', rows: [{ x0: 0, x1: 5, count: 4 }], encodings: { x: 'x0', y: 'count' } };
    const trend: RenderLayer = { layerId: 'means', table: 'weather', rows: [{ x0: 1, mean: 3 }, { x0: 4, mean: 7 }], encodings: { x: 'x0', y: 'mean' } };
    const { el, m } = mountFrame({ layers: { counts: { kind: 'histogram' }, means: { kind: 'line' } } }, ['counts', 'means']);
    m.update(framed([bins, trend], { x: SHARED('quantitative', [0, 10]), y: INDEPENDENT_Y }));
    expect(refusalOf(el)).toBe(`layer "counts" is a histogram with a y of its own — a histogram's extent is read against one baseline, so it takes neither side of a two-scale frame. Declare guide: 'merged' on y, or draw it on a frame of its own.`);
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

/**
 * ZERO IS A PLACE ON THE AXIS (law 12) — the frame renderer's two jobs: PASS
 * the ask through to the guide and to every layer that binds the channel, and
 * REFUSE a mark that draws no zero guide in the same sentence the def door
 * says. It decides nothing about zero itself: whether zero is ON the axis is the
 * chart's answer, against the domain it drew on.
 */
describe('the frame renderer — zero is a place on the axis', () => {
  const zeroOn = (channel: ResolvedChannel): ResolvedChannel => ({ ...channel, zeroGuide: true } as ResolvedChannel);

  it('passes the ask to the MERGED guide, which draws one line for the stack on each axis it owns', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' } } }, ['a']);
    m.update(framed([POINTS_LAYER], { x: zeroOn(SHARED('quantitative', [-100, 100])), y: zeroOn(SHARED('quantitative', [-10, 10])) }));
    expect(el.querySelectorAll('.vzf-frame-guide line.vzf-zero')).toHaveLength(2);
    // the LAYER draws none of its own: it draws no axis either, which is the same law (`guide: 'merged'`)
    expect(el.querySelectorAll('.vzf-scatter line.vzf-zero')).toHaveLength(0);
    expect(refusalOf(el)).toBe('');
    m.unmount();
  });

  it('passes it to a LAYER that keeps its own scale — a per-layer guide, where the axis and its zero are the layer’s to draw', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' } } }, ['a']);
    m.update(framed([POINTS_LAYER], { x: { ...SHARED('quantitative', [-100, 100]), guide: 'per-layer' } as ResolvedChannel, y: zeroOn(SHARED('quantitative', [-10, 10])) }));
    expect(el.querySelectorAll('.vzf-frame-guide')).toHaveLength(0);
    expect(el.querySelectorAll('.vzf-scatter line.vzf-zero')).toHaveLength(1);
    m.unmount();
  });

  it('a channel a layer never BOUND carries no ask to it — a guide folded over somebody else’s column is no axis of this layer’s', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' } } }, ['a']);
    // the layer binds x and y; the ask is on `category`, which it does not bind — nothing is drawn and
    // nothing is refused, exactly as `layerDomain` puts no SPAN on an axis a layer never declared
    m.update(framed([POINTS_LAYER], { category: zeroOn(SHARED('categorical', ['Casual'])), x: SHARED('quantitative', [-100, 100]) }));
    expect(el.querySelectorAll('line.vzf-zero')).toHaveLength(0);
    expect(refusalOf(el)).toBe('');
    m.unmount();
  });

  it('a MERGED guide draws the stack’s zero and the layers are not even ASKED — one line on one pixel, not one per layer', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' }, b: { kind: 'point' } } }, ['a', 'b']);
    const second: RenderLayer = { ...POINTS_LAYER, layerId: 'b' };
    m.update(framed([POINTS_LAYER, second], { x: zeroOn(SHARED('quantitative', [-100, 100])), y: zeroOn(SHARED('quantitative', [-10, 10])) }));
    // the frame's two, and NOT two per layer on top of them — the charts now draw the guide they are
    // asked for whatever `axes` says, so "one line for the stack" is kept by not ASKING (`layerDomain`)
    expect(el.querySelectorAll('.vzf-frame-guide line.vzf-zero')).toHaveLength(2);
    expect(el.querySelectorAll('.vzf-scatter line.vzf-zero')).toHaveLength(0);
    // …and no layer says the refusal twice either: an off-axis domain under a merged guide is the FRAME's
    // sentence alone
    m.update(framed([POINTS_LAYER, second], { x: zeroOn(SHARED('quantitative', [12, 48])), y: SHARED('quantitative', [0, 10]) }));
    expect(Array.from(el.querySelectorAll('text.vzf-zero-note')).map((t) => t.textContent)).toEqual([
      'x was asked for a zero guide, but its axis runs [12, 48] — zero is not a place on it, so there is no line to draw',
    ]);
    m.unmount();
  });

  it('A MARK THAT DRAWS NO ZERO GUIDE IS REFUSED BY NAME — the def door’s own sentence, said by the frame that has to draw it', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'bar' } } }, ['a']);
    const bars: RenderLayer = { layerId: 'a', table: 'ta', rows: [{ shelf: 'Casual', count: 4 }], encodings: { category: 'shelf', y: 'count' } };
    m.update(framed([bars], { category: SHARED('categorical', ['Casual']), y: zeroOn(SHARED('quantitative', [0, 10])) }));
    expect(refusalOf(el)).toBe('layer "a" is a bar, and a bar draws no zero guide on y — a point draws one on x and y, a line on y; declare it there, or drop "zeroGuide"');
    // …and on its x, which is its `category` channel: the refusal names the channel, because the answer is per pair
    m.update(framed([bars], { category: zeroOn(SHARED('categorical', ['Casual'])), y: SHARED('quantitative', [0, 10]) }));
    expect(refusalOf(el)).toBe('layer "a" is a bar, and a bar draws no zero guide on category — a point draws one on x and y, a line on y; declare it there, or drop "zeroGuide"');
    // drop the key and the same stack draws
    m.update(framed([bars], { category: SHARED('categorical', ['Casual']), y: SHARED('quantitative', [0, 10]) }));
    expect(refusalOf(el)).toBe('');
    m.unmount();
  });

  it('a LINE is refused on x and drawn on y — the same per-pair answer, on the mark that has one of each', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'line' } } }, ['a']);
    const line: RenderLayer = { layerId: 'a', table: 'tb', rows: [{ date: '2026-01-01', value: -2 }, { date: '2026-01-08', value: 3 }], encodings: { x: 'date', y: 'value' } };
    m.update(framed([line], { x: zeroOn(SHARED('temporal', ['2026-01-01', '2026-01-08'])), y: SHARED('quantitative', [-10, 10]) }));
    expect(refusalOf(el)).toBe('layer "a" is a line, and a line draws no zero guide on x — a point draws one on x and y, a line on y; declare it there, or drop "zeroGuide"');
    m.update(framed([line], { x: SHARED('temporal', ['2026-01-01', '2026-01-08']), y: zeroOn(SHARED('quantitative', [-10, 10])) }));
    expect(refusalOf(el)).toBe('');
    expect(el.querySelectorAll('.vzf-frame-guide line.vzf-zero')).toHaveLength(1);
    m.unmount();
  });

  it('a frame asked for NO zero guide is byte-identical to the frame before the key existed', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' }, b: { kind: 'line' } } });
    m.update(framed([POINTS_LAYER, LINE_LAYER], XY_FRAME));
    expect(el.innerHTML).not.toContain('vzf-zero');
    m.unmount();
  });
});

/**
 * A BAND IS A RANGE TOO (law 13) — the frame renderer's half: a mark THE STATE
 * LEAVES MUTE is refused by name, in the sentence the def door says with an
 * address in front of it. The predicate is the door's own too
 * (`drawsIntervalBrush`), so a def the door accepts is never a gesture the
 * renderer refuses.
 */
describe('the frame renderer — a band is a range too (law 13)', () => {
  const HIST_LAYER: RenderLayer = { layerId: 'a', table: 'bins', rows: [{ shelf: 'Casual', count: 4 }, { shelf: 'Formal', count: 2 }], encodings: { x: 'shelf', y: 'count' } };

  it('A MARK THE STATE LEAVES MUTE IS REFUSED BY NAME — a histogram whose bins were folded as CATEGORIES', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'histogram' } } }, ['a']);
    m.update(framed([HIST_LAYER], { x: SHARED('categorical', ['Casual', 'Formal']), y: SHARED('quantitative', [0, 10]) }));
    expect(refusalOf(el)).toBe('layer "a" declares it emits an interval, but its x is the category column "shelf" — a band has no between for an interval, so a drag across a histogram\'s slots is a RUN of them; declare encodings: ["match"], or bind x to a date or a number');
    // the same stack over a NUMBER x is the histogram it always was — drawn, no sentence
    m.update(framed([{ ...HIST_LAYER, rows: [{ x0: 0, x1: 10, count: 4 }], encodings: { x: 'x0', y: 'count' } }], { x: SHARED('quantitative', [0, 10]), y: SHARED('quantitative', [0, 10]) }));
    expect(refusalOf(el)).toBe('');
    m.unmount();
  });

  it('A LINE ON A BAND IS NEVER REFUSED — it declares the `match` its band brush lands, so the state leaves it a voice', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'line' } } }, ['a']);
    const line: RenderLayer = { layerId: 'a', table: 'trend', rows: [{ shelf: 'Casual', v: 1 }, { shelf: 'Formal', v: 2 }], encodings: { x: 'shelf', y: 'v' } };
    m.update(framed([line], { x: SHARED('categorical', ['Casual', 'Formal']), y: SHARED('quantitative', [0, 10]) }));
    expect(refusalOf(el)).toBe('');
    // …and it drew the band: one point per slot, and the drag rectangle's own hook is live on it
    expect(el.querySelectorAll('circle.vzf-line-dot')).toHaveLength(2);
    m.unmount();
  });

  it('a channel the frame folded NOTHING for carries no evidence — no scale kind, no refusal (the zero guide\'s own law)', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'histogram' } } }, ['a']);
    // x is left to the layers: there is no folded scale kind, so the frame declines to judge the gesture
    m.update(framed([HIST_LAYER], { x: { mode: 'independent', guide: 'per-layer' } as ResolvedChannel, y: SHARED('quantitative', [0, 10]) }));
    expect(refusalOf(el)).toBe('');
    m.unmount();
  });

  it('a mark that declares NO interval is not judged at all — a bar\'s drag was always a match', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'bar' } } }, ['a']);
    const bars: RenderLayer = { layerId: 'a', table: 'ta', rows: [{ shelf: 'Casual', count: 4 }], encodings: { category: 'shelf', y: 'count' } };
    m.update(framed([bars], { category: SHARED('categorical', ['Casual']), y: SHARED('quantitative', [0, 10]) }));
    expect(refusalOf(el)).toBe('');
    m.unmount();
  });
});

/**
 * THE CURVE AND THE DECLARED EXTENT REACH THE PICTURE (protocol 1.6, law 14) —
 * the frame renderer's other two pass-throughs, both of which it was missing.
 *
 * `frameChartDomain` and `layerDomain` folded a SPAN and a band order and handed
 * over no curve and no declared extent, so a def that said "logarithmic" got a
 * linear axis and a def that said "a torsion angle is −180…180" got whatever the
 * rows happened to reach. Both are read off `RenderState.frame` and passed
 * through; neither is decided here.
 */
describe('the frame renderer — a declared curve and a declared extent reach the marks', () => {
  const LOG_X = { mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain: [1, 1000], transform: 'log' } as unknown as ResolvedChannel;
  const tickTexts = (el: Element, within: string): string[] => Array.from(el.querySelectorAll(`${within} text.vzf-tick`)).map((t) => t.textContent ?? '');

  it('a LOGARITHMIC channel draws a logarithmic MERGED guide — decades, where it used to draw an even linear run', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' } } }, ['a']);
    m.update(framed([POINTS_LAYER], { x: LOG_X, y: SHARED('quantitative', [0, 10]) }));
    // BEFORE: ['1', '334', '667', '1000'] — `ticks(1, 1000, 3)`, a linear axis under a logarithmic
    // declaration, which is a false picture rather than a plain one
    // (the two trailing entries are the axis LABELS, which wear the same class in the merged guide)
    expect(tickTexts(el, '.vzf-frame-guide')).toEqual(['1', '10', '100', '1000', '0', '3.3', '6.7', '10', 'price', 'rating']);
    // …and the Y axis the same way, because the curve rides per CHANNEL and neither axis is the special one
    m.update(framed([POINTS_LAYER], { x: SHARED('quantitative', [0, 100]), y: { ...LOG_X, domain: [1, 100] } as ResolvedChannel }));
    expect(tickTexts(el, '.vzf-frame-guide')).toEqual(['0', '33.3', '66.7', '100', '1', '10', '100', 'price', 'rating']);
    m.unmount();
  });

  it('…and a logarithmic channel reaches the LAYER that binds it, when the layer draws its own axis', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' } } }, ['a']);
    m.update(framed([POINTS_LAYER], { x: { ...LOG_X, guide: 'per-layer' } as ResolvedChannel }));
    // the layer's own x axis, ticked at decades off the scale it was HANDED (`logTicks`), and its y on its
    // own extent. BEFORE: ['1', '251', '501', '750', '1000'] for x — `ticks(1, 1000, 4)`, an even run
    expect(tickTexts(el, '.vzf-scatter')).toEqual(['1', '10', '100', '1000', '2', '3.5', '5', '6.5', '8']);
    m.unmount();
  });

  it('a DECLARED extent is the axis the guide is drawn on — what the quantity CAN be, not what these rows reach', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' } } }, ['a']);
    const bounded = { ...SHARED('quantitative', [10, 90]), bounds: [0, 200] } as unknown as ResolvedChannel;
    m.update(framed([POINTS_LAYER], { x: bounded, y: SHARED('quantitative', [0, 10]) }));
    // the fold says these rows run 10…90; the declaration says the quantity runs 0…200, and the axis
    // is what the quantity can be. BEFORE: ['10', '36.7', '63.3', '90'] — the fold's own union
    expect(tickTexts(el, '.vzf-frame-guide').slice(0, 4)).toEqual(['0', '66.7', '133.3', '200']);
    m.unmount();
  });

  it('…on x, on y, and on both — and it reaches the LAYER, so a mark and its tick cannot disagree', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' } } }, ['a']);
    const bounds = (lo: number, hi: number, fold: readonly [number, number]): ResolvedChannel =>
      ({ ...SHARED('quantitative', fold), guide: 'per-layer', bounds: [lo, hi] } as unknown as ResolvedChannel);
    m.update(framed([POINTS_LAYER], { x: bounds(0, 200, [10, 90]) }));
    expect(tickTexts(el, '.vzf-scatter').slice(0, 5)).toEqual(['0', '50', '100', '150', '200']);
    // on y alone: the y ticks are the declared extent's and the x ticks are still this chart's OWN, because
    // an extent declared on one axis says nothing about the other
    m.update(framed([POINTS_LAYER], { y: bounds(0, 40, [2, 8]) }));
    expect(tickTexts(el, '.vzf-scatter')).toEqual(['10', '30', '50', '70', '90', '0', '10', '20', '30', '40']);
    m.update(framed([POINTS_LAYER], { x: bounds(0, 200, [10, 90]), y: bounds(0, 40, [2, 8]) }));
    expect(tickTexts(el, '.vzf-scatter')).toEqual(['0', '50', '100', '150', '200', '0', '10', '20', '30', '40']);
    m.unmount();
  });

  it('A VALUE OUTSIDE A DECLARED EXTENT IS COUNTED AND SAID, verbatim — never dropped and never refused', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' } } }, ['a']);
    const narrow = { ...SHARED('quantitative', [10, 90]), guide: 'per-layer', bounds: [0, 50] } as unknown as ResolvedChannel;
    m.update(framed([POINTS_LAYER], { x: narrow }));
    expect(Array.from(el.querySelectorAll('text.vzf-outside-note')).map((t) => t.textContent)).toEqual([
      'x has 1 value outside its declared bounds [0, 50] — bounds say what the quantity CAN be, so either they are wrong or this data is',
    ]);
    // and the mark is STILL DRAWN, at its true position — past the right edge of the plot, which is why
    // the count is the only thing in the picture that says it is there
    const dots = Array.from(el.querySelectorAll('.vzf-scatter circle.vzf-dot')).map((c) => Number(c.getAttribute('cx')));
    expect(dots).toHaveLength(2);
    expect(Math.max(...dots)).toBeGreaterThan(Number(el.querySelector('.vzf-scatter line.vzf-axis')!.getAttribute('x2')));
    m.unmount();
  });

  it('a frame that declares NEITHER hands out the object it always did — no `transform` key, no `bounds` key', () => {
    const { el, m } = mountFrame({ layers: { a: { kind: 'point' } } }, ['a']);
    m.update(framed([POINTS_LAYER], XY_FRAME));
    const withNeither = el.innerHTML;
    m.update(framed([POINTS_LAYER], { x: SHARED('quantitative', [0, 100]), y: SHARED('quantitative', [0, 10]) }));
    expect(el.innerHTML).toBe(withNeither);
    m.unmount();
  });
});
