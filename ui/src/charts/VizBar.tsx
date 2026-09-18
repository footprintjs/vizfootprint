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
 *
 * A MARK A READER IS MEANT TO PRESS MUST BE REACHABLE. The drawn bar is a poor
 * target — 185 categories in a 940px pane make it ~5px wide, and a bar of 2 in
 * a chart of 200 is ~3px tall — so each bar carries a TRANSPARENT POINTER
 * TARGET over its whole slot column (`pointerTargetWidth`, the WCAG 2.2 AA
 * floor of 24, or the SLOT when the slot is narrower) and the bar itself is
 * drawn exactly as the data says: a hit area is not a mark. Bounded by the
 * slot because overlapping targets would land a press on a NEIGHBOUR, and
 * when the slot is under the floor the chart says so (`crowdedMarksNote`) in
 * the picture and in its accessible name.
 *
 * ON A FRAME it draws the guide it is told to (`axes`): both its own, none at
 * all while the frame draws one merged guide — or, with `axes="y"`, its COUNT
 * axis alone on the LEFT edge, from zero, in the hue the frame handed it. That
 * last one is the two-scale figure a bar may stand in: bars of a count on the
 * left with a line of a rate on the right (a bar takes the FIRST scale and
 * never the second — `mayTakeFirstScale`, the one predicate the def door and
 * the frame both ask).
 */
import type { ChartEmission } from 'vizfootprint/selection';
import type { ColumnView, ViewEncoding, FitView } from '../adapter/types.js';
import type { RenderSelection } from '../contract/types.js';
import { useRef } from 'react';
import { TICK_ANGLE, VALUE_CHAR_PX, fitTick, fitsBand } from './tickFit.js';
import { AxisLabel } from '../primitives/AxisLabel.js';
import { bandOrder, bandWidth, bandStart, bandCentre, domainOr, ticks, slotAt, pointerTargetWidth, crowdedMarksNote, type ChartDomain } from '../primitives/scales.js';
import { scaleHueStyle } from '../primitives/scaleHue.js';
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
  /**
   * THE FRAME'S SCALES (protocol 1.5): `y` is the COUNT axis's ceiling in count
   * units, so a bar and a line stacked on one frame measure heights the same
   * way. The BASELINE stays zero whatever is passed — a bar's height is read
   * from zero, which is the same law the def validator enforces on a shared
   * quantitative channel (`../../src/def/README.md`, "The frame", law 9). This
   * chart has no quantitative x (its x is a band per category), so a `domain.x`
   * has nothing here to scale and is not read. Absent = the chart's own maximum,
   * and every bar is byte-identical to the chart before the prop existed.
   *
   * A BAR CHART HAS NO LOGARITHMIC AXIS, so `transform` (protocol 1.6) is not
   * read on either channel and this chart draws linear bars whatever it is
   * handed. Both halves of that: its x is a band per category, which has no
   * curve to traverse, and its y is a count read as a LENGTH from a baseline —
   * on a logarithmic axis a bar four times as long is not four times the value.
   * The second half is the def door's law 11c (`zeroAnchorsChannel`), which
   * refuses the declaration outright, so nothing legitimate is being ignored
   * here; this is only the second fence.
   */
  readonly domain?: ChartDomain;
  /**
   * Draw this chart's own axis line, category ticks and axis label. Default
   * `true`; `false` while the FRAME draws one merged guide for the stack.
   *
   * `'y'`: ONLY the COUNT axis, on the LEFT edge — this bar's counts are one
   * scale of a two-scale frame whose x is the frame's, drawn once by it
   * (`VizFrame`, the two-axis figure; a bar may take the FIRST scale and never
   * the second, `mayTakeFirstScale` — so there is no `axisSide` here, the one
   * edge a bar can be handed being the one it draws on). Its BASELINE is the
   * frame's x axis: a bar's count is read from zero, so the two are the same
   * line and this chart never draws a second one.
   *
   * WHY `true` draws no count axis when `'y'` does: on its own this chart puts
   * its numbers ON the bars (`showValues`) and keeps the plot for them, which
   * is the picture it has always drawn. On a two-scale frame those labels are
   * not a scale — a reader has to be able to read this layer's heights off an
   * EDGE, and the left edge is the one a bar's extent may be read from. The
   * axis carries no label of its own: this chart's margin (`PAD.l`) is the
   * room the frame aligns every layer's plot by and may not grow, so it holds
   * the ticks and nothing more — the frame's own sentence is what NAMES both
   * scales (`twoScalesSentence`, law 3).
   */
  readonly axes?: boolean | 'y';
  /**
   * THE INK OF THIS SCALE — the hue a two-scale frame handed this layer
   * (`FrameLayerDraw.scaleHue`, `VizFrame` its one owner; a CSS variable
   * reference such as `var(--vzf-scale-left)`). This chart's OWN count axis —
   * its line and its ticks — is drawn in it, and so are its BARS when nothing
   * else names them: a chart given `colorOf` keeps those colours, because
   * identity is never colour-alone and a scale may not take a hue that already
   * names something. Absent = `var(--vzf-brand)`, byte-identical to this chart
   * before the prop existed.
   */
  readonly scaleHue?: string;
}

/**
 * THE MARGIN BOX this chart draws inside — and its ONE owner. EXPORTED so a
 * frame can put this chart's plot box exactly where every other layer's is
 * (`VizFrame`): the frame offsets each layer by its own pad, so an alignment
 * computed there can never drift from the box drawn here.
 */
export const PAD = { l: 38, r: 14, t: 20, b: 48 };
/** Extra bottom room when any tick has to slant (the plot gives it up). */
const SLANT_PAD = 40;
/** Bottom pixels kept for the axis label, beneath the ticks. */
const AXIS_LABEL_ROOM = 24;
/** The plot height a slant may never take the chart below. */
const MIN_PLOT = 40;
/** How many steps this chart's own COUNT axis takes when it draws one (`axes="y"`) — 3 steps, 4 labels, the same as every other axis in the library. */
const COUNT_TICK_STEPS = 3;

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

  // the frame's ceiling when a frame gave one (never below 1, so a band always has height), this chart's own
  // maximum otherwise. Through `domainOr` like every other axis, because it holds the guard: a ceiling that is
  // not a finite number is not a ceiling, and dividing by it would draw every bar at NaN.
  const max = Math.max(1, domainOr(props.domain?.y, [0, Math.max(...data.map((d) => d.count))])[1]);
  // WHICH AXES THIS CHART DRAWS: both (`true`), neither (`false` — the frame's merged guide), or its COUNT
  // axis alone (`'y'` — one scale of a two-scale frame whose x the frame draws once). Two flags, so the
  // category-side markup below reads one word and the count-side another.
  const axes = props.axes ?? true;
  const drawX = axes === true;
  const drawY = axes === 'y';
  // THE INK OF THIS SCALE, on the parts of the count axis this chart draws: one inherited variable the
  // stylesheet spends per element (`scaleHueStyle`), and nothing at all when no hue was handed
  const hueStyle = scaleHueStyle(props.scaleHue);
  // what a bar is drawn with when nothing else names it: the hue its scale was handed, the brand where
  // there is none (a chart given `colorOf` keeps its answer — identity is never colour-alone)
  const markInk = props.scaleHue ?? 'var(--vzf-brand)';
  // THE BANDS, left to right: the FRAME's order when a frame gave one, this chart's own otherwise
  // (`bandOrder`, ../primitives/scales.ts). One slot per category, holding this layer's datum for it or
  // NOTHING — so two bar layers on one frame put "Casual" over the same slot, and a category this layer
  // has no row for stays an EMPTY band instead of a bar claiming zero.
  const bands = bandOrder(props.domain?.categories, data.map((d) => d.category)).map((category) => ({ category, datum: data.find((d) => d.category === category) }));
  // the slot geometry is `bandWidth`/`bandStart`/`bandCentre` (../primitives/scales.ts), the ONE owner shared with
  // the line's band points and the frame's merged ticks — so one category is one x on every mark that stands on it
  const band = bandWidth(PAD.l, width - PAD.r, bands.length);
  // ticks: flat when they fit their band; slanted (and the plot shorter) when any does not
  // (a short chart cannot give the slant its full room — the plot keeps MIN_PLOT and the ticks clip harder).
  // No ticks, no tick room: with `axes={false}` the guide is the FRAME's — and with `axes="y"` the
  // CATEGORY ticks are the frame's too — so giving up 40px of plot for labels this chart is not drawing
  // would move its baseline off every other layer's.
  const slanted = drawX && bands.some((b) => fitTick(b.category, band, 0).rotate);
  const padB = slanted ? Math.min(PAD.b + SLANT_PAD, Math.max(PAD.b, height - PAD.t - MIN_PLOT)) : PAD.b;
  const tickRoom = Math.max(0, padB - 12 - AXIS_LABEL_ROOM);
  const plot = Math.max(0, height - PAD.t - padB);
  const axisY = height - padB;
  /** Where a COUNT lands on the count axis — the BARS' own arithmetic (`h` below), so a tick and a bar can never be folded from two different numbers. */
  const countY = (value: number): number => axisY - (value / max) * plot;
  // value labels are all-or-nothing: omitting only the wide ones would keep the small numbers and drop the large
  const showValues = data.every((d) => fitsBand(String(d.count), band, VALUE_CHAR_PX));
  // A MARK A READER IS MEANT TO PRESS MUST BE REACHABLE. A bar IS pressable, and the drawn rect is a
  // terrible target: 185 categories in a 940px pane make it ~5px wide, and a bar of 2 in a chart of 200
  // is ~3px tall. So each bar gets a TRANSPARENT POINTER TARGET over its whole slot column — full plot
  // height, `pointerTargetWidth` wide (../primitives/scales.ts, the one owner of that number and of the
  // WCAG floor behind it) — and THE BAR ITSELF IS DRAWN EXACTLY AS THE DATA SAYS: a hit area is not a
  // mark, and a bar whose width lied about its category would be worse than a bar that is hard to press.
  // Bounded by the SLOT, because targets that overlapped would land a press on a NEIGHBOUR; and when the
  // slot is under the floor this chart SAYS SO (`crowdedMarksNote`, in the picture and in its accessible
  // name) instead of promising a reach it does not have. Empty when the slots are wide enough, so a chart
  // whose marks already clear the floor is byte-identical to the one before this packet.
  const hitWidth = pointerTargetWidth(band);
  const crowded = crowdedMarksNote(band);

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
    // WHICH SLOT ONE PIXEL IS INSIDE is `slotAt`'s question, not this chart's (../primitives/scales.ts,
    // the one owner) — `VizLine`'s band tap asks the very same one, so a bar's slot and a line's slot
    // for one pixel can never be two different slots
    return slotAt(PAD.l, width - PAD.r, bands.length, sx);
  };
  const beginRun = (category: string): void => {
    run.current = { start: category, end: category };
  };
  const moveRun = (e: { clientX: number; pointerId: number }): void => {
    if (run.current === null || bands.length === 0) return;
    const idx = bandAt(e);
    if (idx < 0) return; // a pointer event with no position says nothing about where the pointer is
    const end = bands[idx]!.category;
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
    const a = bands.findIndex((slot) => slot.category === r.start);
    const b = bands.findIndex((slot) => slot.category === r.end);
    if (a < 0 || b < 0) return; // the data changed under the drag — nothing honest to select
    const [lo, hi] = a < b ? [a, b] : [b, a];
    // the RUN is the bands the pointer crossed, empty ones included: a drag across a slot this layer has
    // no row for still means "these categories", and dropping it would emit a set the reader did not draw
    onEmit?.(matchEmission(field, bands.slice(lo, hi + 1).map((slot) => slot.category), set.exclude));
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
        aria-label={(props.ariaLabel ?? `count by ${label}`) + crowded}
        onPointerMove={moveRun}
        onPointerUp={endRun}
        onPointerCancel={cancelRun}
        onPointerLeave={cancelRun}
      >
        {/* the axis line — absent while the FRAME draws one merged guide for the stack, and while the
            frame draws the x of a two-scale figure once (`axes="y"`): a bar's zero baseline IS that x */}
        {drawX && <line className="vzf-axis" x1={PAD.l} y1={axisY} x2={width - PAD.r} y2={axisY} />}
        {/* THE COUNT AXIS, on the LEFT edge and from ZERO — this layer's own scale on a two-scale frame,
            in the hue that frame handed it. Its ticks step from the baseline to the ceiling the bars are
            drawn against (`max`), so a tick and a bar can never be folded from two different numbers. */}
        {drawY && <line className="vzf-axis" x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={axisY} style={hueStyle} />}
        {drawY &&
          ticks(0, max, COUNT_TICK_STEPS).map((v, i) => (
            <g key={`ct${String(i)}`} style={hueStyle}>
              <line className="vzf-axis" x1={PAD.l - 4} y1={countY(v)} x2={PAD.l} y2={countY(v)} />
              <text className="vzf-tick" x={PAD.l - 8} y={countY(v) + 3} textAnchor="end">
                {Math.round(v * 10) / 10}
              </text>
            </g>
          ))}
        {bands.map(({ category, datum: d }, i) => {
          const cx = bandStart(PAD.l, band, i);
          const h = d === undefined ? 0 : (d.count / max) * plot;
          const barY = axisY - h;
          const isSel = inSet(category, set);
          const tx = bandCentre(PAD.l, band, i);
          const tick = fitTick(category, band, tickRoom, tx);
          return (
            <g key={category}>
              {/* THE POINTER TARGET — transparent, over the mark's whole slot column, and UNDER the marks
                  so the drawn bar keeps its own hover and its own tooltip (and a browser driver's click on
                  the bar is never intercepted by a sibling it cannot see). It carries the same two gestures
                  the bar does, so a press anywhere in the column lands that bar's selection and a drag-run
                  may start from the empty air above a 3px bar. Never for an EMPTY band: no mark, no target.

                  The library's own precedent, and this one's ONE difference from it: `.vzf-box-hit` and
                  `.vzf-hist-hit` are full-height transparent columns too, and they carry the `role`,
                  the `aria-label` and the keyboard — because a box and a histogram bucket never had one.
                  A BAR already IS the accessible button (role, aria-pressed, aria-label, Enter/Space), so
                  this target is `aria-hidden` and adds no second button per category: one mark, one button,
                  and the target is a pointer affordance only. It is also bounded (`pointerTargetWidth`)
                  where those two take the whole band, so it swallows as little of a stacked frame's canvas
                  as the reachability law allows (the pointer law at `.vzf-frame-over`, styles.css). */}
              {d === undefined ? null : (
                <rect
                  className="vzf-mark-hit"
                  x={tx - hitWidth / 2}
                  y={PAD.t}
                  width={hitWidth}
                  height={plot}
                  aria-hidden="true"
                  onClick={(e) => emit(category, e.shiftKey || e.metaKey || e.ctrlKey)}
                  onPointerDown={() => beginRun(category)}
                >
                  <title>{`click to select ${category}`}</title>
                </rect>
              )}
              {d !== undefined && highlight !== undefined && (() => {
                const hl = highlight.find((h) => h.category === category)?.count ?? 0;
                const hh = (Math.min(hl, d.count) / max) * plot;
                return <rect className="vzf-barhl" x={cx + band * 0.3} y={axisY - hh} width={Math.max(0, band * 0.4)} height={hh} rx={2} aria-hidden="true" />;
              })()}
              {d === undefined ? null : <rect
                className={`vzf-barrect${markClass(category, set)}`}
                x={cx + band * 0.12}
                y={barY}
                width={band * 0.76}
                height={h}
                rx={3}
                fill={colorOf ? colorOf(category) : markInk}
                role="button"
                tabIndex={0}
                aria-pressed={isSel && !set.exclude}
                aria-label={`select ${category} (${d.count})${isSel && set.exclude ? ' — excluded' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={(e) => emit(category, e.shiftKey || e.metaKey || e.ctrlKey)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  emit(category, e.shiftKey || e.metaKey || e.ctrlKey);
                }}
                onPointerDown={() => beginRun(category)}
              >
                <title>{`click to select ${category}`}</title>
              </rect>}
              {showValues && d !== undefined ? (
                <text className="vzf-barval" x={tx} y={barY - 5} textAnchor="middle">
                  {d.count}
                </text>
              ) : null}
              {!drawX ? null : tick.rotate ? (
                <text className="vzf-tick" x={tx} y={axisY + 12} textAnchor="end" transform={`rotate(-${String(TICK_ANGLE)} ${String(tx)} ${String(axisY + 12)})`}>
                  {tick.clipped ? <title>{category}</title> : null}
                  {tick.text}
                </text>
              ) : (
                <text className="vzf-tick" x={tx} y={axisY + 16} textAnchor="middle">
                  {category}
                </text>
              )}
            </g>
          );
        })}
        {/* the words for marks a pointer cannot separate, IN THE PICTURE — the accessible name above
            already carries the fact for a screen reader, and a sighted reader meets it only here. The
            same register, and the same corner, the excluded note wears on this library's other charts. */}
        {crowded !== '' && (
          <text className="vzf-crowded-note" x={width - PAD.r} y={axisY - 6} textAnchor="end">
            {crowded.replace(/^ — /, '')}
          </text>
        )}
        {drawX && <AxisLabel x={width / 2} y={height - 8} text={label} channel="category" onOpen={openPicker} />}
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
