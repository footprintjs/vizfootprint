// @vitest-environment jsdom
/**
 * ONE AXIS PART: the line, the tick marks and their labels, for every chart.
 *
 * | the axis                          | what is drawn                                                            |
 * |-----------------------------------|--------------------------------------------------------------------------|
 * | bottom                            | a horizontal line; marks 4 px below it; labels 16 px below, centred      |
 * | bottom, a label near an edge      | the label moved inside the drawing; its mark stays at the value          |
 * | bottom, no edges given            | labels centred under their marks, wherever that is                       |
 * | left                              | a vertical line; marks 4 px to its left; labels end 8 px to its left     |
 * | right                             | the mirror: marks and labels to its right, labels start there            |
 * | a side label wider than its room  | squeezed into the room, every character kept                             |
 * | a side label that fits, or no room given | as written, no length set                                         |
 * | a hue                             | on the line and on each tick; with none, no style is written at all      |
 * | no ticks                          | the line alone                                                           |
 * | any ticks it is given             | all drawn, in order: this part never drops or adds a tick                |
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Axis, AXIS_LABEL_OFFSET, AXIS_TICK_SIZE, type AxisProps } from './Axis.js';
import { linearScale } from './scales.js';

afterEach(cleanup);

const draw = (props: AxisProps): SVGGElement => render(<svg>{<Axis {...props} />}</svg>).container.querySelector<SVGGElement>('g.vzf-axis-part')!;
const num = (el: Element, name: string): number => Number(el.getAttribute(name));
const ticks = (labels: readonly string[]) => labels.map((label, value) => ({ value, label }));

describe('Axis — bottom', () => {
  const scale = linearScale(0, 4, 50, 450);
  const base: AxisProps = { orient: 'bottom', scale, ticks: ticks(['0', '1', '2', '3', '4']), at: 300, range: [50, 450] };

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
    expect([num(mark, 'x1'), num(mark, 'y1'), num(mark, 'x2'), num(mark, 'y2')]).toEqual([250, 300, 250, 300 + AXIS_TICK_SIZE]);
    expect([num(label, 'x'), num(label, 'y'), label.getAttribute('text-anchor')]).toEqual([250, 300 + AXIS_LABEL_OFFSET.bottom, 'middle']);
    expect(label.hasAttribute('textLength')).toBe(false);
  });

  it('a label near the edge is moved inside the drawing; its mark stays at the value', () => {
    const long = { ...base, ticks: [{ value: 0, label: '1700000000000' }, { value: 4, label: '1700000060000' }], edges: [0, 468] as const };
    const groups = [...draw(long).querySelectorAll(':scope > g')];
    // 13 characters are 78 px: centred at 450 it would end at 489, so it is centred at 468 − 39
    expect(num(groups[1]!.querySelector('text')!, 'x')).toBe(429);
    expect(num(groups[1]!.querySelector('line')!, 'x1')).toBe(450);
    expect(num(groups[0]!.querySelector('text')!, 'x')).toBe(50);
  });

  it('with no edges given a label is centred under its mark, wherever that is', () => {
    const long = { ...base, ticks: [{ value: 4, label: '1700000060000' }] };
    expect(num(draw(long).querySelector('text')!, 'x')).toBe(450);
  });

  it('no ticks: the line alone', () => {
    const axis = draw({ ...base, ticks: [] });
    expect(axis.children).toHaveLength(1);
  });
});

describe('Axis — left and right', () => {
  const scale = linearScale(0, 4, 300, 20);
  const left: AxisProps = { orient: 'left', scale, ticks: ticks(['0', '1', '2', '3', '4']), at: 52, range: [20, 300], labelRoom: 44 };

  it('left: a vertical line, marks to its left, labels ending to its left', () => {
    const axis = draw(left);
    const line = axis.querySelector(':scope > line.vzf-axis')!;
    expect([num(line, 'x1'), num(line, 'y1'), num(line, 'x2'), num(line, 'y2')]).toEqual([52, 20, 52, 300]);
    const group = axis.querySelectorAll(':scope > g')[4]!;
    const [mark, label] = [group.querySelector('line')!, group.querySelector('text')!];
    expect([num(mark, 'x1'), num(mark, 'y1'), num(mark, 'x2'), num(mark, 'y2')]).toEqual([52 - AXIS_TICK_SIZE, 20, 52, 20]);
    expect([num(label, 'x'), num(label, 'y'), label.getAttribute('text-anchor')]).toEqual([52 - AXIS_LABEL_OFFSET.side, 23, 'end']);
  });

  it('right: the mirror', () => {
    const axis = draw({ ...left, orient: 'right', at: 468 });
    expect(axis.getAttribute('data-axis-orient')).toBe('right');
    const group = axis.querySelectorAll(':scope > g')[0]!;
    const [mark, label] = [group.querySelector('line')!, group.querySelector('text')!];
    expect([num(mark, 'x1'), num(mark, 'x2')]).toEqual([468 + AXIS_TICK_SIZE, 468]);
    expect([num(label, 'x'), label.getAttribute('text-anchor')]).toEqual([468 + AXIS_LABEL_OFFSET.side, 'start']);
  });

  it('a label wider than its room is squeezed into it; one that fits is drawn as written', () => {
    const axis = draw({ ...left, ticks: [{ value: 0, label: '12345.0010' }, { value: 1, label: '0.5' }] });
    const [wide, short] = [...axis.querySelectorAll('text')];
    expect(wide!.getAttribute('textLength')).toBe('44');
    expect(wide!.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');
    expect(wide!.textContent).toBe('12345.0010');
    expect(short!.hasAttribute('textLength')).toBe(false);
  });

  it('with no room given every label is drawn as written', () => {
    const { labelRoom: _room, ...unbounded } = left;
    const axis = draw({ ...unbounded, ticks: [{ value: 0, label: '12345.0010' }] });
    expect(axis.querySelector('text')!.hasAttribute('textLength')).toBe(false);
  });
});

describe('Axis — the ink of its scale', () => {
  const props: AxisProps = { orient: 'left', scale: (v) => v, ticks: ticks(['a', 'b']), at: 52, range: [0, 10] };

  it('a hue is written on the line and on each tick', () => {
    const axis = draw({ ...props, hue: 'var(--vzf-scale-left)' });
    expect(axis.querySelector(':scope > line')!.getAttribute('style')).toBe('--vzf-scale-hue: var(--vzf-scale-left);');
    expect([...axis.querySelectorAll(':scope > g')].map((g) => g.getAttribute('style'))).toEqual(['--vzf-scale-hue: var(--vzf-scale-left);', '--vzf-scale-hue: var(--vzf-scale-left);']);
    const bottom = draw({ ...props, orient: 'bottom', hue: 'red' });
    expect(bottom.querySelector(':scope > line')!.getAttribute('style')).toBe('--vzf-scale-hue: red;');
  });

  it('with no hue no style is written at all', () => {
    const axis = draw(props);
    expect(axis.querySelectorAll('[style]')).toHaveLength(0);
  });
});
