import { describe, it, expect } from 'vitest';
import { formatCommitValue, isSelfDescribing } from './format.js';

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

describe('formatCommitValue — neighbourhood (protocol 1.3)', () => {
  const walk = (over: Record<string, unknown> = {}): string =>
    formatCommitValue({ kind: 'neighbourhood', fields: ['source', 'target'], value: { seed: 'Salmonellosis', derivation: 'ego', hops: 1, ids: ['Salmonellosis', 'Lyme', 'Zika'], ...over } });

  it('reads as the SEED and how many came with it — the answer, not the question', () => {
    expect(walk()).toBe('Salmonellosis and its 2 neighbours (ego, 1 hop)');
    // one neighbour is singular, and a walk that found nobody says zero rather than hiding
    expect(walk({ ids: ['Salmonellosis', 'Lyme'] })).toBe('Salmonellosis and its 1 neighbour (ego, 1 hop)');
    expect(walk({ ids: ['Salmonellosis'] })).toBe('Salmonellosis and its 0 neighbours (ego, 1 hop)');
  });

  it('the QUESTION is quoted as recorded — a derivation or a distance this build does not mint still reads', () => {
    expect(walk({ derivation: 'two-hop', hops: 2 })).toBe('Salmonellosis and its 2 neighbours (two-hop, 2 hops)');
    // a body missing either half of the question falls back to what the one derivation this version walks is
    expect(walk({ derivation: 7, hops: '2' })).toBe('Salmonellosis and its 2 neighbours (ego, 1 hop)');
  });

  it('a numeric seed rounds like every other value, and an absent one is ∅', () => {
    expect(walk({ seed: 4.256, ids: [4.256, 9] })).toBe('4.26 and its 1 neighbour (ego, 1 hop)');
    expect(walk({ seed: null, ids: ['a', 'b'] })).toBe('∅ and its 2 neighbours (ego, 1 hop)');
  });

  it('a cleared walk — and a body carrying no id list, which is not a walk to report — read as (cleared)', () => {
    expect(formatCommitValue({ kind: 'neighbourhood', fields: ['source', 'target'], value: null })).toBe('(cleared)');
    expect(formatCommitValue({ kind: 'neighbourhood', fields: ['source', 'target'], value: undefined })).toBe('(cleared)');
    expect(formatCommitValue({ kind: 'neighbourhood', fields: ['source', 'target'], value: { seed: 'x' } })).toBe('(cleared)');
  });
});

describe('isSelfDescribing — whose words already name their own columns', () => {
  it('the two-column kinds do; every other kind needs its field said first', () => {
    expect((['cell', 'neighbourhood'] as const).map(isSelfDescribing)).toEqual([true, true]);
    expect((['point', 'interval', 'match'] as const).map(isSelfDescribing)).toEqual([false, false, false]);
  });
});
