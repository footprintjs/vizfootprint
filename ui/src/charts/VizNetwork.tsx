/**
 * `<VizNetwork>` — THE NODE-LINK: TWO TABLES ON ONE FRAME. The nodes carry
 * their layout positions, the edges carry BOTH of their endpoints, and ONE
 * pair of linear scales — computed over the UNION of the node positions and
 * the edge endpoints — places every mark of both. That shared pair IS the
 * frame, and it is the whole reason this is one component taking two props
 * rather than two components stacked: two independently scaled charts would
 * put a link's end somewhere its node is not.
 *
 * The law it follows is the transform-ownership rule — the chart draws what it
 * is given. It runs NO layout: the positions arrive as ordinary columns,
 * written by the `layout` builtin at an act's slot and carried onto the edges
 * by `bringOver`, so what is on screen is what is in the trace. It declares no
 * size ceiling either — how many nodes one SVG frame can carry is the
 * WRAPPER's judgement (`networkRenderer`), never a fact about this component.
 *
 * Selection is the contract's clause-addressable fold, read exactly as
 * `<VizScatter>` reads it (dim-not-hide, self-excluded). HOVER is the one
 * thing here that is local state and NOT a selection: hovering a node keeps
 * it, the edges touching it and their far endpoints bright and dims the rest —
 * and emits nothing at all, because hover records nothing (contract/README.md,
 * "hover is the case that settles the rule"). The pointer and the keyboard are
 * TWO sources of that one highlight and they keep their own slots: a mouse
 * crossing a mark and leaving must not clear the neighbourhood a focus ring is
 * still promising.
 *
 * First customers: `networkRenderer` (the first first-party renderer to
 * declare `canLayer`) and the CDC demo's disease network.
 */
import { useMemo, useState } from 'react';
import type { ChartEmission } from 'vizfootprint/selection';
import type { RenderRow, RenderSelection } from '../contract/types.js';
import { linearScale, extent } from '../primitives/scales.js';
import { dimClass, useBrightPredicate, selectedSet, inSet, markClass } from '../primitives/useSelection.js';
import { clickEmission, toggleInSetEmission } from '../primitives/pointSelect.js';

/** One node: its key, the position the layout act wrote, and the source row the clauses judge. */
export interface NetworkNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** A group name for the label — the colour channel is a LAYER's to bind, not this prop's to invent. */
  readonly category?: string;
  /**
   * The SOURCE row this node was derived from — the clause predicates in
   * `selection` evaluate against it. A node without a row is never dimmed
   * (honest: no evidence, no dimming) — the `<VizScatter>` rule.
   */
  readonly row?: RenderRow;
}

/**
 * One edge, with BOTH endpoints already positioned: `sx`/`sy` and `tx`/`ty`
 * are what `bringOver` wrote across the declared relation (source_x, source_y,
 * target_x, target_y). The chart never looks a position up by id — an edge
 * pointing at a node that is not on this frame still draws where it says.
 */
export interface NetworkEdge {
  readonly source: string;
  readonly target: string;
  readonly sx: number;
  readonly sy: number;
  readonly tx: number;
  readonly ty: number;
}

export interface VizNetworkProps {
  /** The chart's accessible name — the prose plane's `altShort` lands here; absent = the chart names itself. */
  readonly ariaLabel?: string;
  readonly viewId?: string;
  readonly nodes: readonly NetworkNode[];
  readonly edges: readonly NetworkEdge[];
  /** The DATA field a node click emits on — the nodes table's key. */
  readonly keyField: string;
  /**
   * The clause-addressable crossfilter selection (RP-1): nodes whose source
   * `row` fails the non-self clauses are dimmed, and an edge is only as bright
   * as its two ends. The chart's OWN clause never dims it.
   */
  readonly selection?: RenderSelection;
  readonly onEmit?: (emission: ChartEmission) => void;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

/** The whole frame is padding: a node-link has no axis to leave room for. */
const PAD = { l: 16, r: 16, t: 16, b: 16 };
const NODE_R = 5;

interface FramePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Every point the frame must hold: each node's position AND both endpoints of
 * every edge. WHY the union and not just the nodes: an edge may name a node
 * this frame does not carry (a filtered-away endpoint), and a link running off
 * the plot is a lie about where its far end is.
 */
function framePoints(nodes: readonly NetworkNode[], edges: readonly NetworkEdge[]): FramePoint[] {
  const points: FramePoint[] = nodes.map((n) => ({ x: n.x, y: n.y }));
  for (const e of edges) points.push({ x: e.sx, y: e.sy }, { x: e.tx, y: e.ty });
  return points;
}

/** The two scales every mark of both groups is placed by. */
interface Frame {
  readonly x: (value: number) => number;
  readonly y: (value: number) => number;
}

/**
 * The frame: ONE px-per-unit for both axes, and the slack centred.
 *
 * WHY one unit and not two: a node-link's x and y are not two quantities, they
 * are one spatial substrate. The positions come from the stress layout, whose
 * whole promise is |p_i − p_j| ≈ the graph distance — so stretching the axes
 * independently would render equal graph distances at different pixel
 * distances depending on their orientation, and turn a ring into an ellipse.
 * `extent` never returns lo === hi, so `k` is always finite.
 */
function frameOf(nodes: readonly NetworkNode[], edges: readonly NetworkEdge[], width: number, height: number): Frame {
  const points = framePoints(nodes, edges);
  const [xlo, xhi] = extent(points, (p) => p.x);
  const [ylo, yhi] = extent(points, (p) => p.y);
  const availW = width - PAD.l - PAD.r;
  const availH = height - PAD.t - PAD.b;
  const k = Math.min(availW / (xhi - xlo), availH / (yhi - ylo));
  const spanX = (xhi - xlo) * k;
  const spanY = (yhi - ylo) * k;
  const x0 = PAD.l + (availW - spanX) / 2;
  const y0 = PAD.t + (availH - spanY) / 2;
  return { x: linearScale(xlo, xhi, x0, x0 + spanX), y: linearScale(ylo, yhi, y0 + spanY, y0) };
}

/**
 * The ids that stay bright while `hovered` is under the pointer: the node
 * itself and the far end of every edge touching it. `null` when nothing is
 * hovered — and null means nothing dims, never "dim everything".
 */
function neighbourhoodOf(hovered: string | null, edges: readonly NetworkEdge[]): ReadonlySet<string> | null {
  if (hovered === null) return null;
  const near = new Set<string>([hovered]);
  for (const e of edges) {
    if (e.source === hovered) near.add(e.target);
    if (e.target === hovered) near.add(e.source);
  }
  return near;
}

/** How many edges touch each node — the number a node's label reports, so the links are readable without a mouse. */
function degreeOf(edges: readonly NetworkEdge[]): ReadonlyMap<string, number> {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  return degree;
}

/** A node's name, its group and its degree — one sentence, spoken by both the label and the tooltip. */
function nodeLabel(node: NetworkNode, degree: number): string {
  // an empty cell is not a group: `nodesOf` writes `String(row[colorField])`,
  // and a blank cell in the nodes table is '' — a bare separator in a label a
  // screen reader reads out (the `<VizScatter>` guard, by truthiness)
  const group = node.category ? ` · ${node.category}` : '';
  return `${node.id}${group} · ${degree} ${degree === 1 ? 'link' : 'links'}`;
}

export function VizNetwork(props: VizNetworkProps): JSX.Element {
  const { viewId = 'network', nodes, edges, keyField, selection, onEmit, width = 420, height = 340 } = props;

  // HOVER is local and unrecorded: it never leaves the component, so it needs
  // no capability and lands no commit (contract/types.ts, `RendererCallbacks.hover`).
  // TWO slots, one highlight: each affordance clears only what it set, so a
  // pointer crossing a mark cannot cancel a keyboard user's focus ring. The
  // pointer wins while it is over a mark, and leaving gives focus its own back.
  const [pointed, setPointed] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  const bright = useBrightPredicate(selection);
  const set = selectedSet(undefined, selection);

  // The frame is render-INVARIANT — it depends on the rows and the box, never
  // on the hover — so it is derived once and not on every pointer crossing.
  const frame = useMemo(() => frameOf(nodes, edges, width, height), [nodes, edges, width, height]);
  const degree = useMemo(() => degreeOf(edges), [edges]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);

  /**
   * Each node folded through the clause predicates ONCE. WHY a map and not a
   * call per reader: an edge asks about both of its ends, so a hub of degree
   * 500 would have its row folded 501 times for an answer that cannot differ.
   * `?? true` keeps today's law — an endpoint the frame does not carry, or a
   * node with no row, is no evidence to dim by.
   */
  const brightById = useMemo(
    () => new Map(nodes.map((n) => [n.id, bright && n.row ? bright(n.row) : true] as const)),
    [nodes, bright],
  );

  // WHY the hover is narrowed to the frame: a removed circle fires no
  // mouseleave and no blur, so a filter act can leave an id here naming a node
  // these rows no longer carry — and `neighbourhoodOf` would then dim every
  // surviving mark with nothing under the pointer, which is the one state its
  // own contract forbids. A hover the frame does not carry is not a hover.
  const held = pointed ?? focused;
  const hovered = held !== null && byId.has(held) ? held : null;
  const near = neighbourhoodOf(hovered, edges);

  /** Does this node survive the OTHER views' clauses? No row is no evidence, so it stays bright. */
  const survivesById = (id: string): boolean => brightById.get(id) ?? true;

  const nodeIsBright = (node: NetworkNode): boolean => survivesById(node.id) && (near === null || near.has(node.id));
  const edgeIsBright = (edge: NetworkEdge): boolean =>
    survivesById(edge.source) && survivesById(edge.target) && (hovered === null || edge.source === hovered || edge.target === hovered);

  const emit = (id: string, additive: boolean): void => {
    // the VizMap rule: a plain click selects (and clears on the selected one),
    // shift/⌘/ctrl toggles the node in this view's own SET (SET-1)
    onEmit?.(additive ? toggleInSetEmission(keyField, id, set) : clickEmission(keyField, id, set));
  };

  return (
    <svg
      className={`vzf-chart vzf-network${props.className ? ' ' + props.className : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label={props.ariaLabel ?? `node-link of ${nodes.length} ${keyField} nodes and ${edges.length} links`}
    >
      {/* WHY the GESTURE and not the counts: a node's own `aria-label` wins over
          its `<title>` under accname, so "click to clear" reaches a tooltip and
          no assistive technology — the `<desc>` is the only place it can be
          said. The counts are already on the svg's own label, and the
          PROVENANCE is not this chart's to claim: it draws what it is given. */}
      <desc>{`view ${viewId}: click a node to filter ${keyField}; click it again to clear`}</desc>
      {/* links UNDER nodes — DOM order is paint order, and the nodes are the marks that take the tab */}
      <g className="vzf-net-links">
        {edges.map((e, i) => {
          // an en dash and not an arrow: nothing here is directed — the mark has
          // no arrowhead, the neighbourhood adds both ways, the degree folds in
          // and out into one number, and the layout read an UNDIRECTED graph
          const pair = `${e.source} — ${e.target}`;
          const shared = { key: `${e.source}·${e.target}·${i}`, className: `vzf-net-link${dimClass(edgeIsBright(e))}`, role: 'img', 'aria-label': pair };
          // a coincident-endpoint edge is a SELF-LOOP: drawn as a segment it is
          // zero-length and paints nothing (butt linecap), so the counts would
          // report a link the frame never showed
          return e.sx === e.tx && e.sy === e.ty ? (
            <circle {...shared} fill="none" cx={frame.x(e.sx)} cy={frame.y(e.sy) - NODE_R} r={NODE_R}>
              <title>{pair}</title>
            </circle>
          ) : (
            <line {...shared} x1={frame.x(e.sx)} y1={frame.y(e.sy)} x2={frame.x(e.tx)} y2={frame.y(e.ty)}>
              <title>{pair}</title>
            </line>
          );
        })}
      </g>
      <g className="vzf-net-nodes">
        {nodes.map((n, i) => {
          const isSel = inSet(n.id, set);
          const label = nodeLabel(n, degree.get(n.id) ?? 0);
          return (
            <circle
              // the index is the same defence the links carry: a nodes table
              // that is not one row per key would otherwise give React two
              // children with one key, and it would reuse one for both
              key={`${n.id}·${i}`}
              className={`vzf-dot${markClass(n.id, set)}${dimClass(nodeIsBright(n))}`}
              cx={frame.x(n.x)}
              cy={frame.y(n.y)}
              r={NODE_R}
              fill="var(--vzf-brand)"
              role="button"
              tabIndex={0}
              aria-pressed={isSel && !set.exclude}
              aria-label={`${label}${isSel && set.exclude ? ' — excluded' : ''}`}
              data-node={n.id}
              onMouseEnter={() => setPointed(n.id)}
              onMouseLeave={() => setPointed(null)}
              onFocus={() => setFocused(n.id)}
              onBlur={() => setFocused(null)}
              onClick={(e) => emit(n.id, e.shiftKey || e.metaKey || e.ctrlKey)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                emit(n.id, e.shiftKey || e.metaKey || e.ctrlKey);
              }}
            >
              <title>{`${label} · click to ${isSel ? 'clear' : 'select'}`}</title>
            </circle>
          );
        })}
      </g>
    </svg>
  );
}
