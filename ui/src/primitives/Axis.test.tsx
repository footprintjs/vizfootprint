// @vitest-environment jsdom
/**
 * ONE AXIS PART: the line, the tick marks and their labels, for every chart.
 * Ticks arrive already placed, so a number, a date and a band all fit.
 *
 * | the axis                                  | what is drawn                                                          |
 * |-------------------------------------------|------------------------------------------------------------------------|
 * | bottom                                    | a horizontal line; marks 4 px below it; labels 16 px below, centred    |
 * | bottom, bounds given, a label near an edge| the label moved inside the drawing; its mark stays at the value        |
 * | bottom, no bounds given                   | labels centred under their marks, wherever that is                     |
 * | bottom, a tick that names its anchor      | drawn from its start or to its end, exactly at the tick, never moved   |
 * | bottom, a slanted tick                    | 12 px below, ending at the tick, turned 40°                            |
 * | a tick with a title (a shortened label)   | the whole text kept for hover                                          |
 * | left                                      | a vertical line; marks 4 px to its left; labels end 8 px to its left   |
 * | right                                     | the mirror: marks and labels to its right, labels start there          |
 * | a side label wider than its room          | squeezed into the room between the axis and the drawing's edge         |
 * | a side label that fits, or no bounds given| as written, no length set                                              |
 * | a side axis at or past the drawing's edge | no room to judge by: as written                                        |
 * | a hue                                     | on the line and on each tick; with none, no style is written at all    |
 * | no ticks                                  | the line alone                                                         |
 * | any ticks it is given                     | all drawn, in order: this part never drops or adds a tick              |
 * | `placeTicks`                              | value ticks through a scale: position and label, nothing else          |
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Axis, placeTicks, type AxisProps, type AxisTick } from './Axis.js';
import { linearScale } from './scales.js';

afterEach(cleanup);

const draw = (props: AxisProps): SVGGElement => render(<svg>{<Axis {...props} />}</svg>).container.querySelector<SVGGElement>('g.vzf-axis-part')!;
const num = (el: Element, name: string): number => Number(el.getAttribute(name));
/** Tick `i` of `labels` at 50, 150, 250, … px. */
const every100 = (labels: readonly string[]): AxisTick[] => labels.map((label, i) => ({ position: 50 + i * 100, label }));

describe('Axis — bottom', () => {
  const base: AxisProps = { orient: 'bottom', ticks: every100(['0', '1', '2', '3', '4']), at: 300, range: [50, 450] };

  it('draws the line across its range, at its place', () => {
    const axis = draw(base);
    expect(axis.getAttribute('data-axis-orient')).toBe('bottom');
    const line = axis.querySelector(':scope > line.vzf-axis')!;
    expect([num(line, 'x1'), num(line, 'y1'), num(line, 'x2'), num(line, 'y2')]).toEqual([50, 300, 450, 300]);
  });

  it('draws every tick it is given, in order: a mark below the line and a centred label below that', () => {
    const groups = [...draw(base).querySelectorAll(':scope > g')];
    expect(groups.map((g) => g.querySelector('text')!.textContent)).toEqual(['0', '1', '2', '3', '4']);
    const [mark, label] = [groups[2]!.querySelector('line')!, groups[2]!.querySelector('text')!];
    expect([num(mark, 'x1'), num(mark, 'y1'), num(mark, 'x2'), num(mark, 'y2')]).toEqual([250, 300, 250, 304]);
    expect([num(label, 'x'), num(label, 'y'), label.getAttribute('text-anchor')]).toEqual([250, 316, 'middle']);
    expect(label.hasAttribute('textLength')).toBe(false);
    expect(label.hasAttribute('transform')).toBe(false);
  });

  it('with bounds, a label near the right edge is moved inside; its mark stays at the value', () => {
    const groups = [...draw({ ...base, ticks: [{ position: 50, label: '1700000000000' }, { position: 450, label: '1700000060000' }], labelBounds: [0, 468] }).querySelectorAll(':scope > g')];
    // 13 characters are 78 px: centred at 450 it would end at 489, so it is centred at 468 − 39
    expect(num(groups[1]!.querySelector('text')!, 'x')).toBe(429);
    expect(num(groups[1]!.querySelector('line')!, 'x1')).toBe(450);
    // the first is centred at 50 and starts at 11: it has room and does not move
    expect(num(groups[0]!.querySelector('text')!, 'x')).toBe(50);
  });

  it('…and the same from the left edge', () => {
    const group = draw({ ...base, ticks: [{ position: 50, label: '170000000000000000' }], labelBounds: [0, 468] }).querySelector(':scope > g')!;
    // 18 characters are 108 px: centred at 50 it would start at −4, so it is centred at 54
    expect(num(group.querySelector('text')!, 'x')).toBe(54);
    expect(num(group.querySelector('line')!, 'x1')).toBe(50);
  });

  it('with no bounds given a label is centred under its mark, wherever that is', () => {
    expect(num(draw({ ...base, ticks: [{ position: 450, label: '1700000060000' }] }).querySelector('text')!, 'x')).toBe(450);
  });

  it('a tick that names its anchor is drawn at its tick as asked, and bounds do not move it', () => {
    const ticks: AxisTick[] = [
      { position: 50, label: '2026-04-01', anchor: 'start' },
      { position: 450, label: '2026-04-30', anchor: 'end' },
    ];
    const texts = [...draw({ ...base, ticks, labelBounds: [0, 452] }).querySelectorAll('text')];
    expect(texts.map((t) => [num(t, 'x'), t.getAttribute('text-anchor')])).toEqual([[50, 'start'], [450, 'end']]);
  });

  it('a slanted tick ends at its tick, 12 px below the line, turned 40 degrees', () => {
    const text = draw({ ...base, ticks: [{ position: 250, label: 'A rather long…', slanted: true, title: 'A rather long category' }], labelBounds: [0, 468] }).querySelector('text')!;
    expect([num(text, 'x'), num(text, 'y'), text.getAttribute('text-anchor'), text.getAttribute('transform')]).toEqual([250, 312, 'end', 'rotate(-40 250 312)']);
    // the shortened label is drawn, and the whole text is kept for hover
    expect(text.querySelector('title')!.textContent).toBe('A rather long category');
    expect(text.textContent).toBe('A rather long categoryA rather long…');
  });

  it('a slanted tick with nothing shortened has no title; a level tick may carry one', () => {
    expect(draw({ ...base, ticks: [{ position: 250, label: 'Formal', slanted: true }] }).querySelector('title')).toBeNull();
    expect(draw({ ...base, ticks: [{ position: 250, label: 'Q1', title: 'First quarter' }] }).querySelector('text > title')!.textContent).toBe('First quarter');
  });

  it('no ticks: the line alone', () => {
    expect(draw({ ...base, ticks: [] }).children).toHaveLength(1);
  });
});

describe('Axis — left and right', () => {
  // five ticks from 300 px up to 20 px
  const ticks: AxisTick[] = ['0', '1', '2', '3', '4'].map((label, i) => ({ position: 300 - i * 70, label }));
  const left: AxisProps = { orient: 'left', ticks, at: 52, range: [20, 300], labelBounds: [0, 520] };

  it('left: a vertical line, marks to its left, labels ending to its left', () => {
    const axis = draw(left);
    const line = axis.querySelector(':scope > line.vzf-axis')!;
    expect([num(line, 'x1'), num(line, 'y1'), num(line, 'x2'), num(line, 'y2')]).toEqual([52, 20, 52, 300]);
    const group = axis.querySelectorAll(':scope > g')[4]!;
    const [mark, label] = [group.querySelector('line')!, group.querySelector('text')!];
    expect([num(mark, 'x1'), num(mark, 'y1'), num(mark, 'x2'), num(mark, 'y2')]).toEqual([48, 20, 52, 20]);
    expect([num(label, 'x'), num(label, 'y'), label.getAttribute('text-anchor')]).toEqual([44, 23, 'end']);
  });

  it('right: the mirror', () => {
    const axis = draw({ ...left, orient: 'right', at: 468 });
    expect(axis.getAttribute('data-axis-orient')).toBe('right');
    const group = axis.querySelectorAll(':scope > g')[0]!;
    const [mark, label] = [group.querySelector('line')!, group.querySelector('text')!];
    expect([num(mark, 'x1'), num(mark, 'x2')]).toEqual([472, 468]);
    expect([num(label, 'x'), num(label, 'y'), label.getAttribute('text-anchor')]).toEqual([476, 303, 'start']);
    const line = axis.querySelector(':scope > line.vzf-axis')!;
    expect([num(line, 'x1'), num(line, 'y1'), num(line, 'x2'), num(line, 'y2')]).toEqual([468, 20, 468, 300]);
  });

  it('left: a label wider than the room between the axis and the drawing’s edge is squeezed into it; one that fits is as written', () => {
    // the axis at 52 with labels anchored 8 px away: 44 px of room. Ten characters are 60 px.
    const axis = draw({ ...left, ticks: [{ position: 300, label: '12345.0010' }, { position: 230, label: '0.5' }] });
    const [wide, short] = [...axis.querySelectorAll('text')];
    expect(wide!.getAttribute('textLength')).toBe('44');
    expect(wide!.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');
    expect(wide!.textContent).toBe('12345.0010');
    expect(short!.hasAttribute('textLength')).toBe(false);
  });

  it('right: the room is on the other side', () => {
    // the axis at 502 in a 520 px drawing: 18 − 8 = 10 px of room
    const axis = draw({ ...left, orient: 'right', at: 502, ticks: [{ position: 300, label: '12345' }] });
    expect(axis.querySelector('text')!.getAttribute('textLength')).toBe('10');
  });

  it('with no bounds given every label is drawn as written', () => {
    const { labelBounds: _bounds, ...unbounded } = left;
    expect(draw({ ...unbounded, ticks: [{ position: 300, label: '12345.0010' }] }).querySelector('text')!.hasAttribute('textLength')).toBe(false);
  });

  it('an axis at or past the drawing’s edge has no room to judge by: the label is drawn as written', () => {
    for (const at of [8, 3]) {
      expect(draw({ ...left, at, ticks: [{ position: 300, label: '12345.0010' }] }).querySelector('text')!.hasAttribute('textLength')).toBe(false);
      cleanup();
    }
  });

  it('a side tick may carry a title too', () => {
    expect(draw({ ...left, ticks: [{ position: 300, label: '1.2M', title: '1,234,567' }] }).querySelector('text > title')!.textContent).toBe('1,234,567');
  });
});

describe('Axis — the ink of its scale', () => {
  const props: AxisProps = { orient: 'left', ticks: every100(['a', 'b']), at: 52, range: [0, 10] };

  it('a hue is written on the line and on each tick', () => {
    const axis = draw({ ...props, hue: 'var(--vzf-scale-left)' });
    expect(axis.querySelector(':scope > line')!.getAttribute('style')).toBe('--vzf-scale-hue: var(--vzf-scale-left);');
    expect([...axis.querySelectorAll(':scope > g')].map((g) => g.getAttribute('style'))).toEqual(['--vzf-scale-hue: var(--vzf-scale-left);', '--vzf-scale-hue: var(--vzf-scale-left);']);
    const bottom = draw({ ...props, orient: 'bottom', hue: 'red' });
    expect(bottom.querySelector(':scope > line')!.getAttribute('style')).toBe('--vzf-scale-hue: red;');
    expect([...bottom.querySelectorAll(':scope > g')].map((g) => g.getAttribute('style'))).toEqual(['--vzf-scale-hue: red;', '--vzf-scale-hue: red;']);
  });

  it('with no hue no style is written at all', () => {
    expect(draw(props).querySelectorAll('[style]')).toHaveLength(0);
    expect(draw({ ...props, orient: 'bottom' }).querySelectorAll('[style]')).toHaveLength(0);
  });
});

describe('placeTicks — value ticks through a scale', () => {
  it('gives each tick its place and its label, in order, and nothing else', () => {
    const y = linearScale(0, 100, 296, 18);
    expect(placeTicks([{ value: 0, label: '0' }, { value: 50, label: '50' }, { value: 100, label: '100' }], y)).toEqual([
      { position: 296, label: '0' },
      { position: 157, label: '50' },
      { position: 18, label: '100' },
    ]);
    expect(placeTicks([], y)).toEqual([]);
  });
});
