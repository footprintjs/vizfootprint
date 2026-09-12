/**
 * The FIRST-PARTY REFERENCE IMPLEMENTATIONS of the renderer contract (RP-1):
 * each of the nine charts (scatter · line · bar · map · table · histogram ·
 * heatmap · box plot · network), wrapped as a framework-agnostic
 * {@link Renderer} via one generic React bridge (`reactRenderer`) — and the
 * TENTH, which draws no chart of its own: `layeredRenderer`, the generic FRAME
 * (R6), which composes the 2D marks of a def's layer stack over one margin box
 * through `<VizFrame>`. Each 2D mark is ONE function here (`barMark`,
 * `lineMark`, …), used by its single-mark renderer and by the frame alike: two
 * spellings of "how a bar is drawn from rows" is the one that goes stale.
 *
 * They are proof, not assertion — the first eight pass the conformance kit
 * (`conformance.test.tsx`) end to end, the heatmap including the D30 cell arm.
 * The ninth, `networkRenderer`, is the first to declare `canLayer`, and it is
 * also the first whose every mark belongs to a LAYER rather than to the view:
 * it passes the kit's arms up to `commit-lands`, where the kit asks for a
 * view-level gesture a two-table node-link does not have. That stop is pinned,
 * explained and proven around in `conformance.test.tsx` — read it before
 * changing either side.
 *
 * What the bridge does — and deliberately does NOT do:
 *   - mount() creates a React root inside the host's element and answers the
 *     hello (protocol version, honest capabilities, transforms: [] — these
 *     renderers own NO aggregation; `rows` arrive host-prepared, so e.g. the
 *     bar renderer expects one row per category carrying its count).
 *   - update() renders synchronously (flushSync) so an imperative host sees
 *     the DOM settle before its next line — the contract has no async render
 *     acknowledgement on purpose. A REACT host pushing from inside its own
 *     render (an effect) has to defer the push by a microtask, or React warns
 *     that flushSync ran while it was rendering: `ui/gallery/frame.tsx` shows
 *     the one-line shape, and it is the price of the sync render, not a bug.
 *   - The four callbacks wire straight through: a brush/click → `emit`; an
 *     axis-label click → `reencodeRequest` (the HOST owns the picker — the
 *     charts' built-in EncodingPicker never opens in contract mode). None of
 *     the nine pans or zooms, and each says so where it counts
 *     (`canPanZoom: false` — a host-driven navigate lands a typed gap
 *     instead of silently recording nothing). None of the nine speaks `hover`
 *     either, and no capability says so BY DESIGN: hover records nothing, so
 *     a host loses nothing by discovering the silence at runtime — see the
 *     note on `RendererCallbacks.hover` in types.ts.
 *   - Every capability here is a promise about the BOUND renderer, never
 *     about the chart underneath it (the capability-honesty law — types.ts
 *     header, worked example in this folder's README.md). Where a chart can
 *     do more by hand than the wrapper delivers, the flag stays false until
 *     the wrapper delivers it: that is why `barRenderer`'s `canHighlight` is
 *     computed from its options rather than written as a constant.
 *   - RenderState.theme (a `--vzf-*` token map) lands as CSS variables on the
 *     `.vzf` wrapper, so a themed host stays themed inside the mount.
 *   - `encodings` picks the fields: x/y (scatter, line), color (series),
 *     category (bar), region (map). Missing entries fall back to each chart's
 *     own documented defaults — through `boundField` (`../charts/binding.ts`),
 *     the ONE law for "which field does this channel encode", so a renderer
 *     cannot drift from the charts it wraps.
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  RENDERER_PROTOCOL_VERSION,
  type HostHandshake,
  type Renderer,
  type RendererCapabilities,
  type RenderEncodings,
  type RenderLayer,
  type EmissionKind,
  type RendererCallbacks,
  type RenderRow,
  type RenderSelection,
  type RenderState,
} from './types.js';
import { frameDomains, type ResolvedChannel } from 'vizfootprint/def';
import { boundField } from '../charts/binding.js';
import { bandOrder, epochOf, type ChartDomain, type AxisSide } from '../primitives/scales.js';
import { VizFrame, isFrameChartKind, type FrameAxis, type FrameChartKind } from '../charts/VizFrame.js';
import { VizScatter } from '../charts/VizScatter.js';
import { VizLine } from '../charts/VizLine.js';
import { VizBar } from '../charts/VizBar.js';
import { VizMap, type GeoFeatureCollection } from '../charts/VizMap.js';
import { VizTable, type TableRow } from '../charts/VizTable.js';
import { VizHistogram } from '../charts/VizHistogram.js';
import { VizHeatmap } from '../charts/VizHeatmap.js';
import { VizBoxPlot } from '../charts/VizBoxPlot.js';
import { VizNetwork, type NetworkEdge, type NetworkNode, type NetworkWalkQuestion, type VizNetworkProps } from '../charts/VizNetwork.js';

/** The bridge spec: declared capabilities + a pure state→element function. */
export interface ReactRendererSpec {
  readonly capabilities: RendererCapabilities;
  render(state: RenderState, handshake: HostHandshake): JSX.Element;
}

/**
 * Wrap a React element function as a contract {@link Renderer}. Any React
 * chart can join the protocol through this one bridge; the ten first-party
 * factories below are its reference uses.
 */
export function reactRenderer(spec: ReactRendererSpec): Renderer {
  return {
    mount(el, handshake) {
      const root = createRoot(el as HTMLElement);
      return {
        hello: {
          protocolVersion: RENDERER_PROTOCOL_VERSION,
          capabilities: spec.capabilities,
          transforms: [], // the host owns all aggregation/decimation — declared, not implied
        },
        update(state) {
          // synchronous render: the host's next line sees the settled DOM
          flushSync(() => {
            root.render(
              <div className="vzf" style={state.theme as CSSProperties}>
                {spec.render(state, handshake)}
              </div>,
            );
          });
        },
        unmount() {
          root.unmount();
        },
      };
    },
  };
}

/** A row value as a number, or 0 — mirrors the apps' own coercion for unencodable cells. */
function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

/**
 * WHAT ONE MARK IS DRAWN FROM. A plain view's mark reads the view's own rows
 * and speaks with the view's callbacks; a LAYER of a frame reads its own rows,
 * on the frame's scales, in the box the frame sized for it, and speaks with its
 * own bundle. Everything else about drawing a bar is the same either way — so
 * each kind below is ONE function over this, used by the single-mark renderer
 * and by `layeredRenderer` alike. Two spellings of "how a bar is drawn from
 * rows" is the one that goes stale.
 */
interface MarkDraw {
  readonly viewId: string;
  readonly rows: readonly RenderRow[];
  readonly encodings: RenderEncodings;
  readonly selection: RenderSelection;
  readonly width: number;
  readonly height: number;
  /** Whose voice a gesture on this mark is — the view's, or the layer's own bundle (the 1.2 law). */
  readonly callbacks: RendererCallbacks;
  /** The frame's scales, or `{}` for a mark on its own extents (which is byte-identical to the chart before frames existed). */
  readonly domain: ChartDomain;
  /** `false` while the FRAME draws one merged guide for the stack; `'y'` when this mark draws only its own y, on `axisSide`, and the frame draws x once (the two-axis figure). */
  readonly axes: boolean | 'y';
  /** The edge this mark's own y axis stands on — set exactly when `axes` is `'y'`. Only a line or a point ever receives it (law 2). */
  readonly axisSide?: AxisSide;
  /**
   * PROTOCOL 1.5's fold, PASSED THROUGH RAW — `RenderState.frame`, unread by
   * every mark but `lineMark`. A plain view binds no `layers`, so nothing here
   * builds it a `FramedLayer` to ask `xBinding`/`bandX` the layered path's
   * question ("is this layer's x a band?") — but a host can still fold ONE
   * channel's scale for a plain view the same door folds it for a stack
   * (`frameFor`, `ui/src/adapter/frame.ts` — "first customers: … the gallery
   * page"), and when it does, this is where that answer rides to the mark
   * that needs it, unread by the ones that don't.
   */
  readonly frame?: Readonly<Record<string, ResolvedChannel>>;
}

/** A whole view as one mark's material: its rows, its voice, its own extents, its own guide. */
function viewDraw(state: RenderState, handshake: HostHandshake): MarkDraw {
  return {
    viewId: handshake.viewId,
    rows: state.rows,
    encodings: state.encodings,
    selection: state.selection,
    width: state.size.width,
    height: state.size.height,
    callbacks: handshake.callbacks,
    domain: {},
    axes: true,
    frame: state.frame,
  };
}

// ── scatter ────────────────────────────────────────────────────────────────────

export interface ScatterRendererOptions {
  /** The row field carrying a stable point id. Default `'id'`. */
  readonly idField?: string;
  readonly colorOf?: (category: string | undefined) => string;
}

/** Interval brush on x · dims under the non-self clauses · axis re-encode requests. */
export function scatterRenderer(options: ScatterRendererOptions = {}): Renderer {
  return reactRenderer({
    capabilities: {
      canBrush: true,
      canPointSelect: false,
      canHighlight: true,
      canReencode: true,
      canPanZoom: false,
      emissionKinds: ['interval'],
    },
    render(state, handshake) {
      return pointMark(viewDraw(state, handshake), options);
    },
  });
}

/** One layer (or one view) of points. */
function pointMark(d: MarkDraw, options: ScatterRendererOptions): JSX.Element {
  const x = boundField(d.encodings, 'x', 'x');
  const y = boundField(d.encodings, 'y', 'y');
  const color = d.encodings['color'];
  const idField = options.idField ?? 'id';
  const data = d.rows.map((r, i) => ({
    id: String(r[idField] ?? i),
    x: num(r[x]),
    y: num(r[y]),
    category: color !== undefined ? String(r[color]) : undefined,
    row: r,
  }));
  return (
    <VizScatter
      viewId={d.viewId}
      data={data}
      xField={x}
      yField={y}
      selection={d.selection}
      colorOf={options.colorOf}
      width={d.width}
      height={d.height}
      domain={d.domain}
      axes={d.axes}
      {...(d.axisSide === undefined ? {} : { axisSide: d.axisSide })}
      onEmit={d.callbacks.emit}
      onReencodeRequest={d.callbacks.reencodeRequest}
    />
  );
}

// ── line ───────────────────────────────────────────────────────────────────────

export interface LineRendererOptions {
  readonly colorOf?: (series: string | undefined) => string;
}

/**
 * Time brush on x · axis re-encode requests. The HOST passes rows already
 * crossfiltered (and decimated if it chooses); with one row per (date,
 * series) the chart's per-date mean is the identity — it never re-aggregates
 * host-prepared data.
 */
export function lineRenderer(options: LineRendererOptions = {}): Renderer {
  return reactRenderer({
    capabilities: {
      canBrush: true,
      canPointSelect: false,
      canHighlight: false,
      canReencode: true,
      canPanZoom: false,
      emissionKinds: ['interval'],
    },
    render(state, handshake) {
      return lineMark(viewDraw(state, handshake), options);
    },
  });
}

/**
 * One layer (or one view) of a line. Its points carry a CATEGORY when the x
 * column was folded as one — `domain.categories` when a multi-layer FRAME
 * merged a band order for the stack (`layerDomain` gives it exactly when the
 * column this layer binds to x was folded as categorical), or `d.frame`'s own
 * resolution of the `x` channel for a PLAIN view with no stack to merge one
 * from (`sharedOn` — the SAME test the layered path asks through
 * `xBinding`/`bandX`, so a line never answers "is my x a band" two ways) —
 * and a DATE otherwise: band versus run is the x column's, read off the fold,
 * never off a prop of the mark.
 *
 * THE BUG THIS SECOND ARM FIXES: `viewDraw` builds no band order of its own
 * to merge (there is no stack), so a layerless view's `domain.categories` was
 * ALWAYS undefined — a line over a category the door had just accepted built
 * DATED points regardless, `Date.parse` could not place "flu" or "TX", and
 * every point was silently skipped. The door and the renderer agreeing is
 * exactly what this packet's law requires — pinned in `renderers.test.tsx`,
 * describe('lineRenderer — a layerless line over a category (packet V, the
 * blocking finding)').
 */
function lineMark(d: MarkDraw, options: LineRendererOptions): JSX.Element {
  const dateField = boundField(d.encodings, 'x', 'date');
  const valueField = boundField(d.encodings, 'y', 'value');
  const seriesField = d.encodings['color'];
  const onBand = d.domain.categories !== undefined || sharedOn(d.frame, 'x')?.scale === 'categorical';
  const data = d.rows.map((r) => ({
    ...(onBand ? { category: String(r[dateField]) } : { date: String(r[dateField]) }),
    value: num(r[valueField]),
    series: seriesField !== undefined ? String(r[seriesField]) : undefined,
  }));
  return (
    <VizLine
      viewId={d.viewId}
      data={data}
      dateField={dateField}
      valueField={valueField}
      colorOf={options.colorOf}
      width={d.width}
      height={d.height}
      domain={d.domain}
      axes={d.axes}
      {...(d.axisSide === undefined ? {} : { axisSide: d.axisSide })}
      onEmit={d.callbacks.emit}
      onReencodeRequest={d.callbacks.reencodeRequest}
    />
  );
}

// ── bar ────────────────────────────────────────────────────────────────────────

export interface BarRendererOptions {
  /** The row field carrying the HOST-aggregated count. Default `'count'`. */
  readonly countField?: string;
  /**
   * The row field carrying the HOST-aggregated BRIGHT count for the same
   * category — the Layer-4 highlight share, drawn as a narrower inner bar
   * ("this much of it", never dropped rows). Naming it is what makes this
   * renderer's `canHighlight` TRUE, and the reason it must be named at all
   * is the transform-ownership rule: rows arrive as one row per category and
   * the chart may never recount, so the bright share can only reach it as a
   * SECOND host aggregate on the row. Absent = no overlay, and
   * `canHighlight: false` — an honest "this bound renderer does not do that".
   */
  readonly highlightCountField?: string;
  readonly colorOf?: (category: string) => string;
}

/**
 * Point select on the category · axis re-encode requests · the Layer-4
 * highlight overlay when the host names its field. Rows arrive
 * host-AGGREGATED: one row per category, its count on `countField` (and its
 * bright share on `highlightCountField`, if the host sends one) — the chart
 * never counts (the transform-ownership rule).
 *
 * `canHighlight` is COMPUTED, not asserted: this chart has no rows on screen
 * to dim, so the only highlight it can draw is the share the host aggregated
 * for it. With no `highlightCountField` the wrapper delivers nothing and the
 * flag is false; naming the field makes both true at once, which is the
 * capability-honesty law in one line of code.
 */
export function barRenderer(options: BarRendererOptions = {}): Renderer {
  const highlightField = options.highlightCountField;
  return reactRenderer({
    capabilities: {
      canBrush: false,
      canPointSelect: true,
      canHighlight: highlightField !== undefined,
      canReencode: true,
      canPanZoom: false,
      emissionKinds: ['point', 'match'], // SET-1: shift-click adds to the view's own set
    },
    render(state, handshake) {
      return barMark(viewDraw(state, handshake), options);
    },
  });
}

/** One layer (or one view) of bars. */
function barMark(d: MarkDraw, options: BarRendererOptions): JSX.Element {
  const highlightField = options.highlightCountField;
  const field = boundField(d.encodings, 'category', 'category');
  const countField = options.countField ?? 'count';
  const data = d.rows.map((r) => ({ category: String(r[field]), count: num(r[countField]) }));
  // The overlay rides only while the host is actually sending the share.
  // A frame whose rows carry no such number means no highlight edge is
  // live, and an overlay of zeros would draw a claim of its own ("none of
  // this bar is bright") over every bar — so the absence stays an absence.
  const highlight =
    highlightField === undefined || !d.rows.some((r) => typeof r[highlightField] === 'number')
      ? undefined
      : d.rows.map((r) => ({ category: String(r[field]), count: num(r[highlightField]) }));
  return (
    <VizBar
      viewId={d.viewId}
      data={data}
      highlight={highlight}
      field={field}
      selection={d.selection}
      colorOf={options.colorOf}
      width={d.width}
      height={d.height}
      domain={d.domain}
      // a bar, a histogram and a box plot take neither side of a two-scale frame (law 2, refused upstream by
      // `stackRefusal`), so `'y'` never arrives here; `=== true` keeps the chart's boolean prop honest without a cast
      axes={d.axes === true}
      onEmit={d.callbacks.emit}
      onReencodeRequest={d.callbacks.reencodeRequest}
    />
  );
}

// ── map ────────────────────────────────────────────────────────────────────────

export interface MapRendererOptions {
  /** The GeoJSON FeatureCollection the choropleth draws — geometry is host data, not chart data. */
  readonly geo: GeoFeatureCollection;
  /** The feature property carrying the region name. Default `'name'`. */
  readonly nameProperty?: string;
  /** The row field carrying the HOST-aggregated per-region value. Default `'value'`. */
  readonly valueField?: string;
  /** The unit word for tooltips/legend. Default `'rows'`. */
  readonly valueLabel?: string;
}

/**
 * Point select on a region (click-again clears). Rows arrive host-AGGREGATED:
 * one row per region, its value on `valueField`. No re-encode affordance and
 * no pan/zoom — the capabilities say so honestly.
 */
export function mapRenderer(options: MapRendererOptions): Renderer {
  return reactRenderer({
    capabilities: {
      canBrush: false,
      canPointSelect: true,
      canHighlight: false,
      canReencode: false,
      canPanZoom: false,
      emissionKinds: ['point', 'match'], // SET-1: shift-click adds to the view's own set
    },
    render(state, handshake) {
      const regionField = boundField(state.encodings, 'region', 'region');
      const valueField = options.valueField ?? 'value';
      const data = state.rows.map((r) => ({ region: String(r[regionField]), value: num(r[valueField]) }));
      return (
        <VizMap
          viewId={handshake.viewId}
          geo={options.geo}
          regionField={regionField}
          nameProperty={options.nameProperty}
          data={data}
          valueLabel={options.valueLabel}
          selection={state.selection}
          width={state.size.width}
          height={state.size.height}
          onEmit={handshake.callbacks.emit}
        />
      );
    },
  });
}

// ── histogram ──────────────────────────────────────────────────────────────────

export interface HistogramRendererOptions {
  /** The row field carrying the HOST-computed lower bucket edge. Default `'x0'`. */
  readonly x0Field?: string;
  /** The row field carrying the HOST-computed upper bucket edge. Default `'x1'`. */
  readonly x1Field?: string;
  /** The row field carrying the HOST-computed bucket count. Default `'count'`. */
  readonly countField?: string;
  /** The unit word for tooltips. Default `'rows'`. */
  readonly countLabel?: string;
}

/** A bucket edge from a host row — numbers and ISO strings pass through, anything else is 0. */
function edge(v: unknown): number | string {
  return typeof v === 'number' || typeof v === 'string' ? v : 0;
}

/**
 * Bucket-snapping interval brush on x (a bar click = that bucket's interval;
 * click-again clears) · axis re-encode requests. Rows arrive host-BINNED:
 * one row per bucket carrying its edges and count (`src/data`'s
 * `equalWidthBins`/`recountBins` shape) — the chart never bins or counts
 * (the transform-ownership rule).
 */
export function histogramRenderer(options: HistogramRendererOptions = {}): Renderer {
  return reactRenderer({
    capabilities: {
      canBrush: true,
      canPointSelect: false,
      canHighlight: false,
      canReencode: true,
      canPanZoom: false,
      emissionKinds: ['interval'],
    },
    render(state, handshake) {
      return histogramMark(viewDraw(state, handshake), options);
    },
  });
}

/** One layer (or one view) of host-binned buckets. */
function histogramMark(d: MarkDraw, options: HistogramRendererOptions): JSX.Element {
  const field = boundField(d.encodings, 'x', 'value');
  const x0Field = options.x0Field ?? 'x0';
  const x1Field = options.x1Field ?? 'x1';
  const countField = options.countField ?? 'count';
  const data = d.rows.map((r) => ({ x0: edge(r[x0Field]), x1: edge(r[x1Field]), count: num(r[countField]) }));
  return (
    <VizHistogram
      viewId={d.viewId}
      data={data}
      field={field}
      countLabel={options.countLabel}
      selection={d.selection}
      width={d.width}
      height={d.height}
      domain={d.domain}
      // a bar, a histogram and a box plot take neither side of a two-scale frame (law 2, refused upstream by
      // `stackRefusal`), so `'y'` never arrives here; `=== true` keeps the chart's boolean prop honest without a cast
      axes={d.axes === true}
      onEmit={d.callbacks.emit}
      onReencodeRequest={d.callbacks.reencodeRequest}
    />
  );
}

// ── heatmap ────────────────────────────────────────────────────────────────────

export interface HeatmapRendererOptions {
  /** The row field carrying the HOST-computed lower x edge. Default `'x0'`. */
  readonly x0Field?: string;
  /** The row field carrying the HOST-computed upper x edge. Default `'x1'`. */
  readonly x1Field?: string;
  /** The row field carrying the category row label. Default `'y'`. */
  readonly yRowField?: string;
  /** The row field carrying the HOST-computed cell count. Default `'count'`. */
  readonly countField?: string;
  /** The unit word for tooltips/legend. Default `'rows'`. */
  readonly countLabel?: string;
}

/**
 * The D30 CELL renderer (protocol 1.1): one cell click emits the compound
 * two-field emission — `emissionKinds: ['cell']`, honestly the ONLY kind it
 * produces. Rows arrive host-BINNED 2-D: one row per cell carrying its x
 * edges, category row, and count — the chart never bins or counts (the
 * transform-ownership rule, one dimension up from the histogram). Both axis
 * labels ask the host to re-encode.
 */
export function heatmapRenderer(options: HeatmapRendererOptions = {}): Renderer {
  return reactRenderer({
    capabilities: {
      canBrush: false,
      canPointSelect: false,
      canHighlight: false,
      canReencode: true,
      canPanZoom: false,
      emissionKinds: ['cell'],
    },
    render(state, handshake) {
      const xField = boundField(state.encodings, 'x', 'value');
      const yField = boundField(state.encodings, 'y', 'category');
      const x0Field = options.x0Field ?? 'x0';
      const x1Field = options.x1Field ?? 'x1';
      const yRowField = options.yRowField ?? 'y';
      const countField = options.countField ?? 'count';
      const data = state.rows.map((r) => ({
        x0: edge(r[x0Field]),
        x1: edge(r[x1Field]),
        y: String(r[yRowField]),
        count: num(r[countField]),
      }));
      return (
        <VizHeatmap
          viewId={handshake.viewId}
          data={data}
          xField={xField}
          yField={yField}
          countLabel={options.countLabel}
          selection={state.selection}
          width={state.size.width}
          height={state.size.height}
          onEmit={handshake.callbacks.emit}
          onReencodeRequest={handshake.callbacks.reencodeRequest}
        />
      );
    },
  });
}

// ── box plot ───────────────────────────────────────────────────────────────────

export interface BoxPlotRendererOptions {
  /** The row field carrying the category label. Default `'category'`. */
  readonly categoryField?: string;
  /** The unit word for tooltips. Default `'rows'`. */
  readonly countLabel?: string;
}

/** A summary field from a host row — numbers and ISO strings pass through, anything else is 0. */
function stat(v: unknown): number | string {
  return typeof v === 'number' || typeof v === 'string' ? v : 0;
}

/** A row's outliers array, defensively typed (a malformed host row degrades to none, never a crash). */
function outliersOf(v: unknown): readonly (number | string)[] {
  return Array.isArray(v) ? v.filter((o): o is number | string => typeof o === 'number' || typeof o === 'string') : [];
}

/**
 * Point select on the category (click-again clears) · axis re-encode
 * requests on BOTH channels. Rows arrive host-SUMMARIZED: one row per
 * category carrying its box-plot statistics (`src/data`'s `boxSummary` is
 * the canonical host helper) — the chart never computes a quantile (the
 * transform-ownership rule, one tier up from counting/binning).
 */
export function boxPlotRenderer(options: BoxPlotRendererOptions = {}): Renderer {
  return reactRenderer({
    capabilities: {
      canBrush: false,
      canPointSelect: true,
      canHighlight: false,
      canReencode: true,
      canPanZoom: false,
      emissionKinds: ['point'],
    },
    render(state, handshake) {
      return boxPlotMark(viewDraw(state, handshake), options);
    },
  });
}

/** One layer (or one view) of host-summarized boxes. */
function boxPlotMark(d: MarkDraw, options: BoxPlotRendererOptions): JSX.Element {
  const xField = boundField(d.encodings, 'x', 'category');
  const yField = boundField(d.encodings, 'y', 'value');
  const categoryField = options.categoryField ?? 'category';
  const countLabel = options.countLabel;
  const data = d.rows.map((r) => ({
    category: String(r[categoryField]),
    q1: stat(r['q1']),
    median: stat(r['median']),
    q3: stat(r['q3']),
    whiskerLo: stat(r['whiskerLo']),
    whiskerHi: stat(r['whiskerHi']),
    outliers: outliersOf(r['outliers']),
    count: typeof r['count'] === 'number' ? r['count'] : 0,
  }));
  return (
    <VizBoxPlot
      viewId={d.viewId}
      data={data}
      xField={xField}
      yField={yField}
      countLabel={countLabel}
      selection={d.selection}
      width={d.width}
      height={d.height}
      domain={d.domain}
      // a bar, a histogram and a box plot take neither side of a two-scale frame (law 2, refused upstream by
      // `stackRefusal`), so `'y'` never arrives here; `=== true` keeps the chart's boolean prop honest without a cast
      axes={d.axes === true}
      onEmit={d.callbacks.emit}
      onReencodeRequest={d.callbacks.reencodeRequest}
    />
  );
}

// ── table ──────────────────────────────────────────────────────────────────────

export interface TableRendererOptions {
  /** Which fields to render, in order — the host knows its data shape. */
  readonly columns: readonly string[];
  /** The field a row click selects by. Default `'id'`. */
  readonly idField?: string;
  /** Optional column header overrides (field → display label). */
  readonly labels?: Readonly<Record<string, string>>;
}

/**
 * Point select by row id · dims under the non-self clauses.
 *
 * It also SORTS: a header click reorders the rows in `VizTable`'s own local
 * state. That reordering is deliberately NOT declared as a capability. It
 * used to be (`canRearrange: true`) and the declaration was empty — no
 * outbound verb carried the new order, no guard read the flag, and the sort
 * reached neither the host nor the trace. A user reordering a table and
 * believing the dashboard recorded it is precisely the failure this library
 * exists to prevent, so the claim is gone while the behaviour stays visible
 * and local (the same class as a scroll position: it changes no rows, no
 * selection and no fold). What an honest recorded reorder would need is
 * listed on `RendererCapabilities` in types.ts.
 */
export function tableRenderer(options: TableRendererOptions): Renderer {
  return reactRenderer({
    capabilities: {
      canBrush: false,
      canPointSelect: true,
      canHighlight: true,
      canReencode: false,
      canPanZoom: false,
      emissionKinds: ['point', 'match'], // SET-1: shift-click adds to the view's own set
    },
    render(state, handshake) {
      return (
        <VizTable
          viewId={handshake.viewId}
          data={state.rows as readonly TableRow[]}
          columns={options.columns}
          idField={options.idField}
          labels={options.labels}
          selection={state.selection}
          width={state.size.width}
          height={state.size.height}
          onEmit={handshake.callbacks.emit}
        />
      );
    },
  });
}

// ── network (protocol 1.2 — the first first-party renderer that layers) ────────

/**
 * How many nodes ONE SVG frame draws before this renderer refuses to draw it.
 * A ceiling, not a capability: capabilities are booleans about BEHAVIOUR, and
 * "how many circles one DOM carries" is a size judgement about this medium.
 * The chart underneath knows nothing about it and would happily draw 20,000.
 */
export const NETWORK_NODE_CEILING = 1000;

/**
 * How many LINKS the same frame draws — the other half of the same judgement,
 * and the half that usually bites first: edges grow as n² in a co-occurrence
 * graph, and each one is a `<line>` plus a `<title>` exactly as each node is a
 * `<circle>` plus a `<title>`. Four times the node ceiling: past four links per
 * node at 1000 nodes the picture is ink rather than structure, which is the
 * same size the matrix reading is offered for.
 */
export const NETWORK_EDGE_CEILING = 4000;

export interface NetworkRendererOptions {
  /** The nodes layer's key column, when its layer binds no `key` channel. Default `'id'`. */
  readonly keyField?: string;
}

/** The four endpoint-position channels an EDGE layer binds — `bringOver`'s columns, named by the `network` requirement row. */
const ENDPOINT_CHANNELS = ['sourceX', 'sourceY', 'targetX', 'targetY'] as const;

/** The four endpoint fields, NAMED — no positional tuple, so a reorder of `ENDPOINT_CHANNELS` cannot swap a link's geometry. */
interface EndpointFields {
  readonly sx: string;
  readonly sy: string;
  readonly tx: string;
  readonly ty: string;
}

/**
 * The four endpoint fields this layer binds — or null when it binds fewer,
 * which is how the renderer tells the EDGE layer from the nodes one.
 *
 * WHY the channels and not the chart kind: a `RenderLayer` carries no chartKind —
 * a renderer receives a layer's table, rows and ENCODINGS, and the encodings are
 * where the endpoints were named (src/encoding/requirements.ts, the `network`
 * row's optional channels). A layer binding three of the four cannot be drawn as
 * links, so it draws none — no half-links, no guessing.
 */
function endpointFieldsOf(layer: RenderLayer): EndpointFields | null {
  const [sx, sy, tx, ty] = ENDPOINT_CHANNELS.map((channel) => layer.encodings[channel]);
  if (sx === undefined || sy === undefined || tx === undefined || ty === undefined) return null;
  return { sx, sy, tx, ty };
}

/**
 * Does this layer carry ANY endpoint column? A layer that does is an edge table
 * by construction, and is therefore never the NODES layer — which is the law
 * the partition is written in. Choosing the nodes layer by exclusion instead
 * ("whatever is not the one edge layer") makes a layer binding three of four,
 * or a SECOND edge layer of a multiplex graph, draw its own rows as the node
 * circles and drop the real node table in silence.
 */
function bindsEndpoint(layer: RenderLayer): boolean {
  return ENDPOINT_CHANNELS.some((channel) => layer.encodings[channel] !== undefined);
}

/** The edge layer and the fields it binds, found in ONE pass so the four never have to be recovered with a `!`. */
function edgeLayerOf(layers: readonly RenderLayer[]): { readonly layer: RenderLayer; readonly endpoints: EndpointFields } | null {
  for (const layer of layers) {
    const endpoints = endpointFieldsOf(layer);
    if (endpoints !== null) return { layer, endpoints };
  }
  return null;
}

/** The nodes of one layer's rows, positioned by the columns the layout act wrote. */
function nodesOf(rows: readonly RenderRow[], encodings: RenderEncodings, keyField: string): NetworkNode[] {
  const xField = boundField(encodings, 'x', 'x');
  const yField = boundField(encodings, 'y', 'y');
  const colorField = encodings['color'];
  return rows.map((row) => ({
    id: String(row[keyField]),
    x: num(row[xField]),
    y: num(row[yField]),
    ...(colorField === undefined ? {} : { category: String(row[colorField]) }),
    row,
  }));
}

/**
 * One endpoint cell as a real coordinate, or null. WHY not `num`: `bringOver`
 * writes `null` for an endpoint that names nothing in the related table and
 * COUNTS it, so coercing that to 0 would draw a link from the origin — a hub
 * where no node is — and drag the shared frame's extent to it. The absence
 * stays an absence, the way `barRenderer`'s highlight overlay does.
 */
function coordinateAt(row: RenderRow, field: string): number | null {
  const value = row[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The edges layer's endpoint IDENTITY columns — what each link NAMES, as
 * against the four position columns it is drawn by. One spelling, because two
 * readers ask for them now: the links (whose ends these are) and the walk
 * (whose seed is judged against one of them).
 */
function endpointKeysOf(layer: RenderLayer): readonly [string, string] {
  return [boundField(layer.encodings, 'source', 'source'), boundField(layer.encodings, 'target', 'target')];
}

/**
 * The edges of the endpoint layer's rows — both ends already carried over by
 * `bringOver`, and a row missing either end is an absence rather than a link.
 * Each link keeps its SOURCE row, the way `nodesOf` keeps a node's: it is what
 * the edges layer's own fold judges (protocol 1.8, `VizNetwork.edgeSelection`).
 */
function edgesOf(layer: RenderLayer, endpoints: EndpointFields): NetworkEdge[] {
  const [sourceField, targetField] = endpointKeysOf(layer);
  const edges: NetworkEdge[] = [];
  for (const row of layer.rows) {
    const sx = coordinateAt(row, endpoints.sx);
    const sy = coordinateAt(row, endpoints.sy);
    const tx = coordinateAt(row, endpoints.tx);
    const ty = coordinateAt(row, endpoints.ty);
    if (sx === null || sy === null || tx === null || ty === null) continue;
    edges.push({ source: String(row[sourceField]), target: String(row[targetField]), sx, sy, tx, ty, row });
  }
  return edges;
}

/**
 * THE SUBSTRATE A NODE-LINK IS DRAWN ON — the union of every node position and
 * every edge endpoint, folded by the LIBRARY.
 *
 * WHY `frameDomains` and not an extent here: a union over layers is the frame's
 * fold, and it has one owner (`vizfootprint/def`). This renderer used to hold a
 * second copy of it, which is how an axis and its marks come to disagree.
 *
 * The HOST's fold wins when it pushed one (protocol 1.5) — it read the whole
 * table, not just the rows on screen, so a filter elsewhere leaves the layout
 * where it was. It is taken only when it carries BOTH axes as shared
 * quantitative domains: half a fold from the host and half from here would put
 * one px-per-unit substrate on two different reads. And per axis it is the
 * UNION of every channel that axis is bound on — a node's own `x` and both of
 * the edge layer's endpoint channels — because a host folds per CHANNEL and
 * `x` alone is only where the nodes are.
 */
function substrateOf(nodes: readonly NetworkNode[], edges: readonly NetworkEdge[], layers: readonly RenderLayer[], pushed: Readonly<Record<string, ResolvedChannel>> | undefined): ChartDomain | undefined {
  const fromHost = { x: hostSpan(pushed, SUBSTRATE_CHANNELS.x), y: hostSpan(pushed, SUBSTRATE_CHANNELS.y) };
  if (fromHost.x !== undefined && fromHost.y !== undefined) return { x: fromHost.x, y: fromHost.y };
  const folded = frameDomains([
    { layerId: layers[0]?.layerId ?? 'nodes', chartKind: 'point', channels: { x: { type: 'number', values: nodes.map((n) => n.x) }, y: { type: 'number', values: nodes.map((n) => n.y) } } },
    // both ends of every edge: a link running off the plot is a lie about where its far end is
    { layerId: layers[1]?.layerId ?? 'edges', chartKind: 'line', channels: { x: { type: 'number', values: edges.flatMap((e) => [e.sx, e.tx]) }, y: { type: 'number', values: edges.flatMap((e) => [e.sy, e.ty]) } } },
  ]);
  const x = quantitativeDomain(folded['x']);
  const y = quantitativeDomain(folded['y']);
  return x === undefined || y === undefined ? undefined : { x, y };
}

/** One resolved channel's numbers, when it is a shared quantitative one — otherwise nothing, never a coerced pair. */
function quantitativeDomain(channel: ResolvedChannel | undefined): readonly [number, number] | undefined {
  return channel !== undefined && channel.mode === 'shared' && channel.scale === 'quantitative' ? channel.domain : undefined;
}

/**
 * Which channels each AXIS of the substrate is bound on: the nodes' own
 * position and, off {@link ENDPOINT_CHANNELS} so the names have one owner, both
 * ends of every edge.
 */
const SUBSTRATE_CHANNELS: Readonly<Record<'x' | 'y', readonly string[]>> = {
  x: ['x', ...ENDPOINT_CHANNELS.filter((channel) => channel.endsWith('X'))],
  y: ['y', ...ENDPOINT_CHANNELS.filter((channel) => channel.endsWith('Y'))],
};

/** One axis of the host's fold: the union of the shared quantitative domains it pushed for that axis's channels, or nothing where it pushed none. */
function hostSpan(pushed: Readonly<Record<string, ResolvedChannel>> | undefined, channels: readonly string[]): readonly [number, number] | undefined {
  const domains = channels.map((channel) => quantitativeDomain(pushed?.[channel])).filter((domain): domain is readonly [number, number] => domain !== undefined);
  return domains.length === 0 ? undefined : [Math.min(...domains.map(([lo]) => lo)), Math.max(...domains.map(([, hi]) => hi))];
}

/** The refusal a frame past a ceiling gets — the count, the ceiling, and the reading that survives at this size. */
function ceilingRefusal(count: number, marks: string, ceiling: number): JSX.Element {
  return (
    <p className="vzf-chart-refusal" role="status">
      {`this network has ${count} ${marks}, past the ${ceiling} one SVG frame draws legibly — ` +
        'read it as a matrix instead (a heatmap of source × target), which stays readable where a node-link is a hairball'}
    </p>
  );
}

/** The refusal a frame whose nodes have no identity gets — a node id is the emitted value and the edges' join key, so there is nothing to guess with. */
function keyRefusal(keyField: string, first: RenderRow): JSX.Element {
  return (
    <p className="vzf-chart-refusal" role="status">
      {`this network keys its nodes by "${keyField}", which no row carries — the first row's columns are ${Object.keys(first).join(', ')}. ` +
        'Bind the `key` channel on the nodes layer, or name the column with the renderer’s `keyField` option.'}
    </p>
  );
}

/** The refusal a frame carrying more than the two tables this renderer draws gets — a dropped layer is never silent. */
function layersRefusal(layers: readonly RenderLayer[]): JSX.Element {
  return (
    <p className="vzf-chart-refusal" role="status">
      {`this node-link draws two tables — the nodes and the edges — and this frame carried ${layers.length}: ` +
        `${layers.map((layer) => layer.layerId).join(', ')}. Draw the extra layers on a frame of their own.`}
    </p>
  );
}

/**
 * The node-link: TWO tables on ONE frame (protocol 1.2). It reads
 * `state.layers` — the layer binding the four endpoint positions supplies the
 * edges, the layer carrying NONE of them supplies the nodes — and a node
 * gesture speaks through THAT layer's callback bundle, so the commit lands
 * under `viewId~nodes` and the layer finds its own clause by its own address.
 * A frame carrying no layers is drawn as a nodes-only network over
 * `state.rows`: honest, and exactly what a host that has laid its nodes out
 * but carried no edges over has to show.
 *
 * THE HOST FOLDS PER LAYER (protocol 1.8): each layer carries
 * `RenderLayer.selection`, the fold at its own address —
 * `selectionForView(selections, layerAddress(viewId, layerId), …)`. The nodes
 * layer reads its own (its click clause is self: outlined, never dimmed by,
 * click-again clears) and the edges layer reads ITS own, judged on the edge
 * ROWS beside the two-ends rule — so a declared `highlight` edge from
 * `viewId~nodes` to `viewId~edges` is honoured at the links, which one fold
 * could never do. Sibling layers hold no default edge between them, so with
 * nothing declared the edges' fold carries no clause of the nodes' and the
 * picture is exactly what the one fold drew.
 *
 * WHY THE FALLBACK IS THE NODES' FOLD (a 1.7 host, no `layer.selection`):
 * `RenderState.selection` is read for both layers then, and it must be
 * `selectionForView(selections, layerAddress(viewId, <the nodes layerId>))` —
 * folded for the VIEW instead, the way the other eight are wired, the nodes
 * layer's own clause reads as FOREIGN, so the clicked node loses its outline,
 * its neighbours dim by this chart's own clause, and click-again never clears.
 * The edges are then judged by their two ends alone, as they always were
 * (`netState` in conformance.test.tsx pins both hosts).
 *
 * Point select on a node (click-again clears) · shift-click toggles it in this
 * view's own set (SET-1) · ALT-CLICK asks the WALK (protocol 1.3: the node and
 * everything it links to, landed as one commit under the EDGES address, since
 * the clause reads their endpoint columns) · dims under the non-self clauses.
 * No brush, no pan/zoom and no re-encode affordance: a node-link's x and y are the LAYOUT
 * act's output rather than a quantity anyone reads off an axis, so there is no
 * axis to click and the capabilities say so.
 *
 * THE SVG CEILING lives here and not in the chart: past
 * {@link NETWORK_NODE_CEILING} nodes the frame is refused in a sentence naming
 * the count, the ceiling and the reading that still works at that size.
 */
/**
 * THE FOUR WALKS a reader can pick between, as data — the label, and the
 * question it sets on the chart's walk door.
 *
 * WHY these four and not every combination the session accepts: they are the
 * questions a person asks of a node-link out loud. Two hops is the most an ego
 * walk is offered (the session's own policy), and a path is the one that takes
 * two gestures — the chart says so in its own words as you go.
 */
const WALK_CHOICES: readonly { readonly label: string; readonly question: NetworkWalkQuestion }[] = [
  { label: 'neighbours', question: { derivation: 'ego', hops: 1 } },
  { label: 'two hops', question: { derivation: 'ego', hops: 2 } },
  { label: 'component', question: { derivation: 'component' } },
  { label: 'path', question: { derivation: 'path' } },
];

/**
 * The node-link plus the ONE piece of chrome this wrapper owns: a labelled
 * select for WHICH walk an alt-click asks for (protocol 1.4).
 *
 * WHY here and not in `<VizNetwork>`: the chart draws what it is given and asks
 * what it is told to ask — a control inside it would make it own a choice, and
 * every host embedding it would inherit that choice whether it wanted the
 * chrome or not. WHY not in the host instead: this renderer is the only place a
 * node-link is PLACED in this repo, and a capability nothing reaches is a
 * capability nobody has.
 *
 * The pick is local, unrecorded state — it changes what the NEXT gesture ASKS,
 * and nothing about it lands until somebody alt-clicks (at which point the
 * question rides on the commit, where it can be read back). A frame with no
 * edges layer has no walk door and no walk to choose between, so no picker is
 * drawn.
 */
function NetworkFrame(props: VizNetworkProps): JSX.Element {
  const [pick, setPick] = useState(0);
  const asked = WALK_CHOICES[pick]!; // the select's own option values ARE this array's indices
  return (
    <>
      {props.walk === undefined ? null : (
        <label className="vzf-net-walk">
          {'alt-click asks for '}
          <select
            className="vzf-input"
            aria-label="which walk an alt-click asks for"
            value={pick}
            onChange={(e) => setPick(Number(e.target.value))}
          >
            {WALK_CHOICES.map((choice, i) => (
              <option key={choice.label} value={i}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <VizNetwork {...props} {...(props.walk === undefined ? {} : { walk: { ...props.walk, question: asked.question } })} />
    </>
  );
}

export function networkRenderer(options: NetworkRendererOptions = {}): Renderer {
  return reactRenderer({
    capabilities: {
      canBrush: false,
      canPointSelect: true,
      canHighlight: true,
      canReencode: false,
      canPanZoom: false,
      // SET-1: shift-click adds to the view's own set. Protocol 1.3: alt-click
      // ASKS THE WALK — declared here because this renderer really does speak
      // it through the contract whenever the frame carries an edges layer with
      // a voice of its own (`walk` below); a frame with no links has nothing to
      // walk and the modifier stays silent.
      emissionKinds: ['point', 'match', 'neighbourhood'],
      canLayer: true,
    },
    render(state, handshake) {
      const layers = state.layers ?? [];
      if (layers.length > 2) return layersRefusal(layers);
      const edge = edgeLayerOf(layers);
      // POSITIVELY, not by exclusion: a layer carrying any endpoint column is an edge table
      const nodeLayer = layers.find((layer) => !bindsEndpoint(layer));
      const rows = nodeLayer === undefined ? state.rows : nodeLayer.rows;
      const encodings = nodeLayer === undefined ? state.encodings : nodeLayer.encodings;
      if (rows.length > NETWORK_NODE_CEILING) return ceilingRefusal(rows.length, 'nodes', NETWORK_NODE_CEILING);
      if (edge !== null && edge.layer.rows.length > NETWORK_EDGE_CEILING) return ceilingRefusal(edge.layer.rows.length, 'links', NETWORK_EDGE_CEILING);
      const keyField = boundField(encodings, 'key', options.keyField ?? 'id');
      const first = rows[0];
      // a node id is the value a click emits AND the key the edges point at, so
      // an absent key column is refused rather than minted as "undefined"
      if (first !== undefined && !rows.some((row) => row[keyField] !== undefined)) return keyRefusal(keyField, first);
      // the LAYER speaks whenever it has a bundle: a node click lands under
      // `viewId~<its layer>`. With none — a 1.1 host, or a layerId the bind did
      // not mint — the view speaks and the ADDRESS is lost, not the gesture
      // (renderers.test.tsx: 'a 1.1 host loses the address, not the gesture').
      const voice = (nodeLayer === undefined ? undefined : handshake.layers?.[nodeLayer.layerId]) ?? handshake.callbacks;
      // THE WALK IS THE EDGES' ACT (protocol 1.3): its clause reads their two
      // endpoint columns, so it must land under THEIR address — and unlike a
      // node click there is no honest fallback to the view's own voice, because
      // a clause naming edge columns judged against the nodes table selects
      // nothing and refuses everything after it. No edges layer, or no bundle
      // for it, means no walk to offer — never a walk spoken from the wrong
      // address.
      const edgeVoice = edge === null ? undefined : handshake.layers?.[edge.layer.layerId];
      const walk = edge === null || edgeVoice === undefined ? undefined : { field: endpointKeysOf(edge.layer)[0], emit: edgeVoice.emit };
      const marks = { nodes: nodesOf(rows, encodings, keyField), edges: edge === null ? [] : edgesOf(edge.layer, edge.endpoints) };
      // the substrate both groups are placed by — the library's fold, or the host's when it pushed one
      const domain = substrateOf(marks.nodes, marks.edges, layers, state.frame);
      return (
        <NetworkFrame
          viewId={handshake.viewId}
          nodes={marks.nodes}
          edges={marks.edges}
          keyField={keyField}
          // each layer's own fold (1.8), the frame's where a layer carries none (1.7); the edges' fold
          // is a SECOND prop because the chart judges edge rows by it and node rows by the other
          selection={nodeLayer?.selection ?? state.selection}
          {...(edge?.layer.selection === undefined ? {} : { edgeSelection: edge.layer.selection })}
          width={state.size.width}
          height={state.size.height}
          onEmit={voice.emit}
          {...(domain === undefined ? {} : { domain })}
          {...(walk === undefined ? {} : { walk })}
        />
      );
    },
  });
}

// ── the frame (R6 — the first GENERIC layered renderer) ───────────────────────

/**
 * One layer's MARK, as the host names it. The contract carries rows, never
 * marks (`RenderLayer` has no `chartKind`), because a renderer is free to draw
 * rows however it likes — so a frame renderer, whose whole job is to draw the
 * def's stack, is told here which mark each layer is and which row fields that
 * mark reads. `kind` is the def's `LayerDecl.chartKind`; the field names are
 * the same defaults the single-mark renderers use, in one bag so a spec can be
 * handed straight to whichever mark the kind names.
 */
export interface LayeredLayerSpec {
  /** The def's `chartKind`. A kind no frame can draw (map, network, heatmap, table) is REFUSED in words, never dropped. */
  readonly kind: string;
  /** point: the row field carrying a stable id. Default `'id'`. */
  readonly idField?: string;
  /** bar · histogram: the row field carrying the host-aggregated count. Default `'count'`. */
  readonly countField?: string;
  /** bar: the row field carrying the host-aggregated BRIGHT count (the Layer-4 highlight share). */
  readonly highlightCountField?: string;
  /** histogram: the row fields carrying the host-computed bucket edges. Default `'x0'`/`'x1'`. */
  readonly x0Field?: string;
  readonly x1Field?: string;
  /** boxplot: the row field carrying the category label. Default `'category'`. */
  readonly categoryField?: string;
  /** histogram · boxplot: the unit word for tooltips. Default `'rows'`. */
  readonly countLabel?: string;
  /** The colour of one series/category. Takes `undefined` because a line's series and a point's category can both be absent. */
  readonly colorOf?: (name: string | undefined) => string;
}

export interface LayeredRendererOptions {
  /** Per layerId, its mark. A layer with no entry is REFUSED in words — a frame cannot guess what a table should be drawn as. */
  readonly layers?: Readonly<Record<string, LayeredLayerSpec>>;
  /** The merged x axis's label. Default: the field every layer binding that channel agrees on, or none. */
  readonly xLabel?: string;
  /** The merged y axis's label. Same default. */
  readonly yLabel?: string;
}

/** A channel the host folded a domain for — the only arm of `ResolvedChannel` that carries numbers. */
type SharedChannel = Extract<ResolvedChannel, { readonly mode: 'shared' }>;

/** One layer with the mark its spec names. */
interface FramedLayer {
  readonly layer: RenderLayer;
  readonly kind: FrameChartKind;
  readonly spec: LayeredLayerSpec;
}

/**
 * WHICH CHANNEL each mark's axes are bound on. A bar's x is its `category`
 * channel, not `x` — a bar is declared with `channels: ['category']` and
 * `barMark` reads that binding, so the frame must look for the bar's x
 * resolution under the same name the def wrote. `undefined` = this mark binds
 * no channel on that axis (a bar or a histogram whose y is a host-aggregated
 * COUNT, not a bound column), and then the frame gives it no domain there and
 * it keeps its own ceiling.
 */
const AXIS_CHANNELS: Readonly<Record<FrameChartKind, { readonly x: string; readonly y: string }>> = Object.freeze({
  line: { x: 'x', y: 'y' },
  point: { x: 'x', y: 'y' },
  histogram: { x: 'x', y: 'y' },
  boxplot: { x: 'x', y: 'y' },
  bar: { x: 'category', y: 'y' },
});

/**
 * BAND VERSUS RUN IS A PROPERTY OF THE X COLUMN, NOT OF THE MARK. Two marks
 * decide it by themselves — a bar and a box plot make slots of whatever they
 * are given, and a histogram's bins sit on a number — and the other two (a line,
 * a point) take it from the column they bind to x: categorical means a band,
 * a number or a date means a run. The column's kind is the FOLD's answer
 * (`frameScaleOf` in `src/encoding/frame.ts` is the one owner of "a string or a
 * boolean folds as categorical"; the frame carries it as `ResolvedChannel.scale`),
 * so the classification here never re-derives a type from the rows.
 */
const BAND_MARKS: readonly FrameChartKind[] = ['bar', 'boxplot'];
const RUN_MARKS: readonly FrameChartKind[] = ['histogram'];

/**
 * What this layer binds to x — the column, and the scale the frame folded it as
 * (`undefined` where it folded none: independent, or not shared) — or nothing
 * where the layer binds no x at all. The `layerDomain` law, read the other way
 * round: a scale folded over somebody else's column says nothing about an axis
 * this layer never declared.
 */
function xBinding(f: FramedLayer, frame: Readonly<Record<string, ResolvedChannel>> | undefined): { readonly column: string; readonly scale: SharedChannel['scale'] | undefined } | undefined {
  const channel = AXIS_CHANNELS[f.kind].x;
  const column = f.layer.encodings[channel];
  if (column === undefined) return undefined;
  const resolved = frame?.[channel];
  return { column, scale: resolved !== undefined && resolved.mode === 'shared' ? resolved.scale : undefined };
}

/** Is this layer's x a band? Its mark's answer where the mark has one; the x column's otherwise. */
function bandX(f: FramedLayer, frame: Readonly<Record<string, ResolvedChannel>> | undefined): boolean {
  if (BAND_MARKS.includes(f.kind)) return true;
  if (RUN_MARKS.includes(f.kind)) return false;
  return xBinding(f, frame)?.scale === 'categorical';
}

/** The words for a folded scale's column type, as the fold's `frameScaleOf` reads them back. */
const SCALE_TYPE_WORDS: Readonly<Record<SharedChannel['scale'], string>> = Object.freeze({
  quantitative: 'a number',
  temporal: 'a date',
  categorical: 'a category',
});

/** Why this layer's x is a run, naming the column and its type — or the fact that the frame folded nothing for it. */
function runXWords(f: FramedLayer, frame: Readonly<Record<string, ResolvedChannel>> | undefined): string {
  if (f.kind === 'histogram') return 'its bins sit on a number';
  const x = xBinding(f, frame);
  if (x === undefined) return 'it binds no column to x';
  return x.scale === undefined ? `column "${x.column}" was not folded on this frame` : `column "${x.column}" is ${SCALE_TYPE_WORDS[x.scale]}`;
}

/**
 * WHAT EACH FRAMED MARK REALLY DOES — the same claims its own single-mark
 * renderer makes, so a frame's capabilities are the UNION of the marks it was
 * told to draw and never a claim about one it does not draw. A frame of bars
 * does not brush; a frame with a line in it does.
 *
 * The capability-honesty law of this file, one level up: a capability is a
 * promise about the BOUND renderer. `bar`'s highlight is the one that is also a
 * promise about the SPEC — a bar can only draw the bright SHARE its host
 * aggregated, so it stays false until `highlightCountField` names it, exactly
 * as in `barRenderer`.
 */
const MARK_CAPABILITIES: Readonly<Record<FrameChartKind, { readonly brush: boolean; readonly point: boolean; readonly highlight: boolean; readonly kinds: readonly EmissionKind[] }>> = Object.freeze({
  line: { brush: true, point: false, highlight: false, kinds: ['interval'] },
  point: { brush: true, point: false, highlight: true, kinds: ['interval'] },
  bar: { brush: false, point: true, highlight: false, kinds: ['point', 'match'] },
  histogram: { brush: true, point: false, highlight: false, kinds: ['interval'] },
  boxplot: { brush: false, point: true, highlight: false, kinds: ['point'] },
});

/** The framed marks a host named, with their specs — the only marks the capabilities may speak for. */
function namedMarks(options: LayeredRendererOptions): readonly { readonly kind: FrameChartKind; readonly spec: LayeredLayerSpec }[] {
  const out: { kind: FrameChartKind; spec: LayeredLayerSpec }[] = [];
  for (const spec of Object.values(options.layers ?? {})) if (isFrameChartKind(spec.kind)) out.push({ kind: spec.kind, spec });
  return out;
}

/** A frame's capabilities: the union of the marks it draws, computed at MOUNT off the specs — never asserted. */
function frameCapabilities(options: LayeredRendererOptions): RendererCapabilities {
  const marks = namedMarks(options);
  return {
    canBrush: marks.some((m) => MARK_CAPABILITIES[m.kind].brush),
    canPointSelect: marks.some((m) => MARK_CAPABILITIES[m.kind].point),
    canHighlight: marks.some((m) => (m.kind === 'bar' ? m.spec.highlightCountField !== undefined : MARK_CAPABILITIES[m.kind].highlight)),
    canReencode: false, // the merged guide's labels are TEXT: a click would have to ask WHICH layer to re-encode
    canPanZoom: false,
    // which layer emits which kind is the layer's own business, and the host reads it off the commit's address
    emissionKinds: [...new Set(marks.flatMap((m) => MARK_CAPABILITIES[m.kind].kinds))],
    canLayer: true,
  };
}

/** Every layer with the mark its spec names, or the SENTENCE the first layer that cannot be framed gets. */
function framedLayers(layers: readonly RenderLayer[], options: LayeredRendererOptions): readonly FramedLayer[] | string {
  const framed: FramedLayer[] = [];
  for (const layer of layers) {
    const spec = options.layers?.[layer.layerId];
    if (spec === undefined) {
      return `layer "${layer.layerId}": no mark was named for it — a frame draws what the def declared, so pass its chartKind in this renderer's \`layers\` option.`;
    }
    if (!isFrameChartKind(spec.kind)) {
      return `layer "${layer.layerId}": a ${spec.kind} owns its own frame — a frame draws line, bar, point, histogram and boxplot marks. Draw it on a frame of its own.`;
    }
    framed.push({ layer, kind: spec.kind, spec });
  }
  return framed;
}

/**
 * WHAT A STACK MAY NOT BE, in words. Each of these is a picture that would be
 * DRAWN wrong rather than merely be empty, which is why it is refused instead
 * of attempted — and one sentence, not a list: the frame is refused, so the
 * next reason is the next thing the reader sees once this one is fixed.
 */
function stackRefusal(framed: readonly FramedLayer[], frame: Readonly<Record<string, ResolvedChannel>> | undefined): string | null {
  const bands = framed.filter((f) => bandX(f, frame));
  const runs = framed.filter((f) => !bandX(f, frame));
  // A BAND AND A RUN CANNOT BE ONE X. A bar's slots carry no distance and a line's x
  // over a date or a number does; overlaid, the line's peak would sit over a band it
  // has nothing to do with. Which side a line or a point is on is its x COLUMN's
  // (`bandX`): a line whose x is categorical IS a band — its points sit at the slot
  // centres — so the refusal is only for the run it names, column and type included.
  if (bands.length > 0 && runs.length > 0) {
    const run = runs[0]!;
    return `layer "${run.layer.layerId}" draws its x as a run — ${runXWords(run, frame)} — over layer "${bands[0]!.layer.layerId}"'s bands; a ${run.kind} over bands must bind a category to x, or take a frame of its own.`;
  }
  // A POINT ON A BAND is classified as a band (that is the column's fact), and then refused: `VizScatter`
  // places x on a run of numbers and draws no band in this version, so the picture would be drawn wrong.
  const point = bands.find((f) => f.kind === 'point');
  if (point !== undefined) {
    // a point is among the bands only because `xBinding` found its column folded as categories, so the binding is there
    return `layer "${point.layer.layerId}" is a point on a band — column "${xBinding(point, frame)!.column}" is a category — and a point chart draws no band in this version. Draw it as a line, or give it a frame of its own.`;
  }
  if (bands.length > 1) {
    // TWO BANDS LINE UP ONLY OFF ONE CATEGORY LIST. Without it each lays its slots
    // out from its own rows, and two tables with different values put "Formal"
    // over two different slots — the frame would draw a comparison nobody folded.
    if (bandsOf(sharedAxis(bands, frame, 'x')?.resolved) === undefined) {
      return `layers "${bands[0]!.layer.layerId}" and "${bands[1]!.layer.layerId}" both draw bands, and the frame folded no category list for them — each would order its slots by its own rows. Share their x channel as a categorical one, or give each a frame of its own.`;
    }
    const box = bands.find((f) => f.kind === 'boxplot');
    // A BOX PLOT ORDERS ITS SLOTS BY ITS OWN ROWS in this version (it reads no
    // category list), so it cannot be the layer that lines up with another band.
    if (box !== undefined) {
      return `layer "${box.layer.layerId}" is a box plot on a shared band: a box plot orders its slots by its own rows in this version, so it cannot line up with layer "${bands.find((f) => f !== box)!.layer.layerId}". Give it a frame of its own.`;
    }
  }
  const line = colouredLineRefusal(framed);
  if (line !== null) return line;
  return twoScalesRefusal(framed, frame);
}

/**
 * TWO SCALES ON ONE FRAME ARE TWO CLAIMS, and the frame has two sides to make
 * them on — the laws of the two-axis figure, in words, for a per-layer guide
 * on two or more layers (`frameGuide`, the ONE place that decides merged vs
 * per-layer; a single layer draws its own pair and needs none of this).
 *
 *   law 1 — ONE FRAME HAS ONE X: it is the frame's, drawn once; an x left to
 *     the layers is refused by name (the band/run law already says a frame's x
 *     is one). And TWO SIDES, so at most two own y scales: a third is refused
 *     naming every layer that would draw one — there is no third edge.
 *   law 2 — A BAR, A HISTOGRAM OR A BOX PLOT TAKES NEITHER SIDE: its extent is
 *     read against one baseline. The def door already refuses BOTH shapes that
 *     say so — `independent`, and `shared` drawn `per-layer` beside a second
 *     layer (`validateFrame`, law 9, the SAME reason in both branches) — so a
 *     def built through `buildDashboard` never reaches this refusal (packet W
 *     review, finding 1: it once did, through `shared + per-layer`, before the
 *     door's law 9 grew that second branch). This check stays as the frame's
 *     OWN defense: `RenderState.frame` is a public shape a host may fold BY
 *     HAND, skipping `validateFrame` entirely, and the frame must refuse what
 *     it is handed on its own terms — it does not trust that everything
 *     upstream went through the door.
 *
 * The third law — the frame SAYS the scales are unrelated — is not a refusal
 * but a sentence, {@link twoScalesSentence}, rendered by the frame.
 */
function twoScalesRefusal(framed: readonly FramedLayer[], frame: Readonly<Record<string, ResolvedChannel>> | undefined): string | null {
  if (framed.length < 2 || frameGuide(frame) !== 'per-layer') return null;
  if (!mergedX(framed, frame)) {
    return `x is per-layer on layers ${nameList(framed)} — one frame has one x, drawn once by the frame. Declare guide: 'merged' on x, or draw one layer.`;
  }
  const own = framed.filter((f) => ownY(f, frame));
  if (own.length > 2) {
    return `layers ${nameList(own)} each draw a y of their own — a frame has two sides, left and right, and no third. Draw two of them here, and the rest on a frame of their own.`;
  }
  const unsided = own.find((f) => !SIDED_KINDS.includes(f.kind));
  if (unsided !== undefined) {
    return `layer "${unsided.layer.layerId}" is a ${unsided.kind} with a y of its own — a ${unsided.kind}'s extent is read against one baseline, so it takes neither side of a two-scale frame. Declare guide: 'merged' on y, or draw it on a frame of its own.`;
  }
  return null;
}

/** The marks that can stand a y axis on either edge (`axisSide`): a line and a point — position marks, whose y may be read off any baseline. */
const SIDED_KINDS: readonly FrameChartKind[] = Object.freeze(['line', 'point']);

/** TWO OR MORE layer ids as a sentence lists them: `"a", "b" and "c"` — both refusals that call it name at least two (a stack of two, or a third own y), so there is no one-name arm. */
function nameList(framed: readonly FramedLayer[]): string {
  const ids = framed.map((f) => `"${f.layer.layerId}"`);
  return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]!}`;
}

/** Is the stack's x the FRAME's to draw once — every channel it is bound on folded shared, with a merged guide? */
function mergedX(framed: readonly FramedLayer[], frame: Readonly<Record<string, ResolvedChannel>> | undefined): boolean {
  return axisChannels(framed, 'x').every((channel) => sharedOn(frame, channel)?.guide === 'merged');
}

/**
 * Does this layer draw a y of its OWN — it binds its y channel, and the
 * frame's fold of that channel is not the merged one (independent, shared
 * with a per-layer guide, or never folded at all)? A layer that binds no y
 * has none to draw: on a frame the axes are the frame's, which is the same
 * law that gives a y-unbound bar no merged axis of its own (`layerDomain`).
 */
function ownY(f: FramedLayer, frame: Readonly<Record<string, ResolvedChannel>> | undefined): boolean {
  const channel = AXIS_CHANNELS[f.kind].y;
  if (f.layer.encodings[channel] === undefined) return false;
  return sharedOn(frame, channel)?.guide !== 'merged';
}

/**
 * THE FRAME'S OWN WORDS FOR TWO SCALES (law 3) — the ONE owner of the sentence,
 * exported so a host drawing its own surface over a two-axis frame can quote
 * it. Said only when the two y axes are two SCALES: an independent y, or one
 * the frame never folded. A shared y drawn on both edges is one scale twice,
 * and heights across it ARE comparable — so it says nothing, rather than
 * something false.
 */
export function twoScalesSentence(left: string, right: string): string {
  return `two scales — left is ${left}, right is ${right}; heights are not comparable across them`;
}

/**
 * The sentence a stack earns, or nothing: exactly two own-y layers on two
 * scales — `twoScalesSentence` over their y fields, left then right.
 *
 * TWO FIELDS OF ONE NAME ON TWO TABLES ("left is value, right is value") is
 * true and useless — a reader still cannot tell which edge is which, which is
 * the one thing this sentence exists to fix. Named only where they collide (a
 * shared field name draws the same bare label at both edges too, so naming it
 * everywhere a def happens to pick two well-named fields would say the layer
 * id where nobody needed it) — the layer id beside the field, the same way
 * {@link nameList} already quotes a layer id to tell two "the same" things
 * apart.
 */
function frameWords(framed: readonly FramedLayer[], frame: Readonly<Record<string, ResolvedChannel>> | undefined): string | undefined {
  if (framed.length < 2 || frameGuide(frame) !== 'per-layer') return undefined;
  const own = framed.filter((f) => ownY(f, frame));
  if (own.length !== 2 || sharedOn(frame, 'y') !== undefined) return undefined;
  // both bind their y (that is what `ownY` asked first), so each has a field to name
  const fieldOf = (f: FramedLayer): string => f.layer.encodings[AXIS_CHANNELS[f.kind].y]!;
  const [left, right] = [own[0]!, own[1]!];
  const [leftField, rightField] = [fieldOf(left), fieldOf(right)];
  const collide = leftField === rightField;
  const label = (f: FramedLayer, field: string): string => (collide ? `"${field}" on layer "${f.layer.layerId}"` : field);
  return twoScalesSentence(label(left, leftField), label(right, rightField));
}

/**
 * A LINE SPLIT INTO SERIES lays its legend INSIDE its own box, which moves its
 * plot top off every other layer's — the one thing a chart does to its own
 * margin that the frame cannot see. Refused rather than drawn a few pixels
 * high.
 */
function colouredLineRefusal(framed: readonly FramedLayer[]): string | null {
  for (const f of framed) {
    if (f.kind !== 'line') continue;
    const field = f.layer.encodings['color'];
    if (field === undefined) continue;
    const series = new Set(f.layer.rows.map((row) => String(row[field])));
    if (series.size > 1) {
      return `layer "${f.layer.layerId}" is a line split into ${String(series.size)} series: its legend sits inside its own box and moves its plot top off the frame's. Draw one series per layer, or give it a frame of its own.`;
    }
  }
  return null;
}

/**
 * The CHANNELS a stack's axis is bound on, in declaration order, first-seen: one
 * name when every mark agrees (`x`, or `y`), and TWO on x when a bar — whose x
 * is its `category` channel — stands with a mark whose x is `x`. The def shares
 * CHANNELS, and an axis is where the marks' channels MEET: `AXIS_CHANNELS` is
 * what knows a bar's `category` is its x, so this is the one place that can say
 * two names are one axis.
 */
function axisChannels(framed: readonly FramedLayer[], axis: 'x' | 'y'): readonly string[] {
  return [...new Set(framed.map((f) => AXIS_CHANNELS[f.kind][axis]))];
}

/** The resolution the host folded for a channel, when it was shared. */
function sharedOn(frame: Readonly<Record<string, ResolvedChannel>> | undefined, channel: string): SharedChannel | undefined {
  const resolved = frame?.[channel];
  return resolved !== undefined && resolved.mode === 'shared' ? resolved : undefined;
}

/**
 * THE ONE DOOR to a stack's shared axis: the channels it is bound on and the
 * resolution the host folded for them — or nothing where it was not shared.
 *
 * ONE name: that channel's resolution, as it always was. TWO names (a bar's
 * `category` beside a line's `x`): one band, when BOTH were folded as
 * categories — the two lists become one order the way `fullBandOrder` already
 * folds every layer's own rows in, first name first, the second's categories
 * appended (`bandOrder`), so a bar's "Formal" and the line's "Formal" are one
 * slot. Anything else under two names — one not folded, one a number — is not
 * one axis, and the stack gets the refusal that says so.
 */
function sharedAxis(framed: readonly FramedLayer[], frame: Readonly<Record<string, ResolvedChannel>> | undefined, axis: 'x' | 'y'): { readonly channels: readonly string[]; readonly resolved: SharedChannel } | undefined {
  const channels = axisChannels(framed, axis);
  const resolved = channels.map((channel) => sharedOn(frame, channel));
  const first = resolved[0];
  if (first === undefined) return undefined;
  if (channels.length === 1) return { channels, resolved: first };
  const bands = resolved.map((r) => bandsOf(r));
  if (bands.some((b) => b === undefined)) return undefined; // two names are one axis only as one band
  const domain = bands.slice(1).reduce<readonly string[]>((union, b) => bandOrder(union, b!), bands[0]!);
  return { channels, resolved: { ...first, scale: 'categorical', domain } };
}

/**
 * One shared channel as a SPAN a chart can scale by: its numbers, or a temporal
 * pair converted to the epoch milliseconds every chart positions dates on
 * (`epochOf`, the same function the charts use on their own rows). A category
 * list is not a span, and a date the parser cannot read is no axis at all.
 *
 * (`quantitativeDomain` above answers a different question — whether a channel
 * is a px-per-unit SUBSTRATE, which a date can never be.)
 */
function spanOf(channel: SharedChannel | undefined): readonly [number, number] | undefined {
  if (channel === undefined) return undefined;
  if (channel.scale === 'quantitative') return channel.domain;
  if (channel.scale === 'categorical') return undefined;
  const lo = epochOf(channel.domain[0]);
  const hi = epochOf(channel.domain[1]);
  return lo === null || hi === null ? undefined : [lo, hi];
}

/** One shared channel as a BAND ORDER, when the frame folded it as categories. */
function bandsOf(channel: SharedChannel | undefined): readonly string[] | undefined {
  return channel !== undefined && channel.scale === 'categorical' ? channel.domain : undefined;
}

/**
 * THE FULL BAND ORDER a merged categorical x actually needs: the frame's own
 * fold, then every band layer's OWN categories not already in it, layer by
 * layer in declaration order — `bandOrder` applied progressively over the
 * whole stack, ONCE, before any chart sees a domain.
 *
 * WHY here, rather than leaving each chart's own `bandOrder` call to append
 * what its rows carry: a chart's band WIDTH is `plotWidth / bandCount`, so a
 * layer whose rows reach past the frame's fold would draw MORE bands, at a
 * NARROWER width, than the merged guide has ticks for — and every band, not
 * only the appended one, would drift off the axis it is meant to share (the
 * guide has no rows of its own to widen its ticks by; it only ever reads
 * `domain.categories`). Folding the union once and handing the SAME list to
 * the guide and to every layer turns each chart's own `bandOrder` call into a
 * no-op agreement instead of a second, narrower count.
 */
function fullBandOrder(framed: readonly FramedLayer[], frame: Readonly<Record<string, ResolvedChannel>> | undefined): readonly string[] | undefined {
  const given = bandsOf(sharedAxis(framed, frame, 'x')?.resolved);
  if (given === undefined) return undefined; // nothing merged on x — no union to keep, each layer keeps its own order
  // every layer here is a BAND by construction (`bandX` — a band mark, or a line whose x column is
  // categorical): `stackRefusal`'s band-over-run check already refused any stack that mixed a run
  // in, before this function is ever called. The filter is the same predicate, so it cannot drift.
  return framed
    .filter((f) => bandX(f, frame))
    .reduce<readonly string[]>((union, f) => {
      const field = f.layer.encodings[AXIS_CHANNELS[f.kind].x];
      return field === undefined ? union : bandOrder(union, f.layer.rows.map((r) => String(r[field]))); // "this layer never declared that axis" — the same silence `layerDomain` keeps
    }, given);
}

/**
 * THE FRAME'S OWN SCALES — the numbers its MERGED GUIDE is drawn from, taken
 * off the channels its layers' axes are bound on. The guide is the frame's
 * claim about the whole stack, so it reads the frame's fold; what each LAYER
 * is scaled by is narrower ({@link layerDomain}), and the two come from the
 * same `RenderState.frame` PLUS the same `categories` union ({@link fullBandOrder}),
 * so a tick can never disagree with a mark.
 */
function frameChartDomain(framed: readonly FramedLayer[], frame: Readonly<Record<string, ResolvedChannel>> | undefined, categories: readonly string[] | undefined): ChartDomain {
  const on = (axis: 'x' | 'y'): SharedChannel | undefined => sharedAxis(framed, frame, axis)?.resolved;
  const x = spanOf(on('x'));
  const y = spanOf(on('y'));
  return { ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }), ...(categories === undefined ? {} : { categories }) };
}

/**
 * The frame's scales AS ONE LAYER RECEIVES THEM — and only for the channels
 * THAT layer binds. The frame never puts a number on an axis a layer never
 * declared: a bar that binds no y keeps its own count ceiling, because a value
 * span folded over somebody else's column is not this bar's height. `categories`
 * is the SAME union {@link frameChartDomain} drew its ticks from ({@link fullBandOrder}) —
 * never this layer's own narrower fold — so this layer's band count can never
 * outrun the guide's tick count.
 */
function layerDomain(f: FramedLayer, frame: Readonly<Record<string, ResolvedChannel>> | undefined, categories: readonly string[] | undefined): ChartDomain {
  const channels = AXIS_CHANNELS[f.kind];
  const bound = (channel: string): SharedChannel | undefined => {
    if (f.layer.encodings[channel] === undefined) return undefined; // this layer never declared that axis
    const resolved = frame?.[channel];
    return resolved !== undefined && resolved.mode === 'shared' ? resolved : undefined;
  };
  const x = spanOf(bound(channels.x));
  const y = spanOf(bound(channels.y));
  const boundCategories = bound(channels.x) === undefined ? undefined : categories;
  return { ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }), ...(boundCategories === undefined ? {} : { categories: boundCategories }) };
}

/**
 * ONE GUIDE, OR ONE PER LAYER. Merged only while every channel the frame folded
 * asks for a merged guide: a chart draws BOTH its axes or neither (`axes` is one
 * prop), so a single `guide: 'per-layer'` channel gives every layer its own
 * pair. A frame that folded nothing has nothing merged to draw, and each layer
 * draws its own on its own extents — the honest `independent` picture.
 */
function frameGuide(frame: Readonly<Record<string, ResolvedChannel>> | undefined): 'merged' | 'per-layer' {
  const channels = Object.values(frame ?? {});
  return channels.length > 0 && channels.every((channel) => channel.guide === 'merged') ? 'merged' : 'per-layer';
}

/**
 * One axis of the merged guide, or nothing when that axis was not shared with a
 * MERGED guide — the frame draws only the axes that are its own. A shared y
 * whose guide is per-layer is the layers' to draw (each on its own edge of a
 * two-axis frame), so handing it to the frame too would draw one scale three
 * times.
 */
function frameAxisOf(framed: readonly FramedLayer[], frame: Readonly<Record<string, ResolvedChannel>> | undefined, axis: 'x' | 'y', label: string | undefined): FrameAxis | undefined {
  const shared = sharedAxis(framed, frame, axis);
  if (shared === undefined || shared.resolved.guide !== 'merged') return undefined;
  const named = label ?? channelLabel(framed, shared.channels);
  return { scale: shared.resolved.scale, ...(named === undefined ? {} : { label: named }) };
}

/** The field name a merged axis carries: the one every layer binding any of the axis's channels agrees on — an axis of two fields has no single name. */
function channelLabel(framed: readonly FramedLayer[], channels: readonly string[]): string | undefined {
  const fields = new Set(framed.flatMap((f) => channels.map((channel) => f.layer.encodings[channel])).filter((field): field is string => field !== undefined));
  return fields.size === 1 ? [...fields][0] : undefined;
}

/** Draw one layer with the mark its kind names — the ONE place a framed kind becomes a chart. */
function layerMark(f: FramedLayer, draw: MarkDraw): JSX.Element {
  if (f.kind === 'line') return lineMark(draw, f.spec);
  if (f.kind === 'bar') return barMark(draw, f.spec);
  if (f.kind === 'point') return pointMark(draw, f.spec);
  if (f.kind === 'histogram') return histogramMark(draw, f.spec);
  return boxPlotMark(draw, f.spec); // 'boxplot' — the list is closed by FrameChartKind
}

/** A stack this renderer will not draw, said in words in the space the frame would have filled (the `layersRefusal` grammar). */
function frameRefusal(sentence: string): JSX.Element {
  return (
    <p className="vzf-chart-refusal" role="status">
      {sentence}
    </p>
  );
}

/**
 * THE FRAME: the def's layers, in declaration order, over ONE margin box and
 * ONE pair of scales (protocol 1.5). Each layer is drawn by the mark its spec
 * names, given the frame's domain for the channels IT binds; the guide is the
 * frame's when every folded channel asked for a merged one, and each layer's
 * own otherwise. Paint order is declaration order — the first layer is the
 * bottom one.
 *
 * A gesture on a layer speaks through THAT layer's callback bundle
 * (`handshake.layers[layerId]`), so the commit lands under `viewId~layerId` —
 * the 1.2 law. With no bundle for it the view speaks and the ADDRESS is lost,
 * not the gesture.
 *
 * THE FRAME FOLDS PER LAYER (protocol 1.8): a layer reads the clauses that
 * reached ITS address, folded with ITS clause as self (`RenderLayer.selection`
 * — `selectionForView(selections, layerAddress(viewId, layerId), …)`, the
 * host's fold); the frame's one `RenderState.selection` is the fallback a 1.7
 * host still gets, byte-identical. So on a frame of two point layers a brush on
 * the second is that layer's SELF (never dimmed by it) and the first layer's
 * FOREIGN (dimmed where a link lets it reach) — which one fold could never
 * say, since a self-exclusion fold names one address and the host had to
 * choose whose clause was "self". (A line reads no fold of its own — its shape
 * moves with its rows — so a two-line frame folds per layer and shows no
 * difference on screen; the other four marks read theirs.)
 *
 * A stack it cannot draw is REFUSED IN WORDS (`stackRefusal`) rather than drawn
 * wrong: an unframeable kind, a run over bands (a line whose x column is a date
 * or a number, over a bar — a line whose x is a category IS a band and draws),
 * a point on a band, two bands with no category list, a box plot on a shared
 * band, a line split into series, or — on a per-layer guide over two or more
 * layers — an x left to the layers, a third own y, or a bar/histogram/box plot
 * with a y of its own (`twoScalesRefusal`). Two own y scales on a line or a
 * point are THE TWO-AXIS FIGURE: left and right, x drawn once by the frame, and
 * the frame's own sentence beneath (`twoScalesSentence`).
 */
export function layeredRenderer(options: LayeredRendererOptions = {}): Renderer {
  return reactRenderer({
    capabilities: frameCapabilities(options),
    render(state, handshake) {
      const layers = state.layers ?? [];
      // a frame IS its layers: with none there is no stack, and drawing `state.rows`
      // as some default mark would be this renderer inventing a picture
      if (layers.length === 0) return frameRefusal('this frame carried no layers — a frame is its layers, so there is nothing to draw. Push at least one layer, or bind a single-mark renderer for a plain view.');
      const framed = framedLayers(layers, options);
      if (typeof framed === 'string') return frameRefusal(framed);
      const refusal = stackRefusal(framed, state.frame);
      if (refusal !== null) return frameRefusal(refusal);
      const x = frameAxisOf(framed, state.frame, 'x', options.xLabel);
      const y = frameAxisOf(framed, state.frame, 'y', options.yLabel);
      // the ONE band union every layer AND the merged guide draw off — see `fullBandOrder`
      const categories = fullBandOrder(framed, state.frame);
      // the words for two scales (law 3), or nothing — one owner, `twoScalesSentence`
      const words = frameWords(framed, state.frame);
      return (
        <VizFrame
          layers={framed.map((f) => ({
            layerId: f.layer.layerId,
            kind: f.kind,
            // its own y (an independent or per-layer y it binds) takes an edge on a two-axis frame — the frame picks which
            ownY: ownY(f, state.frame),
            render: (draw) =>
              layerMark(f, {
                viewId: handshake.viewId,
                rows: f.layer.rows,
                encodings: f.layer.encodings,
                // the fold at THIS layer's address (1.8); the frame's one fold where the host pushed none (1.7)
                selection: f.layer.selection ?? state.selection,
                width: draw.width,
                height: draw.height,
                // the LAYER speaks whenever it has a bundle; with none the view speaks and the address is lost, not the gesture
                callbacks: handshake.layers?.[f.layer.layerId] ?? handshake.callbacks,
                // ONLY what THIS layer binds — never the frame's whole fold (`draw.domain`), because
                // an axis a layer never declared is not its axis: a bar that binds no y keeps its own
                // count ceiling rather than taking somebody else's value span as its height
                domain: layerDomain(f, state.frame, categories),
                axes: draw.axes,
                ...(draw.axisSide === undefined ? {} : { axisSide: draw.axisSide }),
              }),
          }))}
          domain={frameChartDomain(framed, state.frame, categories)}
          guide={frameGuide(state.frame)}
          {...(x === undefined ? {} : { x })}
          {...(y === undefined ? {} : { y })}
          {...(words === undefined ? {} : { words })}
          width={state.size.width}
          height={state.size.height}
          ariaLabel={`${String(framed.length)} layers on one frame`}
        />
      );
    },
  });
}
