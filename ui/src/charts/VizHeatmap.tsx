/**
 * `<VizHeatmap>` — a 2-D binned heatmap over HOST-COMPUTED cells, composed
 * entirely from the public primitives tier (the VizHistogram proof-chart
 * discipline): scales + date handling + the shared `rampStep` sequential
 * ramp, `AxisLabel` / `useReencodePicker` / `defaultCompat` (the re-encode
 * seam), `keyActivates`, and the contract's `selfSelectedCell`.
 *
 * TRANSFORM OWNERSHIP: the chart receives READY cells (`{ x0, x1, y, count }`
 * — x edges numeric or ISO-date, `y` a category value) and NEVER bins or
 * counts. The canonical host wiring: `equalWidthBins` over ALL rows fixes the
 * x edges, then one `recountBins` per category over the crossfiltered rows —
 * the edges must stay stable while this chart's own selection is live, or the
 * gesture would move its own target (the VizHistogram rule, one dimension up).
 *
 * v1 SCOPE (numeric/date × category, deliberate): the WIRE beneath already
 * carries any side mix — a cell side is an interval or a point value
 * (src/data `CellSide`), so a future numeric×numeric heatmap needs ZERO wire
 * change; the restriction is pure chart geometry. Category rows are the
 * dashboard's dominant ask (they crossfilter the bar chart's own vocabulary),
 * and category labels double as honest row headers — a second bucketed axis
 * would also need its own edge-stability story, so it waits for a real need.
 *
 * GESTURE (D30 — the compound cell): click a cell → ONE cell emission
 * `{ rawValue: [[x0, x1], y], encoding: { kind: 'cell', fields: [xField,
 * yField] } }` — one gesture, ONE commit ("price 100–150 AND category
 * Formal"); clicking the SELECTED cell again emits the CLEARED cell
 * (`rawValue: null`), releasing BOTH constraints — derived honestly from the
 * fold's own clause (`selfSelectedCell`), never local state. Cells are
 * keyboard-focusable; Enter/Space selects.
 *
 * COLOR: the shared quantized five-step sequential ramp (`--vzf-seq-1..5`,
 * the map's magnitude scale — `rampStep` is single-sourced in primitives).
 * Zero-count cells wear the honest neutral (`--vzf-map-empty` + dashed edge,
 * the map precedent) — never step 1, which means "low", not "none".
 *
 * Both axis labels re-encode: x restricted to numeric/date columns
 * (`defaultCompat`), y to category/numeric columns (its own compat — a
 * boolean/unknown column has no honest row vocabulary).
 */
import type { ChartEmission } from 'vizfootprint/mosaic';
import type { ColumnView, ViewEncoding, FitView } from '../adapter/types.js';
import type { RenderSelection } from '../contract/types.js';
import { selfSelectedCell } from '../contract/selection.js';
import { linearScale, epochOf, dayOf, rampStep, SEQ_RAMP_STEPS } from '../primitives/scales.js';
import { AxisLabel } from '../primitives/AxisLabel.js';
import { keyActivates } from '../primitives/pointSelect.js';
import { useReencodePicker } from '../primitives/reencode.js';
import { boundField } from './binding.js';
import { defaultCompat, type Compatibility } from '../primitives/compat.js';
import { EncodingPicker } from './EncodingPicker.js';

/** One HOST-computed cell: x bucket edges (numeric or ISO-date), the category row, its count. */
export interface HeatmapCellDatum {
  /** Inclusive lower x edge. */
  readonly x0: number | string;
  /** Upper x edge (host counting is right-open except the last bucket). */
  readonly x1: number | string;
  /** The category row this cell belongs to. */
  readonly y: string;
  readonly count: number;
}

export interface VizHeatmapProps {
  /** The chart's accessible name — the prose plane's `altShort` lands here; absent = the chart names itself from its bindings. */
  readonly ariaLabel?: string;
  readonly viewId?: string;
  /** READY cells, host-computed (the chart never bins or counts). */
  readonly data: readonly HeatmapCellDatum[];
  /** The bucketed x field (the cell emission's first side). */
  readonly xField?: string;
  /** The category y field (the cell emission's second side). */
  readonly yField?: string;
  /** The unit word for tooltips/legend (default `'rows'`). */
  readonly countLabel?: string;
  /** The clause-addressable crossfilter selection (RP-1) — the selected-cell outline + click-again-clear derive from it. */
  readonly selection?: RenderSelection;
  /** Columns offered by the encoding pickers (from adapter state). */
  readonly columns?: readonly ColumnView[];
  /** The encoding plane's verdicts per channel (`views[].fits` on the wire) — the built-in picker greys with the session's own sentences. */
  readonly fits?: Readonly<Record<string, readonly FitView[]>>;
  /**
   * The session's live channel→field map at the cursor. A channel it names
   * WINS over the field props below — see {@link boundField}: one binding,
   * named on the axis and emitted on a gesture alike.
   */
  readonly encoding?: ViewEncoding;
  readonly onEmit?: (emission: ChartEmission) => void;
  readonly onReencode?: (viewId: string, channel: string, field: string) => void;
  /** Contract mode (RP-1 `reencodeRequest`): an axis click asks the HOST instead of opening the built-in picker. */
  readonly onReencodeRequest?: (channel: string) => void;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

const PAD = { r: 16, t: 16, b: 64 };

/**
 * The row-label gutter ADAPTS to the measured cell: a roomy cockpit cell
 * shows full category names; a squeezed one (the 8-cell flow band) keeps the
 * plot usable by tightening the gutter and TRUNCATING the labels — honestly,
 * since every cell's tooltip and aria-label still carry the full name.
 */
function labelGutter(width: number): { padL: number; maxChars: number } {
  return width >= 300 ? { padL: 74, maxChars: 12 } : { padL: 40, maxChars: 4 };
}

/** A row label fitted to the gutter — full when it fits, `…`-truncated when not. */
function fitLabel(label: string, maxChars: number): string {
  return label.length > maxChars ? `${label.slice(0, maxChars)}…` : label;
}

/** An x edge's position on the linear axis — numbers as-is, ISO dates by epoch. */
function edgePos(edge: number | string): number | null {
  return typeof edge === 'number' ? edge : epochOf(edge);
}

/** An x edge's short label — numbers to ≤2 decimals, dates to their day. */
function edgeLabel(edge: number | string): string {
  return typeof edge === 'number' ? String(Math.round(edge * 100) / 100) : dayOf(edge);
}

/**
 * A bucket's edge pair, typed for the cell rail's homogeneous interval side.
 * Both edges come from ONE host `equalWidthBins` call, which never mixes
 * domains — a pathological mixed pair degrades to the string domain (where
 * the evaluator's no-coercion rule simply matches nothing), never a crash.
 */
function edgePair(x0: number | string, x1: number | string): [number, number] | [string, string] {
  if (typeof x0 === 'number' && typeof x1 === 'number') return [x0, x1];
  return [String(x0), String(x1)];
}

/** One positionable x column (a bucket): its edges + axis positions. */
interface ColumnGeom {
  readonly x0: number | string;
  readonly x1: number | string;
  readonly p0: number;
  readonly p1: number;
}

/**
 * The y-channel compat: category rows want a string column; a numeric column
 * is honest too (its values become discrete rows). boolean/unknown/date have
 * no honest row vocabulary here (a date belongs on the bucketed x axis).
 */
function yCompat(channel: string, column: ColumnView): Compatibility {
  if (column.type === 'string' || column.type === 'number') return { ok: true };
  return { ok: false, reason: `${channel} needs a category (string) or numeric column — "${column.field}" is ${column.type}` };
}

export function VizHeatmap(props: VizHeatmapProps): JSX.Element {
  const {
    viewId = 'heatmap',
    data,
    countLabel = 'rows',
    selection,
    columns = [],
    fits,
    encoding = {},
    onEmit,
    onReencode,
    onReencodeRequest,
    width = 420,
    height = 340,
  } = props;
  // ONE binding per channel — the session's when it named one, this chart's own
  // field prop otherwise; both axis labels, the accessible names and the CELL
  // emission's field pair all use these.
  const xField = boundField(encoding, 'x', props.xField ?? 'value');
  const yField = boundField(encoding, 'y', props.yField ?? 'category');

  // x columns in first-appearance order (host edge order), skipping any whose
  // edge cannot be placed (unparseable date — never guessed); y rows likewise.
  const cols: ColumnGeom[] = [];
  const seenCols = new Set<string>();
  const rows: string[] = [];
  const seenRows = new Set<string>();
  for (const c of data) {
    const key = `${c.x0}`;
    if (!seenCols.has(key)) {
      const p0 = edgePos(c.x0);
      const p1 = edgePos(c.x1);
      if (p0 !== null && p1 !== null) {
        cols.push({ x0: c.x0, x1: c.x1, p0, p1 });
      }
      seenCols.add(key); // an unplaceable bucket is skipped once, not retried per row
    }
    if (!seenRows.has(c.y)) {
      rows.push(c.y);
      seenRows.add(c.y);
    }
  }

  const d0 = cols.length > 0 ? cols[0]!.p0 : 0;
  const d1 = cols.length > 0 ? cols[cols.length - 1]!.p1 : 1;
  const { padL, maxChars } = labelGutter(width);
  const x = linearScale(d0, d1, padL, width - PAD.r);
  const plotBottom = height - PAD.b;
  const plotH = plotBottom - PAD.t;
  const rowH = rows.length > 0 ? plotH / rows.length : plotH;
  const rowY = (label: string): number => PAD.t + rows.indexOf(label) * rowH;

  const counts = new Map(data.map((c) => [`${c.x0}|${c.y}`, c.count]));
  const max = Math.max(0, ...data.map((c) => c.count));

  // the view's OWN live cell, from the addressable fold — outline + toggle
  const own = selection ? selfSelectedCell(selection) : null;
  const isSelected = (c: ColumnGeom, y: string): boolean =>
    own !== null && JSON.stringify(own.values) === JSON.stringify([[c.x0, c.x1], y]);

  const emitCell = (c: ColumnGeom, y: string): void => {
    if (isSelected(c, y)) {
      // clicking the selected cell again CLEARS the whole cell — both constraints release
      onEmit?.({ rawValue: null, encoding: { kind: 'cell', fields: [xField, yField] } });
      return;
    }
    onEmit?.({ rawValue: [edgePair(c.x0, c.x1), y], encoding: { kind: 'cell', fields: [xField, yField] } });
  };

  const { pickerChannel, openPicker, closePicker } = useReencodePicker(onReencodeRequest);

  // x edge ticks, thinned by available pixels (the VizHistogram discipline);
  // the last edge always shows, a colliding stepped label drops instead.
  const edges: { pos: number; label: string }[] = [];
  if (cols.length > 0) {
    const labelW = typeof cols[0]!.x0 === 'string' ? 68 : 44;
    const fit = Math.max(2, Math.floor((width - padL - PAD.r) / labelW));
    const step = Math.max(1, Math.ceil((cols.length + 1) / fit));
    const last = cols[cols.length - 1]!;
    for (let i = 0; i < cols.length; i += step) {
      if (Math.abs(x(cols[i]!.p0) - x(last.p1)) < labelW) continue;
      edges.push({ pos: cols[i]!.p0, label: edgeLabel(cols[i]!.x0) });
    }
    edges.push({ pos: last.p1, label: edgeLabel(last.x1) });
  }

  const legendW = 18;
  const legendX = (i: number): number => padL + i * (legendW + 2);

  return (
    <>
      <svg
        className={`vzf-chart vzf-heatmap${props.className ? ' ' + props.className : ''}`}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={props.ariaLabel ?? `${countLabel} by ${xField} and ${yField}`}
      >
        {/* cells: color = count on the shared ramp; 0 = the honest neutral */}
        {rows.map((yLabel) =>
          cols.map((c) => {
            const count = counts.get(`${c.x0}|${yLabel}`) ?? 0;
            const hasData = count > 0 && max > 0;
            const sel = isSelected(c, yLabel);
            const px0 = x(c.p0);
            const px1 = x(c.p1);
            const range = `${edgeLabel(c.x0)}–${edgeLabel(c.x1)}`;
            return (
              <rect
                key={`${c.x0}|${yLabel}`}
                className={`vzf-heatcell${hasData ? '' : ' vzf-heatcell-empty'}${sel ? ' vzf-selected' : ''}`}
                x={px0 + 1}
                y={rowY(yLabel) + 1}
                width={Math.max(1, px1 - px0 - 2)}
                height={Math.max(1, rowH - 2)}
                rx={2}
                fill={hasData ? `var(--vzf-seq-${rampStep(count, max)})` : 'var(--vzf-map-empty)'}
                role="button"
                tabIndex={0}
                aria-pressed={sel}
                aria-label={
                  hasData
                    ? `${xField} ${range} and ${yField} ${yLabel} · ${count} ${countLabel}`
                    : `${xField} ${range} and ${yField} ${yLabel} · no ${countLabel}`
                }
                data-cell={`${c.x0}|${yLabel}`}
                onClick={() => emitCell(c, yLabel)}
                onKeyDown={keyActivates(() => emitCell(c, yLabel))}
              >
                <title>
                  {hasData
                    ? `${range} × ${yLabel} · ${count} ${countLabel} · click to ${sel ? 'clear' : 'select'}`
                    : `${range} × ${yLabel} · no ${countLabel} under the current selection`}
                </title>
              </rect>
            );
          }),
        )}
        {/* y category labels (row headers) */}
        {rows.map((yLabel) => (
          <text key={yLabel} className="vzf-tick vzf-heat-row" x={padL - 6} y={rowY(yLabel) + rowH / 2 + 3} textAnchor="end">
            {fitLabel(yLabel, maxChars)}
          </text>
        ))}
        {/* x baseline + edge ticks — the emitted intervals name exactly these edges */}
        <line className="vzf-axis" x1={padL} y1={plotBottom} x2={width - PAD.r} y2={plotBottom} />
        {edges.map((e, i) => (
          <g key={`e${i}`}>
            <line className="vzf-axis" x1={x(e.pos)} y1={plotBottom} x2={x(e.pos)} y2={plotBottom + 4} />
            <text className="vzf-tick" x={x(e.pos)} y={plotBottom + 16} textAnchor="middle">
              {e.label}
            </text>
          </g>
        ))}
        {/* legend: the shared five-step ramp; honest absence line when empty (the map precedent) */}
        <g className="vzf-heat-legend" aria-hidden="true">
          {Array.from({ length: SEQ_RAMP_STEPS }, (_, i) => (
            <rect key={i} className="vzf-map-swatch" x={legendX(i)} y={height - 30} width={legendW} height={8} rx={2} fill={`var(--vzf-seq-${i + 1})`} />
          ))}
          {max > 0 ? (
            <text className="vzf-map-minmax" x={legendX(SEQ_RAMP_STEPS) + 4} y={height - 22}>
              0 – {max} {countLabel}
            </text>
          ) : (
            <text className="vzf-map-note" x={legendX(0)} y={height - 22}>
              no {countLabel} under the current selection
            </text>
          )}
        </g>
        {/* the two interactive axis labels — both re-encode affordances */}
        <AxisLabel x={(padL + width - PAD.r) / 2} y={height - 8} text={xField} channel="x" onOpen={openPicker} />
        <AxisLabel x={14} y={(PAD.t + plotBottom) / 2} text={yField} channel="y" rotate={-90} onOpen={openPicker} />
        <desc>{`view ${viewId}: click a cell to select ${xField} and ${yField} together; click it again to clear`}</desc>
      </svg>
      <EncodingPicker
        open={pickerChannel !== null}
        viewId={viewId}
        channel={pickerChannel ?? 'x'}
        columns={columns}
        fits={fits}
        currentField={pickerChannel === 'y' ? yField : xField}
        compatible={(channel, column) => (channel === 'y' ? yCompat(channel, column) : defaultCompat(channel, column))}
        onReencode={(v, c, f) => onReencode?.(v, c, f)}
        onClose={closePicker}
      />
    </>
  );
}
