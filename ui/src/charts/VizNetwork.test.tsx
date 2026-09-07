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
