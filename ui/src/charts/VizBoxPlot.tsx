/**
 * `<VizBoxPlot>` — a responsive SVG box plot over HOST-COMPUTED summary
 * statistics, composed entirely from the public primitives tier (the
 * VizHistogram/VizHeatmap proof-chart discipline): scales + date handling,
 * `AxisLabel`/`useReencodePicker`/`defaultCompat` (the re-encode seam),
 * `togglePointEmission`/`selectedValue`/`keyActivates` (the VizBar/VizMap
 * point-select language) — no forked internals anywhere.
 *
 * STATISTICS AS RENDER DATA (the load-bearing rule): the chart receives READY
 * `BoxPlotDatum[]` — one summary per category; `src/data`'s `boxSummary` is
 * the canonical host helper (type-7 quartiles, Tukey whiskers, listed
 * outliers) — and NEVER computes a quantile, a fence, or an outlier test
 * itself. Under a crossfilter the HOST recomputes each category's summary
 * from its own recomputed value array (the VizBar recount pattern, one tier
 * up: a summary, not a count).
 *
 * GESTURE: click a box → the R3 POINT emission `{ rawValue: category,
 * encoding: { kind: 'point', field: xField } }` (`togglePointEmission` — the
 * VizMap language); clicking the SELECTED category again emits the CLEARED
 * point (`rawValue: undefined`), releasing the filter — the outline and the
 * toggle comparison both derive from the fold's own point clause
 * (`selectedValue`, which reads `selfSelectedValue` when `selected` is
 * omitted), never local state. Boxes are keyboard-focusable; Enter selects.
 *
 * OUTLIERS (honest v1 scope): each outlier renders as its own dot, hoverable
 * via `<title>`/`aria-label` — but it carries NO click handler and NO
 * `tabIndex`. An outlier is evidence about the CATEGORY's distribution, not
 * an addressable row of its own; v1 does not invent a per-outlier selection
 * kind the R3 rail has no vocabulary for. Clicking anywhere in the category's
 * column (box, whiskers, OR an outlier dot) selects the whole category, same
 * as VizBar/VizMap.
 *
 * Axis labels both re-encode: y is restricted to numeric/date columns
 * (`defaultCompat` — the scatter/histogram rule, since y is the encoded
 * VALUE); x accepts string or numeric columns (its own compat, the
 * VizHeatmap `y`-channel precedent — x is the row CATEGORY, not a
 * positional channel).
 *
 * CATEGORY LABELS ARE WIDTH-AWARE (`fitCategoryLabel`): a squeezed cockpit
 * cell truncates each label to what its OWN band fits, honestly, rather than
 * letting neighbours' text collide — the VizHeatmap row-label discipline,
 * applied per-band; the full name always rides the hit column's
 * `aria-label`/`title`.
 */
import { useMemo } from 'react';
import type { ChartEmission } from '../../../src/mosaic/index.js';
import type { ColumnView, ViewEncoding, FitView } from '../adapter/types.js';
import type { RenderSelection } from '../contract/types.js';
import { linearScale, extent, ticks, epochOf, dayOf } from '../primitives/scales.js';
import { AxisLabel } from '../primitives/AxisLabel.js';
import { togglePointEmission, keyActivates } from '../primitives/pointSelect.js';
import { selectedValue } from '../primitives/useSelection.js';
import { useReencodePicker } from '../primitives/reencode.js';
import { defaultCompat, type Compatibility } from '../primitives/compat.js';
import { EncodingPicker } from './EncodingPicker.js';

/** One HOST-computed box-plot summary for a category (`src/data`'s `boxSummary` is the canonical source). */
export interface BoxPlotDatum {
  readonly category: string;
  readonly q1: number | string;
  readonly median: number | string;
  readonly q3: number | string;
  /** The lowest ACTUAL data value inside the Tukey fence (never fabricated). */
  readonly whiskerLo: number | string;
  /** The highest ACTUAL data value inside the Tukey fence. */
  readonly whiskerHi: number | string;
  /** Values outside the fence — individually hoverable, NOT separately selectable (v1 honest scope, see the file header). */
  readonly outliers: readonly (number | string)[];
  readonly count: number;
}

export interface VizBoxPlotProps {
  readonly viewId?: string;
  /** READY per-category summaries, host-computed (the chart never computes a quantile). */
  readonly data: readonly BoxPlotDatum[];
  /** The categorical field the boxes divide (also the point-emission field). */
  readonly xField?: string;
  /** The numeric/date field the box statistics summarize. */
  readonly yField?: string;
  readonly xLabel?: string;
  readonly yLabel?: string;
  /** The unit word for tooltips (default `'rows'`). */
  readonly countLabel?: string;
  /** The selected category (controlled). Omit it and the outline derives from `selection`'s own point clause. */
  readonly selected?: string | null;
  /** The clause-addressable crossfilter selection (RP-1) — feeds the `selected` derivation. */
  readonly selection?: RenderSelection;
  /** Columns offered by the encoding pickers (from adapter state). */
  readonly columns?: readonly ColumnView[];
  /** The encoding plane's verdicts per channel (`views[].fits` on the wire) — the built-in picker greys with the session's own sentences. */
  readonly fits?: Readonly<Record<string, readonly FitView[]>>;
  /** Current channel→field map for the pickers' highlight. */
  readonly encoding?: ViewEncoding;
  readonly onEmit?: (emission: ChartEmission) => void;
  readonly onReencode?: (viewId: string, channel: string, field: string) => void;
  /** Contract mode (RP-1 `reencodeRequest`): an axis click asks the HOST instead of opening the built-in picker. */
  readonly onReencodeRequest?: (channel: string) => void;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

const PAD = { l: 48, r: 16, t: 16, b: 48 };

/** A value's position on the linear axis — numbers as-is, ISO dates by epoch. */
function edgePos(v: number | string): number | null {
  return typeof v === 'number' ? v : epochOf(v);
}

/** A value's short display label — numbers to ≤2 decimals, dates to their day. */
function edgeLabel(v: number | string): string {
  return typeof v === 'number' ? String(Math.round(v * 100) / 100) : dayOf(v);
}

/**
 * The x-channel compat: a box-plot category wants a string OR numeric column
 * (the VizHeatmap `y`-channel precedent, one chart over) — boolean/date have
 * no honest category vocabulary here (a date belongs on the value axis).
 */
function categoryCompat(channel: string, column: ColumnView): Compatibility {
  if (column.type === 'string' || column.type === 'number') return { ok: true };
  return { ok: false, reason: `${channel} needs a category (string) or numeric column — "${column.field}" is ${column.type}` };
}

/**
 * A category tick label fitted to its OWN band width — truncated (with an
 * ellipsis) when the full name would not fit, and left BLANK (never a
 * colliding fragment) when the band is too tight for even one character plus
 * the ellipsis. WIDTH-AWARE, the VizHeatmap row-label discipline (`fitLabel`
 * + its adaptive gutter) applied per-band instead of to one shared gutter: a
 * box-plot label can't be THINNED the way VizHistogram skips crowded edge
 * ticks (every visible box IS its own category, so there is no redundant
 * neighbour tick to drop instead) — but an HONESTLY EMPTY label plays the
 * same role histogram's dropped tick does: nothing shown beats two labels
 * bleeding into each other. The full name is never lost regardless of how
 * tight the truncation gets: it rides the hit column's own `aria-label`/
 * `title` (below), the same "truncate on screen, keep the whole name in the
 * accessible name" split VizHeatmap uses.
 */
function fitCategoryLabel(label: string, band: number): string {
  // .vzf-tick rides a 10px monospace font; ~6px/character is a safe (slightly
  // generous) estimate, with a small margin so a label never crowds its
  // neighbour's own band
  const CHAR_W = 6;
  const MARGIN = 4;
  const maxWhole = Math.floor((band - MARGIN) / CHAR_W);
  if (label.length <= maxWhole) return label; // fits as-is — no ellipsis needed
  const maxTruncated = maxWhole - 1; // one glyph of the budget is the ellipsis itself
  if (maxTruncated < 1) return ''; // too tight for even one character — honest silence, never a collision
  return `${label.slice(0, maxTruncated)}…`;
}

/** One outlier, paired with its placed position (kept together so a skipped-unplaceable outlier never shifts another's index). */
interface OutlierGeom {
  readonly value: number | string;
  readonly p: number;
}

interface BoxGeom extends BoxPlotDatum {
  readonly q1p: number;
  readonly medianP: number;
  readonly q3p: number;
  readonly loP: number;
  readonly hiP: number;
  readonly outlierGeoms: readonly OutlierGeom[];
}

/** Positionable boxes — a category whose core statistics cannot be placed is skipped entirely, never guessed. */
function toGeoms(data: readonly BoxPlotDatum[]): BoxGeom[] {
  const geoms: BoxGeom[] = [];
  for (const d of data) {
    const q1p = edgePos(d.q1);
    const medianP = edgePos(d.median);
    const q3p = edgePos(d.q3);
    const loP = edgePos(d.whiskerLo);
    const hiP = edgePos(d.whiskerHi);
    if (q1p === null || medianP === null || q3p === null || loP === null || hiP === null) continue;
    const outlierGeoms: OutlierGeom[] = [];
    for (const value of d.outliers) {
      const p = edgePos(value);
      if (p !== null) outlierGeoms.push({ value, p }); // an unplaceable outlier is skipped individually, never guessed
    }
    geoms.push({ ...d, q1p, medianP, q3p, loP, hiP, outlierGeoms });
  }
  return geoms;
}

export function VizBoxPlot(props: VizBoxPlotProps): JSX.Element {
  const {
    viewId = 'boxplot',
    data,
    xField = 'category',
    yField = 'value',
    xLabel = xField,
    yLabel = yField,
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

  const geoms = useMemo(() => toGeoms(data), [data]);

  // the y domain: every whisker end + every outlier across every box — the
  // RAW extent drives the tick labels; a separate 8%-of-span outer pad keeps
  // the drawn marks off the plot's own edge (the VizScatter padding idea,
  // sized relative to THIS chart's own value range rather than a fixed constant)
  const allYs = geoms.flatMap((g) => [g.loP, g.hiP, ...g.outlierGeoms.map((o) => o.p)]);
  const [rawLo, rawHi] = extent(allYs, (v) => v, 0);
  const outerPad = (rawHi - rawLo) * 0.08;
  const y = linearScale(rawLo - outerPad, rawHi + outerPad, height - PAD.b, PAD.t);

  const band = (width - PAD.l - PAD.r) / Math.max(1, geoms.length);
  const boxW = Math.max(6, Math.min(band * 0.5, 64));
  const capW = boxW * 0.6;
  const cx = (i: number): number => PAD.l + band * i + band / 2;

  // explicit `selected` wins; otherwise the outline derives from the fold's own point clause
  const selected = selectedValue(props.selected, selection);

  const emit = (category: string): void => {
    // clicking the selected category again CLEARS the point selection — the
    // togglePointEmission primitive (rawValue undefined = the cleared state of
    // src/data's three-way point split; null would mean "match SQL NULL")
    onEmit?.(togglePointEmission(xField, category, selected));
  };

  const { pickerChannel, openPicker, closePicker } = useReencodePicker(onReencodeRequest);

  // date-domain ticks read back through the FULL ISO day (display only — the
  // emitted category never rides this label, so no edge-precision rule applies)
  const isDate = geoms.length > 0 && typeof geoms[0]!.q1 === 'string';
  const yTickVals = ticks(rawLo, rawHi, 4);
  const yTickLabel = (v: number): string => (isDate ? new Date(v).toISOString().slice(0, 10) : String(Math.round(v * 100) / 100));

  return (
    <>
      <svg
        className={`vzf-chart vzf-boxplot${props.className ? ' ' + props.className : ''}`}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`box plot of ${yLabel} by ${xLabel}`}
      >
        {/* axes frame */}
        <line className="vzf-axis" x1={PAD.l} y1={height - PAD.b} x2={width - PAD.r} y2={height - PAD.b} />
        <line className="vzf-axis" x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={height - PAD.b} />
        {/* y ticks */}
        {yTickVals.map((v, i) => (
          <g key={`yt${i}`}>
            <line className="vzf-axis" x1={PAD.l - 4} y1={y(v)} x2={PAD.l} y2={y(v)} />
            <text className="vzf-tick" x={PAD.l - 8} y={y(v) + 3} textAnchor="end">
              {yTickLabel(v)}
            </text>
          </g>
        ))}
        {/* boxes */}
        {geoms.map((g, i) => {
          const sel = selected === g.category;
          const boxTop = y(g.q3p);
          const boxBottom = y(g.q1p);
          const range = `${edgeLabel(g.q1)} – ${edgeLabel(g.q3)}`;
          return (
            <g key={g.category}>
              {/* whiskers: vertical stem + caps, from the box edges to the real data extremes */}
              <line className="vzf-box-whisker" x1={cx(i)} y1={y(g.hiP)} x2={cx(i)} y2={boxTop} aria-hidden="true" />
              <line className="vzf-box-whisker" x1={cx(i)} y1={boxBottom} x2={cx(i)} y2={y(g.loP)} aria-hidden="true" />
              <line className="vzf-box-cap" x1={cx(i) - capW / 2} y1={y(g.hiP)} x2={cx(i) + capW / 2} y2={y(g.hiP)} aria-hidden="true" />
              <line className="vzf-box-cap" x1={cx(i) - capW / 2} y1={y(g.loP)} x2={cx(i) + capW / 2} y2={y(g.loP)} aria-hidden="true" />
              {/* the box itself: q1..q3 */}
              <rect
                className={`vzf-box${sel ? ' vzf-selected' : ''}`}
                x={cx(i) - boxW / 2}
                y={boxTop}
                width={boxW}
                height={Math.max(1, boxBottom - boxTop)}
                aria-hidden="true"
              />
              <line
                className="vzf-box-median"
                x1={cx(i) - boxW / 2}
                y1={y(g.medianP)}
                x2={cx(i) + boxW / 2}
                y2={y(g.medianP)}
                aria-hidden="true"
              />
              {/* outliers: individually hoverable, NOT separately selectable (v1 honest scope) */}
              {g.outlierGeoms.map((o, oi) => (
                <circle
                  key={oi}
                  className="vzf-box-outlier"
                  cx={cx(i)}
                  cy={y(o.p)}
                  r={3}
                  aria-label={`${xLabel} ${g.category} outlier · ${yLabel} ${edgeLabel(o.value)}`}
                >
                  <title>{`${g.category} outlier · ${yLabel} ${edgeLabel(o.value)}`}</title>
                </circle>
              ))}
              {/* the full-height transparent HIT area: keyboard + tooltip + click for the whole category column */}
              <rect
                className="vzf-box-hit"
                x={PAD.l + band * i}
                y={PAD.t}
                width={band}
                height={height - PAD.t - PAD.b}
                role="button"
                tabIndex={0}
                aria-pressed={sel}
                aria-label={`${xLabel} ${g.category} · ${g.count} ${countLabel} · median ${edgeLabel(g.median)}`}
                data-box={g.category}
                onClick={() => emit(g.category)}
                onKeyDown={keyActivates(() => emit(g.category))}
              >
                <title>{`${g.category} · ${g.count} ${countLabel} · box ${range} · median ${edgeLabel(g.median)} · click to ${sel ? 'clear' : 'select'}`}</title>
              </rect>
              {/* category tick label — width-aware truncation (fitCategoryLabel); the full name lives on the hit column's own aria-label/title above */}
              <text className="vzf-tick vzf-box-catlabel" x={cx(i)} y={height - PAD.b + 16} textAnchor="middle">
                {fitCategoryLabel(g.category, band)}
              </text>
            </g>
          );
        })}
        {/* the two interactive axis labels */}
        <AxisLabel x={(PAD.l + width - PAD.r) / 2} y={height - 8} text={xLabel} channel="x" onOpen={openPicker} />
        <AxisLabel x={14} y={(PAD.t + height - PAD.b) / 2} text={yLabel} channel="y" anchor="middle" rotate={-90} onOpen={openPicker} />
        <desc>{`view ${viewId}: click a box to select ${xLabel}; click it again to clear`}</desc>
      </svg>
      <EncodingPicker
        open={pickerChannel !== null}
        viewId={viewId}
        channel={pickerChannel ?? 'x'}
        columns={columns}
        fits={fits}
        currentField={pickerChannel === 'y' ? encoding['y'] ?? yField : encoding['x'] ?? xField}
        compatible={(channel, column) => (channel === 'x' ? categoryCompat(channel, column) : defaultCompat(channel, column))}
        onReencode={(v, c, f) => onReencode?.(v, c, f)}
        onClose={closePicker}
      />
    </>
  );
}
