/**
 * The FIRST-PARTY REFERENCE IMPLEMENTATIONS of the renderer contract (RP-1):
 * each of the seven charts (scatter · line · bar · map · table · histogram ·
 * heatmap), wrapped as a framework-agnostic {@link Renderer} via one generic
 * React bridge (`reactRenderer`). They are proof, not assertion — all seven
 * pass the conformance kit (`conformance.test.tsx`) end to end, the heatmap
 * including the D29 cell arm.
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
 *     charts' built-in EncodingPicker never opens in contract mode); none of
 *     the five implements hover or pan/zoom, and their capabilities say so
 *     (canPanZoom: false — a host-driven navigate lands a typed gap).
 *   - RenderState.theme (a `--vzf-*` token map) lands as CSS variables on the
 *     `.vzf` wrapper, so a themed host stays themed inside the mount.
 *   - `encodings` picks the fields: x/y (scatter, line), color (series),
 *     category (bar), region (map). Missing entries fall back to each chart's
 *     own documented defaults.
 */

import type { CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  RENDERER_PROTOCOL_VERSION,
  type HostHandshake,
  type Renderer,
  type RendererCapabilities,
  type RenderState,
} from './types.js';
import { VizScatter } from '../charts/VizScatter.js';
import { VizLine } from '../charts/VizLine.js';
import { VizBar } from '../charts/VizBar.js';
import { VizMap, type GeoFeatureCollection } from '../charts/VizMap.js';
import { VizTable, type TableRow } from '../charts/VizTable.js';
import { VizHistogram } from '../charts/VizHistogram.js';
import { VizHeatmap } from '../charts/VizHeatmap.js';

/** The bridge spec: declared capabilities + a pure state→element function. */
export interface ReactRendererSpec {
  readonly capabilities: RendererCapabilities;
  render(state: RenderState, handshake: HostHandshake): JSX.Element;
}

/**
 * Wrap a React element function as a contract {@link Renderer}. Any React
 * chart can join the protocol through this one bridge; the five first-party
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
      const x = state.encodings['x'] ?? 'x';
      const y = state.encodings['y'] ?? 'y';
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
      const dateField = state.encodings['x'] ?? 'date';
      const valueField = state.encodings['y'] ?? 'value';
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
  readonly colorOf?: (category: string) => string;
}

/**
 * Point select on the category · axis re-encode requests. Rows arrive
 * host-AGGREGATED: one row per category, its count on `countField` — the
 * chart never counts (the transform-ownership rule).
 */
export function barRenderer(options: BarRendererOptions = {}): Renderer {
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
      const field = state.encodings['category'] ?? 'category';
      const countField = options.countField ?? 'count';
      const data = state.rows.map((r) => ({ category: String(r[field]), count: num(r[countField]) }));
      return (
        <VizBar
          viewId={handshake.viewId}
          data={data}
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
      emissionKinds: ['point'],
    },
    render(state, handshake) {
      const regionField = state.encodings['region'] ?? 'region';
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
      const field = state.encodings['x'] ?? 'value';
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
 * The D29 CELL renderer (protocol 1.1): one cell click emits the compound
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
      const xField = state.encodings['x'] ?? 'value';
      const yField = state.encodings['y'] ?? 'category';
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

// ── table ──────────────────────────────────────────────────────────────────────

export interface TableRendererOptions {
  /** Which fields to render, in order — the host knows its data shape. */
  readonly columns: readonly string[];
  /** The field a row click selects by. Default `'id'`. */
  readonly idField?: string;
  /** Optional column header overrides (field → display label). */
  readonly labels?: Readonly<Record<string, string>>;
}

/** Point select by row id · dims under the non-self clauses · sortable (canRearrange). */
export function tableRenderer(options: TableRendererOptions): Renderer {
  return reactRenderer({
    capabilities: {
      canBrush: false,
      canPointSelect: true,
      canHighlight: true,
      canReencode: false,
      canPanZoom: false,
      canRearrange: true,
      emissionKinds: ['point'],
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
