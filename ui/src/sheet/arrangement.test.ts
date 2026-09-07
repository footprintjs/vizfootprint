/**
 * THE ARRANGEMENT CODEC — the sort a commit carries, both ways.
 *
 * Two properties are what this file is for. The round trip is EXACT (a field
 * named with a comma, a colon or a quote survives it, which is why the value
 * is JSON and not a joined string), and the read is TOTAL: every foreign,
 * stale or half-written value reads as NO sort, because a grid must never be
 * put in an order nobody asked for.
 */
import { describe, expect, it } from 'vitest';
import type { SortSpec } from 'vizfootprint/data';
import { sheetLayoutScope, sheetLayoutViewId, sheetSortOf, sortArrow, sortedByWords, sortFromLayoutValue, sortPhraseOf, sortToLayoutValue, sortWords, SHEET_LAYOUT_PREFIX, SHEET_SORT_PROP } from './arrangement.js';

const ASC: readonly SortSpec[] = [{ field: 'cases', dir: 'asc' }];

describe('the identity a sheet arranges under', () => {
  it('is one scope per sheet, under the library’s own layout namespace', () => {
    expect(sheetLayoutScope('sheet')).toBe('sheet:sheet');
    expect(sheetLayoutViewId('sheet')).toBe('layout:sheet:sheet');
    // two sheets on one dashboard never share an arrangement
    expect(sheetLayoutViewId('rows')).not.toBe(sheetLayoutViewId('cells'));
  });

  it('the namespace is the LIBRARY\'s, byte for byte — a copy that drifted would land every sort where nothing routes it', async () => {
    // test-only value import of the src constant (production ui code states it locally, so a poll
    // consumer never needs one) — the same pin `layoutView.test.ts` puts on LAYOUT_DASHBOARD_VIEW_ID
    const { LAYOUT_VIEW_PREFIX } = await import('vizfootprint/branches');
    expect(SHEET_LAYOUT_PREFIX).toBe(LAYOUT_VIEW_PREFIX);
  });
});

describe('the value a commit carries', () => {
  it('writes no sort as the empty string, so a CLEARED sort is still written down', () => {
    expect(sortToLayoutValue(undefined)).toBe('');
    expect(sortToLayoutValue([])).toBe('');
  });

  it('round-trips a key exactly, absence rule and all', () => {
    const spec: readonly SortSpec[] = [{ field: 'cases', dir: 'desc', absent: 'last' }];
    expect(sortFromLayoutValue(sortToLayoutValue(spec))).toEqual(spec);
  });

  it('round-trips a field name a joined string could not carry', () => {
    const spec: readonly SortSpec[] = [{ field: 'a,b:c"d', dir: 'asc' }];
    expect(sortFromLayoutValue(sortToLayoutValue(spec))).toEqual(spec);
  });

  it('round-trips more than one key, so nothing is silently dropped', () => {
    const spec: readonly SortSpec[] = [{ field: 'region', dir: 'asc' }, { field: 'cases', dir: 'desc' }];
    expect(sortFromLayoutValue(sortToLayoutValue(spec))).toEqual(spec);
  });
});

describe('reading a value back is TOTAL — anything unreadable is no sort at all', () => {
  it('an absent or empty value', () => {
    expect(sortFromLayoutValue(undefined)).toBeUndefined();
    expect(sortFromLayoutValue('')).toBeUndefined();
  });

  it('text that is not JSON', () => {
    expect(sortFromLayoutValue('cases:asc')).toBeUndefined();
  });

  it('JSON that is not a list of keys', () => {
    expect(sortFromLayoutValue('{"field":"cases","dir":"asc"}')).toBeUndefined();
    expect(sortFromLayoutValue('[]')).toBeUndefined();
    expect(sortFromLayoutValue('"cases"')).toBeUndefined();
  });

  it('a key this version does not know — the whole spec, never a half-honoured one', () => {
    expect(sortFromLayoutValue('[null]')).toBeUndefined();
    expect(sortFromLayoutValue('[7]')).toBeUndefined();
    expect(sortFromLayoutValue('[{"dir":"asc"}]')).toBeUndefined();
    expect(sortFromLayoutValue('[{"field":"","dir":"asc"}]')).toBeUndefined();
    expect(sortFromLayoutValue('[{"field":"cases","dir":"sideways"}]')).toBeUndefined();
    expect(sortFromLayoutValue('[{"field":"cases","dir":"asc","absent":"middle"}]')).toBeUndefined();
    // one good key beside one bad one is still an order nobody asked for
    expect(sortFromLayoutValue('[{"field":"cases","dir":"asc"},{"field":"x"}]')).toBeUndefined();
    // a slot a NEWER version added: the window port would drop the prop it does not know and
    // answer "cases ascending" — an order nobody asked for, which is what this codec refuses
    expect(sortFromLayoutValue('[{"field":"cases","dir":"asc","collation":"numeric"}]')).toBeUndefined();
  });

  it('a value that is not text at all — `layouts` arrives off a poll\'s JSON, where a leaf can be null', () => {
    expect(sortFromLayoutValue(null as unknown as string)).toBeUndefined();
    expect(sortFromLayoutValue(7 as unknown as string)).toBeUndefined();
    expect(sheetSortOf({ 'sheet:cells': { [SHEET_SORT_PROP]: null as unknown as string } }, 'cells')).toBeUndefined();
  });

  it('accepts every absence rule the window port declares', () => {
    expect(sortFromLayoutValue('[{"field":"cases","dir":"asc","absent":"first"}]')).toEqual([{ field: 'cases', dir: 'asc', absent: 'first' }]);
    expect(sortFromLayoutValue('[{"field":"cases","dir":"desc","absent":"last"}]')).toEqual([{ field: 'cases', dir: 'desc', absent: 'last' }]);
  });
});

describe('sheetSortOf — the arrangement at the cursor', () => {
  it('reads this sheet’s own scope, and nobody else’s', () => {
    const layouts = { 'sheet:cells': { [SHEET_SORT_PROP]: sortToLayoutValue(ASC) }, dashboard: { preset: 'focus' } };
    expect(sheetSortOf(layouts, 'cells')).toEqual(ASC);
    expect(sheetSortOf(layouts, 'other')).toBeUndefined();
  });

  it('a session with no layout fold, no scope, or no sort prop has no sort', () => {
    expect(sheetSortOf(undefined, 'cells')).toBeUndefined();
    expect(sheetSortOf({}, 'cells')).toBeUndefined();
    expect(sheetSortOf({ 'sheet:cells': {} }, 'cells')).toBeUndefined();
  });
});

describe('the words on the rail', () => {
  it('name the sheet and the order, and say when an order was cleared', () => {
    expect(sortWords('cells', ASC)).toBe('cells: sorted by cases ↑');
    expect(sortWords('cells', [{ field: 'cases', dir: 'desc' }])).toBe('cells: sorted by cases ↓');
    expect(sortWords('cells', undefined)).toBe('cells: sort cleared');
    expect(sortWords('cells', [])).toBe('cells: sort cleared');
  });

  it('name EVERY key, so two different arrangements never read the same', () => {
    expect(sortWords('cells', [{ field: 'region', dir: 'asc' }, { field: 'cases', dir: 'desc' }])).toBe('cells: sorted by region ↑, cases ↓');
    // the failure this replaced: these two acts used to land byte-identical words
    expect(sortWords('cells', [{ field: 'region', dir: 'asc' }, { field: 'year', dir: 'asc' }])).not.toBe(
      sortWords('cells', [{ field: 'region', dir: 'asc' }, { field: 'cases', dir: 'desc' }]),
    );
  });

  it('the glyph pair and the phrase have ONE owner — the readout and the header spend the same two', () => {
    expect([sortArrow('asc'), sortArrow('desc')]).toEqual(['↑', '↓']);
    expect(sortPhraseOf({ field: 'cases', dir: 'desc' })).toBe('cases ↓');
    expect(sortedByWords(ASC)).toBe('sorted by cases ↑');
  });
});
