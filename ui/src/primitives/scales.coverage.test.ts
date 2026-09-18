import { describe, it, expect } from 'vitest';
import { linearScale, extent, ticks, slotsCovered, valuesCovered, noValuesCoveredNote, noSlotsCoveredNote } from './scales.js';

describe('linearScale', () => {
  it('maps domain to range and inverts back', () => {
    const s = linearScale(0, 10, 100, 200);
    expect(s(0)).toBe(100);
    expect(s(10)).toBe(200);
    expect(s(5)).toBe(150);
    expect(s.invert(150)).toBe(5);
    expect(s.domain).toEqual([0, 10]);
    expect(s.range).toEqual([100, 200]);
  });

  it('falls back to a divisor of 1 when the domain is degenerate (d0 === d1)', () => {
    // (r1 - r0) / (d1 - d0 || 1) — d1-d0 is 0 (falsy), so the scale must use
    // the `|| 1` fallback rather than dividing by zero.
    const s = linearScale(5, 5, 0, 100);
    expect(Number.isFinite(s(5))).toBe(true);
    expect(s(5)).toBe(0); // r0 + (5-5)*100 = 0
    expect(s(6)).toBe(100); // r0 + (6-5)*100 = 100 (slope is exactly 100, not Infinity)
  });
});

describe('extent', () => {
  it('returns a padded default domain for an empty row set', () => {
    expect(extent([], (d: { v: number }) => d.v, 5)).toEqual([-5, 6]);
    expect(extent([], (d: { v: number }) => d.v)).toEqual([0, 1]);
  });

  it('returns a padded default domain when every accessed value is non-finite', () => {
    // NaN fails every `<`/`>` comparison, so lo/hi never move off their
    // Infinity/-Infinity seeds — the isFinite guard must catch that.
    const rows = [{ v: NaN }, { v: NaN }];
    expect(extent(rows, (d) => d.v, 2)).toEqual([-2, 3]);
  });

  it('pads a degenerate (all-equal) extent so lo !== hi', () => {
    expect(extent([{ v: 5 }], (d: { v: number }) => d.v, 1)).toEqual([3, 7]);
    expect(extent([{ v: 5 }, { v: 5 }], (d: { v: number }) => d.v)).toEqual([4, 6]);
  });

  it('returns the true [min, max] padded by `pad` for a normal spread', () => {
    const rows = [{ v: 3 }, { v: 9 }, { v: -1 }];
    expect(extent(rows, (d) => d.v, 1)).toEqual([-2, 10]);
  });
});

describe('ticks', () => {
  it('produces n+1 evenly-spaced values across [lo, hi]', () => {
    expect(ticks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });
});

/**
 * `slotsCovered` — the ONE owner of "which slots does this pixel range cover"
 * (law 13, the band brush). A slot is covered when its CENTRE is in the range,
 * because the centre is where the mark stands.
 */
describe('slotsCovered', () => {
  // 3 slots over [0, 300]: width 100, centres at 50 / 150 / 250
  it('covers a slot when the range crosses its centre, and no slot when it crosses none', () => {
    expect(slotsCovered(0, 300, 3, 40, 160)).toEqual([0, 1]);
    expect(slotsCovered(0, 300, 3, 0, 300)).toEqual([0, 1, 2]);
    // between two centres: nothing is covered, and an empty answer is an ANSWER
    expect(slotsCovered(0, 300, 3, 160, 240)).toEqual([]);
  });

  it('is CLOSED at both ends — a range that ends exactly on a centre covers that slot', () => {
    expect(slotsCovered(0, 300, 3, 50, 150)).toEqual([0, 1]);
    expect(slotsCovered(0, 300, 3, 250, 260)).toEqual([2]);
  });

  it('is order-insensitive: a right-to-left range is the same set, in the BAND’s order', () => {
    expect(slotsCovered(0, 300, 3, 260, 40)).toEqual([0, 1, 2]);
    expect(slotsCovered(0, 300, 3, 160, 40)).toEqual(slotsCovered(0, 300, 3, 40, 160));
  });

  it('an EMPTY band has no slot to cover, whatever the range', () => {
    expect(slotsCovered(0, 300, 0, 0, 300)).toEqual([]);
  });

  it('slots narrower than a pixel are still slots — the answer names every one the range crossed', () => {
    // 1000 slots over [0, 300] is 0.3 each: a 3-unit range crosses 10 of them
    expect(slotsCovered(0, 300, 1000, 100, 103)).toHaveLength(10);
  });
});

/**
 * `valuesCovered` — {@link slotsCovered}'s twin for a RUN OF NUMBERS (the
 * numeric brush), asked in DATA space. Same three laws: closed at both ends,
 * order-free in its bounds, and an EMPTY answer is an answer.
 */
describe('valuesCovered', () => {
  const RESIDUES = [101, 104, 107, 112, 241];

  it('names the values inside the span, in the order it was GIVEN (the axis\u2019s, never the pointer\u2019s)', () => {
    expect(valuesCovered(RESIDUES, 103, 113)).toEqual([104, 107, 112]);
    expect(valuesCovered(RESIDUES, 0, 1000)).toEqual(RESIDUES);
  });

  it('is CLOSED at both ends — a span that ends exactly on a value covers it', () => {
    expect(valuesCovered(RESIDUES, 104, 107)).toEqual([104, 107]);
    expect(valuesCovered(RESIDUES, 241, 241)).toEqual([241]);
  });

  it('is order-insensitive: a right-to-left span is the same answer', () => {
    expect(valuesCovered(RESIDUES, 113, 103)).toEqual(valuesCovered(RESIDUES, 103, 113));
  });

  it('a span over no value at all answers NOTHING — and that is the answer a chart says out loud', () => {
    expect(valuesCovered(RESIDUES, 113, 240)).toEqual([]);
    expect(valuesCovered([], 0, 1)).toEqual([]);
  });

  it('the words for it are a RUN\u2019s, not a band\u2019s — one owner each, and neither borrows the other\u2019s vocabulary', () => {
    expect(noValuesCoveredNote()).toBe('a drag selects the values its span covers — this one covered none, so nothing was selected');
    expect(noValuesCoveredNote()).not.toBe(noSlotsCoveredNote());
  });
});
