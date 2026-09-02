/**
 * The rail's ticks shrink as commits pile up: comfortable with room, narrower
 * as they accumulate, never under the minimum, ids hidden when dense — and
 * never a tick dropped.
 */
import { describe, expect, it } from 'vitest';
import { railTick, TICK_MAX, TICK_MIN, TICK_LABELLED } from './rail.js';

describe('railTick', () => {
  it('a few commits get comfortable ticks with ids; many share the width down to the minimum, ids hidden first', () => {
    expect(railTick(600, 5)).toEqual({ tick: TICK_MAX, dense: false }); // room to spare: capped at the comfortable width
    expect(railTick(300, 12)).toEqual({ tick: 21, dense: false }); // (300 - 11*4) / 12 = 21.3 → 21, still labelled
    expect(railTick(300, 20)).toEqual({ tick: 11, dense: true }); // (300 - 19*4) / 20 = 11.2 → 11, too narrow for an id
    expect(railTick(300, 200)).toEqual({ tick: TICK_MIN, dense: true }); // past the minimum the rail scrolls instead
    expect(TICK_MIN).toBeLessThan(TICK_LABELLED);
    expect(TICK_LABELLED).toBeLessThan(TICK_MAX);
  });
  it('with no width yet (before layout) or no commits, the ticks are comfortable and labelled', () => {
    expect(railTick(0, 40)).toEqual({ tick: TICK_MAX, dense: false });
    expect(railTick(500, 0)).toEqual({ tick: TICK_MAX, dense: false });
  });
});
