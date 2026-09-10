/**
 * sqlWindow.test.ts — pins the STATEMENT, byte for byte. Every string in here
 * is what an engine will actually run, so a change to the builder that reorders
 * a clause, drops a `NULLS LAST`, or renders `WHERE null` fails here rather
 * than in a browser, where a silently empty answer looks like an empty table.
 */
import { describe, it, expect } from 'vitest';
import { windowSQL, ROW_ORDER_COLUMN, WindowRefusal } from './sqlWindow.js';
import { resolvePredicateSQL } from './predicate.js';
import type { EvaluateOptions, SortSpec } from './types.js';

const WHERE = '("state" IN (\'TX\'))';

describe('windowSQL — rows mode', () => {
  it('the plainest window: no options at all is every column, every row, no WHERE', () => {
    expect(windowSQL('cases', '')).toBe('SELECT * FROM "cases"');
  });

  it('a fragment becomes the WHERE, and nothing else moves', () => {
    expect(windowSQL('cases', WHERE)).toBe('SELECT * FROM "cases" WHERE ("state" IN (\'TX\'))');
  });

  it('a column projection is quoted, in the order asked', () => {
    expect(windowSQL('cases', WHERE, { columns: ['state', 'count'] })).toBe(
      'SELECT "state", "count" FROM "cases" WHERE ("state" IN (\'TX\'))',
    );
  });

  it('LIMIT and OFFSET come last, in that order', () => {
    expect(windowSQL('cases', WHERE, { limit: 50, offset: 100 })).toBe(
      'SELECT * FROM "cases" WHERE ("state" IN (\'TX\')) LIMIT 50 OFFSET 100',
    );
  });

  it('zero is a whole number at or above zero: LIMIT 0 and OFFSET 0 are rendered, not dropped', () => {
    expect(windowSQL('cases', '', { limit: 0, offset: 0 })).toBe('SELECT * FROM "cases" LIMIT 0 OFFSET 0');
  });

  it('an OFFSET with no LIMIT is a window too', () => {
    expect(windowSQL('cases', '', { offset: 7 })).toBe('SELECT * FROM "cases" OFFSET 7');
  });

  it('mode: rows said out loud is the default', () => {
    expect(windowSQL('cases', WHERE, { mode: 'rows' })).toBe(windowSQL('cases', WHERE));
  });
});

describe('windowSQL — the empty WHERE', () => {
  it('an empty fragment renders no WHERE — and neither does whitespace', () => {
    expect(windowSQL('cases', '')).toBe('SELECT * FROM "cases"');
    expect(windowSQL('cases', '   ')).toBe('SELECT * FROM "cases"');
  });

  it("the cleared descriptor is NOT rendered — `WHERE null` would answer zero rows and invert an empty selection's meaning", () => {
    const cleared = resolvePredicateSQL(null); // 'null' — the one spelling both routes produce
    expect(cleared).toBe('null');
    expect(windowSQL('cases', cleared)).toBe('SELECT * FROM "cases"');
    expect(windowSQL('cases', cleared, { mode: 'count' })).toBe('SELECT COUNT(*) AS n FROM "cases"');
  });
});

describe('windowSQL — ORDER BY', () => {
  it('one key: direction and null placement are both spelled out (never left to `default_null_order`)', () => {
    expect(windowSQL('cases', '', { sort: [{ field: 'count', dir: 'desc' }] })).toBe(
      'SELECT * FROM "cases" ORDER BY "count" DESC NULLS LAST',
    );
  });

  it('multi-key with mixed directions and mixed absent ends, in the order given', () => {
    const sort: readonly SortSpec[] = [
      { field: 'state', dir: 'asc' },
      { field: 'count', dir: 'desc', absent: 'first' },
      { field: 'week', dir: 'asc', absent: 'last' },
    ];
    expect(windowSQL('cases', WHERE, { sort })).toBe(
      'SELECT * FROM "cases" WHERE ("state" IN (\'TX\')) ' +
        'ORDER BY "state" ASC NULLS LAST, "count" DESC NULLS FIRST, "week" ASC NULLS LAST',
    );
  });

  it('an empty sort is no sort — no ORDER BY appears', () => {
    expect(windowSQL('cases', '', { sort: [] })).toBe('SELECT * FROM "cases"');
  });

  it('the whole statement, every clause at once', () => {
    const options: EvaluateOptions = {
      columns: ['state', 'count'],
      sort: [{ field: 'count', dir: 'desc' }],
      limit: 25,
      offset: 50,
    };
    expect(windowSQL('cases', WHERE, options)).toBe(
      'SELECT "state", "count" FROM "cases" WHERE ("state" IN (\'TX\')) ORDER BY "count" DESC NULLS LAST LIMIT 25 OFFSET 50',
    );
  });
});

describe('windowSQL — count mode', () => {
  it('count is COUNT(*) AS n, with the same WHERE', () => {
    expect(windowSQL('cases', WHERE, { mode: 'count' })).toBe('SELECT COUNT(*) AS n FROM "cases" WHERE ("state" IN (\'TX\'))');
  });

  it('count carries NO ORDER BY, LIMIT or OFFSET — a count is one row, and a window would cap the answer instead of the rows counted', () => {
    const options: EvaluateOptions = {
      mode: 'count',
      columns: ['state'],
      sort: [{ field: 'count', dir: 'desc' }],
      limit: 10,
      offset: 20,
      indices: true,
    };
    expect(windowSQL('cases', WHERE, options)).toBe('SELECT COUNT(*) AS n FROM "cases" WHERE ("state" IN (\'TX\'))');
  });

  it('a sort key outside the projection is NOT refused in count mode — no ORDER BY is rendered, and every order counts the same', () => {
    const options: EvaluateOptions = { mode: 'count', columns: ['state'], sort: [{ field: 'count', dir: 'asc' }] };
    expect(windowSQL('cases', '', options)).toBe('SELECT COUNT(*) AS n FROM "cases"');
  });

  it('rows and count answer the same predicate: the count statement is the rows statement with the window taken off', () => {
    expect(windowSQL('cases', WHERE, { mode: 'count' })).toBe('SELECT COUNT(*) AS n FROM "cases" WHERE ("state" IN (\'TX\'))');
    expect(windowSQL('cases', WHERE)).toBe('SELECT * FROM "cases" WHERE ("state" IN (\'TX\'))');
  });
});

describe(`windowSQL — the ${ROW_ORDER_COLUMN} source-order convention`, () => {
  it('the convention is one name, owned here', () => {
    expect(ROW_ORDER_COLUMN).toBe('__row');
  });

  it('indices with a projection appends the row-order column, after the columns asked for', () => {
    expect(windowSQL('cases', '', { columns: ['state'], indices: true })).toBe('SELECT "state", "__row" FROM "cases"');
  });

  it('a caller who already asked for it does not get it twice', () => {
    expect(windowSQL('cases', '', { columns: [ROW_ORDER_COLUMN, 'state'], indices: true })).toBe(
      'SELECT "__row", "state" FROM "cases"',
    );
  });

  it('indices without a projection stays `*` — a loaded table already carries the column, and naming it again would return two of it', () => {
    expect(windowSQL('cases', '', { indices: true })).toBe('SELECT * FROM "cases"');
  });

  it('the appended column is IN the answer, so sorting by it is allowed', () => {
    expect(windowSQL('cases', '', { columns: ['state'], indices: true, sort: [{ field: ROW_ORDER_COLUMN, dir: 'asc' }] })).toBe(
      'SELECT "state", "__row" FROM "cases" ORDER BY "__row" ASC NULLS LAST',
    );
  });

  it('without `indices` it is ordered by and not returned — the order is a claim about rows, not about columns', () => {
    expect(windowSQL('cases', '', { columns: ['state'], sort: [{ field: ROW_ORDER_COLUMN, dir: 'asc' }] })).toBe(
      'SELECT "state" FROM "cases" ORDER BY "__row" ASC NULLS LAST',
    );
  });
});

describe('windowSQL — the tie-break every rendered order ends in', () => {
  const LOADED = { hasRowOrder: true };
  const SORT: readonly SortSpec[] = [{ field: 'count', dir: 'desc' }];

  it('a table this engine loaded gets the source-order column as the LAST key', () => {
    // WHY it matters: without it, `ORDER BY "count" DESC` over tied rows is not
    // a total order, and page 2 of the window is a second scan that may serve a
    // row page 1 already served (measured at 300k rows: ids 6 and 9 twice).
    expect(windowSQL('cases', '', { sort: SORT, limit: 3, offset: 3 }, LOADED)).toBe(
      'SELECT * FROM "cases" ORDER BY "count" DESC NULLS LAST, "__row" ASC LIMIT 3 OFFSET 3',
    );
  });

  it('…after EVERY asked-for key, never among them', () => {
    expect(windowSQL('cases', '', { sort: [...SORT, { field: 'state', dir: 'asc' }] }, LOADED)).toBe(
      'SELECT * FROM "cases" ORDER BY "count" DESC NULLS LAST, "state" ASC NULLS LAST, "__row" ASC',
    );
  });

  it('and it adds no COLUMN to the answer: a projection is what comes back, an order is not', () => {
    expect(windowSQL('cases', '', { columns: ['state'], sort: SORT }, LOADED)).toBe(
      'SELECT "state" FROM "cases" ORDER BY "count" DESC NULLS LAST, "__row" ASC',
    );
  });

  it('no sort and no window is still no ORDER BY — an unasked order over a whole read is not a promise this builder invents', () => {
    expect(windowSQL('cases', '', {}, LOADED)).toBe('SELECT * FROM "cases"');
    expect(windowSQL('cases', '', { sort: [] }, LOADED)).toBe('SELECT * FROM "cases"');
    expect(windowSQL('cases', '', { indices: true }, LOADED)).toBe('SELECT * FROM "cases"');
  });

  it('count mode renders no order at all, so there is nothing to break a tie in', () => {
    expect(windowSQL('cases', WHERE, { mode: 'count', sort: SORT }, LOADED)).toBe(
      'SELECT COUNT(*) AS n FROM "cases" WHERE ("state" IN (\'TX\'))',
    );
  });

  it('a caller who ordered by it already gets ONE key, not two', () => {
    expect(windowSQL('cases', '', { sort: [{ field: ROW_ORDER_COLUMN, dir: 'desc' }] }, LOADED)).toBe(
      'SELECT * FROM "cases" ORDER BY "__row" DESC NULLS LAST',
    );
  });

  it('a table this engine did NOT load gets no such key — ordering by a column it lacks is an error, not a tie-break', () => {
    expect(windowSQL('cases', '', { sort: SORT }, { hasRowOrder: false })).toBe('SELECT * FROM "cases" ORDER BY "count" DESC NULLS LAST');
    expect(windowSQL('cases', '', { sort: SORT })).toBe('SELECT * FROM "cases" ORDER BY "count" DESC NULLS LAST');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ORDER AN UNSORTED PAGE GETS.
// ─────────────────────────────────────────────────────────────────────────────
//
// The tie-break's reason with the sort taken away: an unsorted window has no
// total order either (every row is tied with every other), and a page is a
// second scan of the same table. DuckDB promises no scan order, so page 2 of
// `LIMIT 50` can repeat what page 1 served. The sheet pages unsorted, so this
// is the DEFAULT window. A full unpaged read has no boundary for a row to fall
// on the wrong side of, and stays unordered.

describe('windowSQL — an unsorted PAGE is served in source order', () => {
  const LOADED = { hasRowOrder: true };

  it('a LIMIT with no sort renders the source-order column as the whole order — exactly this SQL', () => {
    expect(windowSQL('cases', '', { limit: 50 }, LOADED)).toBe('SELECT * FROM "cases" ORDER BY "__row" ASC LIMIT 50');
  });

  it('…and a table this engine did NOT load renders no order at all: it has no such column to name', () => {
    expect(windowSQL('cases', '', { limit: 50 }, { hasRowOrder: false })).toBe('SELECT * FROM "cases" LIMIT 50');
    expect(windowSQL('cases', '', { limit: 50 })).toBe('SELECT * FROM "cases" LIMIT 50');
  });

  it('an OFFSET alone is a page boundary too, and an empty sort is no sort', () => {
    expect(windowSQL('cases', '', { offset: 7 }, LOADED)).toBe('SELECT * FROM "cases" ORDER BY "__row" ASC OFFSET 7');
    expect(windowSQL('cases', '', { sort: [], limit: 3, offset: 3 }, LOADED)).toBe(
      'SELECT * FROM "cases" ORDER BY "__row" ASC LIMIT 3 OFFSET 3',
    );
  });

  it('LIMIT 0 and OFFSET 0 are windows, so they are ordered too — a whole number at or above zero is a boundary', () => {
    expect(windowSQL('cases', '', { limit: 0, offset: 0 }, LOADED)).toBe('SELECT * FROM "cases" ORDER BY "__row" ASC LIMIT 0 OFFSET 0');
  });

  it('the order comes after the WHERE and adds no column to the answer', () => {
    expect(windowSQL('cases', WHERE, { columns: ['state'], limit: 25, offset: 50 }, LOADED)).toBe(
      'SELECT "state" FROM "cases" WHERE ("state" IN (\'TX\')) ORDER BY "__row" ASC LIMIT 25 OFFSET 50',
    );
  });

  it('count mode is still one row: a window there would cap the answer, so it renders neither the window nor an order', () => {
    expect(windowSQL('cases', '', { mode: 'count', limit: 50 }, LOADED)).toBe('SELECT COUNT(*) AS n FROM "cases"');
  });

  it('an asked-for sort still owns the order — the unsorted rule adds nothing to it', () => {
    expect(windowSQL('cases', '', { sort: [{ field: 'count', dir: 'desc' }], limit: 50 }, LOADED)).toBe(
      'SELECT * FROM "cases" ORDER BY "count" DESC NULLS LAST, "__row" ASC LIMIT 50',
    );
  });
});

describe('windowSQL — the two refusals', () => {
  const badNumbers: ReadonlyArray<readonly [string, EvaluateOptions, string]> = [
    ['a negative limit', { limit: -1 }, 'limit must be a whole number at or above zero (got -1)'],
    ['a fractional limit', { limit: 2.5 }, 'limit must be a whole number at or above zero (got 2.5)'],
    ['a negative offset', { offset: -10 }, 'offset must be a whole number at or above zero (got -10)'],
    ['a fractional offset', { offset: 0.5 }, 'offset must be a whole number at or above zero (got 0.5)'],
    ['NaN', { limit: Number.NaN }, 'limit must be a whole number at or above zero (got NaN)'],
    ['Infinity', { offset: Number.POSITIVE_INFINITY }, 'offset must be a whole number at or above zero (got Infinity)'],
  ];

  for (const [what, options, sentence] of badNumbers) {
    it(`bad-window: ${what} is refused in one sentence that names only the wrong value`, () => {
      expect(() => windowSQL('cases', WHERE, options)).toThrow(WindowRefusal);
      try {
        windowSQL('cases', WHERE, options);
        expect.unreachable('a malformed window must be refused');
      } catch (error) {
        expect(error).toBeInstanceOf(WindowRefusal);
        expect((error as WindowRefusal).reason).toBe('bad-window');
        expect((error as WindowRefusal).message).toBe(sentence);
        expect((error as WindowRefusal).name).toBe('WindowRefusal');
      }
    });
  }

  it('bad-window is refused in COUNT mode too — flipping the mode cannot launder a bad number', () => {
    expect(() => windowSQL('cases', WHERE, { mode: 'count', offset: -1 })).toThrow(WindowRefusal);
  });

  it('a limit is judged before an offset — the caller is told about one wrong value at a time', () => {
    try {
      windowSQL('cases', '', { limit: -1, offset: -2 });
      expect.unreachable('a malformed window must be refused');
    } catch (error) {
      expect((error as WindowRefusal).message).toBe('limit must be a whole number at or above zero (got -1)');
    }
  });

  it('a key the projection drops is ORDERED BY, not refused: SQL allows it, and the memory engine has always answered it', () => {
    // The one law both engines keep (src/data/README.md): the sort is about
    // WHICH ROWS COME FIRST, the projection about which columns come back.
    expect(windowSQL('cases', WHERE, { columns: ['state', 'week'], sort: [{ field: 'count', dir: 'desc' }] })).toBe(
      'SELECT "state", "week" FROM "cases" WHERE ("state" IN (\'TX\')) ORDER BY "count" DESC NULLS LAST',
    );
  });

  it('bad-window is the ONE thing a pure builder refuses — there is no second reason left', () => {
    expect(new WindowRefusal('bad-window', 'said once').reason).toBe('bad-window');
  });

  it('no projection is no refusal — `*` puts every column in the answer, so any key is visible', () => {
    expect(windowSQL('cases', '', { sort: [{ field: 'count', dir: 'asc' }] })).toBe(
      'SELECT * FROM "cases" ORDER BY "count" ASC NULLS LAST',
    );
  });

  it('a refusal is a real Error, so a provider can let it travel', () => {
    const refusal = new WindowRefusal('bad-window', 'said once');
    expect(refusal).toBeInstanceOf(Error);
    expect(String(refusal)).toBe('WindowRefusal: said once');
  });
});

describe('windowSQL — quoting', () => {
  it('a name carrying a double quote has it doubled, in the table, the projection and the ORDER BY', () => {
    const options: EvaluateOptions = { columns: ['we"ird'], sort: [{ field: 'we"ird', dir: 'asc' }] };
    expect(windowSQL('ta"ble', '', options)).toBe('SELECT "we""ird" FROM "ta""ble" ORDER BY "we""ird" ASC NULLS LAST');
  });

  it('the same quoting rule reaches the count statement', () => {
    expect(windowSQL('ta"ble', '', { mode: 'count' })).toBe('SELECT COUNT(*) AS n FROM "ta""ble"');
  });

  it('a name with a space or a keyword needs no special case — every identifier is quoted', () => {
    expect(windowSQL('order by', '', { columns: ['select', 'a b'] })).toBe('SELECT "select", "a b" FROM "order by"');
  });
});
