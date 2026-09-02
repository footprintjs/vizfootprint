/**
 * `<VizScatter>` — a responsive SVG scatter (x × y, coloured by category) with a
 * horizontal BRUSH. It is a CONTROLLED component and a REFERENCE IMPLEMENTATION
 * of the renderer contract (RP-1): dimming comes from the clause-addressable
 * `selection` — the chart folds every OTHER view's clause over each datum's
 * source `row` (dim under everyone's brush but my own; the self clause is
 * excluded by `keepPredicate`), never from a host-computed flat keep-predicate.
 * The regression overlay comes from `regression`. On brush it emits the R3
 * shape `{ rawValue, encoding }` in DATA space (never pixels) — the chart
 * NEVER builds a clause. Each axis label is an interactive affordance: with
 * `onReencodeRequest` it ASKS THE HOST (the contract's `reencodeRequest`
 * verb — the host owns the picker); otherwise it opens the built-in
 * {@link EncodingPicker} (the React convenience layer).
 *
 * Composed from the PUBLIC primitives (`../primitives`): scales +
 * `useHorizontalBrush`/`BrushOverlay` (the gesture machinery + completion
 * discipline) + `useBrightPredicate`/`dimClass` (self-excluded dim-not-hide) +
 * `AxisLabel`/`useReencodePicker` (the re-encode seam) — the same pieces a
 * consumer-built chart gets.
 */
import type { ChartEmission } from '../../../src/mosaic/index.js';
import type { ColumnView, ViewEncoding } from '../adapter/types.js';
import type { RenderRow, RenderSelection } from '../contract/types.js';
import { linearScale, extent, ticks } from '../primitives/scales.js';
import { AxisLabel } from '../primitives/AxisLabel.js';
import { useHorizontalBrush, BrushOverlay } from '../primitives/brush.js';
import { useBrightPredicate, dimClass } from '../primitives/useSelection.js';
import { useReencodePicker } from '../primitives/reencode.js';
import { EncodingPicker } from './EncodingPicker.js';

export interface ScatterDatum {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly category?: string;
  /**
   * The SOURCE row this datum was derived from — the clause predicates in
   * `selection` evaluate against it (they name DATA fields; the datum's
   * x/y are already renamed). A datum without a row is never dimmed
   * (honest: no evidence, no dimming).
   */
  readonly row?: RenderRow;
}

export interface RegressionGeom {
  readonly slope: number;
  readonly intercept: number;
  readonly domain: readonly [number, number];
}

export interface VizScatterProps {
  readonly viewId?: string;
  readonly data: readonly ScatterDatum[];
  /** DATA fields the axes encode (also the brush emit field). */
  readonly xField?: string;
  readonly yField?: string;
  readonly xLabel?: string;
  readonly yLabel?: string;
  readonly colorOf?: (category: string | undefined) => string;
  /**
   * The clause-addressable crossfilter selection (RP-1) — REPLACES the old
   * flat `highlight` keep-predicate. Points whose source `row` fails the
   * non-self clauses are dimmed; the chart's OWN clause never dims it.
   * Build it with `selectionForView(state.selections, viewId)`.
   */
  readonly selection?: RenderSelection;
  readonly regression?: RegressionGeom | null;
  /** Columns offered by the encoding picker (from adapter state). */
  readonly columns?: readonly ColumnView[];
  /** Current channel→field map for the picker's highlight. */
  readonly encoding?: ViewEncoding;
  readonly onEmit?: (emission: ChartEmission) => void;
  readonly onReencode?: (viewId: string, channel: string, field: string) => void;
  /**
   * Contract mode (the `reencodeRequest` verb): when set, an axis-label click
   * asks the HOST to re-encode this channel instead of opening the built-in
   * picker — the host owns the picker and the verb.
   */
  readonly onReencodeRequest?: (channel: string) => void;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

const PAD = { l: 52, r: 18, t: 18, b: 44 };

export function VizScatter(props: VizScatterProps): JSX.Element {
  const {
    viewId = 'scatter',
    data,
    xField = 'x',
    yField = 'y',
    xLabel = xField,
    yLabel = yField,
    colorOf,
    selection,
    regression,
    columns = [],
    encoding = {},
    onEmit,
    onReencode,
    onReencodeRequest,
    width = 520,
    height = 340,
  } = props;

  // the self-excluded crossfilter fold — recomputed only when the selection changes
  const keep = useBrightPredicate(selection);

  const [xlo, xhi] = extent(data, (d) => d.x, 5);
  const x = linearScale(xlo, xhi, PAD.l, width - PAD.r);
  const [ylo, yhi] = extent(data, (d) => d.y, 0.5);
  const y = linearScale(ylo, yhi, height - PAD.b, PAD.t);

  // drag→interval on x — the brush primitive's completion discipline (a sub-4px
  // release emits the CLEARED interval); snap = this chart's own scale invert
  const { svgRef, brush, handlers } = useHorizontalBrush({
    plotLeft: PAD.l,
    plotRight: width - PAD.r,
    width,
    field: xField,
    snap: (loPx, hiPx) => [Math.round(x.invert(loPx) * 100) / 100, Math.round(x.invert(hiPx) * 100) / 100],
    onEmit,
  });

  const { pickerChannel, openPicker, closePicker } = useReencodePicker(onReencodeRequest);

  const xTicks = ticks(xlo + 5, xhi - 5, 4);
  const yTickVals = ticks(Math.ceil(ylo + 0.5), Math.floor(yhi - 0.5), 4);

  return (
    <>
      <svg
        ref={svgRef}
        className={`vzf-chart vzf-scatter${props.className ? ' ' + props.className : ''}`}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`scatter of ${yLabel} against ${xLabel}`}
        {...handlers}
      >
        {/* axes frame */}
        <line className="vzf-axis" x1={PAD.l} y1={height - PAD.b} x2={width - PAD.r} y2={height - PAD.b} />
        <line className="vzf-axis" x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={height - PAD.b} />
        {/* x ticks */}
        {xTicks.map((v, i) => (
          <g key={`xt${i}`}>
            <line className="vzf-axis" x1={x(v)} y1={height - PAD.b} x2={x(v)} y2={height - PAD.b + 4} />
            <text className="vzf-tick" x={x(v)} y={height - PAD.b + 16} textAnchor="middle">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {/* y ticks */}
        {yTickVals.map((v, i) => (
          <g key={`yt${i}`}>
            <line className="vzf-axis" x1={PAD.l - 4} y1={y(v)} x2={PAD.l} y2={y(v)} />
            <text className="vzf-tick" x={PAD.l - 8} y={y(v) + 3} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {/* regression overlay */}
        {regression && (
          <line
            className="vzf-regline"
            x1={x(regression.domain[0])}
            y1={y(regression.slope * regression.domain[0] + regression.intercept)}
            x2={x(regression.domain[1])}
            y2={y(regression.slope * regression.domain[1] + regression.intercept)}
          />
        )}
        {/* points */}
        {data.map((d) => {
          const kept = keep && d.row ? keep(d.row) : true;
          return (
            <circle
              key={d.id}
              className={`vzf-dot${dimClass(kept)}`}
              cx={x(d.x)}
              cy={y(d.y)}
              r={4}
              fill={colorOf ? colorOf(d.category) : 'var(--vzf-brand)'}
            >
              <title>{`${d.id}${d.category ? ' · ' + d.category : ''} · ${xLabel} ${d.x} · ${yLabel} ${d.y}`}</title>
            </circle>
          );
        })}
        {/* brush */}
        <BrushOverlay brush={brush} y={PAD.t} height={height - PAD.t - PAD.b} />
        {/* interactive axis labels */}
        <AxisLabel x={(PAD.l + width - PAD.r) / 2} y={height - 8} text={xLabel} channel="x" onOpen={openPicker} />
        <AxisLabel x={14} y={height / 2} text={yLabel} channel="y" anchor="middle" rotate={-90} onOpen={openPicker} />
      </svg>
      <EncodingPicker
        open={pickerChannel !== null}
        viewId={viewId}
        channel={pickerChannel ?? 'x'}
        columns={columns}
        currentField={pickerChannel ? encoding[pickerChannel] ?? (pickerChannel === 'x' ? xField : yField) : undefined}
        onReencode={(v, c, f) => onReencode?.(v, c, f)}
        onClose={closePicker}
      />
    </>
  );
}
