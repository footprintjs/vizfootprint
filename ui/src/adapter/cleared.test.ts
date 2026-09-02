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
