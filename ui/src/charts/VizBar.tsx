/**
 * `<VizBar>` — a responsive SVG bar chart (count by category), click-to-select.
 * Controlled: bar heights come from `data`, the outline from `selected`. A click
 * emits the R3 POINT shape `{ rawValue: category, encoding: { kind:'point' } }` —
 * the chart never builds a clause. The category axis label is an interactive
 * affordance that opens the {@link EncodingPicker} for the categorical channel.
 */
import { useState } from 'react';
import type { ChartEmission } from '../../../src/mosaic/index.js';
import type { ColumnView, ViewEncoding } from '../adapter/types.js';
import { AxisLabel } from './AxisLabel.js';
import { EncodingPicker } from './EncodingPicker.js';

export interface BarDatum {
  readonly category: string;
  readonly count: number;
}

export interface VizBarProps {
  readonly viewId?: string;
  readonly data: readonly BarDatum[];
  readonly field?: string;
  readonly label?: string;
  readonly colorOf?: (category: string) => string;
  readonly selected?: string | null;
  readonly columns?: readonly ColumnView[];
  readonly encoding?: ViewEncoding;
  readonly onEmit?: (emission: ChartEmission) => void;
  readonly onReencode?: (viewId: string, channel: string, field: string) => void;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

const PAD = { l: 38, r: 14, t: 20, b: 48 };

export function VizBar(props: VizBarProps): JSX.Element {
  const {
    viewId = 'bar',
    data,
    field = 'category',
    label = field,
    colorOf,
    selected,
    columns = [],
    encoding = {},
    onEmit,
    onReencode,
    width = 360,
    height = 340,
  } = props;
  const [pickerChannel, setPickerChannel] = useState<string | null>(null);

  const max = Math.max(1, ...data.map((d) => d.count));
  const plot = height - PAD.t - PAD.b;
  const band = (width - PAD.l - PAD.r) / Math.max(1, data.length);

  const emit = (category: string): void => {
    const emission: ChartEmission = { rawValue: category, encoding: { kind: 'point', field } };
    onEmit?.(emission);
  };

  return (
    <>
      <svg
        className={`vzf-chart vzf-bar${props.className ? ' ' + props.className : ''}`}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`count by ${label}`}
      >
        <line className="vzf-axis" x1={PAD.l} y1={height - PAD.b} x2={width - PAD.r} y2={height - PAD.b} />
        {data.map((d, i) => {
          const cx = PAD.l + band * i;
          const h = (d.count / max) * plot;
          const barY = height - PAD.b - h;
          const isSel = selected === d.category;
          return (
            <g key={d.category}>
              <rect
                className={`vzf-barrect${isSel ? ' vzf-selected' : ''}`}
                x={cx + band * 0.12}
                y={barY}
                width={band * 0.76}
                height={h}
                rx={3}
                fill={colorOf ? colorOf(d.category) : 'var(--vzf-brand)'}
                role="button"
                tabIndex={0}
                aria-pressed={isSel}
                aria-label={`select ${d.category} (${d.count})`}
                style={{ cursor: 'pointer' }}
                onClick={() => emit(d.category)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    emit(d.category);
                  }
                }}
              >
                <title>{`click to select ${d.category}`}</title>
              </rect>
              <text className="vzf-barval" x={cx + band / 2} y={barY - 5} textAnchor="middle">
                {d.count}
              </text>
              <text className="vzf-tick" x={cx + band / 2} y={height - PAD.b + 16} textAnchor="middle">
                {d.category}
              </text>
            </g>
          );
        })}
        <AxisLabel x={width / 2} y={height - 8} text={label} channel="category" onOpen={setPickerChannel} />
      </svg>
      <EncodingPicker
        open={pickerChannel !== null}
        viewId={viewId}
        channel={pickerChannel ?? 'category'}
        columns={columns}
        currentField={pickerChannel ? encoding[pickerChannel] ?? field : undefined}
        onReencode={(v, c, f) => onReencode?.(v, c, f)}
        onClose={() => setPickerChannel(null)}
      />
    </>
  );
}
