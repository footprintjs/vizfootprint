/**
 * `<VizBar>` — a responsive SVG bar chart (count by category), click-to-select.
 * Controlled: bar heights come from `data` (host-aggregated counts — the
 * transform-ownership rule: this chart never bins or counts), the outline
 * from `selected`, OR — RP-1 — from the clause-addressable `selection`'s own
 * point clause when `selected` is omitted. A click emits the R3 POINT shape
 * `{ rawValue: category, encoding: { kind:'point' } }` — the chart never
 * builds a clause. The category axis label is an interactive affordance:
 * `onReencodeRequest` asks the HOST (contract mode); otherwise it opens the
 * built-in {@link EncodingPicker} for the categorical channel.
 */
import type { ChartEmission } from '../../../src/mosaic/index.js';
import type { ColumnView, ViewEncoding } from '../adapter/types.js';
import type { RenderSelection } from '../contract/types.js';
import { fitTick, fitsBand } from './tickFit.js';
import { AxisLabel } from '../primitives/AxisLabel.js';
import { pointEmission, keyActivates } from '../primitives/pointSelect.js';
import { selectedValue } from '../primitives/useSelection.js';
import { useReencodePicker } from '../primitives/reencode.js';
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
  /** The selected category (controlled). Omit it and the outline derives from `selection`'s own point clause. */
  readonly selected?: string | null;
  /** The clause-addressable crossfilter selection (RP-1) — feeds the `selected` derivation. */
  readonly selection?: RenderSelection;
  readonly columns?: readonly ColumnView[];
  readonly encoding?: ViewEncoding;
  readonly onEmit?: (emission: ChartEmission) => void;
  readonly onReencode?: (viewId: string, channel: string, field: string) => void;
  /** Contract mode (`reencodeRequest`): an axis click asks the HOST instead of opening the built-in picker. */
  readonly onReencodeRequest?: (channel: string) => void;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

const PAD = { l: 38, r: 14, t: 20, b: 48 };
/** Extra bottom room when any tick has to slant (the plot gives it up). */
const SLANT_PAD = 40;
/** Bottom pixels kept for the axis label, beneath the ticks. */
const AXIS_LABEL_ROOM = 24;
/** The plot height a slant may never take the chart below. */
const MIN_PLOT = 40;

export function VizBar(props: VizBarProps): JSX.Element {
  const {
    viewId = 'bar',
    data,
    field = 'category',
    label = field,
    colorOf,
    selection,
    columns = [],
    encoding = {},
    onEmit,
    onReencode,
    onReencodeRequest,
    width = 360,
    height = 340,
  } = props;
  // explicit `selected` wins; otherwise the outline derives from the fold's own point clause
  const selected = selectedValue(props.selected, selection);
  const { pickerChannel, openPicker, closePicker } = useReencodePicker(onReencodeRequest);

  const max = Math.max(1, ...data.map((d) => d.count));
  const band = (width - PAD.l - PAD.r) / Math.max(1, data.length);
  // ticks: flat when they fit their band; slanted (and the plot shorter) when any does not
  // (a short chart cannot give the slant its full room — the plot keeps MIN_PLOT and the ticks clip harder)
  const slanted = data.some((d) => fitTick(d.category, band, 0).rotate);
  const padB = slanted ? Math.min(PAD.b + SLANT_PAD, Math.max(PAD.b, height - PAD.t - MIN_PLOT)) : PAD.b;
  const tickRoom = Math.max(0, padB - 12 - AXIS_LABEL_ROOM);
  const plot = Math.max(0, height - PAD.t - padB);
  const axisY = height - padB;

  const emit = (category: string): void => {
    onEmit?.(pointEmission(field, category));
  };

  return (
    <>
      <svg
        className={`vzf-chart vzf-bar${props.className ? ' ' + props.className : ''}`}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`count by ${label}`}
      >
        <line className="vzf-axis" x1={PAD.l} y1={axisY} x2={width - PAD.r} y2={axisY} />
        {data.map((d, i) => {
          const cx = PAD.l + band * i;
          const h = (d.count / max) * plot;
          const barY = axisY - h;
          const isSel = selected === d.category;
          const tick = fitTick(d.category, band, tickRoom);
          const tx = cx + band / 2;
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
                onKeyDown={keyActivates(() => emit(d.category))}
              >
                <title>{`click to select ${d.category}`}</title>
              </rect>
              {fitsBand(String(d.count), band) ? (
                <text className="vzf-barval" x={tx} y={barY - 5} textAnchor="middle">
                  {d.count}
                </text>
              ) : null}
              {tick.rotate ? (
                <text className="vzf-tick" x={tx} y={axisY + 12} textAnchor="end" transform={`rotate(-40 ${String(tx)} ${String(axisY + 12)})`}>
                  {tick.clipped ? <title>{d.category}</title> : null}
                  {tick.text}
                </text>
              ) : (
                <text className="vzf-tick" x={tx} y={axisY + 16} textAnchor="middle">
                  {d.category}
                </text>
              )}
            </g>
          );
        })}
        <AxisLabel x={width / 2} y={height - 8} text={label} channel="category" onOpen={openPicker} />
      </svg>
      <EncodingPicker
        open={pickerChannel !== null}
        viewId={viewId}
        channel={pickerChannel ?? 'category'}
        columns={columns}
        currentField={pickerChannel ? encoding[pickerChannel] ?? field : undefined}
        onReencode={(v, c, f) => onReencode?.(v, c, f)}
        onClose={closePicker}
      />
    </>
  );
}
