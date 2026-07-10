/**
 * `<VizScatter>` — a responsive SVG scatter (x × y, coloured by category) with a
 * horizontal BRUSH. It is a CONTROLLED component: dimming comes from `highlight`
 * (the parent computes crossfilter self-exclusion), the regression overlay from
 * `regression`. On brush it emits the R3 shape `{ rawValue, encoding }` in DATA
 * space (never pixels) — the chart NEVER builds a clause. Each axis label is an
 * interactive affordance that opens the {@link EncodingPicker}.
 */
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ChartEmission } from '../../../src/mosaic/index.js';
import type { ColumnView, ViewEncoding } from '../adapter/types.js';
import { linearScale, extent, ticks } from './scales.js';
import { AxisLabel } from './AxisLabel.js';
import { EncodingPicker } from './EncodingPicker.js';

export interface ScatterDatum {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly category?: string;
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
  /** Keep predicate — points failing it are dimmed. */
  readonly highlight?: (d: ScatterDatum) => boolean;
  readonly regression?: RegressionGeom | null;
  /** Columns offered by the encoding picker (from adapter state). */
  readonly columns?: readonly ColumnView[];
  /** Current channel→field map for the picker's highlight. */
  readonly encoding?: ViewEncoding;
  readonly onEmit?: (emission: ChartEmission) => void;
  readonly onReencode?: (viewId: string, channel: string, field: string) => void;
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
    highlight,
    regression,
    columns = [],
    encoding = {},
    onEmit,
    onReencode,
    width = 520,
    height = 340,
  } = props;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ x0: number } | null>(null);
  const [brush, setBrush] = useState<{ x: number; w: number } | null>(null);
  const [pickerChannel, setPickerChannel] = useState<string | null>(null);

  const [xlo, xhi] = extent(data, (d) => d.x, 5);
  const x = linearScale(xlo, xhi, PAD.l, width - PAD.r);
  const [ylo, yhi] = extent(data, (d) => d.y, 0.5);
  const y = linearScale(ylo, yhi, height - PAD.b, PAD.t);

  const clampX = (px: number): number => Math.max(PAD.l, Math.min(width - PAD.r, px));
  const pxFromEvent = (ev: ReactPointerEvent): number => {
    const svg = svgRef.current;
    if (!svg) return PAD.l;
    const rect = svg.getBoundingClientRect();
    const scale = width / (rect.width || width);
    return clampX((ev.clientX - rect.left) * scale);
  };
  const toInterval = (a: number, b: number): [number, number] => {
    const lo = x.invert(Math.min(a, b));
    const hi = x.invert(Math.max(a, b));
    return [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100];
  };

  const onPointerDown = (ev: ReactPointerEvent<SVGSVGElement>): void => {
    const px = pxFromEvent(ev);
    dragRef.current = { x0: px };
    svgRef.current?.setPointerCapture?.(ev.pointerId);
    setBrush({ x: px, w: 0 });
  };
  const onPointerMove = (ev: ReactPointerEvent<SVGSVGElement>): void => {
    if (!dragRef.current) return;
    const px = pxFromEvent(ev);
    setBrush({ x: Math.min(dragRef.current.x0, px), w: Math.abs(px - dragRef.current.x0) });
  };
  const onPointerUp = (ev: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const px = pxFromEvent(ev);
    const emission: ChartEmission =
      Math.abs(px - drag.x0) < 4
        ? { rawValue: null, encoding: { kind: 'interval', field: xField } }
        : { rawValue: toInterval(drag.x0, px), encoding: { kind: 'interval', field: xField } };
    if (emission.rawValue === null) setBrush(null);
    onEmit?.(emission);
  };

  const openPicker = (channel: string): void => setPickerChannel(channel);

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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
          const kept = highlight ? highlight(d) : true;
          return (
            <circle
              key={d.id}
              className={`vzf-dot${kept ? '' : ' vzf-dim'}`}
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
        {brush && brush.w > 0 && (
          <rect className="vzf-brush" x={brush.x} y={PAD.t} width={brush.w} height={height - PAD.t - PAD.b} rx={2} />
        )}
        {/* interactive axis labels */}
        <AxisLabel x={(PAD.l + width - PAD.r) / 2} y={height - 8} text={xLabel} channel="x" onOpen={openPicker} />
        <AxisLabel x={16} y={height / 2} text={yLabel} channel="y" anchor="middle" onOpen={openPicker} />
      </svg>
      <EncodingPicker
        open={pickerChannel !== null}
        viewId={viewId}
        channel={pickerChannel ?? 'x'}
        columns={columns}
        currentField={pickerChannel ? encoding[pickerChannel] ?? (pickerChannel === 'x' ? xField : yField) : undefined}
        onReencode={(v, c, f) => onReencode?.(v, c, f)}
        onClose={() => setPickerChannel(null)}
      />
    </>
  );
}
