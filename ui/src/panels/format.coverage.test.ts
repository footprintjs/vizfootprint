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

describe('formatCommitValue — the D30 cell wording ("price 100 – 150 and category = Formal")', () => {
  it('renders interval × point in plain words with both field names', () => {
    expect(
      formatCommitValue({ kind: 'cell', fields: ['price', 'category'], value: [[100, 150], 'Formal'] }),
    ).toBe('price 100 – 150 and category = Formal');
  });

  it('renders a half-open interval side and a point side of every scalar shape', () => {
    expect(formatCommitValue({ kind: 'cell', fields: ['price', 'category'], value: [[150, null], 'Formal'] })).toBe(
      'price at least 150 and category = Formal',
    );
    expect(formatCommitValue({ kind: 'cell', fields: ['date', 'category'], value: [[null, '2026-05-31'], 'Party'] })).toBe(
      'date up to 2026-05-31 and category = Party',
    );
    expect(formatCommitValue({ kind: 'cell', fields: ['price', 'rating'], value: [[0, 10], 4.256] })).toBe(
      'price 0 – 10 and rating = 4.26',
    );
    expect(formatCommitValue({ kind: 'cell', fields: ['price', 'rating'], value: [[0, 10], 4] })).toBe('price 0 – 10 and rating = 4');
    expect(formatCommitValue({ kind: 'cell', fields: ['price', 'note'], value: [[0, 10], null] })).toBe('price 0 – 10 and note = ∅');
  });

  it('a cleared cell (or a wire row that lost its pair) reads as (cleared)', () => {
    expect(formatCommitValue({ kind: 'cell', fields: ['price', 'category'], value: null })).toBe('(cleared)');
    expect(formatCommitValue({ kind: 'cell', value: [[0, 10], 'x'] })).toBe('(cleared)');
  });
});

describe('formatCommitValue — match (SET-1)', () => {
  it('reads "in {…}" / "not in {…}" with numbers rounded and null as ∅; a cleared match says so', () => {
    expect(formatCommitValue({ kind: 'match', value: { values: ['A', 2.345, null] } })).toBe('in {A, 2.35, ∅}');
    expect(formatCommitValue({ kind: 'match', value: { values: [7], exclude: true } })).toBe('not in {7}');
    expect(formatCommitValue({ kind: 'match', value: null })).toBe('(cleared)');
    expect(formatCommitValue({ kind: 'match', value: {} })).toBe('in {}');
  });
});

describe('formatCommitValue — a link commit (layer 4)', () => {
  it('reads the edge in the matrix\'s words; an un-declare (null) is ∅', () => {
    expect(formatCommitValue({ kind: 'point', value: { source: 'map', kind: 'point', target: 'bar', response: 'highlight' } })).toBe('map point → bar: highlight');
    expect(formatCommitValue({ kind: 'point', value: null })).toBe('∅');
    expect(formatCommitValue({ kind: 'point', value: { source: 'map', target: 'bar' } })).toBe('[object Object]'); // not an edge: no response — the honest fallback
  });
});
