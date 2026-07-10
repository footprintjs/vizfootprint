import { describe, it, expect } from 'vitest';
import { formatCommitValue } from './format.js';

describe('formatCommitValue edges', () => {
  it('renders the empty-diamond for null/undefined POINT values (the non-interval null arm)', () => {
    expect(formatCommitValue({ kind: 'point', value: null })).toBe('∅');
    expect(formatCommitValue({ kind: 'point', value: undefined })).toBe('∅');
  });

  it('renders an integer point value verbatim, without the round2 detour', () => {
    expect(formatCommitValue({ kind: 'point', value: 42 })).toBe('42');
  });
});
