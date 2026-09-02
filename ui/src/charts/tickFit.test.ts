import { describe, it, expect } from 'vitest';
import { fitTick, fitsBand, TICK_CHAR_PX } from './tickFit.js';

describe('tickFit', () => {
  it('a label narrower than its band stays flat and whole', () => {
    expect(fitTick('Party', 40, 16)).toEqual({ rotate: false, text: 'Party', clipped: false });
    expect(fitsBand('Party', 5 * TICK_CHAR_PX)).toBe(true);
  });
  it('a label wider than its band slants, whole when the room holds it', () => {
    // 12 chars = 72px in a 30px band; 56px of room on a 40° slant holds ~87px → 14 chars
    expect(fitTick('Salmonellosi', 30, 56)).toEqual({ rotate: true, text: 'Salmonellosi', clipped: false });
  });
  it('a long label slants and is clipped to the room with an ellipsis', () => {
    const fit = fitTick('Carbapenemase-producing Enterobacterales', 30, 56);
    expect(fit.rotate).toBe(true);
    expect(fit.clipped).toBe(true);
    expect(fit.text.endsWith('…')).toBe(true);
    expect(fit.text.length).toBeLessThanOrEqual(14);
  });
  it('no room at all still leaves one character', () => {
    expect(fitTick('Pertussis', 10, 0).text).toBe('P…');
  });
});
