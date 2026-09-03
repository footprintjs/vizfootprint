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
import type { ChartEmission } from 'vizfootprint/mosaic';
import type { ColumnView, ViewEncoding, FitView } from '../adapter/types.js';
import type { RenderSelection } from '../contract/types.js';
import { useRef } from 'react';
import { TICK_ANGLE, VALUE_CHAR_PX, fitTick, fitsBand } from './tickFit.js';
import { AxisLabel } from '../primitives/AxisLabel.js';
import { clickEmission, matchEmission, toggleInSetEmission } from '../primitives/pointSelect.js';
import { inSet, markClass, selectedSet } from '../primitives/useSelection.js';
import { useReencodePicker } from '../primitives/reencode.js';
import { boundField } from './binding.js';
import { EncodingPicker } from './EncodingPicker.js';

export interface BarDatum {
  readonly category: string;
  readonly count: number;
}

export interface VizBarProps {
  /** The chart's accessible name — the prose plane's `altShort` lands here; absent = the chart names itself from its bindings. */
  readonly ariaLabel?: string;
  readonly viewId?: string;
  readonly data: readonly BarDatum[];
  /**
   * Layer 4 `highlight`: the SAME categories counted over the rows a highlight
   * edge keeps bright — drawn as a narrower inner bar over each base bar, so a
   * highlight reads as "this much of it" instead of dropping rows. Host-computed,
   * like `data`. Absent = no overlay.
   */
  readonly highlight?: readonly BarDatum[];
  /** The DATA field the category axis encodes (also the emit field) — a default, overridden by `encoding.category`. */
  readonly field?: string;
  /** Words for the axis label. Given, they win over the binding — the caller chose them. */
  readonly label?: string;
  readonly colorOf?: (category: string) => string;
  /** The selected category (controlled). Omit it and the outline derives from `selection`'s own point clause. */
  readonly selected?: string | null;
  /** The clause-addressable crossfilter selection (RP-1) — feeds the `selected` derivation. */
  readonly selection?: RenderSelection;
  readonly columns?: readonly ColumnView[];
  /** The encoding plane's verdicts per channel (`views[].fits` on the wire) — the built-in picker greys with the session's own sentences. */
  readonly fits?: Readonly<Record<string, readonly FitView[]>>;
  /**
   * The session's live channel→field map at the cursor. A channel it names
   * WINS over the field prop — see {@link boundField}: one binding, named on
   * the axis and emitted on a gesture alike.
   */
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
    highlight,
    colorOf,
    selection,
    columns = [],
    fits,
    encoding = {},
    onEmit,
    onReencode,
    onReencodeRequest,
    width = 360,
    height = 340,
  } = props;
  // ONE binding for the category channel — the session's when it named one,
  // this chart's own `field` otherwise; everything below names only this.
  const field = boundField(encoding, 'category', props.field ?? 'category');
  const label = props.label ?? field;
  // explicit `selected` wins; otherwise the outline derives from the fold's own point OR match clause (SET-1)
  const set = selectedSet(props.selected, selection);
  const { pickerChannel, openPicker, closePicker } = useReencodePicker(onReencodeRequest);
  // SET-1 drag-run: pointer down on one bar, release over another selects the RUN between them (a
  // match). The run is tracked by CATEGORY (a poll may reorder the data mid-drag) and the pointer by
  // its x over the whole plot (a bar's own height is not the hit target; touch works through capture).
  const run = useRef<{ start: string; end: string } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const max = Math.max(1, ...data.map((d) => d.count));
  const band = Math.max(0, (width - PAD.l - PAD.r) / Math.max(1, data.length)); // a pushed-narrow cell never draws a negative width
  // ticks: flat when they fit their band; slanted (and the plot shorter) when any does not
  // (a short chart cannot give the slant its full room — the plot keeps MIN_PLOT and the ticks clip harder)
  const slanted = data.some((d) => fitTick(d.category, band, 0).rotate);
  const padB = slanted ? Math.min(PAD.b + SLANT_PAD, Math.max(PAD.b, height - PAD.t - MIN_PLOT)) : PAD.b;
  const tickRoom = Math.max(0, padB - 12 - AXIS_LABEL_ROOM);
  const plot = Math.max(0, height - PAD.t - padB);
  const axisY = height - padB;
  // value labels are all-or-nothing: omitting only the wide ones would keep the small numbers and drop the large
  const showValues = data.every((d) => fitsBand(String(d.count), band, VALUE_CHAR_PX));

  // plain click: read against the view's own set (a member of an exclude-set leaves it; the single
  // kept value clears; anything else selects a point); shift/⌘/ctrl-click: toggle in the SET — SET-1
  const emit = (category: string, additive: boolean): void => {
    onEmit?.(additive ? toggleInSetEmission(field, category, set) : clickEmission(field, category, set));
  };
  /** The band index under a pointer event, from its x over the svg (viewBox units; identity when unmeasured); -1 for an event without a position. */
  const bandAt = (e: { clientX: number }): number => {
    const box = svgRef.current?.getBoundingClientRect();
    const sx = box !== undefined && box.width > 0 ? (e.clientX - box.left) * (width / box.width) : e.clientX;
    if (!Number.isFinite(sx)) return -1;
    return Math.min(data.length - 1, Math.max(0, Math.floor((sx - PAD.l) / band)));
  };
  const beginRun = (category: string): void => {
    run.current = { start: category, end: category };
  };
  const moveRun = (e: { clientX: number; pointerId: number }): void => {
    if (run.current === null || data.length === 0) return;
    const idx = bandAt(e);
    if (idx < 0) return; // a pointer event with no position says nothing about where the pointer is
    const end = data[idx]!.category;
    if (end === run.current.end) return;
    // the pointer has left the pressed bar: this is a DRAG now, so capture it — a plain click never
    // captures (capturing on pointerdown would retarget the click away from the bar in real browsers)
    const svg = svgRef.current as (SVGSVGElement & { setPointerCapture?: (id: number) => void; hasPointerCapture?: (id: number) => boolean }) | null;
    if (svg?.setPointerCapture !== undefined && svg.hasPointerCapture?.(e.pointerId) !== true) svg.setPointerCapture(e.pointerId);
    run.current.end = end;
  };
  const endRun = (): void => {
    const r = run.current;
    run.current = null;
    if (r === null || r.start === r.end) return; // a press-and-release on one bar is the click handler's business
    const a = data.findIndex((d) => d.category === r.start);
    const b = data.findIndex((d) => d.category === r.end);
    if (a < 0 || b < 0) return; // the data changed under the drag — nothing honest to select
    const [lo, hi] = a < b ? [a, b] : [b, a];
    onEmit?.(matchEmission(field, data.slice(lo, hi + 1).map((d) => d.category), set.exclude));
  };
  const cancelRun = (): void => {
    run.current = null;
  };

  return (
    <>
      <svg
        className={`vzf-chart vzf-bar${props.className ? ' ' + props.className : ''}`}
        viewBox={`0 0 ${width} ${height}`}
        ref={svgRef}
        role="group"
        aria-label={props.ariaLabel ?? `count by ${label}`}
        onPointerMove={moveRun}
        onPointerUp={endRun}
        onPointerCancel={cancelRun}
        onPointerLeave={cancelRun}
      >
        <line className="vzf-axis" x1={PAD.l} y1={axisY} x2={width - PAD.r} y2={axisY} />
        {data.map((d, i) => {
          const cx = PAD.l + band * i;
          const h = (d.count / max) * plot;
          const barY = axisY - h;
          const isSel = inSet(d.category, set);
          const tx = cx + band / 2;
          const tick = fitTick(d.category, band, tickRoom, tx);
          return (
            <g key={d.category}>
              {highlight !== undefined && (() => {
                const hl = highlight.find((h) => h.category === d.category)?.count ?? 0;
                const hh = (Math.min(hl, d.count) / max) * plot;
                return <rect className="vzf-barhl" x={cx + band * 0.3} y={axisY - hh} width={Math.max(0, band * 0.4)} height={hh} rx={2} aria-hidden="true" />;
              })()}
              <rect
                className={`vzf-barrect${markClass(d.category, set)}`}
                x={cx + band * 0.12}
                y={barY}
                width={band * 0.76}
                height={h}
                rx={3}
                fill={colorOf ? colorOf(d.category) : 'var(--vzf-brand)'}
                role="button"
                tabIndex={0}
                aria-pressed={isSel && !set.exclude}
                aria-label={`select ${d.category} (${d.count})${isSel && set.exclude ? ' — excluded' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={(e) => emit(d.category, e.shiftKey || e.metaKey || e.ctrlKey)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  emit(d.category, e.shiftKey || e.metaKey || e.ctrlKey);
                }}
                onPointerDown={() => beginRun(d.category)}
              >
                <title>{`click to select ${d.category}`}</title>
              </rect>
              {showValues ? (
                <text className="vzf-barval" x={tx} y={barY - 5} textAnchor="middle">
                  {d.count}
                </text>
              ) : null}
              {tick.rotate ? (
                <text className="vzf-tick" x={tx} y={axisY + 12} textAnchor="end" transform={`rotate(-${String(TICK_ANGLE)} ${String(tx)} ${String(axisY + 12)})`}>
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
        fits={fits}
        currentField={pickerChannel === null ? undefined : boundField(encoding, pickerChannel, field)}
        onReencode={(v, c, f) => onReencode?.(v, c, f)}
        onClose={closePicker}
      />
    </>
  );
}
