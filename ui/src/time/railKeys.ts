/**
 * THE RAIL'S KEYS — where a key press moves along a rail of bars.
 *
 * A rail is ONE stop in the tab order. Inside it the arrow keys walk the bars,
 * Home and End jump to the ends, and Enter or Space (the bar is a button) goes
 * to the bar the keyboard is on. Moving along the rail does not travel: a
 * person can read their way along a history without changing where they stand.
 *
 * Why not one tab stop per bar: a history of two hundred steps put two hundred
 * stops between the mode switch and the bookmark button.
 *
 * Data logic only: an index in, an index out. The component moves the focus.
 */

/** The keys a rail answers. Anything else is not the rail's. */
export type RailKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

const isRailKey = (key: string): key is RailKey => key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End';

/**
 * The bar a key moves to, by index, or `null` when the key is not the rail's,
 * the rail is empty, or `at` names no bar. The ends do not wrap: a rail is a
 * line with a first step and a last one, and stopping at an end says so.
 */
export function railKeyTarget(count: number, at: number, key: string): number | null {
  if (!isRailKey(key) || !Number.isInteger(count) || count <= 0 || !Number.isInteger(at) || at < 0 || at >= count) return null;
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, at - 1);
    case 'ArrowRight':
      return Math.min(count - 1, at + 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
  }
}
