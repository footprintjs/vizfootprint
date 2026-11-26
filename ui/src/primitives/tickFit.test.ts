/**
 * A TICK LABEL IS SHOWN WHOLE, AND TWO LABELS DO NOT TOUCH — done the way the
 * known chart libraries do it.
 *
 * | the axis                                        | the rule, and whose it is                                   | what is drawn                               |
 * |-------------------------------------------------|-------------------------------------------------------------|---------------------------------------------|
 * | linear, labels fit                              | —                                                           | the ticks `roundTicks` gives for the target |
 * | linear, labels would touch                      | fewer ticks = a coarser round step (D3 `ticks(count)`)      | multiples of 1, 2 or 5; never every k-th    |
 * | linear, zero inside the span                    | zero is a multiple of every step                            | "0" is always among the labels              |
 * | linear, even the coarsest step touches          | the scan below                                              | what fits; at least the first and the last  |
 * | logarithmic (ticks crowd at one end)            | walk and keep what fits (Vega `labelOverlap: 'greedy'`)     | every label that has room, by its own width |
 * | an x label that would cross the drawing's edge  | move it in (Highcharts `overflow: 'justify'`, Vega flush)   | whole, ending at the edge                   |
 * | y ticks closer than a line of text              | the same rules, by line height                              | no two stacked                              |
 * | a y label wider than the margin                 | squeezed (`squeezedLength`)                                 | every digit                                 |
 * | one or two ticks; places that are not numbers   | —                                                           | left alone                                  |
 */
import { describe, expect, it } from 'vitest';
import { TICK_CHAR_PX, TICK_GAP_PX, TICK_LINE_PX, labelCentre, labelsFit, linearScale, logScale, logTickLabel, logTicks, roundTicks, roundTicksThatFit, squeezedLength, ticksThatFit, type RoundTick } from './scales.js';

const ticks = (labels: readonly string[]): RoundTick[] => labels.map((label, value) => ({ value, label }));
/** A scale that puts tick `i` at `i * step` pixels. */
const every = (step: number) => (value: number): number => value * step;
const said = (kept: readonly RoundTick[]): string[] => kept.map((t) => t.label);
const random = (seed: number) => (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

/** An independent measure: how many neighbouring kept labels stand closer than the gap, each by its own width. */
function touching(kept: readonly RoundTick[], place: (v: number) => number, along: 'width' | 'height'): number {
  const half = (t: RoundTick): number => (along === 'height' ? TICK_LINE_PX : t.label.length * TICK_CHAR_PX) / 2;
  let pairs = 0;
  for (let i = 1; i < kept.length; i++) {
    const [a, b] = [kept[i - 1]!, kept[i]!];
    if (Math.abs(place(b.value) - place(a.value)) - half(a) - half(b) < TICK_GAP_PX - 1e-9) pairs += 1;
  }
  return pairs;
}

describe('labelCentre — an x label stays inside the drawing', () => {
  it('a label with room is centred under its tick', () => {
    expect(labelCentre(200, '0.5', [0, 420])).toBe(200);
    expect(labelCentre(200, '0.5')).toBe(200);
  });

  it('a label that would cross the right edge is moved in until it ends at the edge', () => {
    // 13 characters are 78 px wide; centred at 402 it would end at 441 in a 420 px drawing
    expect(labelCentre(402, '1700000060000', [0, 420])).toBe(420 - 39);
  });

  it('…and the same at the left edge', () => {
    expect(labelCentre(10, '1700000000000', [0, 420])).toBe(39);
  });

  it('a label wider than the whole drawing is centred in it', () => {
    expect(labelCentre(5, 'x'.repeat(40), [0, 100])).toBe(50);
  });

  it('with no edges given nothing moves, however wide the label', () => {
    expect(labelCentre(-500, 'x'.repeat(40))).toBe(-500);
  });
});

describe('labelsFit — each label by its own width', () => {
  it('a long label beside a short one needs half of each, not the longest twice', () => {
    // "aaaaaaaa" is 48 px, "b" is 6 px: centres 31 px apart leave exactly the 4 px gap
    const pair = [{ value: 0, label: 'aaaaaaaa' }, { value: 1, label: 'b' }];
    expect(labelsFit(pair, every(31), 'width')).toBe(true);
    expect(labelsFit(pair, every(30), 'width')).toBe(false);
  });

  it('a vertical axis is judged by a line of text', () => {
    expect(labelsFit(ticks(['0', '1']), every(TICK_LINE_PX + TICK_GAP_PX), 'height')).toBe(true);
    expect(labelsFit(ticks(['0', '1']), every(TICK_LINE_PX + TICK_GAP_PX - 1), 'height')).toBe(false);
  });

  it('an end label moved in from the edge is judged where it is drawn', () => {
    // two 10-character labels (60 px each) at 0 and 60: centred they touch nothing wider than 0 px apart…
    const pair = [{ value: 0, label: '0123456789' }, { value: 1, label: '0123456789' }];
    expect(labelsFit(pair, every(64), 'width')).toBe(true);
    // …but inside [0, 64] the first is moved to 30 and the second to 34, so they overlap
    expect(labelsFit(pair, every(64), 'width', [0, 64])).toBe(false);
  });

  it('none or one label always fits', () => {
    expect(labelsFit([], every(1), 'width')).toBe(true);
    expect(labelsFit(ticks(['a']), every(1), 'width')).toBe(true);
  });
});

describe('roundTicksThatFit — fewer ticks is a coarser round step', () => {
  it('labels that fit: exactly the ticks asked for', () => {
    const place = linearScale(0, 1000, 0, 400);
    expect(roundTicksThatFit(0, 1000, 5, place, 'width')).toEqual(roundTicks(0, 1000, 5));
  });

  it('labels that would touch: the next round step, not every second label', () => {
    // 0 200 … 1000 on 60 px: six labels do not fit. Every second of them would be 0 400 800;
    // the coarser round step gives 0 500 1000.
    const place = linearScale(0, 1000, 0, 60);
    expect(said(roundTicksThatFit(0, 1000, 5, place, 'width'))).toEqual(['0', '500', '1000']);
  });

  it('zero keeps its label on a narrow signed axis', () => {
    const place = linearScale(-0.55, 0.55, 0, 70);
    const kept = said(roundTicksThatFit(-0.55, 0.55, 5, place, 'width'));
    expect(kept).toContain('0');
    expect(kept.length).toBeLessThan(5);
  });

  it('a vertical axis thins by line height, and runs upward', () => {
    const place = linearScale(0, 6, 60, 0);
    const kept = roundTicksThatFit(0, 6, 6, place, 'height');
    expect(said(kept)).toEqual(['0', '2', '4', '6']);
  });

  it('even one tick asked for does not fit: what the scan keeps, never fewer than it is given', () => {
    const place = linearScale(1.7e12, 1.7e12 + 60_000, 0, 30);
    const kept = roundTicksThatFit(1.7e12, 1.7e12 + 60_000, 5, place, 'width');
    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect(kept.length).toBeLessThanOrEqual(2);
  });

  it('a target that is not a whole number, or below one, still asks for at least one', () => {
    const place = linearScale(0, 10, 0, 400);
    expect(roundTicksThatFit(0, 10, 0, place, 'width')).toEqual(roundTicks(0, 10, 1));
    expect(roundTicksThatFit(0, 10, 4.9, place, 'width')).toEqual(roundTicks(0, 10, 4));
  });

  it('20,000 generated axes: no two labels touch once more than two are drawn; every axis is one roundTicks answer; zero inside three or more labels is labelled', () => {
    const next = random(7);
    for (let run = 0; run < 20000; run++) {
      const width = 10 ** (next() * 8 - 4);
      const lo = (next() - 0.5) * width * (next() < 0.5 ? 2 : 2000);
      const hi = lo + width;
      const length = 30 + next() * 600;
      const along = next() < 0.5 ? 'width' : 'height';
      const place = along === 'width' ? linearScale(lo, hi, 0, length) : linearScale(lo, hi, length, 0);
      const target = 1 + Math.floor(next() * 8);
      const kept = roundTicksThatFit(lo, hi, target, place, along);
      const what = `${lo} … ${hi} on ${length}px by ${along}, ${target} asked: ${said(kept).join(' ')}`;
      if (kept.length > 2) expect(touching(kept, place, along), what).toBe(0);
      const answers = Array.from({ length: target }, (_, i) => roundTicks(lo, hi, i + 1));
      const whole = answers.some((a) => a.length === kept.length && a.every((t, i) => t.value === kept[i]!.value));
      if (kept.length > 2) expect(whole, what).toBe(true);
      if (kept.length > 2 && lo < 0 && hi > 0 && kept.some((t) => t.value < 0) && kept.some((t) => t.value > 0)) expect(said(kept), what).toContain('0');
    }
  });
});

describe('ticksThatFit — given ticks, walked from the first', () => {
  it('labels that fit are all kept, and it is the same array', () => {
    const all = ticks(['0', '0.2', '0.4', '0.6', '0.8', '1']);
    expect(ticksThatFit(all, every(60), 'width')).toBe(all);
  });

  it('each label is kept when it does not touch the last one kept', () => {
    // 8-character labels are 48 px, single characters 6 px, ticks 30 px apart: "b" touches the long
    // first label and goes; "c", "d" and "e" have room; the long last label touches "e" and goes
    expect(said(ticksThatFit(ticks(['aaaaaaaa', 'b', 'c', 'd', 'e', 'ffffffff']), every(30), 'width'))).toEqual(['aaaaaaaa', 'c', 'd', 'e']);
  });

  it('labels so long that nothing else fits beside the first: the first and the last', () => {
    const long = ticks(Array.from({ length: 7 }, () => 'x'.repeat(40)));
    expect(said(ticksThatFit(long, every(30), 'width'))).toEqual(['x'.repeat(40), 'x'.repeat(40)]);
    expect(ticksThatFit(long, every(30), 'width')[1]).toBe(long[6]);
  });

  it('ticks closer than a line of text are thinned, whichever way the axis runs', () => {
    expect(said(ticksThatFit(ticks(['0', '1', '2', '3', '4', '5', '6']), every(8), 'height'))).toEqual(['0', '2', '4', '6']);
    expect(said(ticksThatFit(ticks(['0', '1', '2', '3', '4', '5', '6']), (v) => 200 - v * 8, 'height'))).toEqual(['0', '2', '4', '6']);
  });

  it('a 1-2-5 run that crowds at one end loses labels only where they crowd', () => {
    const run = [2, 5, 10, 20, 50].map((value) => ({ value, label: String(value) }));
    const place = logScale(2, 50, 0, 60);
    const kept = ticksThatFit(run, place, 'width');
    expect(kept[0]).toBe(run[0]);
    expect(kept.length).toBeGreaterThan(2);
    expect(kept.length).toBeLessThan(run.length);
    expect(touching(kept, place, 'width')).toBe(0);
  });

  it('5,000 generated logarithmic axes, both ways round: the first is kept, no kept pair touches once more than two are drawn, and every dropped label touched the kept one before it', () => {
    const next = random(11);
    for (let run = 0; run < 5000; run++) {
      const lo = 10 ** Math.floor(next() * 12 - 4);
      const hi = lo * 10 ** (0.3 + next() * 14);
      const length = 40 + next() * 500;
      const place = next() < 0.5 ? logScale(lo, hi, 0, length) : logScale(lo, hi, length, 0);
      const all = logTicks(lo, hi, 5).map((value) => ({ value, label: logTickLabel(value) }));
      for (const along of ['width', 'height'] as const) {
        const kept = ticksThatFit(all, place, along);
        const what = `${lo} … ${hi} on ${length}px by ${along}: ${said(kept).join(' ')}`;
        if (all.length > 0) expect(kept[0], what).toBe(all[0]);
        if (kept.length <= 2) continue;
        expect(touching(kept, place, along), what).toBe(0);
        let before = all[0]!;
        for (const tick of all.slice(1)) {
          if (kept.includes(tick)) before = tick;
          else expect(touching([before, tick], place, along), `${what} dropped ${tick.label}`).toBe(1);
        }
      }
    }
  });

  it('one or two ticks, and places that are not numbers, are left alone', () => {
    const two = ticks(['aaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbb']);
    expect(ticksThatFit(two, every(1), 'width')).toBe(two);
    const one = ticks(['only']);
    expect(ticksThatFit(one, every(1), 'width')).toBe(one);
    const three = ticks(['a', 'b', 'c']);
    expect(ticksThatFit(three, () => Number.NaN, 'width')).toBe(three);
    expect(ticksThatFit([], every(1), 'width')).toEqual([]);
  });

  it('ticks that all stand on one spot: the first and the last', () => {
    const stacked = ticks(['a', 'b', 'c']);
    expect(said(ticksThatFit(stacked, () => 5, 'width'))).toEqual(['a', 'c']);
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
