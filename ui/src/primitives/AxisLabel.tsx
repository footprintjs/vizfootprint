/**
 * An interactive axis label (SVG): hovering/focusing shows a dashed affordance
 * ring, and click / Enter / Space opens the encoding picker for its channel.
 * Honest affordance — the label LOOKS actionable because it is.
 */
import { keyActivates } from './pointSelect.js';

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
      style={{ cursor: 'pointer' }}
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
