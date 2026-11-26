/**
 * ONE AXIS: the line a scale stands on, its tick marks and their labels.
 *
 * WHY ONE PART. Seven charts and the frame each drew their own axis, so a
 * rule about labels reached only the charts someone remembered to change. An
 * axis is one job, and the known chart libraries give it one part: `d3-axis`
 * (`axisBottom`, `axisLeft`, `axisRight`), visx's `<Axis orientation scale>`,
 * and Observable Plot, where an axis is itself a mark. The names here are
 * theirs: `orient`, `scale`, `ticks`.
 *
 * WHAT IT DOES NOT DECIDE. Which ticks to draw is the caller's choice (the
 * tick rules are in `./scales.ts`), so this part never drops a tick it was
 * given and never invents one. It only places what it is handed:
 *   - a label under a bottom axis stays inside the drawing (`labelCentre`);
 *   - a label beside a left or right axis is drawn whole, squeezed into the
 *     room it has when it is wider than that room (`squeezedLength`).
 *
 * Both are the caller's to switch on: with no `edges` and no `labelRoom` given
 * a label is drawn as written, wherever that puts it.
 *
 * NOT SETTLED YET, and free to change while three axes use it: the prop names
 * (`ticks` here holds values with their labels; in D3 and Plot the word means
 * a count), and how a band, a date or a slanted label is handed over. Those
 * are decided when the bar and the date axes move here.
 *
 * It renders and nothing else: no state, no measuring, no data.
 */
import { labelCentre, squeezedLength, type LabelEdges, type RoundTick } from './scales.js';
import { scaleHueStyle } from './scaleHue.js';

/** The side of the plot an axis stands on, in `d3-axis`'s words. */
export type AxisOrient = 'bottom' | 'left' | 'right';

/** The length of a tick mark, and how far a label stands from the axis line, in pixels. */
const TICK_SIZE = 4;
/** A bottom label's baseline this far below the line; a side label's near end this far from it. */
const LABEL_OFFSET = { bottom: 16, side: 8 } as const;
/** How far below its tick's centre a side label's baseline sits, so the text reads as centred on the tick. */
const SIDE_LABEL_DROP = 3;

export interface AxisProps {
  readonly orient: AxisOrient;
  /** Where a value is drawn along the axis, in pixels. */
  readonly scale: (value: number) => number;
  /** The ticks to draw, each with its label. All of them are drawn. */
  readonly ticks: readonly RoundTick[];
  /** Where the axis line stands across the plot: its y for a bottom axis, its x for a left or right one. */
  readonly at: number;
  /** The two ends of the axis line, in pixels along the axis. */
  readonly range: readonly [number, number];
  /** A bottom axis only: the drawing's left and right edges `[min, max]`, which a label stays between. Absent = labels are centred under their ticks and may leave the drawing. */
  readonly edges?: LabelEdges;
  /** A left or right axis only: the room a label has between its anchor and the edge of the drawing. Absent, or not above zero = labels are drawn as written and may leave the drawing. */
  readonly labelRoom?: number;
  /** The hue of this axis's scale, when a two-scale frame handed its layer one. Absent = the ink token. */
  readonly hue?: string;
}

export function Axis(props: AxisProps): JSX.Element {
  const { orient, scale, ticks, at, range, edges, labelRoom } = props;
  // THE INK OF THIS SCALE goes on the line and on each tick, the elements the stylesheet paints with it
  // (`scaleHueStyle`); with no hue nothing is written at all
  const hue = scaleHueStyle(props.hue);
  if (orient === 'bottom') {
    return (
      <g className="vzf-axis-part" data-axis-orient={orient}>
        <line className="vzf-axis" x1={range[0]} y1={at} x2={range[1]} y2={at} style={hue} />
        {ticks.map((tick, i) => (
          <g key={i} style={hue}>
            <line className="vzf-axis" x1={scale(tick.value)} y1={at} x2={scale(tick.value)} y2={at + TICK_SIZE} />
            <text className="vzf-tick" x={labelCentre(scale(tick.value), tick.label, edges)} y={at + LABEL_OFFSET.bottom} textAnchor="middle">
              {tick.label}
            </text>
          </g>
        ))}
      </g>
    );
  }
  // a side axis reads AWAY from the plot: marks and labels go left of a left axis, right of a right one
  const away = orient === 'right' ? 1 : -1;
  return (
    <g className="vzf-axis-part" data-axis-orient={orient}>
      <line className="vzf-axis" x1={at} y1={range[0]} x2={at} y2={range[1]} style={hue} />
      {ticks.map((tick, i) => (
        <g key={i} style={hue}>
          <line className="vzf-axis" x1={at + TICK_SIZE * away} y1={scale(tick.value)} x2={at} y2={scale(tick.value)} />
          <text
            className="vzf-tick"
            x={at + LABEL_OFFSET.side * away}
            y={scale(tick.value) + SIDE_LABEL_DROP}
            textAnchor={away < 0 ? 'end' : 'start'}
            textLength={labelRoom === undefined ? undefined : squeezedLength(tick.label, labelRoom)}
            lengthAdjust="spacingAndGlyphs"
          >
            {tick.label}
          </text>
        </g>
      ))}
    </g>
  );
}
