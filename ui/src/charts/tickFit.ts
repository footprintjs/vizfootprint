/**
 * TICK FITTING — what to do when a category label is wider than its band.
 *
 * A bar chart with fifteen long categories in a narrow panel used to draw
 * every label on top of its neighbours. The fix is a pure decision: a label
 * that fits its band stays horizontal and whole; one that does not is drawn
 * on a slant, and clipped with an ellipsis to the room beneath the axis
 * (the full text goes in a `<title>` so hover still names it). The chart
 * asks the same question of its value labels and simply omits the ones that
 * would collide — a number that cannot be read is worse than none.
 */

/** Pixels one tick character occupies (`.vzf-tick` is 10px monospace ≈ 6px advance). */
export const TICK_CHAR_PX = 6;
/** Pixels one value-label character occupies (`.vzf-barval` is 11px monospace ≈ 6.6px advance). */
export const VALUE_CHAR_PX = 6.6;
/** The slant, in degrees, for labels that do not fit horizontally. */
export const TICK_ANGLE = 40;

export interface TickFit {
  /** Draw the label on the slant (anchored at its end) rather than flat. */
  readonly rotate: boolean;
  /** The text to draw — the label, or its head plus an ellipsis. */
  readonly text: string;
  /** True when `text` is not the whole label. */
  readonly clipped: boolean;
}

/** Whether `text` fits inside `band` pixels (at tick size unless `charPx` says otherwise). */
export function fitsBand(text: string, band: number, charPx: number = TICK_CHAR_PX): boolean {
  return text.length * charPx <= band;
}

/**
 * Fit `label` into a band `band` px wide with `room` px of vertical room
 * beneath the axis and `leftRoom` px between the tick and the chart's left
 * edge. Flat and whole when it fits; otherwise slanted, and clipped to what
 * the slant can hold within BOTH rooms — a slanted label runs down AND left,
 * and the leftmost tick has the least room to its left.
 */
export function fitTick(label: string, band: number, room: number, leftRoom: number = Infinity): TickFit {
  if (fitsBand(label, band)) return { rotate: false, text: label, clipped: false };
  const rad = (TICK_ANGLE * Math.PI) / 180;
  const slantPx = Math.min(room / Math.sin(rad), leftRoom / Math.cos(rad));
  const max = Math.max(1, Math.floor(slantPx / TICK_CHAR_PX));
  if (label.length <= max) return { rotate: true, text: label, clipped: false };
  return { rotate: true, text: `${label.slice(0, Math.max(1, max - 1))}…`, clipped: true };
}
