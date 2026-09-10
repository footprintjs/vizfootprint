/**
 * THE ARRANGEMENT CODEC — the four things a commit carries, both ways.
 *
 * Two properties are what this file is for. The round trip is EXACT (a field
 * named with a comma, a colon or a quote survives it, which is why the value
 * is JSON and not a joined string), and the read is TOTAL: every foreign,
 * stale or half-written value reads as NO sort, because a grid must never be
 * put in an order nobody asked for.
 */
import { describe, expect, it } from 'vitest';
import type { SortSpec } from 'vizfootprint/data';
import type { ArrangeAt } from './arrangement.js';
import { arrangeColumns, arrangeItems, arrangementSaid, arrangementToLayoutValue, arrangementWords, frozenCount, frozenFromLayoutValue, frozenToLayoutValue, hiddenFromLayoutValue, hiddenToLayoutValue, orderFromLayoutValue, orderToLayoutValue, sheetArrangementOf, sheetFrozenOf, sheetHiddenOf, sheetLayoutScope, sheetLayoutViewId, sheetOrderOf, sheetSortOf, sortArrow, sortedByWords, sortFromLayoutValue, sortPhraseOf, sortToLayoutValue, sortWords, SHEET_FROZEN_PROP, SHEET_HIDDEN_PROP, SHEET_LAYOUT_PREFIX, SHEET_ORDER_PROP, SHEET_SORT_PROP } from './arrangement.js';

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

describe('the other three props ride the same road', () => {
  it('each is one prop under the sheet’s own scope, and the readers read only their own', () => {
    const layouts = {
      'sheet:cells': { [SHEET_SORT_PROP]: sortToLayoutValue(ASC), [SHEET_HIDDEN_PROP]: hiddenToLayoutValue(['note']), [SHEET_ORDER_PROP]: orderToLayoutValue(['region']), [SHEET_FROZEN_PROP]: frozenToLayoutValue(3) },
    };
    expect(sheetSortOf(layouts, 'cells')).toEqual(ASC);
    expect(sheetHiddenOf(layouts, 'cells')).toEqual(['note']);
    expect(sheetOrderOf(layouts, 'cells')).toEqual(['region']);
    expect(sheetFrozenOf(layouts, 'cells')).toBe(3);
    // and another sheet on the same dashboard holds none of it
    for (const read of [sheetSortOf, sheetHiddenOf, sheetOrderOf, sheetFrozenOf]) expect(read(layouts, 'other')).toBeUndefined();
  });

  it('round-trips a list of names a joined string could not carry', () => {
    const names = ['a,b', 'c:d', 'e"f'];
    expect(hiddenFromLayoutValue(hiddenToLayoutValue(names))).toEqual(names);
    expect(orderFromLayoutValue(orderToLayoutValue(names))).toEqual(names);
  });

  it('writes “nothing” as the cleared string, so showing every column is still written down', () => {
    expect(hiddenToLayoutValue(undefined)).toBe('');
    expect(hiddenToLayoutValue([])).toBe('');
    expect(orderToLayoutValue(undefined)).toBe('');
    expect(orderToLayoutValue([])).toBe('');
  });

  it('reading a name list back is TOTAL — a duplicate or a blank name is an arrangement nobody asked for', () => {
    for (const read of [hiddenFromLayoutValue, orderFromLayoutValue]) {
      expect(read(undefined)).toBeUndefined();
      expect(read('')).toBeUndefined();
      expect(read('cases,region')).toBeUndefined(); // not JSON
      expect(read('[]')).toBeUndefined();
      expect(read('"cases"')).toBeUndefined();
      expect(read('[7]')).toBeUndefined();
      expect(read('[""]')).toBeUndefined();
      expect(read('["cases","cases"]')).toBeUndefined(); // repaired lists hide the drift that made them
      expect(read('["cases","region"]')).toEqual(['cases', 'region']);
    }
  });

  it('the frozen count has no zero: one column is the grid’s own law, so 1 IS the cleared value', () => {
    expect(frozenToLayoutValue(undefined)).toBe('');
    expect(frozenToLayoutValue(1)).toBe('');
    expect(frozenToLayoutValue(0)).toBe('');
    expect(frozenToLayoutValue(-4)).toBe('');
    expect(frozenToLayoutValue(3)).toBe('3');
    expect(frozenFromLayoutValue(frozenToLayoutValue(3))).toBe(3);
  });

  it('reading a frozen count back is TOTAL — a fraction, a zero or a word is no arrangement', () => {
    expect(frozenFromLayoutValue(undefined)).toBeUndefined();
    expect(frozenFromLayoutValue('')).toBeUndefined();
    expect(frozenFromLayoutValue('two')).toBeUndefined();
    expect(frozenFromLayoutValue('2.5')).toBeUndefined();
    expect(frozenFromLayoutValue('0')).toBeUndefined();
    expect(frozenFromLayoutValue('-2')).toBeUndefined();
    expect(frozenFromLayoutValue('[2]')).toBeUndefined();
    expect(frozenFromLayoutValue('1')).toBe(1); // a wire may still say it out loud
  });

  it('the COUNT an arrangement means has one owner — the value, the words and the grid can never be three numbers', () => {
    expect(frozenCount(undefined)).toBe(1);
    expect(frozenCount(0)).toBe(1);
    expect(frozenCount(1)).toBe(1);
    expect(frozenCount(2.9)).toBe(2);
    expect(frozenCount(Number.NaN)).toBe(1);
    expect(frozenCount(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('one WRITER and one READER for every prop, so the act door has no four-way switch', () => {
    expect(arrangementToLayoutValue('sort', ASC)).toBe(sortToLayoutValue(ASC));
    expect(arrangementToLayoutValue('hidden', ['note'])).toBe('["note"]');
    expect(arrangementToLayoutValue('order', ['region'])).toBe('["region"]');
    expect(arrangementToLayoutValue('frozen', 2)).toBe('2');
    const layouts = { 'sheet:cells': { hidden: '["note"]' } };
    expect(sheetArrangementOf(layouts, 'cells', 'hidden')).toEqual(['note']);
    expect(sheetArrangementOf(undefined, 'cells', 'frozen')).toBeUndefined();
  });
});

describe('arrangeColumns — the visible projection, and the names the table no longer has', () => {
  const ENGINE = ['id', 'region', 'date', 'cases'];

  it('with no arrangement it is the engine’s own order, with the key brought to the front', () => {
    expect(arrangeColumns(ENGINE, 'id', {})).toEqual({ columns: ['id', 'region', 'date', 'cases'], hidden: [], missing: [] });
    expect(arrangeColumns(['region', 'id', 'cases'], 'id', {})).toEqual({ columns: ['id', 'region', 'cases'], hidden: [], missing: [] });
    // a table with no key at all, and a key the answer does not carry: the engine's order, untouched
    expect(arrangeColumns(ENGINE, undefined, {}).columns).toEqual(ENGINE);
    expect(arrangeColumns(ENGINE, 'rowid', {}).columns).toEqual(ENGINE);
  });

  it('hides what the arrangement hides, and says how many actually went', () => {
    const arranged = arrangeColumns(ENGINE, 'id', { hidden: ['date', 'region'] });
    expect(arranged.columns).toEqual(['id', 'cases']);
    expect(arranged.hidden).toEqual(['date', 'region']);
  });

  it('THE KEY IS NEVER HIDDEN — it is the row’s identity, and hiding it would leave a grid nobody can read', () => {
    const arranged = arrangeColumns(ENGINE, 'id', { hidden: ['id', 'date'] });
    expect(arranged.columns).toEqual(['id', 'region', 'cases']);
    // and it is not COUNTED as hidden either: the readout must not say "1 hidden" about a column that is on screen
    expect(arranged.hidden).toEqual(['date']);
  });

  it('leads with the names `order` names, and everything else follows in the engine’s order', () => {
    expect(arrangeColumns(ENGINE, 'id', { order: ['cases'] }).columns).toEqual(['id', 'cases', 'region', 'date']);
    expect(arrangeColumns(ENGINE, 'id', { order: ['cases', 'date'] }).columns).toEqual(['id', 'cases', 'date', 'region']);
    // THE KEY IS NOT MOVABLE out of first place, whatever the order says
    expect(arrangeColumns(ENGINE, 'id', { order: ['cases', 'id'] }).columns).toEqual(['id', 'cases', 'region', 'date']);
  });

  it('hiding wins over leading, and the order keeps the name for when the column comes back', () => {
    const arranged = arrangeColumns(ENGINE, 'id', { order: ['cases', 'date'], hidden: ['cases'] });
    expect(arranged.columns).toEqual(['id', 'date', 'region']);
    expect(arranged.missing).toEqual([]);
  });

  it('R6: a name this table does not have is IGNORED and REPORTED — never a broken grid, never a rewritten trace', () => {
    const arranged = arrangeColumns(ENGINE, 'id', { order: ['rate', 'cases'], hidden: ['note', 'rate'] });
    expect(arranged.columns).toEqual(['id', 'cases', 'region', 'date']);
    expect(arranged.hidden).toEqual([]);
    // said ONCE, whichever prop named it twice
    expect(arranged.missing).toEqual(['rate', 'note']);
  });

  it('is the same law over the columns the engine ANSWERED as over the ones it was asked for', () => {
    const asked = arrangeColumns(ENGINE, 'id', { order: ['cases'], hidden: ['date'] });
    expect(asked.columns).toEqual(['id', 'cases', 'region']);
    // the engine answers the projection (it may re-order it); the drawn order is the same rule again
    expect(arrangeColumns(['cases', 'region', 'id'], 'id', { order: ['cases'], hidden: ['date'] }).columns).toEqual(asked.columns);
  });

  it('hiding every NON-key column on a keyed table leaves the key alone, drawn — this is not "hides every column"', () => {
    const arranged = arrangeColumns(ENGINE, 'id', { hidden: ['region', 'date', 'cases'] });
    // the key survives: a keyed table can never be arranged down to nothing (R3),
    // so the caller's "empty projection" guard never fires here — only a KEYLESS
    // table (see Sheet.test.tsx, "hides EVERY column") can actually reach zero
    expect(arranged.columns).toEqual(['id']);
    expect(arranged.hidden).toEqual(['region', 'date', 'cases']);
    expect(arranged.columns.length).toBeGreaterThan(0);
  });
});

describe('the words for every transition', () => {
  it('a sort states itself whole, and `sortWords` is the same sentence', () => {
    expect(arrangementWords('cells', 'sort', undefined, ASC)).toBe('cells: sorted by cases ↑');
    expect(arrangementWords('cells', 'sort', ASC, undefined)).toBe('cells: sort cleared');
    expect(arrangementWords('cells', 'sort', ASC, [])).toBe('cells: sort cleared');
    expect(arrangementWords('cells', 'sort', undefined, ASC)).toBe(sortWords('cells', ASC));
  });

  it('hiding and showing ONE column name it', () => {
    expect(arrangementWords('cells', 'hidden', undefined, ['cases'])).toBe('cells: hid cases');
    expect(arrangementWords('cells', 'hidden', ['note'], ['note', 'cases'])).toBe('cells: hid cases');
    expect(arrangementWords('cells', 'hidden', ['note', 'cases'], ['note'])).toBe('cells: showed cases');
  });

  it('a whole list at once is counted, and showing everything says what it did', () => {
    expect(arrangementWords('cells', 'hidden', undefined, ['a', 'b', 'c'])).toBe('cells: hid 3 columns');
    // a swap is neither a hide nor a show of one name
    expect(arrangementWords('cells', 'hidden', ['a'], ['b'])).toBe('cells: hid 1 column');
    expect(arrangementWords('cells', 'hidden', ['a', 'b'], [])).toBe('cells: showed every column');
    expect(arrangementWords('cells', 'hidden', ['a', 'b'], undefined)).toBe('cells: showed every column');
  });

  it('a column pulled to the front says so; any other order states itself whole', () => {
    expect(arrangementWords('cells', 'order', undefined, ['region'])).toBe('cells: moved region first');
    expect(arrangementWords('cells', 'order', ['region', 'date'], ['date', 'region'])).toBe('cells: moved date first');
    expect(arrangementWords('cells', 'order', ['region', 'date', 'cases'], ['region', 'cases', 'date'])).toBe('cells: order region, cases, date');
    expect(arrangementWords('cells', 'order', ['region'], [])).toBe('cells: order cleared');
    expect(arrangementWords('cells', 'order', ['region'], undefined)).toBe('cells: order cleared');
  });

  it('freezing counts the columns, and coming back to one is UNFREEZING — never “froze 1 column”', () => {
    expect(arrangementWords('cells', 'frozen', undefined, 2)).toBe('cells: froze 2 columns');
    expect(arrangementWords('cells', 'frozen', 3, 1)).toBe('cells: unfroze');
    expect(arrangementWords('cells', 'frozen', 3, undefined)).toBe('cells: unfroze');
    expect(arrangementWords('cells', 'frozen', 1, 2.7)).toBe('cells: froze 2 columns'); // one owner of the count
  });
});

describe('what one header’s menu offers', () => {
  const AT: ArrangeAt = { drawn: ['id', 'region', 'date', 'cases'], key: 'id', hidden: undefined, order: undefined, frozen: undefined };
  const labels = (name: string, at: ArrangeAt = AT): string[] => arrangeItems(name, at).map((item) => item.label);
  const act = (name: string, label: string, at: ArrangeAt = AT): [string, unknown] => {
    const item = arrangeItems(name, at).find((i) => i.label === label)!;
    return [item.prop, item.value];
  };

  it('offers the four gestures where they would change something, and not where they would not', () => {
    expect(labels('region')).toEqual(['hide', 'move right', 'freeze up to here']); // already first among the movable
    expect(labels('date')).toEqual(['hide', 'move left', 'move right', 'move first', 'freeze up to here']);
    expect(labels('cases')).toEqual(['hide', 'move left', 'move first', 'freeze up to here']); // already last
  });

  it('THE KEY offers nothing to hide and nothing to move — it is the row’s identity (R3)', () => {
    expect(labels('id')).toEqual([]); // one frozen column is already the law: there is nothing to do
    expect(labels('id', { ...AT, frozen: 3 })).toEqual(['unfreeze']);
  });

  it('a column the grid is not drawing has no menu at all', () => {
    expect(labels('rate')).toEqual([]);
  });

  it('each item is ONE (prop, value) act the codec would accept', () => {
    expect(act('date', 'hide')).toEqual(['hidden', ['date']]);
    expect(act('date', 'hide', { ...AT, hidden: ['note'] })).toEqual(['hidden', ['note', 'date']]);
    // hiding a column the list already names does not name it twice — the codec refuses a duplicate
    expect(act('date', 'hide', { ...AT, hidden: ['date'] })).toEqual(['hidden', ['date']]);
    // a swap names every movable column, because it cannot be said any shorter
    expect(act('date', 'move left')).toEqual(['order', ['date', 'region', 'cases']]);
    expect(act('date', 'move right')).toEqual(['order', ['region', 'cases', 'date']]);
    // …and "move first" lands the LEADING order, which is what makes the rail read "moved date first"
    expect(act('date', 'move first')).toEqual(['order', ['date']]);
    expect(act('date', 'move first', { ...AT, order: ['cases', 'date'] })).toEqual(['order', ['date', 'cases']]);
  });

  it('freezing counts from the key, by where the column is DRAWN', () => {
    expect(act('region', 'freeze up to here')).toEqual(['frozen', 2]);
    expect(act('cases', 'freeze up to here')).toEqual(['frozen', 4]);
    // where it already is, the item is the way BACK instead
    expect(labels('region', { ...AT, frozen: 2 })).toEqual(['hide', 'move right', 'unfreeze']);
    expect(act('region', 'unfreeze', { ...AT, frozen: 2 })).toEqual(['frozen', undefined]);
    // and past it, freezing is still on offer
    expect(labels('date', { ...AT, frozen: 2 })).toContain('freeze up to here');
  });

  it('a table with no key at all lets its first column move like any other', () => {
    const at = { ...AT, drawn: ['region', 'cases'], key: undefined };
    // …and the FIRST drawn column is already the one that stays put, so it offers no freeze
    expect(labels('region', at)).toEqual(['hide', 'move right']);
    expect(labels('cases', at)).toEqual(['hide', 'move left', 'move first', 'freeze up to here']);
  });
});

describe('what the status line says about the arrangement itself', () => {
  it('says nothing when the trace and the table agree', () => {
    expect(arrangementSaid({ key: 'id', hidden: ['note'], missing: [], empty: false })).toEqual([]);
    expect(arrangementSaid({ key: undefined, hidden: undefined, missing: [], empty: false })).toEqual([]);
  });

  it('R3: a trace that hides the KEY is refused in words, and the column stays', () => {
    expect(arrangementSaid({ key: 'id', hidden: ['id'], missing: [], empty: false })).toEqual(["the key column id is the row's identity — it cannot be hidden"]);
  });

  it('R6: a name this table does not have is said once — never a broken grid, never a rewritten trace', () => {
    expect(arrangementSaid({ key: 'id', hidden: undefined, missing: ['rate'], empty: false })).toEqual(['the arrangement names rate, which this table does not have']);
    expect(arrangementSaid({ key: 'id', hidden: undefined, missing: ['rate', 'note'], empty: false })).toEqual(['the arrangement names rate, note, which this table does not have']);
  });

  it('an arrangement that hides everything says so, rather than showing the whole table back', () => {
    expect(arrangementSaid({ key: undefined, hidden: ['a'], missing: [], empty: true })).toEqual(['the arrangement hides every column — show one to read the rows']);
  });
});
