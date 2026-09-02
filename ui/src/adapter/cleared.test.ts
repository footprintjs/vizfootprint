/**
 * The wire carries `clearedSelections` (layer 4 `onClear`); a row without a
 * clearing commit is not a cleared selection and is dropped.
 */
import { describe, it, expect } from 'vitest';
import { mapPollState } from './sessionView.js';

describe('mapPollState — cleared selections', () => {
  it('keeps rows that name their clearing commit, with a cell pair intact; drops the rest; absent = none', () => {
    const state = mapPollState({
      records: [],
      activeSelections: [],
      clearedSelections: [
        { viewId: 'bar', field: 'category', kind: 'point', value: 'Formal', clearedBy: 'c9' },
        { viewId: 'heat', field: 'a × b', kind: 'cell', value: ['x', [1, 2]], fields: ['a', 'b'], clearedBy: 'c10' },
        { viewId: 'ghost', field: 'category', kind: 'point', value: 'Formal' },
      ],
    });
    expect(state.cleared).toEqual([
      { viewId: 'bar', field: 'category', kind: 'point', value: 'Formal', clearedBy: 'c9' },
      { viewId: 'heat', field: 'a × b', kind: 'cell', value: ['x', [1, 2]], fields: ['a', 'b'], clearedBy: 'c10' },
    ]);
    expect(mapPollState({ records: [] }).cleared).toEqual([]);
  });
});

describe('mapPollState — provenance', () => {
  it('keeps well-formed source rows (with or without a locator), drops malformed ones, and reads nothing from a missing or non-object field', () => {
    const state = mapPollState({
      records: [],
      sources: {
        cells: { format: 'csv', via: 'file', at: '/data/snapshot.csv', version: 'mtime:x;size:1', retrievedAt: '2026-09-02T00:00:00.000Z', rows: 90300 },
        small: { format: 'rows', via: 'inline', version: 'inline:3-abcd', retrievedAt: '2026-09-02T00:00:00.000Z', rows: 3 },
        broken: { format: 'csv', rows: 'many' },
      },
    });
    expect(state.sources).toEqual({
      cells: { format: 'csv', via: 'file', at: '/data/snapshot.csv', version: 'mtime:x;size:1', retrievedAt: '2026-09-02T00:00:00.000Z', rows: 90300 },
      small: { format: 'rows', via: 'inline', version: 'inline:3-abcd', retrievedAt: '2026-09-02T00:00:00.000Z', rows: 3 },
    });
    expect(mapPollState({ records: [] }).sources).toBeUndefined();
    expect(mapPollState({ records: [], sources: 'nope' }).sources).toBeUndefined();
  });
});
