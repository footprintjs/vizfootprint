/**
 * ONE AXIS: the line a scale stands on, its tick marks and their labels.
 *
 * WHY ONE PART. Seven charts and the frame each drew their own axis, so a
 * rule about labels reached only the charts someone remembered to change. An
 * axis is one job, and the known chart libraries give it one part: `d3-axis`
 * (`axisBottom`, `axisLeft`, `axisRight`), visx's `<Axis orientation>`, and
 * Observable Plot, where an axis is itself a mark.
 *
 * TICKS ARRIVE ALREADY PLACED. A tick is its `position` along the axis, in
 * pixels, and its `label`. `d3-axis` takes a scale and asks it for ticks;
 * here a number, a date and a band are placed by three different rules, and
 * which ticks to draw is the chart's choice (`./scales.ts`), so the chart
 * places them and this part draws what it is handed. (visx's tick renderer
 * receives its ticks the same way: a position and the formatted text.) It
 * never drops a tick it was given and never invents one.
 *
 * WHAT IT DOES TO A LABEL, and only when `labelBounds` says where the drawing
 * ends:
 *   - under a bottom axis, a level label centred on its tick is moved inside
 *     the drawing (`labelCentre`);
 *   - beside a left or right axis, a label wider than the room between the
 *     axis and the drawing's edge is squeezed into it, every character kept
 *     (`squeezedLength`).
 * With no `labelBounds` a label is drawn as written, wherever that puts it.
 * A tick that names its own `anchor`, or is `slanted`, is drawn as asked.
 *
 * It renders and nothing else: no state, no measuring, no data.
 */
import { labelCentre, squeezedLength, type LabelEdges } from './scales.js';
import { scaleHueStyle } from './scaleHue.js';

/** The side of the plot an axis stands on, in `d3-axis`'s words. */
export type AxisOrient = 'bottom' | 'left' | 'right';

/** One tick, already placed. */
export interface AxisTick {
  /** Where the tick stands along the axis, in pixels. */
  readonly position: number;
  /** The words drawn for it. */
  readonly label: string;
  /**
   * A bottom axis: which part of a level label stands on the tick. `middle`
   * (the default) is the one a `labelBounds` may move; `start` and `end` are
   * drawn exactly as asked, which is how the first and last label of an axis
   * are turned inward.
   */
  readonly anchor?: 'start' | 'middle' | 'end';
  /** A bottom axis: draw the label on the slant, ending at its tick, because it does not fit level. */
  readonly slanted?: boolean;
  /** The whole text, when `label` is a shortened form of it: shown on hover. */
  readonly title?: string;
}

/** The length of a tick mark, in pixels. */
const TICK_SIZE = 4;
/** A level bottom label's baseline this far below the line; a slanted one's end this far below it; a side label's near end this far from the line. */
const LABEL_OFFSET = { bottom: 16, slanted: 12, side: 8 } as const;
/** The slant of a label that does not fit level, in degrees. */
export const AXIS_LABEL_SLANT = 40;
/** How far below its tick's centre a side label's baseline sits, so the text reads as centred on the tick. */
const SIDE_LABEL_DROP = 3;

export interface AxisProps {
  readonly orient: AxisOrient;
  /** The ticks to draw, each already placed and labelled. All of them are drawn. */
  readonly ticks: readonly AxisTick[];
  /** Where the axis line stands across the plot: its y for a bottom axis, its x for a left or right one. */
  readonly at: number;
  /** The two ends of the axis line, in pixels along the axis. */
  readonly range: readonly [number, number];
  /**
   * The drawing's left and right edges `[min, max]`, in pixels: the bounds a
   * label must stay inside. Absent = labels are drawn as written and may
   * leave the drawing.
   */
  readonly labelBounds?: LabelEdges;
  /** The hue of this axis's scale, when a two-scale frame handed its layer one. Absent = the ink token. */
  readonly hue?: string;
}

export function Axis(props: AxisProps): JSX.Element {
  const { orient, ticks, at, range, labelBounds } = props;
  // THE INK OF THIS SCALE goes on the line and on each tick, the elements the stylesheet paints with it
  // (`scaleHueStyle`); with no hue nothing is written at all
  const hue = scaleHueStyle(props.hue);
  if (orient === 'bottom') {
    return (
      <g className="vzf-axis-part" data-axis-orient={orient}>
        <line className="vzf-axis" x1={range[0]} y1={at} x2={range[1]} y2={at} style={hue} />
        {ticks.map((tick, i) => {
          const anchor = tick.anchor ?? 'middle';
          return (
            <g key={i} style={hue}>
              <line className="vzf-axis" x1={tick.position} y1={at} x2={tick.position} y2={at + TICK_SIZE} />
              {tick.slanted === true ? (
                <text className="vzf-tick" x={tick.position} y={at + LABEL_OFFSET.slanted} textAnchor="end" transform={`rotate(-${String(AXIS_LABEL_SLANT)} ${String(tick.position)} ${String(at + LABEL_OFFSET.slanted)})`}>
                  {tick.title === undefined ? null : <title>{tick.title}</title>}
                  {tick.label}
                </text>
              ) : (
                <text className="vzf-tick" x={anchor === 'middle' ? labelCentre(tick.position, tick.label, labelBounds) : tick.position} y={at + LABEL_OFFSET.bottom} textAnchor={anchor}>
                  {tick.title === undefined ? null : <title>{tick.title}</title>}
                  {tick.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  }
  // a side axis reads AWAY from the plot: marks and labels go left of a left axis, right of a right one
  const away = orient === 'right' ? 1 : -1;
  // the room a label has between where it is anchored and the edge of the drawing on its side
  const room = labelBounds === undefined ? undefined : (orient === 'right' ? labelBounds[1] - at : at - labelBounds[0]) - LABEL_OFFSET.side;
  return (
    <g className="vzf-axis-part" data-axis-orient={orient}>
      <line className="vzf-axis" x1={at} y1={range[0]} x2={at} y2={range[1]} style={hue} />
      {ticks.map((tick, i) => (
        <g key={i} style={hue}>
          <line className="vzf-axis" x1={at + TICK_SIZE * away} y1={tick.position} x2={at} y2={tick.position} />
          <text
            className="vzf-tick"
            x={at + LABEL_OFFSET.side * away}
            y={tick.position + SIDE_LABEL_DROP}
            textAnchor={away < 0 ? 'end' : 'start'}
            textLength={room === undefined ? undefined : squeezedLength(tick.label, room)}
            lengthAdjust="spacingAndGlyphs"
          >
            {tick.title === undefined ? null : <title>{tick.title}</title>}
            {tick.label}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Place value ticks through a scale: the usual way a chart turns its tick values into `AxisTick`s. */
export function placeTicks(ticks: readonly { readonly value: number; readonly label: string }[], scale: (value: number) => number): AxisTick[] {
  return ticks.map((tick) => ({ position: scale(tick.value), label: tick.label }));
}
