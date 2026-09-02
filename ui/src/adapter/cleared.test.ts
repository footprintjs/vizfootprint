/**
 * The wire carries `clearedSelections` (layer 4 `onClear`); a row without a
 * clearing commit is not a cleared selection and is dropped.
 */
import { describe, it, expect } from 'vitest';
import { mapPollState, type RawPollState } from './sessionView.js';

describe('mapPollState — cleared selections', () => {
  it('keeps rows that name their clearing commit, with a cell pair intact; drops the rest; absent = none', () => {
    const state = mapPollState({
      records: [],
      activeSelections: [],
      clearedSelections: [
        { viewId: 'bar', field: 'category', kind: 'point' as const, value: 'Formal', clearedBy: 'c9' },
        { viewId: 'heat', field: 'a × b', kind: 'cell' as const, value: ['x', [1, 2]], fields: ['a', 'b'], clearedBy: 'c10' },
        { viewId: 'ghost', field: 'category', kind: 'point' as const, value: 'Formal' },
      ],
    });
    expect(state.cleared).toEqual([
      { viewId: 'bar', field: 'category', kind: 'point' as const, value: 'Formal', clearedBy: 'c9' },
      { viewId: 'heat', field: 'a × b', kind: 'cell' as const, value: ['x', [1, 2]], fields: ['a', 'b'], clearedBy: 'c10' },
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

describe('mapPollState — a commit true of data that has moved', () => {
  it('is marked when its table has since moved to another version; a current one is not; no stamp = no mark; no provenance = nothing judged', () => {
    const sources = { data: { format: 'csv', via: 'file', version: 'v2', retrievedAt: '2026-09-02T00:00:00.000Z', rows: 3 } };
    const records: RawPollState['records'] = [
      { id: 's1', parent: null, viewId: 'bar', kind: 'point' as const, field: 'category', value: 'Formal', cause: { requestedBy: 'user' }, data: { data: 'v1' } as Record<string, string> },
      { id: 's2', parent: 's1', viewId: 'bar', kind: 'point' as const, field: 'category', value: 'Work', cause: { requestedBy: 'user' }, data: { data: 'v2' } as Record<string, string> },
      { id: 's3', parent: 's2', viewId: 'bar', kind: 'point' as const, field: 'category', value: 'Party', cause: { requestedBy: 'user' } },
      { id: 's4', parent: 's3', viewId: 'bar', kind: 'point' as const, field: 'category', value: 'Casual', cause: { requestedBy: 'user' }, data: { elsewhere: 'v9' } as Record<string, string> },
    ];
    const state = mapPollState({ records, sources });
    expect(state.commits.map((c) => [c.id, c.dataMoved, c.data, c.moved])).toEqual([
      ['s1', true, { data: 'v1' }, [{ table: 'data', from: 'v1', to: 'v2' }]],
      ['s2', false, { data: 'v2' }, undefined],
      ['s3', undefined, undefined, undefined],
      ['s4', false, { elsewhere: 'v9' }, undefined], // a table with no provenance on the wire is not judged
    ]);
    // a malformed stamp off the wire is dropped, never shown as a fact
    const oddRecords: RawPollState['records'] = [
      { id: 'o1', parent: null, viewId: 'bar', kind: 'point' as const, field: 'category', value: 'x', cause: { requestedBy: 'user' }, data: 'nope' as never },
      { id: 'o2', parent: 'o1', viewId: 'bar', kind: 'point' as const, field: 'category', value: 'y', cause: { requestedBy: 'user' }, data: { t: 1 } as never },
    ];
    const odd = mapPollState({ records: oddRecords, sources });
    expect(odd.commits.map((c) => c.data)).toEqual([undefined, undefined]);
    expect(mapPollState({ records }).commits.map((c) => c.dataMoved)).toEqual([undefined, undefined, undefined, undefined]);
  });
});
