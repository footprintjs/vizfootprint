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
import type { ChartEmission } from 'vizfootprint/selection';
import type { ColumnView, ViewEncoding, FitView } from '../adapter/types.js';
import type { RenderRow, RenderSelection } from '../contract/types.js';
import { ticks, domainOr, scaleFor, placeable, padFor, extentFor, logTicks, logTickLabel, excludedNote, type ChartDomain } from '../primitives/scales.js';
import { AxisLabel } from '../primitives/AxisLabel.js';
import { useHorizontalBrush, BrushOverlay } from '../primitives/brush.js';
import { useBrightPredicate, dimClass } from '../primitives/useSelection.js';
import { useReencodePicker } from '../primitives/reencode.js';
import { boundField } from './binding.js';
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
  /** The chart's accessible name — the prose plane's `altShort` lands here; absent = the chart names itself from its bindings. */
  readonly ariaLabel?: string;
  readonly viewId?: string;
  readonly data: readonly ScatterDatum[];
  /** DATA fields the axes encode (also the brush emit field) — defaults, overridden by `encoding.x` / `encoding.y`. */
  readonly xField?: string;
  readonly yField?: string;
  readonly xLabel?: string;
  readonly yLabel?: string;
  readonly colorOf?: (category: string | undefined) => string;
  /**
   * The clause-addressable crossfilter selection (RP-1) — REPLACES the old
   * flat `highlight` keep-predicate. Points whose source `row` fails the
   * non-self clauses are dimmed; the chart's OWN clause never dims it.
   * Build it with `selectionForView(state.selections, viewId, 'intersect', state.links, state.clearedSelections)` — the graph decides which clauses reach this view (a `highlight` edge dims, a `none` edge never arrives) and a cleared source is remembered per its edge; the two-argument form applies every clause and ignores both.
   */
  readonly selection?: RenderSelection;
  readonly regression?: RegressionGeom | null;
  /** Columns offered by the encoding picker (from adapter state). */
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
  /**
   * Contract mode (the `reencodeRequest` verb): when set, an axis-label click
   * asks the HOST to re-encode this channel instead of opening the built-in
   * picker — the host owns the picker and the verb.
   */
  readonly onReencodeRequest?: (channel: string) => void;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
  /**
   * THE FRAME'S SCALES (protocol 1.5): the domains to draw against instead of
   * this chart's own extent, both in the bound columns' own units, so a layer
   * of a frame sits on the shared scale. Absent = the chart's own extent, and
   * every mark is byte-identical to the chart before the prop existed. It
   * filters nothing: a point outside the domain is drawn outside it.
   */
  readonly domain?: ChartDomain;
  /** Draw this chart's own axes (lines, ticks and the interactive axis labels). Default `true`; `false` while the FRAME draws one merged guide for the stack. */
  readonly axes?: boolean;
}

/**
 * THE MARGIN BOX this chart draws inside — and its ONE owner. EXPORTED so a
 * frame can put this chart's plot box exactly where every other layer's is
 * (`VizFrame`): the frame offsets each layer by its own pad, so an alignment
 * computed there can never drift from the box drawn here.
 */
export const PAD = { l: 52, r: 18, t: 18, b: 44 };

export function VizScatter(props: VizScatterProps): JSX.Element {
  const {
    viewId = 'scatter',
    data,
    colorOf,
    selection,
    regression,
    columns = [],
    fits,
    encoding = {},
    onEmit,
    onReencode,
    onReencodeRequest,
    width = 520,
    height = 340,
  } = props;
  // ONE binding per channel — the session's when it named one, this chart's own
  // field prop otherwise; label, accessible name, tooltip and emit all use these.
  const xField = boundField(encoding, 'x', props.xField ?? 'x');
  const yField = boundField(encoding, 'y', props.yField ?? 'y');
  const xLabel = props.xLabel ?? xField;
  const yLabel = props.yLabel ?? yField;

  // the self-excluded crossfilter fold — recomputed only when the selection changes
  const keep = useBrightPredicate(selection);

  // which curve each axis is drawn on — `scaleFor` is the ONE owner of the answer (../primitives/scales.ts)
  const xKind = props.domain?.transform?.x;
  const yKind = props.domain?.transform?.y;
  // A VALUE THE TRANSFORM CANNOT PLACE HAS NO POSITION, so it is left out of the picture AND out of
  // the extent the axis is folded from (a 0 in a logarithmic column must not drag the low bound to a
  // value the axis cannot label) — and it is COUNTED, never silently dropped, the same law the
  // library's fold keeps with `ResolvedDomain.excluded`. Guarded on a transform being declared at
  // all, so a chart with none filters nothing and stays byte-identical to the one that existed before.
  const drawable = props.domain?.transform === undefined ? data : data.filter((d) => placeable(xKind, d.x) && placeable(yKind, d.y));
  const excluded = data.length - drawable.length;
  // the frame's domain when a frame gave one, this chart's own extent otherwise (../primitives/scales.ts)
  // the chart's own breathing room, which a LOGARITHMIC axis takes none of (`padFor`); `extentFor` is
  // LOG-AWARE about an empty `drawable` — see its own doc for why `extent`'s plain [0,1] default would
  // otherwise mislead `logDomain` into lifting a low bound that was never really there
  const [xlo, xhi] = domainOr(props.domain?.x, extentFor(drawable, (d) => d.x, padFor(xKind, 5), xKind));
  const x = scaleFor(xKind)(xlo, xhi, PAD.l, width - PAD.r);
  const [ylo, yhi] = domainOr(props.domain?.y, extentFor(drawable, (d) => d.y, padFor(yKind, 0.5), yKind));
  const y = scaleFor(yKind)(ylo, yhi, height - PAD.b, PAD.t);
  const axes = props.axes ?? true;

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

  // the chart's OWN extents are padded (5 on x, 0.5 on y), so its ticks step inside that padding;
  // a frame's domain carries no padding of ours, so its ticks span exactly what the axis claims
  // a LOGARITHMIC axis is ticked at decades instead (`logTicks`), read off the scale's own clamped
  // domain rather than the raw pair, because that is the span the marks were actually placed on
  const xTicks = xKind === 'log' ? logTicks(x.domain[0], x.domain[1], 5) : ticks(props.domain?.x === undefined ? xlo + 5 : xlo, props.domain?.x === undefined ? xhi - 5 : xhi, 4);
  const yTickVals = yKind === 'log' ? logTicks(y.domain[0], y.domain[1], 5) : props.domain?.y === undefined ? ticks(Math.ceil(ylo + 0.5), Math.floor(yhi - 0.5), 4) : ticks(ylo, yhi, 4);

  return (
    <>
      <svg
        ref={svgRef}
        className={`vzf-chart vzf-scatter${props.className ? ' ' + props.className : ''}`}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={(props.ariaLabel ?? `scatter of ${yLabel} against ${xLabel}`) + excludedNote(excluded)}
        {...handlers}
      >
        {/* axes frame — absent while the FRAME draws one merged guide for the stack */}
        {axes && <line className="vzf-axis" x1={PAD.l} y1={height - PAD.b} x2={width - PAD.r} y2={height - PAD.b} />}
        {axes && <line className="vzf-axis" x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={height - PAD.b} />}
        {/* x ticks */}
        {axes && xTicks.map((v, i) => (
          <g key={`xt${i}`}>
            <line className="vzf-axis" x1={x(v)} y1={height - PAD.b} x2={x(v)} y2={height - PAD.b + 4} />
            <text className="vzf-tick" x={x(v)} y={height - PAD.b + 16} textAnchor="middle">
              {xKind === 'log' ? logTickLabel(v) : Math.round(v)}
            </text>
          </g>
        ))}
        {/* y ticks */}
        {axes && yTickVals.map((v, i) => (
          <g key={`yt${i}`}>
            <line className="vzf-axis" x1={PAD.l - 4} y1={y(v)} x2={PAD.l} y2={y(v)} />
            <text className="vzf-tick" x={PAD.l - 8} y={y(v) + 3} textAnchor="end">
              {yKind === 'log' ? logTickLabel(v) : v}
            </text>
          </g>
        ))}
        {/* regression overlay — drawn only where the transform can place both of its ends: a
            least-squares line is a LINEAR statement, and an end with no position would draw at NaN */}
        {regression && placeable(xKind, regression.domain[0]) && placeable(xKind, regression.domain[1])
          && placeable(yKind, regression.slope * regression.domain[0] + regression.intercept)
          && placeable(yKind, regression.slope * regression.domain[1] + regression.intercept) && (
          <line
            className="vzf-regline"
            x1={x(regression.domain[0])}
            y1={y(regression.slope * regression.domain[0] + regression.intercept)}
            x2={x(regression.domain[1])}
            y2={y(regression.slope * regression.domain[1] + regression.intercept)}
          />
        )}
        {/* points — the placeable ones; see `drawable` above */}
        {drawable.map((d) => {
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
        {axes && <AxisLabel x={(PAD.l + width - PAD.r) / 2} y={height - 8} text={xLabel} channel="x" onOpen={openPicker} />}
        {axes && <AxisLabel x={14} y={height / 2} text={yLabel} channel="y" anchor="middle" rotate={-90} onOpen={openPicker} />}
        {/* the words for what a transform could not place, IN THE PICTURE — `excludedNote` already
            carries this fact into the accessible name for a screen reader; a sighted reader meets it
            only here, so a log-log scatter that silently omits hundreds of rows does not look like one
            that has none */}
        {excluded > 0 && (
          <text className="vzf-excluded-note" x={width - PAD.r} y={PAD.t - 6} textAnchor="end">
            {excludedNote(excluded).replace(/^ — /, '')}
          </text>
        )}
      </svg>
      <EncodingPicker
        open={pickerChannel !== null}
        viewId={viewId}
        channel={pickerChannel ?? 'x'}
        columns={columns}
        fits={fits}
        currentField={pickerChannel === null ? undefined : pickerChannel === 'x' ? xField : boundField(encoding, pickerChannel, yField)}
        onReencode={(v, c, f) => onReencode?.(v, c, f)}
        onClose={closePicker}
      />
    </>
  );
}
