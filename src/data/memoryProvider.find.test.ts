/**
 * FIND on the memory engine: where the next match is, in the order the reader
 * is standing in — forward and backward, the honest ends (no match ahead while
 * matches exist behind), case-insensitivity, the columns actually looked in,
 * the positions under a SORT, and the `bad-find` matrix.
 *
 * A find never changes the view: every assertion here reads `matches` (the
 * whole view's count) beside `position`, which is the pair a reader is owed.
 */
import { describe, it, expect } from 'vitest';
import { memoryProvider } from './memoryProvider.js';
import { isRejection } from './types.js';
import type { DataProviderRejection, FindOptions, FindResult, Row } from './types.js';

const ROWS: Row[] = [
  { id: 'a', fruit: 'pear', n: 3, note: 'ripe' },
  { id: 'b', fruit: 'apple', n: 12, note: 'green' },
  { id: 'c', fruit: 'fig', n: 1, note: 'APPLE season' },
  { id: 'd', fruit: 'Apple', n: 3, note: 'red' },
  { id: 'e', fruit: 'date', n: 2, note: 'dry' },
  { id: 'f', fruit: 'pineapple', n: 21, note: 'tinned' },
];

const ask = (over: Partial<FindOptions> = {}): FindOptions => ({ text: 'apple', columns: ['fruit'], from: 0, direction: 'forward', ...over });

/** The answer, or a failing expectation naming the refusal — a rejection is never read as "no match". */
function found(answer: FindResult | DataProviderRejection): FindResult {
  if (isRejection(answer)) throw new Error(`refused: ${(answer as DataProviderRejection).detail ?? (answer as DataProviderRejection).reason}`);
  return answer;
}

/** …and the HIT shape, which is the only one carrying an ordinal, an index and a row — the type says so, so a test reads them only after saying which it expects. */
function hit(answer: FindResult | DataProviderRejection): Extract<FindResult, { readonly position: number }> {
  const answered = found(answer);
  if (answered.position === null) throw new Error(`no match where one was expected: ${JSON.stringify(answered)}`);
  return answered;
}

describe.each(['row', 'column'] as const)('memoryProvider.find (%s layout)', (layout) => {
  const p = () => memoryProvider(ROWS, { layout });

  it('declares it can find, and answers the FIRST match at or after `from` with its position, its 1-based ordinal, its source index and its row', async () => {
    const prov = p();
    expect(prov.capabilities.canFind).toBe(true);
    const first = found(await prov.find!('data', null, ask()));
    // 'apple' is in b (apple), d (Apple) and f (pineapple) — three of six rows
    expect(first).toEqual({ sql: 'null', matches: 3, position: 1, ordinal: 1, index: 1, row: ROWS[1] });
    // …and the descriptor is the VIEW's, so it is the same one `evaluate` reports for no filter
    const next = hit(await prov.find!('data', null, ask({ from: 2 })));
    expect([next.position, next.ordinal, next.index]).toEqual([3, 2, 3]);
    const last = hit(await prov.find!('data', null, ask({ from: 4 })));
    expect([last.position, last.ordinal, last.index]).toEqual([5, 3, 5]);
  });

  it('BACKWARD answers the LAST match at or before `from` — and both ends are honest: no match that way, with the matches still counted', async () => {
    const prov = p();
    const back = hit(await prov.find!('data', null, ask({ from: 4, direction: 'backward' })));
    expect([back.position, back.ordinal]).toEqual([3, 2]);
    const wrapless = found(await prov.find!('data', null, ask({ from: 0, direction: 'backward' })));
    expect(wrapless.position).toBeNull();
    expect(wrapless.matches).toBe(3); // the matches are all AHEAD: the caller wraps, this door never does
    // a MISS carries nothing to name: no ordinal, no source index, no row — the
    // type forbids reading them, and the answer really does not hold them
    expect(Object.keys(wrapless).sort()).toEqual(['matches', 'position', 'sql']);
    const past = found(await prov.find!('data', null, ask({ from: 6 })));
    expect([past.position, past.matches]).toEqual([null, 3]);
  });

  it('matches case-insensitively, as a SUBSTRING, and only in the columns it was told to look in', async () => {
    const prov = p();
    expect(found(await prov.find!('data', null, ask({ text: 'APPLE' }))).matches).toBe(3);
    expect(found(await prov.find!('data', null, ask({ text: 'PEAR' }))).position).toBe(0);
    // the note column holds 'APPLE season'; looking only in `fruit` never sees it
    expect(found(await prov.find!('data', null, ask({ text: 'season' }))).matches).toBe(0);
    expect(found(await prov.find!('data', null, ask({ text: 'season', columns: ['note'] }))).position).toBe(2);
    // two columns are an OR over the row: any cell holding it makes the row a match
    expect(found(await prov.find!('data', null, ask({ columns: ['fruit', 'note'] }))).matches).toBe(4);
  });

  it('looks at the TEXT FORM of a non-text cell, so a number is searchable as its digits', async () => {
    const prov = p();
    expect(found(await prov.find!('data', null, ask({ text: '3', columns: ['n'] }))).matches).toBe(2); // 3 and 3
    // a SUBSTRING of the digits, which is what a person typing into a find strip means
    const two = found(await prov.find!('data', null, ask({ text: '2', columns: ['n'] })));
    expect([two.matches, two.position]).toEqual([3, 1]); // 12, 2, 21
  });

  it('counts positions in the SORTED view when it is given a sort — the same permutation a window walks', async () => {
    const prov = p();
    const sort = [{ field: 'fruit' as const, dir: 'asc' as const }];
    // sorted by fruit: Apple(d), apple(b), date(e), fig(c), pear(a), pineapple(f)
    const first = hit(await prov.find!('data', null, ask({ sort })));
    expect([first.position, first.ordinal, first.index]).toEqual([0, 1, 3]);
    const third = hit(await prov.find!('data', null, ask({ sort, from: 2 })));
    expect([third.position, third.ordinal, third.index]).toEqual([5, 3, 5]);
    const back = hit(await prov.find!('data', null, ask({ sort, from: 4, direction: 'backward' })));
    expect([back.position, back.ordinal]).toEqual([1, 2]);
  });

  it('a find sees only what the FILTER kept — positions and counts are the view\'s, never the table\'s', async () => {
    const prov = p();
    const clause = { kind: 'interval' as const, field: 'n', value: [2, 13] as readonly [number, number] };
    // n in [2,13] keeps a(3), b(12), d(3), e(2) — four rows, in that order
    const answer = found(await prov.find!('data', clause, ask()));
    expect(answer.matches).toBe(2); // apple(b) and Apple(d); pineapple(f) is filtered out at n=21
    expect(answer.position).toBe(1); // the view is a, b, d, e — b is position 1
    expect(answer.sql).toContain('BETWEEN');
    const back = hit(await prov.find!('data', clause, ask({ from: 3, direction: 'backward' })));
    expect([back.position, back.ordinal]).toEqual([2, 2]);
  });

  it('refuses a malformed ask in ONE word and ONE sentence each — the `bad-find` matrix', async () => {
    const prov = p();
    const refusal = async (over: Partial<FindOptions>): Promise<DataProviderRejection> => (await prov.find!('data', null, ask(over))) as DataProviderRejection;
    for (const [over, sentence] of [
      [{ text: '' }, 'a find needs something to look for — the text was empty'],
      [{ text: '   ' }, 'a find needs something to look for — the text was empty'],
      [{ from: -1 }, 'from must be a whole number at or above zero (got -1)'],
      [{ from: 1.5 }, 'from must be a whole number at or above zero (got 1.5)'],
      [{ direction: 'sideways' as unknown as 'forward' }, 'direction must be "forward" or "backward" (got "sideways")'],
      [{ columns: [] }, 'a find needs at least one column to look in'],
    ] as const) {
      const said = await refusal(over as Partial<FindOptions>);
      expect(said.reason, JSON.stringify(over)).toBe('bad-find');
      expect(said.operation).toBe('find');
      expect(said.detail).toBe(sentence);
    }
  });

  it('refuses an unknown table, an unknown column to look in, an unknown clause column and an unknown sort key — in `evaluate`\'s own words', async () => {
    const prov = p();
    const nope = (await prov.find!('nope', null, ask())) as DataProviderRejection;
    expect([nope.reason, nope.detail]).toEqual(['unknown-table', 'no such table "nope"']);
    const column = (await prov.find!('data', null, ask({ columns: ['ghost'] }))) as DataProviderRejection;
    expect([column.reason, column.detail]).toEqual(['unknown-column', 'table "data" has no column "ghost" to look in']);
    const sort = (await prov.find!('data', null, ask({ sort: [{ field: 'ghost', dir: 'asc' }] }))) as DataProviderRejection;
    expect([sort.reason, sort.detail]).toEqual(['unknown-column', 'table "data" has no column "ghost" to sort by']);
    const clause = (await prov.find!('data', { kind: 'point', field: 'ghost', value: 1 }, ask())) as DataProviderRejection;
    expect([clause.reason, clause.detail]).toEqual(['unknown-column', 'table "data" has no column "ghost"']);
  });

  it('an EMPTY table knows no columns, so it judges none — and honestly finds nothing', async () => {
    const empty = memoryProvider([] as Row[], { layout });
    const answer = found(await empty.find!('data', null, ask({ columns: ['whatever'] })));
    expect(answer).toEqual({ sql: 'null', matches: 0, position: null });
  });
});
