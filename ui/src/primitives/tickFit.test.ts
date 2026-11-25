/**
 * A TICK LABEL IS SHOWN WHOLE, AND TWO LABELS DO NOT TOUCH.
 *
 * | the axis                                         | before                         | now                                      |
 * |--------------------------------------------------|--------------------------------|------------------------------------------|
 * | labels that fit                                  | all drawn                      | all drawn, the same array                |
 * | seven 13-character labels on a 360 px x axis     | six overlapping pairs          | every other one; first and last kept     |
 * | labels so long only two fit                      | a run of ink                   | the first and the last                   |
 * | y ticks closer than a line of text               | stacked on each other          | thinned by line height                   |
 * | a y label wider than the margin ("12345.0010")   | cut off: "345.0010"            | squeezed into the margin, every digit    |
 * | a y label that fits                              | as written                     | as written (no length set)               |
 * | one or two ticks; ticks on one spot              | —                              | left alone                               |
 */
import { describe, expect, it } from 'vitest';
import { TICK_CHAR_PX, TICK_GAP_PX, TICK_LINE_PX, roundTicks, squeezedLength, ticksThatFit, type RoundTick } from './scales.js';

const ticks = (labels: readonly string[]): RoundTick[] => labels.map((label, value) => ({ value, label }));
/** A scale that puts tick `i` at `i * step` pixels. */
const every = (step: number) => (value: number): number => value * step;
const said = (kept: readonly RoundTick[]): string[] => kept.map((t) => t.label);

describe('ticksThatFit — along a horizontal axis, by label width', () => {
  it('labels that fit are all kept, and it is the same array', () => {
    const all = ticks(['0', '200', '400', '600', '800', '1000']);
    expect(ticksThatFit(all, every(60), 'width')).toBe(all);
  });

  it('labels that would touch are thinned to every k-th, first and last kept', () => {
    const epoch = ticks(['1700000000000', '1700000010000', '1700000020000', '1700000030000', '1700000040000', '1700000050000', '1700000060000']);
    // 13 characters is 78 px, plus the gap; the ticks stand 60 px apart
    expect(13 * TICK_CHAR_PX + TICK_GAP_PX).toBeGreaterThan(60);
    expect(said(ticksThatFit(epoch, every(60), 'width'))).toEqual(['1700000000000', '1700000020000', '1700000040000', '1700000060000']);
  });

  it('the last tick is always kept; the kept tick it would crowd gives way', () => {
    // every 2nd of six is 0, 2, 4 — and 5 is the last: 4 would sit one step from it
    expect(said(ticksThatFit(ticks(['aaaaaaaa', 'b', 'c', 'd', 'e', 'ffffffff']), every(40), 'width'))).toEqual(['aaaaaaaa', 'c', 'ffffffff']);
    // every 3rd of five is 0, 3 — and 4 is the last: 3 gives way
    expect(said(ticksThatFit(ticks(['aaaaaaaaaaaaaaaa', 'b', 'c', 'd', 'eeeeeeeeeeeeeeee']), every(40), 'width'))).toEqual(['aaaaaaaaaaaaaaaa', 'eeeeeeeeeeeeeeee']);
  });

  it('labels so long that only two fit: the first and the last', () => {
    const long = ticks(['x'.repeat(40), 'b', 'c', 'd', 'x'.repeat(40)]);
    expect(said(ticksThatFit(long, every(30), 'width'))).toEqual(['x'.repeat(40), 'x'.repeat(40)]);
  });

  it('whatever is kept, no two kept labels touch (2,000 generated axes)', () => {
    let seed = 7;
    const random = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 2000; run++) {
      const count = 3 + Math.floor(random() * 12);
      const width = 1 + Math.floor(random() * 16);
      const all = ticks(Array.from({ length: count }, (_, i) => String(i).padStart(width, '9')));
      const step = 5 + random() * 120;
      const kept = ticksThatFit(all, every(step), 'width');
      expect(kept[0]).toBe(all[0]);
      expect(kept.at(-1)).toBe(all.at(-1));
      const need = width * TICK_CHAR_PX + TICK_GAP_PX;
      for (let i = 1; i < kept.length; i++) {
        const apart = (kept[i]!.value - kept[i - 1]!.value) * step;
        // only the first and last may stand closer than a label when nothing else is left between them
        if (kept.length > 2) expect(apart, `${count} ticks, ${width} chars, ${step}px`).toBeGreaterThanOrEqual(need - 1e-9);
      }
    }
  });
});

describe('ticksThatFit — along a vertical axis, by line height', () => {
  it('ticks further apart than a line of text are all kept', () => {
    const all = ticks(['0', '1', '2', '3']);
    expect(ticksThatFit(all, every(TICK_LINE_PX + TICK_GAP_PX), 'height')).toBe(all);
  });

  it('ticks closer than a line of text are thinned, whatever their labels say', () => {
    expect(said(ticksThatFit(ticks(['0', '1', '2', '3', '4', '5', '6']), every(8), 'height'))).toEqual(['0', '2', '4', '6']);
  });

  it('a scale that runs the other way (a y axis grows upward) thins the same', () => {
    expect(said(ticksThatFit(ticks(['0', '1', '2', '3', '4', '5', '6']), (v) => 200 - v * 8, 'height'))).toEqual(['0', '2', '4', '6']);
  });
});

describe('ticksThatFit — what it leaves alone', () => {
  it('one or two ticks, and ticks that all stand on one spot', () => {
    const two = ticks(['x'.repeat(50), 'y'.repeat(50)]);
    expect(ticksThatFit(two, every(1), 'width')).toBe(two);
    const one = ticks(['a']);
    expect(ticksThatFit(one, every(1), 'width')).toBe(one);
    const stacked = ticks(['a', 'b', 'c']);
    expect(ticksThatFit(stacked, () => 5, 'width')).toBe(stacked);
    expect(ticksThatFit(stacked, () => Number.NaN, 'width')).toBe(stacked);
    expect(ticksThatFit([], every(1), 'width')).toEqual([]);
  });

  it('real ticks through a real span', () => {
    const real = roundTicks(1.7e12, 1.7e12 + 60_000, 5);
    const kept = ticksThatFit(real, (v) => ((v - 1.7e12) / 60_000) * 360, 'width');
    expect(said(kept)).toEqual(['1700000000000', '1700000020000', '1700000040000', '1700000060000']);
  });
});

describe('squeezedLength — a label is shown whole', () => {
  it('a label that fits is drawn as written', () => {
    expect(squeezedLength('-3.710M', 44)).toBeUndefined();
    expect(squeezedLength('0', 44)).toBeUndefined();
    expect(squeezedLength('1234567', 42)).toBeUndefined(); // exactly the room
  });

  it('a label wider than its room is squeezed to the room', () => {
    expect(squeezedLength('12345.0010', 44)).toBe(44);
    expect(squeezedLength('10.000000M', 44)).toBe(44);
  });

  it('no room to judge by: left as written', () => {
    expect(squeezedLength('12345.0010', 0)).toBeUndefined();
    expect(squeezedLength('12345.0010', -8)).toBeUndefined();
  });
});
