/**
 * THE SPAN A COUNT IS DRAWN ON: from zero, up to a ceiling that is never below one.
 *
 * | what a frame folded (or none)      | the chart's own extent | the span drawn |
 * |------------------------------------|------------------------|----------------|
 * | none                               | 0 … 130                | 0 … 130        |
 * | 0 … 20                             | anything               | 0 … 20         |
 * | 5 … 20 (a floor that is not zero)  | anything               | 0 … 20         |
 * | 20 … 0 (backwards)                 | anything               | 0 … 20         |
 * | 0 … 0 (a column of zeroes)         | anything               | 0 … 1          |
 * | 0 … 0.4 (a ceiling below one)      | anything               | 0 … 1          |
 * | −5 … −1 (all negative)             | anything               | 0 … 1          |
 * | not numbers                        | 0 … 7                  | 0 … 7          |
 */
import { describe, expect, it } from 'vitest';
import { countSpan } from './scales.js';

describe('countSpan', () => {
  it('is the chart’s own extent from zero when no frame gave one', () => {
    expect(countSpan(undefined, [0, 130])).toEqual([0, 130]);
    expect(countSpan([0, Number.NaN], [0, 7])).toEqual([0, 7]);
  });

  it('takes a frame’s ceiling, and always starts at zero', () => {
    expect(countSpan([0, 20], [0, 9])).toEqual([0, 20]);
    expect(countSpan([5, 20], [0, 9])).toEqual([0, 20]);
    expect(countSpan([20, 0], [0, 9])).toEqual([0, 20]);
  });

  it('never has a ceiling below one', () => {
    expect(countSpan([0, 0], [0, 0])).toEqual([0, 1]);
    expect(countSpan([0, 0.4], [0, 0.4])).toEqual([0, 1]);
    expect(countSpan([-5, -1], [0, 0])).toEqual([0, 1]);
    expect(countSpan(undefined, [0, 0])).toEqual([0, 1]);
  });
});
