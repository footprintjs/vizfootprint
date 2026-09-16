/**
 * An interactive axis label (SVG): hovering/focusing shows a dashed affordance
 * ring, and click / Enter / Space opens the encoding picker for its channel.
 * Honest affordance — the label LOOKS actionable because it is.
 *
 * With a `hue` it wears its SCALE's ink (one edge of a two-scale frame,
 * `scaleHueStyle`); the ring and the hover cue stay the brand's either way,
 * because they are about the click and not about the scale.
 */
import { keyActivates } from './pointSelect.js';
import { scaleHueStyle } from './scaleHue.js';

export interface AxisLabelProps {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly channel: string;
  readonly anchor?: 'start' | 'middle' | 'end';
  /** Approx label box (viewBox units) for the affordance ring + hit area. */
  readonly boxWidth?: number;
  readonly boxHeight?: number;
  /** Rotate the whole affordance around (x, y) — e.g. -90 for a vertical y-axis label. */
  readonly rotate?: number;
  /** The hue of the SCALE this label names, when a two-scale frame handed its layer one (`FrameLayerDraw.scaleHue`). Absent = the ink token it always wore. */
  readonly hue?: string;
  readonly onOpen: (channel: string) => void;
}

export function AxisLabel(props: AxisLabelProps): JSX.Element {
  const { x, y, text, channel, anchor = 'middle', boxWidth = Math.max(60, text.length * 7 + 24), boxHeight = 18, rotate, onOpen } = props;
  const bx = anchor === 'middle' ? x - boxWidth / 2 : anchor === 'end' ? x - boxWidth : x;
  const onKey = keyActivates<SVGGElement>(() => onOpen(channel));
  return (
    <g
      className="vzf-axis-group"
      role="button"
      tabIndex={0}
      aria-label={`Encode the ${channel} axis (currently ${text})`}
      data-axis-channel={channel}
      transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined}
      onClick={() => onOpen(channel)}
      onKeyDown={onKey}
      style={{ cursor: 'pointer', ...scaleHueStyle(props.hue) }}
    >
      <rect className="vzf-axis-affordance" x={bx} y={y - boxHeight + 3} width={boxWidth} height={boxHeight} rx={5} />
      <rect className="vzf-axis-hit" x={bx} y={y - boxHeight + 3} width={boxWidth} height={boxHeight} />
      <text className="vzf-axis-label" x={x} y={y} textAnchor={anchor}>
        {text}
        <tspan className="vzf-axis-caret" dx="6" aria-hidden="true">
          ⤢
        </tspan>
      </text>
    </g>
  );
}
