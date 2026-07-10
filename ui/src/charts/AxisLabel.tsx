/**
 * An interactive axis label (SVG): hovering/focusing shows a dashed affordance
 * ring, and click / Enter / Space opens the encoding picker for its channel.
 * Honest affordance — the label LOOKS actionable because it is.
 */
import type { KeyboardEvent } from 'react';

export interface AxisLabelProps {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly channel: string;
  readonly anchor?: 'start' | 'middle' | 'end';
  /** Approx label box (viewBox units) for the affordance ring + hit area. */
  readonly boxWidth?: number;
  readonly boxHeight?: number;
  readonly onOpen: (channel: string) => void;
}

export function AxisLabel(props: AxisLabelProps): JSX.Element {
  const { x, y, text, channel, anchor = 'middle', boxWidth = Math.max(60, text.length * 7 + 24), boxHeight = 18, onOpen } = props;
  const bx = anchor === 'middle' ? x - boxWidth / 2 : anchor === 'end' ? x - boxWidth : x;
  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(channel);
    }
  };
  return (
    <g
      className="vzf-axis-group"
      role="button"
      tabIndex={0}
      aria-label={`Encode the ${channel} axis (currently ${text})`}
      data-axis-channel={channel}
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
