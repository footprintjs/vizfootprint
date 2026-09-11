/**
 * THE FRAME — several layers of marks over ONE margin box, ONE pair of scales
 * and ONE guide (R6). A view is an ordered stack of layers and the frame owns
 * the scales (Wickham: "scales are common across layers"); this component owns
 * the two things that makes true on screen:
 *
 *   1. ONE MARGIN BOX. Every layer's PLOT box is the same rectangle, so equal
 *      values land on equal pixels. The charts have different margins of their
 *      own (a line keeps 52px for its y ticks, a bar 38), so the frame takes
 *      the UNION of them as its own margin and then offsets each layer by ITS
 *      pad — the chart stays the one owner of its box (`PAD`, exported from
 *      each chart), and the frame never re-states it.
 *   2. ONE GUIDE, OR TWO SIDES. Under `guide: 'merged'` every layer is drawn
 *      with `axes={false}` and the FRAME draws the axes once, from the frame's
 *      own domain. Under `'per-layer'` a single layer draws its own pair,
 *      inside the same box. Two or more layers under `'per-layer'` are THE
 *      TWO-AXIS FIGURE: the frame still draws the axes it was given (x, drawn
 *      once — one frame has one x), and each layer whose y is its OWN scale
 *      (`ownY`) draws only that y — the first on the LEFT edge, the second on
 *      the RIGHT (`axes: 'y'` + `axisSide`, `FrameLayerDraw`). A frame has two
 *      sides, so a third own y is refused upstream in words (`stackRefusal`
 *      in `contract/renderers.tsx`, law 1); this component draws what it is
 *      handed without knowing that happened, and hands a third the left edge
 *      rather than hiding it. A layer with no y of its own draws no axes — the
 *      frame's are its.
 *   3. THE WORDS. Two scales on one frame are two claims, and the frame must
 *      say so: `words` — the renderer's sentence, one owner — is rendered in
 *      the frame's own CAPTION REGION (a strip inside the frame's height, below
 *      the plot, taken from the margin the way a slanted tick takes its room)
 *      and in the accessible label. A dual axis that says nothing is the lie.
 *
 * The margin is still ONE union: a right axis adds its room on the right
 * (`padOnSide` — the chart's own pad mirrored, the same object the chart draws
 * by), and the caption adds its strip below, each ONLY when drawn — a frame
 * with neither is byte-identical to the frame before they existed.
 *
 * WHAT THIS COMPONENT DOES NOT DO, by design:
 *   - It never reads a row. A layer arrives as a `render` callback, so the
 *     frame knows a MARK KIND (for the margin) and nothing else about the data
 *     — which is what lets the contract renderer, the gallery and a test all
 *     compose the same frame out of whatever they already have.
 *   - It draws no legend and its axis labels are TEXT, not the charts'
 *     re-encode affordance: a click on a merged axis would have to ask WHICH
 *     layer to re-encode, and the frame has no honest answer in this version.
 *
 * The stack is N svgs in one box rather than one svg with N groups: every
 * chart component owns its own `<svg>` (plus the encoding picker beside it),
 * and the alternative is six charts that can only be drawn inside a frame.
 * The pointer law that follows is in styles.css at `.vzf-frame-layer`.
 */
import { fitTick } from './tickFit.js';
import { PAD as LINE_PAD } from './VizLine.js';
import { PAD as BAR_PAD } from './VizBar.js';
import { PAD as POINT_PAD } from './VizScatter.js';
import { PAD as HISTOGRAM_PAD } from './VizHistogram.js';
import { PAD as BOXPLOT_PAD } from './VizBoxPlot.js';
import { dayOf, ticks, scaleFor, logTicks, logTickLabel, bandWidth, bandCentre, padOnSide, type ChartDomain, type ScaleKind, type AxisSide } from '../primitives/scales.js';

/** The mark kinds a frame can draw: the 2D charts, and exactly those (a map, a network, a heatmap and a table each own their own frame). */
export type FrameChartKind = 'line' | 'bar' | 'point' | 'histogram' | 'boxplot';

/** The margin a chart keeps around its plot. */
export interface FramePad {
  readonly l: number;
  readonly r: number;
  readonly t: number;
  readonly b: number;
}

/**
 * Each framed kind's own margin box, by its own constant — the charts are the
 * owners and this is only the index. A kind missing here cannot be framed,
 * which is the same list {@link FrameChartKind} names.
 */
export const FRAME_PADS: Readonly<Record<FrameChartKind, FramePad>> = Object.freeze({
  line: LINE_PAD,
  bar: BAR_PAD,
  point: POINT_PAD,
  histogram: HISTOGRAM_PAD,
  boxplot: BOXPLOT_PAD,
});

/** Is this a mark kind a frame can draw? The ONE owner of that question — the renderer's refusal reads it. */
export function isFrameChartKind(kind: string): kind is FrameChartKind {
  return Object.prototype.hasOwnProperty.call(FRAME_PADS, kind);
}

/**
 * THE FRAME'S OWN MARGIN: the union of the layers' margins, side by side. The
 * widest left margin wins, because a box narrower than any layer's own would
 * push that layer's ticks off its edge. An empty stack has no margin at all —
 * there is nothing to keep room for.
 */
export function framePad(kinds: readonly FrameChartKind[]): FramePad {
  return unionPads(kinds.map((kind) => FRAME_PADS[kind]));
}

/** The union of margins, side by side — `framePad`'s arithmetic over pads already placed on their sides. */
function unionPads(pads: readonly FramePad[]): FramePad {
  const side = (get: (pad: FramePad) => number): number => pads.reduce((most, pad) => Math.max(most, get(pad)), 0);
  return { l: side((p) => p.l), r: side((p) => p.r), t: side((p) => p.t), b: side((p) => p.b) };
}

/**
 * Pixels the caption strip takes beneath the plot when the frame has words to
 * say: two lines of the caption's small type, so a sentence that wraps once on
 * a narrow frame is still whole. Added to the margin union ONLY when `words`
 * is given — a wordless frame keeps its plot.
 */
export const CAPTION_ROOM = 32;

/** The rectangle the marks are drawn in — the SAME rectangle for every layer, which is the whole promise. */
export interface FramePlotBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The frame's plot box inside a `width × height` cell. Clamped, so a cell pushed narrower than its own margins draws an empty box rather than an inside-out one. */
export function framePlotBox(pad: FramePad, width: number, height: number): FramePlotBox {
  return { left: pad.l, top: pad.t, right: Math.max(pad.l, width - pad.r), bottom: Math.max(pad.t, height - pad.b) };
}

/**
 * Where one layer's chart is placed so that ITS plot box lands on the frame's:
 * offset back by its own pad, sized to the frame's plot plus that pad. The
 * chart is drawn at 1 user unit per pixel (its `viewBox` is its own size), so
 * nothing is scaled and no stroke or label is distorted.
 */
export function frameLayerBox(pad: FramePad, plot: FramePlotBox): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } {
  return { left: plot.left - pad.l, top: plot.top - pad.t, width: plot.right - plot.left + pad.l + pad.r, height: plot.bottom - plot.top + pad.t + pad.b };
}

/** What a layer is handed to draw itself with: the size of ITS svg, the frame's scales, and whether it draws its own guide. */
export interface FrameLayerDraw {
  readonly width: number;
  readonly height: number;
  /** The frame's domain, in the units each chart's own `domain` prop reads (`../primitives/scales.ts`). */
  readonly domain: ChartDomain;
  /** `false` while the FRAME draws one merged guide for the whole stack; `'y'` when this layer draws ONLY its own y axis, on `axisSide`, and the frame draws x once. */
  readonly axes: boolean | 'y';
  /** Which edge this layer's own y axis stands on — set exactly when `axes` is `'y'`. */
  readonly axisSide?: AxisSide;
}

/** One layer of a frame: which mark it is (for the margin), whether its y is its own, and how to draw it. */
export interface VizFrameLayer {
  readonly layerId: string;
  readonly kind: FrameChartKind;
  /**
   * This layer's y is its OWN scale — bound by the layer and not the frame's
   * merged one. Read only under `guide: 'per-layer'` with two or more layers:
   * the first such layer takes the left edge, the second the right (law 1).
   * Absent = false: on such a frame the layer draws no axes of its own.
   */
  readonly ownY?: boolean;
  render(draw: FrameLayerDraw): JSX.Element;
}

/**
 * One axis of the merged guide: the SCALE KIND (which decides how a tick is
 * spelled) and the field name under it. The NUMBERS are not here — they ride
 * on `domain`, in the units the charts read, exactly as a layer gets them, so
 * the guide and the marks can never be folded from two different pairs.
 */
export interface FrameAxis {
  readonly scale: 'quantitative' | 'temporal' | 'categorical';
  /** Drawn under (or beside) the axis as plain text. Absent = no label. */
  readonly label?: string;
}

export interface VizFrameProps {
  /** The layers in DECLARATION order: first = bottom, and the order they are painted in. */
  readonly layers: readonly VizFrameLayer[];
  /** The frame's scales, as every layer receives them. */
  readonly domain?: ChartDomain;
  /** `'merged'` (default): the frame draws the axes once. `'per-layer'`: every layer draws its own, in the same box. */
  readonly guide?: 'merged' | 'per-layer';
  /** The merged x axis. Absent = no x guide is drawn (nothing was shared on x). */
  readonly x?: FrameAxis;
  /** The merged y axis. Absent = no y guide. */
  readonly y?: FrameAxis;
  /**
   * THE FRAME'S OWN WORDS — the sentence that says two scales are two claims
   * (`twoScalesSentence`, `contract/renderers.tsx`, its one owner). Rendered in
   * the caption strip beneath the plot and in the accessible label. Absent =
   * no strip, no words.
   */
  readonly words?: string;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
  readonly ariaLabel?: string;
}

/** How many steps the merged guide's ticks take — 3 steps, 4 labels, the same as the charts' own axes. */
const FRAME_TICK_STEPS = 3;
/** Pixels beneath the axis kept for the axis label, so a slanted tick is clipped instead of running into it. */
const AXIS_LABEL_ROOM = 24;

/** One tick of the merged guide: where it sits along the axis, and what it says. */
interface FrameTick {
  readonly at: number;
  readonly text: string;
  /** Drawn on the slant (a band label wider than its band). */
  readonly rotate: boolean;
  /** Set when `text` is not the whole label — the full one rides in a `<title>`. */
  readonly full?: string;
}

/**
 * THE CURVE ONE MERGED AXIS IS DRAWN ON, and the ONE place the frame decides
 * it: the transform the frame's own domain declares, but only where the axis is
 * QUANTITATIVE. A categorical axis is a list of bands and a temporal one is a
 * run of dates, and neither has a logarithm to take — the def door refuses a
 * log transform on a non-number column outright (law 11b), and here the key is
 * ignored for the same reason a chart ignores an axis it cannot scale.
 *
 * A STACK MIXING A LOGARITHMIC AND A LINEAR LAYER ON ONE SHARED CHANNEL CANNOT
 * HAPPEN, and this function is where that is ASSERTED rather than handled: the
 * transform rides on the frame's ONE `domain` object, which every layer
 * receives by that same reference ({@link FrameLayerDraw}), so there is nowhere
 * to put a second answer for the same channel. One resolution per channel is
 * the library's law (`ChannelResolution`); on this side it is a shape, so the
 * guide and every layer's marks are folded from the same pair AND the same
 * curve by construction.
 */
function curveOf(axis: FrameAxis | undefined, declared: ScaleKind | undefined): ScaleKind | undefined {
  return axis?.scale === 'quantitative' ? declared : undefined;
}

/** A tick's number as the merged guide spells it: a date as its day, a decade of a logarithmic axis as its power of ten, anything else rounded to a tenth (one rule, named here, for both axes). */
function tickText(scale: FrameAxis['scale'], value: number, kind?: ScaleKind): string {
  if (scale === 'temporal') return dayOf(new Date(value).toISOString());
  return kind === 'log' ? logTickLabel(value) : String(Math.round(value * 10) / 10);
}

/**
 * Ticks across a span: DECADES on a logarithmic axis, evenly spaced otherwise.
 * A span that is not two finite numbers is not a span — no ticks, rather than
 * an axis of NaN.
 *
 * The logarithmic ticks are read off the scale's OWN clamped domain
 * (`scaleFor`, which is the one owner of that clamp) rather than the raw pair,
 * so the guide labels the span the layers' marks were actually placed on.
 */
function spanTicks(scale: FrameAxis['scale'], span: readonly [number, number] | undefined, from: number, to: number, kind?: ScaleKind): readonly FrameTick[] {
  if (span === undefined || !Number.isFinite(span[0]) || !Number.isFinite(span[1])) return [];
  const at = scaleFor(kind)(span[0], span[1], from, to);
  const values = kind === 'log' ? logTicks(at.domain[0], at.domain[1], FRAME_TICK_STEPS + 1) : ticks(span[0], span[1], FRAME_TICK_STEPS);
  return values.map((value) => ({ at: at(value), text: tickText(scale, value, kind), rotate: false }));
}

/**
 * One tick per band, at its centre, fitted to the band the way a bar chart fits
 * its own (`fitTick` — one owner). The centre is `bandCentre` off `bandWidth`
 * (`../primitives/scales.ts`), the SAME slot geometry every mark on a band
 * places itself by — so a tick and a bar's slot and a line's point for one
 * category are one x by construction, never by three charts agreeing.
 */
function bandTicks(categories: readonly string[] | undefined, from: number, to: number, room: number): readonly FrameTick[] {
  const names = categories ?? [];
  const band = bandWidth(from, to, names.length);
  return names.map((name, i) => {
    const at = bandCentre(from, band, i);
    const fit = fitTick(name, band, room, at);
    return { at, text: fit.text, rotate: fit.rotate, ...(fit.clipped ? { full: name } : {}) };
  });
}

/**
 * The ticks of one axis: its BANDS when the shared channel is categorical, its
 * span otherwise. The bands are passed in rather than read off the domain,
 * because `ChartDomain.categories` is the X band order by definition — a
 * categorical Y is given none, and draws its line and no ticks rather than the
 * x's names down its side.
 */
function axisTicks(axis: FrameAxis, categories: readonly string[] | undefined, span: readonly [number, number] | undefined, from: number, to: number, room: number, kind?: ScaleKind): readonly FrameTick[] {
  return axis.scale === 'categorical' ? bandTicks(categories, from, to, room) : spanTicks(axis.scale, span, from, to, kind);
}

/**
 * The merged guide: one axis line and one set of ticks per axis the frame was
 * given, drawn in the frame's own margin. `floor` is where that margin ENDS —
 * the frame's bottom, or the top of the caption strip when the frame has words
 * — so the x label and a slanted tick's room are measured against the margin
 * and never run into the caption.
 */
function FrameGuide(props: { readonly frame: VizFrameProps; readonly plot: FramePlotBox; readonly width: number; readonly height: number; readonly floor: number }): JSX.Element {
  const { frame, plot, floor } = props;
  const domain = frame.domain ?? {};
  const room = Math.max(0, floor - plot.bottom - 12 - (frame.x?.label === undefined ? 0 : AXIS_LABEL_ROOM));
  // x runs left→right; y runs bottom→top (a value grows upwards), which is the only difference between them
  const xTicks = frame.x === undefined ? [] : axisTicks(frame.x, domain.categories, domain.x, plot.left, plot.right, room, curveOf(frame.x, domain.transform?.x));
  const yTicks = frame.y === undefined ? [] : axisTicks(frame.y, undefined, domain.y, plot.bottom, plot.top, 0, curveOf(frame.y, domain.transform?.y));
  return (
    <svg className="vzf-chart vzf-frame-guide" viewBox={`0 0 ${props.width} ${props.height}`} aria-hidden="true">
      {frame.x !== undefined && <line className="vzf-axis" x1={plot.left} y1={plot.bottom} x2={plot.right} y2={plot.bottom} />}
      {frame.y !== undefined && <line className="vzf-axis" x1={plot.left} y1={plot.top} x2={plot.left} y2={plot.bottom} />}
      {xTicks.map((tick) => (
        <g key={`x:${tick.text}:${tick.at}`}>
          <line className="vzf-axis" x1={tick.at} y1={plot.bottom} x2={tick.at} y2={plot.bottom + 4} />
          {tick.rotate ? (
            <text className="vzf-tick" x={tick.at} y={plot.bottom + 12} textAnchor="end" transform={`rotate(-40 ${String(tick.at)} ${String(plot.bottom + 12)})`}>
              {tick.full === undefined ? null : <title>{tick.full}</title>}
              {tick.text}
            </text>
          ) : (
            // a FLAT label is always the whole label: `fitTick` clips only what it slants
            <text className="vzf-tick" x={tick.at} y={plot.bottom + 16} textAnchor="middle">
              {tick.text}
            </text>
          )}
        </g>
      ))}
      {yTicks.map((tick) => (
        <g key={`y:${tick.text}:${tick.at}`}>
          <line className="vzf-axis" x1={plot.left - 4} y1={tick.at} x2={plot.left} y2={tick.at} />
          <text className="vzf-tick" x={plot.left - 8} y={tick.at + 3} textAnchor="end">
            {tick.text}
          </text>
        </g>
      ))}
      {frame.x?.label === undefined ? null : (
        <text className="vzf-tick vzf-frame-axislabel" x={(plot.left + plot.right) / 2} y={floor - 8} textAnchor="middle">
          {frame.x.label}
        </text>
      )}
      {frame.y?.label === undefined ? null : (
        <text className="vzf-tick vzf-frame-axislabel" x={14} y={(plot.top + plot.bottom) / 2} textAnchor="middle" transform={`rotate(-90 14 ${String((plot.top + plot.bottom) / 2)})`}>
          {frame.y.label}
        </text>
      )}
    </svg>
  );
}

/** What the frame decided for one layer's guide: none (the frame's), its own pair (a single layer), or its own y on one edge (the two-axis figure). */
type LayerGuide = { readonly axes: false } | { readonly axes: true } | { readonly axes: 'y'; readonly axisSide: AxisSide };

/** The two edges, in the order own-y layers take them: the first on the left, the second on the right. A third goes round again to the left — visible, never hidden (it is refused upstream, in words). */
const SIDES: readonly AxisSide[] = ['left', 'right'];

/**
 * WHO DRAWS WHICH AXIS, per layer, in declaration order — the ONE place this
 * component decides it. Merged: nobody but the frame. Per-layer on a single
 * layer: that layer, both axes (unchanged from before sides existed). Per-layer
 * on two or more: the frame draws what it was given (x, once), and each own-y
 * layer draws only its y, on the next free edge.
 */
function layerGuides(layers: readonly VizFrameLayer[], guide: 'merged' | 'per-layer'): readonly LayerGuide[] {
  if (guide === 'merged') return layers.map(() => ({ axes: false }));
  if (layers.length === 1) return [{ axes: true }];
  let taken = 0;
  return layers.map((layer) => (layer.ownY === true ? { axes: 'y', axisSide: SIDES[taken++ % SIDES.length]! } : { axes: false }));
}

/** A layer's margin as it will draw it: its kind's pad, mirrored when its own y stands on the right (`padOnSide` — the chart reads the same). */
function layerPad(layer: VizFrameLayer, decided: LayerGuide): FramePad {
  return padOnSide(FRAME_PADS[layer.kind], decided.axes === 'y' ? decided.axisSide : undefined);
}

/**
 * The stack. One box, the guide (when it is the frame's — merged, or the x of
 * a two-axis frame), then every layer in declaration order — later layers
 * paint over earlier ones, which is the paint order the def declared — and the
 * caption strip beneath when the frame has words.
 */
export function VizFrame(props: VizFrameProps): JSX.Element {
  const { layers, width = 520, height = 340, guide = 'merged', words } = props;
  const guides = layerGuides(layers, guide);
  // THE MARGIN UNION, with a right pad only when a right axis is drawn and a caption strip only when
  // there are words — so a frame with neither keeps the plot rectangle it always had
  const union = unionPads(layers.map((layer, i) => layerPad(layer, guides[i]!)));
  // the caption strip is BELOW the margin: the guide's floor is its top, so the x label and slant room stay above it
  const floor = words === undefined ? height : height - CAPTION_ROOM;
  const pad = words === undefined ? union : { ...union, b: union.b + CAPTION_ROOM };
  const plot = framePlotBox(pad, width, height);
  // the frame's own guide is drawn whenever it has one to draw: merged, or a two-or-more-layer stack whose x it draws once
  const frameGuide = guide === 'merged' || layers.length > 1;
  const name = props.ariaLabel ?? `${String(layers.length)} layers on one frame`;
  return (
    <div
      className={`vzf-frame${props.className === undefined ? '' : ' ' + props.className}`}
      style={{ position: 'relative', width, height }}
      role="group"
      aria-label={words === undefined ? name : `${name} — ${words}`}
      data-vzf="frame"
    >
      {frameGuide ? <FrameGuide frame={props} plot={plot} width={width} height={height} floor={floor} /> : null}
      {layers.map((layer, i) => {
        const decided = guides[i]!;
        const box = frameLayerBox(layerPad(layer, decided), plot);
        return (
          // the BOTTOM layer keeps the pointer over its whole box (nothing is beneath it to reach), and every
          // layer above it takes the pointer only where it drew a mark — so a click on blank canvas lands on
          // the marks below instead of being swallowed by whichever layer is on top (styles.css).
          <div
            key={layer.layerId}
            className={`vzf-frame-layer ${i === 0 ? 'vzf-frame-base' : 'vzf-frame-over'}`}
            data-layer={layer.layerId}
            style={{ position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height }}
          >
            {layer.render({ width: box.width, height: box.height, domain: props.domain ?? {}, ...decided })}
          </div>
        );
      })}
      {words === undefined ? null : (
        // the caption strip: inside the frame's height, beneath the x axis label, spanning the plot — the
        // words a sighted reader meets; the accessible label above carries the same sentence
        <p className="vzf-frame-caption vzf-chart-caption" role="note" style={{ position: 'absolute', left: plot.left, width: plot.right - plot.left, bottom: 0, height: CAPTION_ROOM, margin: 0, overflow: 'hidden', lineHeight: 1.35 }}>
          {words}
        </p>
      )}
    </div>
  );
}
