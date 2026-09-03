/**
 * The rail's width is FIXED by the header; the bars share it. One commit
 * fills the rail, two take half each, four a quarter each — no upper limit.
 * Ids hide under 18px, no bar goes under 6px (past that the rail scrolls),
 * and a bar is never dropped.
 */
import { describe, expect, it } from 'vitest';
import { railTick, railScope, TICK_UNMEASURED, TICK_MIN, TICK_LABELLED } from './rail.js';

describe('railTick', () => {
  it('N commits share the fixed rail: one fills it, two take half, four take a quarter — the gaps are the only difference', () => {
    expect(railTick(400, 1)).toEqual({ tick: 400, dense: false }); // one bar IS the rail — no gap to give away
    expect(railTick(400, 2)).toEqual({ tick: 198, dense: false }); // (400 - 1*4) / 2 = 198 → half each
    expect(railTick(400, 4)).toEqual({ tick: 97, dense: false }); // (400 - 3*4) / 4 = 97 → a quarter each
    expect(railTick(400, 8)).toEqual({ tick: 46, dense: false }); // (400 - 7*4) / 8 = 46.5 → 46, an eighth each
    // the bars always add back up to the rail (bars + gaps), which is why the rail never grows
    expect(2 * 198 + 1 * 4).toBe(400);
    expect(4 * 97 + 3 * 4).toBe(400);
  });

  it('there is NO upper clamp — a wide rail with few commits gives each of them a wide bar', () => {
    expect(railTick(1200, 1).tick).toBe(1200);
    expect(railTick(1200, 3).tick).toBe(397); // (1200 - 8) / 3 = 397.3 → 397
    expect(railTick(600, 5).tick).toBe(116); // (600 - 16) / 5 = 116.8 → 116, far past the old 28px cap
  });

  it('ids hide under 18px, and 6px is the floor past which the rail scrolls instead', () => {
    expect(railTick(440, 20)).toEqual({ tick: 18, dense: false }); // (440 - 76) / 20 = 18.2 → 18, exactly wide enough for an id
    expect(railTick(360, 20)).toEqual({ tick: 14, dense: true }); // (360 - 76) / 20 = 14.2 → 14, too narrow for an id
    expect(railTick(300, 200)).toEqual({ tick: TICK_MIN, dense: true }); // the share went under the floor — the bars hold 6px and the rail scrolls
    expect(railTick(100, 40)).toEqual({ tick: TICK_MIN, dense: true }); // the share is NEGATIVE here; the floor still answers 6px
    expect(TICK_MIN).toBeLessThan(TICK_LABELLED);
  });

  it('before layout (width 0) or with nothing to draw (count 0) the answer is the unmeasured placeholder, labelled', () => {
    expect(railTick(0, 40)).toEqual({ tick: TICK_UNMEASURED, dense: false });
    expect(railTick(500, 0)).toEqual({ tick: TICK_UNMEASURED, dense: false });
    expect(TICK_LABELLED).toBeLessThan(TICK_UNMEASURED); // the placeholder is a labelled width, so nothing flickers dense before the first measure
  });
});

// defect 4: a fork silently redrew the rail (53 bars → 11) with no sentence
// anywhere saying it was now showing ONE path of two.
describe('railScope — what the rail is showing, in words', () => {
  it('says how much of the story is on the rail, which path it is, and how many paths there are', () => {
    expect(railScope({ shown: 11, total: 53, pathName: 'work-2', pathCount: 2 })).toBe('11 of 53 steps · path “work-2” of 2');
  });

  it('falls back to "this path" when the story has not named one yet', () => {
    expect(railScope({ shown: 11, total: 53, pathCount: 2 })).toBe('11 of 53 steps · this path of 2');
    expect(railScope({ shown: 11, total: 53, pathName: '', pathCount: 2 })).toBe('11 of 53 steps · this path of 2');
  });

  it('one path with a step off the rail still says so; a single path drops the "of N"', () => {
    expect(railScope({ shown: 3, total: 5 })).toBe('3 of 5 steps · this path');
  });

  it('says NOTHING when the rail holds the whole story on the only path — a note always there stops being read', () => {
    expect(railScope({ shown: 53, total: 53 })).toBe(null);
    expect(railScope({ shown: 0, total: 0 })).toBe(null);
  });

  it('a second path is worth saying even when every step is on this one', () => {
    expect(railScope({ shown: 5, total: 5, pathName: 'main', pathCount: 2 })).toBe('5 of 5 steps · path “main” of 2');
  });

  // when the rail draws a lane the head is not on, NO bar can carry the head
  // mark — the sentence has to say where "now" went, or the mark a reader
  // navigates by has simply gone missing
  it('says where "now" is when the rail is drawing another lane', () => {
    expect(railScope({ shown: 3, total: 4, pathCount: 2, offLane: true })).toBe('3 of 4 steps · this path of 2 · now is on another path');
    // …even when this lane happens to hold every step of the story
    expect(railScope({ shown: 4, total: 4, offLane: true })).toBe('4 of 4 steps · this path · now is on another path');
  });
});
