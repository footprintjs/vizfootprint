/**
 * The FIRST-PARTY REFERENCE IMPLEMENTATIONS of the renderer contract (RP-1):
 * each of the nine charts (scatter · line · bar · map · table · histogram ·
 * heatmap · box plot · network), wrapped as a framework-agnostic
 * {@link Renderer} via one generic React bridge (`reactRenderer`). They are
 * proof, not assertion — the first eight pass the conformance kit
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
 *     acknowledgement on purpose.
 *   - The four callbacks wire straight through: a brush/click → `emit`; an
 *     axis-label click → `reencodeRequest` (the HOST owns the picker — the
 *     charts' built-in EncodingPicker never opens in contract mode). None of
 *     the nine pans or zooms, and each says so where it counts
 *     (`canPanZoom: false` — a host-driven navigate lands a typed gap
 *     instead of silently recording nothing). None of them speaks `hover`
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
  type RenderRow,
  type RenderState,
} from './types.js';
import { boundField } from '../charts/binding.js';
import { VizScatter } from '../charts/VizScatter.js';
import { VizLine } from '../charts/VizLine.js';
import { VizBar } from '../charts/VizBar.js';
import { VizMap, type GeoFeatureCollection } from '../charts/VizMap.js';
import { VizTable, type TableRow } from '../charts/VizTable.js';
import { VizHistogram } from '../charts/VizHistogram.js';
import { VizHeatmap } from '../charts/VizHeatmap.js';
import { VizBoxPlot } from '../charts/VizBoxPlot.js';
import { VizNetwork, type NetworkEdge, type NetworkNode } from '../charts/VizNetwork.js';

/** The bridge spec: declared capabilities + a pure state→element function. */
export interface ReactRendererSpec {
  readonly capabilities: RendererCapabilities;
  render(state: RenderState, handshake: HostHandshake): JSX.Element;
}

/**
 * Wrap a React element function as a contract {@link Renderer}. Any React
 * chart can join the protocol through this one bridge; the nine first-party
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
      const x = boundField(state.encodings, 'x', 'x');
      const y = boundField(state.encodings, 'y', 'y');
      const color = state.encodings['color'];
      const idField = options.idField ?? 'id';
      const data = state.rows.map((r, i) => ({
        id: String(r[idField] ?? i),
        x: num(r[x]),
        y: num(r[y]),
        category: color !== undefined ? String(r[color]) : undefined,
        row: r,
      }));
      return (
        <VizScatter
          viewId={handshake.viewId}
          data={data}
          xField={x}
          yField={y}
          selection={state.selection}
          colorOf={options.colorOf}
          width={state.size.width}
          height={state.size.height}
          onEmit={handshake.callbacks.emit}
          onReencodeRequest={handshake.callbacks.reencodeRequest}
        />
      );
    },
  });
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
      const dateField = boundField(state.encodings, 'x', 'date');
      const valueField = boundField(state.encodings, 'y', 'value');
      const seriesField = state.encodings['color'];
      const data = state.rows.map((r) => ({
        date: String(r[dateField]),
        value: num(r[valueField]),
        series: seriesField !== undefined ? String(r[seriesField]) : undefined,
      }));
      return (
        <VizLine
          viewId={handshake.viewId}
          data={data}
          dateField={dateField}
          valueField={valueField}
          colorOf={options.colorOf}
          width={state.size.width}
          height={state.size.height}
          onEmit={handshake.callbacks.emit}
          onReencodeRequest={handshake.callbacks.reencodeRequest}
        />
      );
    },
  });
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
      const field = boundField(state.encodings, 'category', 'category');
      const countField = options.countField ?? 'count';
      const data = state.rows.map((r) => ({ category: String(r[field]), count: num(r[countField]) }));
      // The overlay rides only while the host is actually sending the share.
      // A frame whose rows carry no such number means no highlight edge is
      // live, and an overlay of zeros would draw a claim of its own ("none of
      // this bar is bright") over every bar — so the absence stays an absence.
      const highlight =
        highlightField === undefined || !state.rows.some((r) => typeof r[highlightField] === 'number')
          ? undefined
          : state.rows.map((r) => ({ category: String(r[field]), count: num(r[highlightField]) }));
      return (
        <VizBar
          viewId={handshake.viewId}
          data={data}
          highlight={highlight}
          field={field}
          selection={state.selection}
          colorOf={options.colorOf}
          width={state.size.width}
          height={state.size.height}
          onEmit={handshake.callbacks.emit}
          onReencodeRequest={handshake.callbacks.reencodeRequest}
        />
      );
    },
  });
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
      const field = boundField(state.encodings, 'x', 'value');
      const x0Field = options.x0Field ?? 'x0';
      const x1Field = options.x1Field ?? 'x1';
      const countField = options.countField ?? 'count';
      const data = state.rows.map((r) => ({ x0: edge(r[x0Field]), x1: edge(r[x1Field]), count: num(r[countField]) }));
      return (
        <VizHistogram
          viewId={handshake.viewId}
          data={data}
          field={field}
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
      const xField = boundField(state.encodings, 'x', 'category');
      const yField = boundField(state.encodings, 'y', 'value');
      const categoryField = options.categoryField ?? 'category';
      const countLabel = options.countLabel;
      const data = state.rows.map((r) => ({
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
          viewId={handshake.viewId}
          data={data}
          xField={xField}
          yField={yField}
          countLabel={countLabel}
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

/** The edges of the endpoint layer's rows — both ends already carried over by `bringOver`, and a row missing either end is an absence rather than a link. */
function edgesOf(layer: RenderLayer, endpoints: EndpointFields): NetworkEdge[] {
  const [sourceField, targetField] = endpointKeysOf(layer);
  const edges: NetworkEdge[] = [];
  for (const row of layer.rows) {
    const sx = coordinateAt(row, endpoints.sx);
    const sy = coordinateAt(row, endpoints.sy);
    const tx = coordinateAt(row, endpoints.tx);
    const ty = coordinateAt(row, endpoints.ty);
    if (sx === null || sy === null || tx === null || ty === null) continue;
    edges.push({ source: String(row[sourceField]), target: String(row[targetField]), sx, sy, tx, ty });
  }
  return edges;
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
 * WHY THE HOST MUST FOLD FOR THE LAYER: pass `RenderState.selection` as
 * `selectionForView(selections, layerAddress(viewId, <the nodes layerId>))`.
 * Folded for the VIEW instead — the way the other eight are wired — the nodes
 * layer's own clause reads as FOREIGN, so the clicked node loses its outline,
 * its neighbours dim by this chart's own clause, and click-again never clears
 * (`netState` in conformance.test.tsx pins the right fold).
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
      return (
        <VizNetwork
          viewId={handshake.viewId}
          nodes={nodesOf(rows, encodings, keyField)}
          edges={edge === null ? [] : edgesOf(edge.layer, edge.endpoints)}
          keyField={keyField}
          selection={state.selection}
          width={state.size.width}
          height={state.size.height}
          onEmit={voice.emit}
          {...(walk === undefined ? {} : { walk })}
        />
      );
    },
  });
}
