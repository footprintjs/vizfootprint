// @vitest-environment jsdom
/**
 * `<VizNetwork>` — the node-link on ONE frame. What these tests pin: the
 * shared scale pair really is shared (an edge's end lands exactly on its
 * node's centre) and really is computed over the UNION (an endpoint no node
 * carries still widens the frame); links paint under nodes and the nodes are
 * the marks that take the tab; hover brightens a neighbourhood and records
 * NOTHING; a click emits the point and a shift-click the set; and the
 * contract's clauses dim without hiding — an edge only as bright as its ends.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { VizNetwork, type NetworkEdge, type NetworkNode } from './VizNetwork.js';
import { selectionForView } from '../contract/selection.js';
import type { ChartEmission } from 'vizfootprint/selection';
import type { SelectionView } from '../adapter/types.js';

afterEach(cleanup);

// four nodes: two grouped, one ungrouped, one with NO source row (never dimmed)
const NODES: NetworkNode[] = [
  { id: 'flu', x: 0, y: 0, category: 'viral', row: { disease: 'flu', region: 'North' } },
  { id: 'cold', x: 10, y: 4, category: 'viral', row: { disease: 'cold', region: 'South' } },
  { id: 'strep', x: 4, y: 10, row: { disease: 'strep', region: 'North' } },
  { id: 'lone', x: 6, y: 2 },
];
// three edges — the last points at a node this frame does NOT carry, at (20, 20)
const EDGES: NetworkEdge[] = [
  { source: 'flu', target: 'cold', sx: 0, sy: 0, tx: 10, ty: 4 },
  { source: 'cold', target: 'strep', sx: 10, sy: 4, tx: 4, ty: 10 },
  { source: 'flu', target: 'ghost', sx: 0, sy: 0, tx: 20, ty: 20 },
];

const W = 200;
const H = 100;

describe('optional per-mark paint', () => {
  it('paints one mark by one property alone and leaves its siblings unpainted, in ONE render', () => {
    // WHY one render: the paint law is decided per mark, so a dashed edge with no colour and a
    // coloured node beside an uncoloured one must each take their own arm of the same ternaries.
    const { container } = renderNet({
      colorOfEdge: () => undefined,
      edgeDashOf: (edge) => (edge === EDGES[0] ? '4 1' : undefined),
      colorOfNode: (node) => (node.id === 'flu' ? '#123456' : undefined),
    });
    const [dashed, plain] = links(container);
    expect(dashed!.style.strokeDasharray).toBe('4 1'); // dash alone: the style object exists with no stroke
    expect(dashed!.style.stroke).toBe('');
    expect(plain!.getAttribute('style')).toBeNull(); // neither: no style attribute at all
    const dots = [...container.querySelectorAll('g.vzf-net-nodes circle.vzf-dot')] as SVGCircleElement[];
    const painted = dots.filter((d) => d.getAttribute('style') !== null);
    expect(painted).toHaveLength(1);
    expect(painted[0]!.style.fill).toBe('#123456'); // jsdom keeps the literal
    expect(dots.length - painted.length).toBe(NODES.length - 1); // every other node keeps the theme's fill
  });

  it('preserves default markup when callbacks return undefined', () => {
    const original = renderNet();
    const markup = original.container.innerHTML;
    cleanup();
    const fallback = renderNet({ colorOfNode: () => undefined, colorOfEdge: () => undefined, edgeDashOf: () => undefined });
    expect(fallback.container.innerHTML).toBe(markup);
    expect(fallback.container.querySelector('[style]')).toBeNull();
  });

  it('passes complete source marks and styles both segments and self-loops independently', () => {
    const loop: NetworkEdge = { source: 'flu', target: 'flu', sx: 0, sy: 0, tx: 0, ty: 0, label: 'Inferred' };
    const colorOfNode = vi.fn((node: NetworkNode) => node.id === 'flu' ? '#336699' : undefined);
    const colorOfEdge = vi.fn((edge: NetworkEdge) => edge === loop ? '#aa6600' : undefined);
    const edgeDashOf = vi.fn((edge: NetworkEdge) => edge === loop ? '5 3' : edge === EDGES[0] ? '2 2' : undefined);
    const { container } = renderNet({ edges: [...EDGES, loop], colorOfNode, colorOfEdge, edgeDashOf });
    expect(colorOfNode.mock.calls.map(([node]) => node)).toEqual(NODES);
    expect(colorOfNode.mock.calls[0]![0]).toBe(NODES[0]);
    expect(colorOfEdge.mock.calls.map(([edge]) => edge)).toEqual([...EDGES, loop]);
    expect(edgeDashOf.mock.calls.at(-1)![0]).toBe(loop);
    expect(nodeAt(container, 'flu').style.fill).toBe('#336699');
    expect(nodeAt(container, 'cold').hasAttribute('style')).toBe(false);
    expect(nodeAt(container, 'flu').getAttribute('fill')).toBe('var(--vzf-brand)');
    expect(links(container)[0]!.style.strokeDasharray).toBe('2 2');
    expect(links(container)[0]!.style.stroke).toBe('');
    expect(links(container)[1]!.hasAttribute('style')).toBe(false);
    const loopMark = container.querySelector('g.vzf-net-links circle') as SVGCircleElement;
    expect(loopMark.style.stroke).toBe('#aa6600');
    expect(loopMark.style.strokeDasharray).toBe('5 3');
    expect(loopMark.getAttribute('fill')).toBe('none');
    expect(loopMark.getAttribute('aria-label')).toBe('flu — flu');
  });

  it('keeps selection, hover dimming, and click emissions independent of paint', () => {
    const { container, onEmit, rerender } = renderNet({
      selection: ownSelection('flu'), colorOfNode: () => '#336699', colorOfEdge: () => '#aa6600', edgeDashOf: () => '5 3',
    });
    expect(nodeAt(container, 'flu').getAttribute('class')).toBe('vzf-dot vzf-selected');
    expect(nodeAt(container, 'flu').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(nodeAt(container, 'cold'));
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'cold', encoding: { kind: 'point', field: 'disease' } });
    fireEvent.mouseOver(nodeAt(container, 'flu'));
    expect(dimmed(container).sort()).toEqual(['cold — strep', 'lone', 'strep']);
    expect(nodeAt(container, 'strep').style.fill).toBe('#336699');
    expect(links(container)[1]!.style.stroke).toBe('#aa6600');
    for (const mark of container.querySelectorAll<SVGElement>('[style]')) expect(mark.style.opacity).toBe('');
    fireEvent.mouseOut(nodeAt(container, 'flu'));
    rerender(<VizNetwork viewId="net" nodes={NODES} edges={EDGES} keyField="disease" selection={fromOther()} colorOfNode={() => '#336699'} colorOfEdge={() => '#aa6600'} />);
    expect(dimmed(container).sort()).toEqual(['cold', 'cold — strep', 'flu — cold']);
    expect(links(container)[0]!.style.strokeDasharray).toBe('');
  });

  it('removes previous inline paint when the callbacks are removed', () => {
    const { container, rerender } = renderNet({ colorOfNode: () => '#336699', colorOfEdge: () => '#aa6600', edgeDashOf: () => '5 3' });
    rerender(<VizNetwork viewId="net" nodes={NODES} edges={EDGES} keyField="disease" width={W} height={H} />);
    expect(nodeAt(container, 'flu').style.fill).toBe('');
    expect(nodeAt(container, 'flu').getAttribute('fill')).toBe('var(--vzf-brand)');
    for (const link of links(container)) {
      expect(link.style.stroke).toBe('');
      expect(link.style.strokeDasharray).toBe('');
    }
  });
});

function renderNet(over: Partial<Parameters<typeof VizNetwork>[0]> = {}) {
  const onEmit = vi.fn<(e: ChartEmission) => void>();
  const utils = render(
    <VizNetwork viewId="net" nodes={NODES} edges={EDGES} keyField="disease" width={W} height={H} onEmit={onEmit} {...over} />,
  );
  return { onEmit, ...utils };
}

const nodeAt = (c: HTMLElement, id: string): SVGCircleElement => c.querySelector(`circle[data-node="${id}"]`)!;
const links = (c: HTMLElement): SVGLineElement[] => [...c.querySelectorAll('g.vzf-net-links line')] as SVGLineElement[];
const dimmed = (c: HTMLElement): string[] =>
  [...c.querySelectorAll('.vzf-dim')].map((el) => el.getAttribute('data-node') ?? (el.getAttribute('aria-label') as string));

/** The clause of ANOTHER view — the one that dims. */
function fromOther(): ReturnType<typeof selectionForView> {
  const rows: SelectionView[] = [{ viewId: 'other', field: 'region', kind: 'point', value: 'North' }];
  return selectionForView(rows, 'net');
}

/** This view's OWN clause — it outlines and never dims. */
function ownSelection(value: unknown, kind: 'point' | 'match' = 'point'): ReturnType<typeof selectionForView> {
  const rows: SelectionView[] = [{ viewId: 'net', field: 'disease', kind, value }];
  return selectionForView(rows, 'net');
}

// ── the frame ────────────────────────────────────────────────────────────────

describe('the frame — ONE pair of scales, over the UNION of node positions and edge endpoints', () => {
  it('places an edge END exactly on its node CENTRE: the two groups share one scale pair', () => {
    const { container } = renderNet();
    const flu = nodeAt(container, 'flu');
    const cold = nodeAt(container, 'cold');
    const [fluToCold] = links(container);
    expect(Number(fluToCold!.getAttribute('x1'))).toBeCloseTo(Number(flu.getAttribute('cx')));
    expect(Number(fluToCold!.getAttribute('y1'))).toBeCloseTo(Number(flu.getAttribute('cy')));
    expect(Number(fluToCold!.getAttribute('x2'))).toBeCloseTo(Number(cold.getAttribute('cx')));
    expect(Number(fluToCold!.getAttribute('y2'))).toBeCloseTo(Number(cold.getAttribute('cy')));
  });

  it('an endpoint NO node carries still widens the frame — the union, not the nodes alone', () => {
    const { container } = renderNet();
    // x AND y both run 0..20 (the ghost endpoint), not 0..10 (the widest node).
    // 168 × 68 of padded box at one unit is 3.4 px per unit: a 68-wide picture,
    // centred, so x runs 66 → 134 and y (inverted) 84 → 16.
    expect(Number(nodeAt(container, 'flu').getAttribute('cx'))).toBeCloseTo(66);
    expect(Number(nodeAt(container, 'cold').getAttribute('cx'))).toBeCloseTo(100); // 134 if the nodes alone had set the domain
    expect(Number(links(container)[2]!.getAttribute('x2'))).toBeCloseTo(134);
    expect(Number(nodeAt(container, 'flu').getAttribute('cy'))).toBeCloseTo(84);
    expect(Number(links(container)[2]!.getAttribute('y2'))).toBeCloseTo(16);
  });

  it('ONE px-per-unit for both axes — the layout said those two nodes are that far apart, in any direction', () => {
    const { container } = renderNet();
    const flu = nodeAt(container, 'flu');
    const cold = nodeAt(container, 'cold');
    // flu (0,0) → cold (10,4): ten units across and four down, at the SAME unit
    const perX = (Number(cold.getAttribute('cx')) - Number(flu.getAttribute('cx'))) / 10;
    const perY = (Number(flu.getAttribute('cy')) - Number(cold.getAttribute('cy'))) / 4;
    expect(perX).toBeCloseTo(perY);
    expect(perX).toBeCloseTo(3.4); // min(168/20, 68/20) — the box's tighter side
  });

  it('an empty graph draws an empty frame rather than nothing at all', () => {
    const { container } = renderNet({ nodes: [], edges: [] });
    expect(container.querySelectorAll('g.vzf-net-links line')).toHaveLength(0);
    expect(container.querySelectorAll('g.vzf-net-nodes circle')).toHaveLength(0);
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('node-link of 0 disease nodes and 0 links');
  });
});

// ── paint order, tab order, and the accessible shape ─────────────────────────

describe('the a11y shape — DOM order is paint order is tab order', () => {
  it('draws exactly two groups, links FIRST (under) then nodes', () => {
    const { container } = renderNet();
    expect([...container.querySelectorAll('svg > g')].map((g) => g.getAttribute('class'))).toEqual(['vzf-net-links', 'vzf-net-nodes']);
    expect(links(container)).toHaveLength(3);
    expect(container.querySelectorAll('g.vzf-net-nodes circle.vzf-dot')).toHaveLength(4);
  });

  it('the svg is a group of focusable marks, described by its view, and each mark names itself', () => {
    const { container } = renderNet();
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('group');
    expect(svg.getAttribute('aria-label')).toBe('node-link of 4 disease nodes and 3 links');
    // the counts are on the svg's own label; the DESC spends itself on the
    // gesture, which a node's aria-label would otherwise hide from a screen
    // reader — and claims no provenance the chart cannot know
    expect(svg.querySelector('desc')!.textContent).toBe('view net: click a node to filter disease; click it again to clear');
    // every node takes the tab, in DOM order; the links take none
    expect([...container.querySelectorAll('[tabindex]')].map((el) => el.getAttribute('data-node'))).toEqual(['flu', 'cold', 'strep', 'lone']);
    expect(links(container).every((l) => l.getAttribute('tabindex') === null)).toBe(true);
  });

  it('a node label carries its group and its DEGREE (so the links read without a mouse), singular at one', () => {
    const { container } = renderNet();
    expect(nodeAt(container, 'flu').getAttribute('aria-label')).toBe('flu · viral · 2 links');
    expect(nodeAt(container, 'strep').getAttribute('aria-label')).toBe('strep · 1 link'); // no group, one link
    expect(nodeAt(container, 'lone').getAttribute('aria-label')).toBe('lone · 0 links');
    expect(nodeAt(container, 'flu').querySelector('title')!.textContent).toBe('flu · viral · 2 links · click to select');
  });

  it('a link names its pair with an UNDIRECTED connector — nothing here is directed', () => {
    const { container } = renderNet();
    // the mark carries no arrowhead, the neighbourhood adds both ways and the
    // degree folds in and out into one number, so an arrow in the label would
    // assert a direction the picture, the highlight and the layout all deny
    expect(links(container).map((l) => l.getAttribute('aria-label'))).toEqual(['flu — cold', 'cold — strep', 'flu — ghost']);
    expect(links(container)[0]!.querySelector('title')!.textContent).toBe('flu — cold');
  });

  it('a SELF-LOOP is drawn as a loop, not as a zero-length line nobody can see', () => {
    // an edge whose two ends coincide paints nothing as a <line> (butt linecap),
    // so the degree would count a link the frame never showed
    const { container } = renderNet({ edges: [...EDGES, { source: 'flu', target: 'flu', sx: 0, sy: 0, tx: 0, ty: 0 }] });
    const loop = container.querySelector('g.vzf-net-links circle')!;
    expect(loop.getAttribute('aria-label')).toBe('flu — flu');
    expect(loop.getAttribute('fill')).toBe('none');
    expect(Number(loop.getAttribute('cx'))).toBeCloseTo(66);
    expect(Number(loop.getAttribute('cy'))).toBeCloseTo(79); // one radius above flu's centre
    expect(links(container)).toHaveLength(3); // the three real segments are still segments
  });

  it('an EMPTY category is no category — no stray separator in the name a screen reader reads', () => {
    const { container } = renderNet({ nodes: [{ id: 'flu', x: 0, y: 0, category: '' }], edges: [] });
    expect(nodeAt(container, 'flu').getAttribute('aria-label')).toBe('flu · 0 links');
  });

  it('two rows sharing one key are two marks — the index defends the React key the way the links already do', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = renderNet({ nodes: [{ id: 'flu', x: 0, y: 0 }, { id: 'flu', x: 4, y: 4 }], edges: [] });
    expect(container.querySelectorAll('g.vzf-net-nodes circle')).toHaveLength(2);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('takes an explicit accessible name and an extra class', () => {
    const { container } = renderNet({ ariaLabel: 'Disease co-occurrence', className: 'tall' });
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-label')).toBe('Disease co-occurrence');
    expect(svg.getAttribute('class')).toBe('vzf-chart vzf-network tall');
  });

  it('names itself "network" when no view named it', () => {
    const { container } = renderNet({ viewId: undefined });
    expect(container.querySelector('desc')!.textContent).toContain('view network');
  });
});

// ── hover ────────────────────────────────────────────────────────────────────

describe('hover — the neighbourhood stays bright, and nothing is recorded', () => {
  it('hovering a node keeps it, the edges touching it and their far ends bright; everything else dims', () => {
    const { container, onEmit } = renderNet();
    fireEvent.mouseOver(nodeAt(container, 'flu'));
    // bright: flu (hovered), cold (far end of flu→cold). dim: strep, lone
    expect(dimmed(container).sort()).toEqual(['cold — strep', 'lone', 'strep']);
    // and hover is the verb that records nothing
    expect(onEmit).not.toHaveBeenCalled();
  });

  it('leaving restores every mark — null means "nothing dims", never "dim everything"', () => {
    const { container } = renderNet();
    fireEvent.mouseOver(nodeAt(container, 'flu'));
    fireEvent.mouseOut(nodeAt(container, 'flu'));
    expect(dimmed(container)).toEqual([]);
  });

  it('keyboard focus is the same highlight: focus brightens the neighbourhood, blur restores it', () => {
    const { container } = renderNet();
    fireEvent.focus(nodeAt(container, 'strep'));
    // strep's one edge is cold—strep, so cold is its far end; flu and lone dim
    expect(dimmed(container).sort()).toEqual(['flu', 'flu — cold', 'flu — ghost', 'lone']);
    fireEvent.blur(nodeAt(container, 'strep'));
    expect(dimmed(container)).toEqual([]);
  });

  it('the pointer and the keyboard keep their own slots: a mouse crossing a mark cannot clear a focus ring\'s neighbourhood', () => {
    const { container } = renderNet();
    fireEvent.focus(nodeAt(container, 'strep'));
    const focusDim = dimmed(container).sort();
    // the pointer wins while it is over a mark …
    fireEvent.mouseOver(nodeAt(container, 'flu'));
    expect(dimmed(container).sort()).toEqual(['cold — strep', 'lone', 'strep']);
    // … and leaving gives the still-focused node its own neighbourhood back
    fireEvent.mouseOut(nodeAt(container, 'flu'));
    expect(dimmed(container).sort()).toEqual(focusDim);
  });

  it('a hover the new rows no longer carry is not a hover — it never dims the whole frame', () => {
    const { container, rerender } = renderNet();
    fireEvent.mouseOver(nodeAt(container, 'cold'));
    expect(dimmed(container).sort()).toEqual(['flu — ghost', 'lone']);
    // a linked filter, a story step or a re-run act drops the hovered node, and
    // the circle that would have fired mouseleave is unmounted under the pointer
    rerender(<VizNetwork viewId="net" nodes={NODES.filter((n) => n.id !== 'cold')} edges={[]} keyField="disease" width={W} height={H} />);
    expect(dimmed(container)).toEqual([]);
  });
});

// ── selection ────────────────────────────────────────────────────────────────

describe('click — the point, the set, and the keyboard', () => {
  it('a plain click emits the R3 POINT on the key field', () => {
    const { container, onEmit } = renderNet();
    fireEvent.click(nodeAt(container, 'strep'));
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'strep', encoding: { kind: 'point', field: 'disease' } });
  });

  it('a click on the node this view already selected CLEARS it (rawValue null)', () => {
    const { container, onEmit } = renderNet({ selection: ownSelection('flu') });
    fireEvent.click(nodeAt(container, 'flu'));
    expect(onEmit).toHaveBeenCalledWith({ rawValue: null, encoding: { kind: 'point', field: 'disease' } });
  });

  it('a shift/⌘/ctrl-click toggles the node in this view\'s own SET (SET-1)', () => {
    const { container, onEmit } = renderNet({ selection: ownSelection('flu') });
    fireEvent.click(nodeAt(container, 'cold'), { shiftKey: true });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: { values: ['flu', 'cold'] }, encoding: { kind: 'match', field: 'disease' } });
    fireEvent.click(nodeAt(container, 'strep'), { metaKey: true });
    expect(onEmit).toHaveBeenLastCalledWith({ rawValue: { values: ['flu', 'strep'] }, encoding: { kind: 'match', field: 'disease' } });
    fireEvent.click(nodeAt(container, 'lone'), { ctrlKey: true });
    expect(onEmit).toHaveBeenLastCalledWith({ rawValue: { values: ['flu', 'lone'] }, encoding: { kind: 'match', field: 'disease' } });
  });

  it('Enter and Space activate a node; a shifted Space toggles the set; any other key does nothing', () => {
    const { container, onEmit } = renderNet();
    fireEvent.keyDown(nodeAt(container, 'flu'), { key: 'Enter' });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'flu', encoding: { kind: 'point', field: 'disease' } });
    fireEvent.keyDown(nodeAt(container, 'cold'), { key: ' ', shiftKey: true });
    expect(onEmit).toHaveBeenLastCalledWith({ rawValue: { values: ['cold'] }, encoding: { kind: 'match', field: 'disease' } });
    onEmit.mockClear();
    fireEvent.keyDown(nodeAt(container, 'flu'), { key: 'Tab' });
    expect(onEmit).not.toHaveBeenCalled();
  });

  it('a chart with no onEmit stays clickable and silent', () => {
    const { container } = renderNet({ onEmit: undefined });
    expect(() => fireEvent.click(nodeAt(container, 'flu'))).not.toThrow();
  });

  it('the view\'s OWN clause outlines the node and never dims anything', () => {
    const { container } = renderNet({ selection: ownSelection('flu') });
    expect(nodeAt(container, 'flu').getAttribute('class')).toBe('vzf-dot vzf-selected');
    expect(nodeAt(container, 'flu').getAttribute('aria-pressed')).toBe('true');
    expect(nodeAt(container, 'flu').querySelector('title')!.textContent).toContain('click to clear');
    expect(dimmed(container)).toEqual([]);
  });

  it('an EXCLUDE set outlines the excluded node and says so in its label', () => {
    const { container } = renderNet({ selection: ownSelection({ values: ['flu'], exclude: true }, 'match') });
    expect(nodeAt(container, 'flu').getAttribute('class')).toBe('vzf-dot vzf-excluded');
    expect(nodeAt(container, 'flu').getAttribute('aria-pressed')).toBe('false');
    expect(nodeAt(container, 'flu').getAttribute('aria-label')).toBe('flu · viral · 2 links — excluded');
  });
});

// ── the clauses ──────────────────────────────────────────────────────────────

describe('the clauses — dim, never hide; an edge is only as bright as its ends', () => {
  it('another view\'s clause dims the nodes that fail it, and every edge that touches one', () => {
    const { container } = renderNet({ selection: fromOther() });
    // region North survives: flu, strep. cold fails. `lone` has NO row — no evidence, no dimming.
    expect(dimmed(container).sort()).toEqual(['cold', 'cold — strep', 'flu — cold']);
    // dim, never hide: all four nodes and all three links are still on screen
    expect(container.querySelectorAll('g.vzf-net-nodes circle')).toHaveLength(4);
    expect(links(container)).toHaveLength(3);
  });

  it('an edge pointing at a node this frame does not carry stays bright — an absent end is not evidence', () => {
    const { container } = renderNet({ selection: fromOther() });
    expect(links(container)[2]!.getAttribute('class')).toBe('vzf-net-link'); // flu — ghost
  });

  it('hover narrows INSIDE the clause fold: a node dimmed by another view stays dim when hovered next door', () => {
    const { container } = renderNet({ selection: fromOther() });
    fireEvent.mouseOver(nodeAt(container, 'flu'));
    expect(dimmed(container)).toContain('cold'); // cold is flu's neighbour AND fails the clause
    expect(dimmed(container)).toContain('strep'); // outside the hovered neighbourhood
  });
});

// ── protocol 1.3: the WALK — asked on the edges, drawn on the nodes ───────────

/** The walk door: the endpoint column it asks on, and a spy for the edges layer's voice. */
function walkDoor() {
  const emit = vi.fn<(e: ChartEmission) => void>();
  return { walk: { field: 'source', emit }, emit };
}

/** A landed walk, folded for the NODES layer — the shape the def's `mirror` edge delivers. */
function walked(ids: readonly string[], seed = 'flu'): ReturnType<typeof selectionForView> {
  const rows: SelectionView[] = [
    { viewId: 'net~edges', field: 'source ↔ target', kind: 'neighbourhood', value: { seed, derivation: 'ego', hops: 1, ids }, fields: ['source', 'target'] },
  ];
  return selectionForView(rows, 'net~nodes');
}

describe('the walk — alt-click asks the edges, and the answer lights the nodes', () => {
  it('alt-click emits the SEED through the walk door, and the node\'s own voice says nothing', () => {
    const { walk, emit } = walkDoor();
    const { onEmit, container } = renderNet({ walk });
    fireEvent.click(nodeAt(container, 'cold'), { altKey: true });
    expect(emit).toHaveBeenCalledWith({ rawValue: 'cold', encoding: { kind: 'neighbourhood', field: 'source' } });
    expect(onEmit).not.toHaveBeenCalled();
  });

  it('the same modifier on the KEYBOARD asks the same walk — Enter and Space both', () => {
    const { walk, emit } = walkDoor();
    const { container } = renderNet({ walk });
    fireEvent.keyDown(nodeAt(container, 'flu'), { key: 'Enter', altKey: true });
    fireEvent.keyDown(nodeAt(container, 'strep'), { key: ' ', altKey: true });
    expect(emit.mock.calls.map(([e]) => e.rawValue)).toEqual(['flu', 'strep']);
  });

  it('alt-clicking the node the walk STARTED from clears it — the point\'s own rule', () => {
    const { walk, emit } = walkDoor();
    const { container } = renderNet({ walk, selection: walked(['flu', 'cold']) });
    fireEvent.click(nodeAt(container, 'flu'), { altKey: true });
    expect(emit).toHaveBeenCalledWith({ rawValue: null, encoding: { kind: 'neighbourhood', field: 'source' } });
  });

  it('an UNNAMED seed marks no node as walked — `null` is the sentinel, never a node key', () => {
    const { walk, emit } = walkDoor();
    // a walk projected from a clause with no commit behind it records `seed: null` rather than
    // inventing one; the node keyed by the string "null" is not the node it started from
    const { container } = renderNet({ walk, selection: walked(['null', 'flu'], null as unknown as string) });
    fireEvent.click(nodeAt(container, 'flu'), { altKey: true });
    expect(emit).toHaveBeenCalledWith({ rawValue: 'flu', encoding: { kind: 'neighbourhood', field: 'source' } });
  });

  it('with NO walk door the modifier is not a gesture: an alt-click selects, exactly as a plain one does', () => {
    const { onEmit, container } = renderNet();
    fireEvent.click(nodeAt(container, 'cold'), { altKey: true });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'cold', encoding: { kind: 'point', field: 'disease' } });
  });

  it('the EGO NET is lit from the recorded ids: everything outside the walk dims, and an edge only as bright as its ends', () => {
    const { container } = renderNet({ selection: walked(['flu', 'cold']) });
    // `flu — ghost` stays bright: its far end is a node this frame does not carry, and an
    // endpoint that is not here is no evidence to dim by — the chart's standing law, unchanged
    expect(dimmed(container).sort()).toEqual(['cold — strep', 'lone', 'strep'].sort());
    expect(container.querySelectorAll('g.vzf-net-nodes circle')).toHaveLength(4); // dim, never hide
  });

  it('a walk over the WHOLE graph dims nothing, and a cleared one is not a walk at all', () => {
    expect(dimmed(renderNet({ selection: walked(['flu', 'cold', 'strep', 'lone', 'ghost']) }).container)).toEqual([]);
    cleanup();
    const cleared: SelectionView[] = [{ viewId: 'net~edges', field: 'source ↔ target', kind: 'neighbourhood', value: null, fields: ['source', 'target'] }];
    expect(dimmed(renderNet({ selection: selectionForView(cleared, 'net~nodes') }).container)).toEqual([]);
  });

  it('the walk is NEVER judged as a row predicate: a node row carries no endpoint column, and it is not dimmed for that', () => {
    // every node row here has `disease`/`region` and neither `source` nor `target`;
    // folded into the predicate the clause would dim the entire frame
    const { container } = renderNet({ selection: walked(['flu', 'cold', 'strep', 'lone', 'ghost']) });
    expect(container.querySelectorAll('circle.vzf-dim')).toHaveLength(0);
  });

  it('says the gesture out loud, and only where there is one to make', () => {
    const { container } = renderNet({ walk: walkDoor().walk, selection: walked(['flu', 'cold']) });
    expect(container.querySelector('desc')!.textContent).toContain('alt-click (or alt+Enter) a node to select it and everything it links to');
    expect(nodeAt(container, 'flu').querySelector('title')!.textContent).toContain('alt-click to clear its neighbourhood');
    expect(nodeAt(container, 'cold').querySelector('title')!.textContent).toContain('alt-click for its neighbourhood');
    cleanup();
    const plain = renderNet().container;
    expect(plain.querySelector('desc')!.textContent).not.toContain('alt-click');
    expect(nodeAt(plain, 'flu').querySelector('title')!.textContent).not.toContain('alt-click');
  });
});

// ── protocol 1.4: WHICH walk — the host picks the question, the gesture follows ──

/** A landed walk of any derivation, folded for the NODES layer (the shape the def's `mirror` edge delivers). */
function walkedAs(value: Record<string, unknown>): ReturnType<typeof selectionForView> {
  const rows: SelectionView[] = [{ viewId: 'net~edges', field: 'source ↔ target', kind: 'neighbourhood', value, fields: ['source', 'target'] }];
  return selectionForView(rows, 'net~nodes');
}

describe('the walk QUESTION (protocol 1.4) — two hops, a component, and the two-click path', () => {
  it('the default question asks what it always asked: no `walk` on the encoding at all', () => {
    const { walk, emit } = walkDoor();
    const { container } = renderNet({ walk: { ...walk, question: { derivation: 'ego', hops: 1 } } });
    fireEvent.click(nodeAt(container, 'cold'), { altKey: true });
    expect(emit).toHaveBeenCalledWith({ rawValue: 'cold', encoding: { kind: 'neighbourhood', field: 'source' } });
  });

  it('an ego question with no hops named is the default one hop — the question may be partial, the ask never is', () => {
    const { walk, emit } = walkDoor();
    const { container } = renderNet({ walk: { ...walk, question: { derivation: 'ego' } } });
    fireEvent.click(nodeAt(container, 'cold'), { altKey: true });
    expect(emit).toHaveBeenCalledWith({ rawValue: 'cold', encoding: { kind: 'neighbourhood', field: 'source' } });
    expect(nodeAt(container, 'cold').querySelector('title')!.textContent).toContain('alt-click for its neighbourhood');
    expect(container.querySelector('desc')!.textContent).toContain('to select it and everything it links to');
  });

  it('two hops of ego, and a whole component, ride out on the encoding', () => {
    const two = walkDoor();
    const twoUp = renderNet({ walk: { ...two.walk, question: { derivation: 'ego', hops: 2 } } });
    fireEvent.click(nodeAt(twoUp.container, 'cold'), { altKey: true });
    expect(two.emit).toHaveBeenCalledWith({ rawValue: 'cold', encoding: { kind: 'neighbourhood', field: 'source', walk: { derivation: 'ego', hops: 2 } } });
    cleanup();

    const whole = walkDoor();
    const wholeUp = renderNet({ walk: { ...whole.walk, question: { derivation: 'component' } } });
    fireEvent.click(nodeAt(wholeUp.container, 'flu'), { altKey: true });
    expect(whole.emit).toHaveBeenCalledWith({ rawValue: 'flu', encoding: { kind: 'neighbourhood', field: 'source', walk: { derivation: 'component' } } });
  });

  it('the PATH takes two clicks: the first lands the seed\'s own neighbourhood, the second asks for the path', () => {
    const { walk, emit } = walkDoor();
    const question = { derivation: 'path' } as const;
    // FIRST click — nothing is walked yet, so there is no path to ask for: the seed's neighbourhood is something to see
    const first = renderNet({ walk: { ...walk, question } });
    fireEvent.click(nodeAt(first.container, 'flu'), { altKey: true });
    expect(emit).toHaveBeenLastCalledWith({ rawValue: 'flu', encoding: { kind: 'neighbourhood', field: 'source' } });
    cleanup();

    // SECOND click — the live walk's seed comes off the FOLD, and the far end is the node clicked
    const second = renderNet({ walk: { ...walk, question }, selection: walkedAs({ seed: 'flu', derivation: 'ego', hops: 1, ids: ['flu', 'cold'] }) });
    fireEvent.click(nodeAt(second.container, 'strep'), { altKey: true });
    expect(emit).toHaveBeenLastCalledWith({ rawValue: 'flu', encoding: { kind: 'neighbourhood', field: 'source', walk: { derivation: 'path', to: 'strep' } } });
  });

  it('a path already landed keeps asking from ITS seed, and alt-clicking the seed clears', () => {
    const { walk, emit } = walkDoor();
    const question = { derivation: 'path' } as const;
    const live = walkedAs({ seed: 'flu', derivation: 'path', hops: 2, to: 'strep', ids: ['flu', 'cold', 'strep'] });
    const { container } = renderNet({ walk: { ...walk, question }, selection: live });
    // another far end: the same seed, a new `to` — one act, never two
    fireEvent.click(nodeAt(container, 'cold'), { altKey: true });
    expect(emit).toHaveBeenLastCalledWith({ rawValue: 'flu', encoding: { kind: 'neighbourhood', field: 'source', walk: { derivation: 'path', to: 'cold' } } });
    // the seed itself: cleared, and a cleared walk asks NO walk
    fireEvent.click(nodeAt(container, 'flu'), { altKey: true });
    expect(emit).toHaveBeenLastCalledWith({ rawValue: null, encoding: { kind: 'neighbourhood', field: 'source' } });
  });

  it('a path with NO PATH still lights what it recorded — `hops: null` is a body, not a failure', () => {
    const { container } = renderNet({ selection: walkedAs({ seed: 'flu', derivation: 'path', hops: null, to: 'lone', ids: ['flu', 'lone'] }) });
    // the recorded set is the two nodes, so every node outside it dims — the honest picture of "nothing joins them".
    // `flu — ghost` stays bright for the reason it always does: an end this frame does not carry is not evidence.
    expect(dimmed(container).sort()).toEqual(['cold', 'cold — strep', 'flu — cold', 'strep']);
  });

  it('the `<title>` says what the NEXT alt-click will do — in every mode', () => {
    const { walk } = walkDoor();
    const two = renderNet({ walk: { ...walk, question: { derivation: 'ego', hops: 2 } } });
    expect(nodeAt(two.container, 'cold').querySelector('title')!.textContent).toContain('alt-click for its neighbourhood two hops out');
    expect(two.container.querySelector('desc')!.textContent).toContain('to select it and everything within two hops');
    cleanup();

    const whole = renderNet({ walk: { ...walk, question: { derivation: 'component' } }, selection: walkedAs({ seed: 'flu', derivation: 'component', hops: 2, ids: ['flu', 'cold', 'strep'] }) });
    expect(nodeAt(whole.container, 'cold').querySelector('title')!.textContent).toContain('alt-click for everything it connects to');
    expect(nodeAt(whole.container, 'flu').querySelector('title')!.textContent).toContain('alt-click to clear everything it connects to');
    expect(whole.container.querySelector('desc')!.textContent).toContain('to select everything it connects to');
    cleanup();

    const fresh = renderNet({ walk: { ...walk, question: { derivation: 'path' } } });
    expect(nodeAt(fresh.container, 'cold').querySelector('title')!.textContent).toContain('alt-click to start a path here');
    expect(fresh.container.querySelector('desc')!.textContent).toContain('to start a path, then alt-click another node for the path between them');
    cleanup();

    const live = renderNet({ walk: { ...walk, question: { derivation: 'path' } }, selection: walkedAs({ seed: 'flu', derivation: 'ego', hops: 1, ids: ['flu', 'cold'] }) });
    expect(nodeAt(live.container, 'strep').querySelector('title')!.textContent).toContain('alt-click for the path from flu');
    // the picker says PATH while an EGO walk is what is in force, so the clear arm names the EGO
    // walk: these words are about what this click clears, and that is what the trace shows
    expect(nodeAt(live.container, 'flu').querySelector('title')!.textContent).toContain('alt-click to clear its neighbourhood');
  });

  it('the CLEAR arm names the walk IN FORCE, never the one the picker is set to', () => {
    const { walk } = walkDoor();
    const cases: readonly (readonly [Record<string, unknown>, string])[] = [
      [{ seed: 'flu', derivation: 'ego', hops: 1, ids: ['flu', 'cold'] }, 'clear its neighbourhood'],
      [{ seed: 'flu', derivation: 'ego', hops: 2, ids: ['flu', 'cold', 'strep'] }, 'clear its neighbourhood two hops out'],
      [{ seed: 'flu', derivation: 'path', hops: 2, to: 'strep', ids: ['flu', 'cold', 'strep'] }, 'clear the path'],
      [{ seed: 'flu', derivation: 'component', hops: 2, ids: ['flu', 'cold', 'strep'] }, 'clear everything it connects to'],
      // a walk another build minted is still cleared by that click — and the words claim nothing
      // about a shape this frame cannot read
      [{ seed: 'flu', derivation: 'community', hops: 1, ids: ['flu', 'cold'] }, 'clear this walk'],
    ];
    for (const [body, words] of cases) {
      // the picker stays at its DEFAULT throughout: the words come off the landed body, never off the pick
      const { container } = renderNet({ walk, selection: walkedAs(body) });
      expect(nodeAt(container, 'flu').querySelector('title')!.textContent, String(body['derivation'])).toContain(`alt-click to ${words}`);
      cleanup();
    }
  });
});

// Opt-in captions stay on the same frame and never become new interaction targets.
describe('visible captions and node radius', () => {
  it('preserves the default DOM when captions are not enabled', () => {
    const original = renderNet();
    const markup = original.container.innerHTML;
    cleanup();
    const labeled = renderNet({ nodes: NODES.map((node) => ({ ...node, label: 'Readable name' })), edges: EDGES.map((edge) => ({ ...edge, label: 'Observed link' })) });
    expect(labeled.container.innerHTML).toBe(markup);
    expect(labeled.container.querySelectorAll('text')).toHaveLength(0);
    expect(nodeAt(labeled.container, 'flu').getAttribute('r')).toBe('5');
  });

  it('uses the shared frame, inward anchors and visible self-loop captions', () => {
    const nodes: NetworkNode[] = [{ id: 'left', x: 0, y: 10 }, { id: 'middle', x: 5, y: 5, label: 'Middle record' }, { id: 'right', x: 10, y: 0 }];
    const edges: NetworkEdge[] = [
      { source: 'left', target: 'right', sx: 0, sy: 10, tx: 10, ty: 0, label: 'Recorded connection' },
      { source: 'middle', target: 'middle', sx: 5, sy: 5, tx: 5, ty: 5, label: 'Same record' },
    ];
    const { container } = renderNet({ nodes, edges, width: 200, height: 200, showNodeLabels: true, showEdgeLabels: true });
    const captions = [...container.querySelectorAll('.vzf-net-node-label')];
    expect(captions.map((label) => label.textContent)).toEqual(['left', 'Middle record', 'right']);
    expect(captions.map((label) => label.getAttribute('text-anchor'))).toEqual(['start', 'middle', 'end']);
    for (const [i, label] of captions.entries()) {
      const mark = nodeAt(container, nodes[i]!.id);
      expect(label.getAttribute('x')).toBe(mark.getAttribute('cx'));
      expect(Number(label.getAttribute('y'))).toBeGreaterThanOrEqual(16);
      expect(Number(label.getAttribute('y'))).toBeLessThanOrEqual(184);
    }
    expect(Number(captions[0]!.getAttribute('y'))).toBeGreaterThan(Number(nodeAt(container, 'left').getAttribute('cy')));
    expect(Number(captions[2]!.getAttribute('y'))).toBeLessThan(Number(nodeAt(container, 'right').getAttribute('cy')));
    const edgeCaptions = [...container.querySelectorAll('.vzf-net-edge-label')];
    expect(edgeCaptions.map((label) => label.textContent)).toEqual(['Recorded connection', 'Same record']);
    expect(Number(edgeCaptions[0]!.getAttribute('x'))).toBe(100);
    expect(Number(edgeCaptions[0]!.getAttribute('y'))).toBe(94);
    expect(Number(edgeCaptions[1]!.getAttribute('y'))).toBe(70);
  });

  it('renders hostile captions only as text, skips empty captions, and leaves interaction to marks', () => {
    const hostile = '<img src=x onerror="throw 1"><script>bad()</script>';
    const { container } = renderNet({
      nodes: [{ id: 'safe', x: 0, y: 0, label: hostile }, { id: 'blank', x: 1, y: 1, label: '' }],
      edges: [
        { source: 'safe', target: 'blank', sx: 0, sy: 0, tx: 1, ty: 1, label: hostile },
        { source: 'safe', target: 'blank', sx: 0, sy: 0, tx: 1, ty: 1, label: ' ' },
        { source: 'safe', target: 'blank', sx: 0, sy: 0, tx: 1, ty: 1 },
      ],
      showNodeLabels: true, showEdgeLabels: true,
    });
    const captions = [...container.querySelectorAll('text')];
    expect(captions).toHaveLength(2);
    for (const caption of captions) {
      expect(caption.textContent).toBe(hostile);
      expect(caption.getAttribute('aria-hidden')).toBe('true');
      expect(caption.getAttribute('pointer-events')).toBe('none');
      expect(caption.hasAttribute('tabindex')).toBe(false);
    }
    expect(container.querySelector('img, script')).toBeNull();
  });

  it.each([1, 9, 16])('uses valid radius %s for nodes and self-loops', (radius) => {
    const { container } = renderNet({ nodeRadius: radius, edges: [{ source: 'flu', target: 'flu', sx: 0, sy: 0, tx: 0, ty: 0 }] });
    expect(nodeAt(container, 'flu').getAttribute('r')).toBe(String(radius));
    expect(container.querySelector('g.vzf-net-links circle')!.getAttribute('r')).toBe(String(radius));
  });

  it.each([NaN, Infinity, -Infinity, 0, -1, 16.1, '9' as unknown as number])('falls back to radius 5 for invalid input %s', (radius) => {
    const { container } = renderNet({ nodeRadius: radius });
    expect(nodeAt(container, 'flu').getAttribute('r')).toBe('5');
  });

  it('still selects by source id and dims captions with their marks on hover', () => {
    const { container, onEmit } = renderNet({
      nodes: NODES.map((node) => ({ ...node, label: `Caption ${node.id}` })),
      edges: EDGES.map((edge) => ({ ...edge, label: `${edge.source} to ${edge.target}` })),
      showNodeLabels: true, showEdgeLabels: true, nodeRadius: 9,
    });
    fireEvent.click(nodeAt(container, 'cold'));
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'cold', encoding: { kind: 'point', field: 'disease' } });
    fireEvent.keyDown(nodeAt(container, 'strep'), { key: 'Enter' });
    expect(onEmit).toHaveBeenLastCalledWith({ rawValue: 'strep', encoding: { kind: 'point', field: 'disease' } });
    fireEvent.mouseOver(nodeAt(container, 'flu'));
    expect([...container.querySelectorAll('.vzf-net-node-label.vzf-dim')].map((label) => label.textContent)).toEqual(['Caption strep', 'Caption lone']);
    expect([...container.querySelectorAll('.vzf-net-edge-label.vzf-dim')].map((label) => label.textContent)).toEqual(['cold to strep']);
    fireEvent.mouseOut(nodeAt(container, 'flu'));
    expect(container.querySelector('.vzf-net-node-label.vzf-dim, .vzf-net-edge-label.vzf-dim')).toBeNull();
  });
});
