/**
 * landing.test.ts — THE BYTES A LANDING REGISTERS, THE TYPES IT DECLARES, AND
 * THE STATEMENT THAT READS THEM, PINNED.
 *
 * Every rule in `landing.ts` is a byte someone can diff: which DuckDB type a
 * column is declared as, how each kind of cell is written, what the header
 * looks like, what each reader is told — for rows, and for a def's own CSV
 * text typed by the same law. The proof that the engine reads those bytes back
 * as the memory engine holds them is the FIDELITY table in
 * `engineInvariant.test.ts`; this file is what that proof rests on.
 */
import { describe, it, expect } from 'vitest';
import { csvLandingOf, csvReaderSQL, landedColumnsOf, landedTypeOf, rowsReaderSQL, rowsLandingOf, NO_CSV_HEADER, NO_ROWS_TO_LAND, NULL_TOKEN } from './landing.js';

describe('a column s landed type is tallied from every value in it — the memory engine s rule, in DuckDB s words', () => {
  it('safe integers, nulls among them, are a BIGINT — a find then renders `15`, as the memory engine does', () => {
    expect(landedTypeOf([1, null, 15, -0, Number.MAX_SAFE_INTEGER, undefined])).toBe('BIGINT');
  });

  it('one decimal makes the column a DOUBLE', () => {
    expect(landedTypeOf([1, 2.5])).toBe('DOUBLE');
  });

  it('an integer beyond the safe range is a DOUBLE too — a BIGINT could not hold what JS holds', () => {
    expect(landedTypeOf([1, 1e21])).toBe('DOUBLE');
  });

  it('NaN and Infinity land as NULL, so they say nothing about the type: the column stays a BIGINT', () => {
    expect(landedTypeOf([1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])).toBe('BIGINT');
  });

  it('booleans are a BOOLEAN, Date objects a TIMESTAMP, strings a VARCHAR', () => {
    expect(landedTypeOf([true, null, false])).toBe('BOOLEAN');
    expect(landedTypeOf([new Date(0), null])).toBe('TIMESTAMP');
    expect(landedTypeOf(['a', null, '2026-04-05'])).toBe('VARCHAR');
  });

  it('an ISO date STRING is a string — never sniffed into a date, which is what the engine s own sniffer did and drifted on', () => {
    expect(landedTypeOf(['2026-04-05', '2026-04-05T10:20:30Z'])).toBe('VARCHAR');
  });

  it('a column of nothing but nulls is a VARCHAR — it reads every null back as null, and the memory engine calls it `unknown` either way', () => {
    expect(landedTypeOf([null, undefined])).toBe('VARCHAR');
    expect(landedTypeOf([])).toBe('VARCHAR');
  });

  it('a mixed column is a VARCHAR — the memory engine calls it `string` too', () => {
    expect(landedTypeOf([1, 'a'])).toBe('VARCHAR');
    expect(landedTypeOf([true, 1])).toBe('VARCHAR');
  });
});

describe('the text: a header of quoted names, one line per row, every cell written by its column s type', () => {
  it('numbers are bare digits, `-0` keeps its sign, a non-finite number is the null token', () => {
    const { text, columns } = rowsLandingOf([{ f: 12.5 }, { f: -0 }, { f: Number.NaN }, { f: Number.POSITIVE_INFINITY }, { f: 1e21 }, { f: null }]);
    expect(columns).toEqual([{ name: 'f', type: 'DOUBLE' }]);
    expect(text).toBe(`"f"\n12.5\n-0\n${NULL_TOKEN}\n${NULL_TOKEN}\n1e+21\n${NULL_TOKEN}\n`);
  });

  it('booleans are `true`/`false`, a null among them the token', () => {
    expect(rowsLandingOf([{ b: true }, { b: null }, { b: false }]).text).toBe(`"b"\ntrue\n${NULL_TOKEN}\nfalse\n`);
  });

  it('Date objects are ISO instants; an invalid Date is absent, so the token', () => {
    const { text, columns } = rowsLandingOf([{ o: new Date('2026-04-05T10:20:30.123Z') }, { o: new Date(Number.NaN) }, { o: null }]);
    expect(columns).toEqual([{ name: 'o', type: 'TIMESTAMP' }]);
    expect(text).toBe(`"o"\n2026-04-05T10:20:30.123Z\n${NULL_TOKEN}\n${NULL_TOKEN}\n`);
  });

  it('every string is QUOTED, a quote doubled — a comma, a newline, spaces, the empty string and the token itself all survive; a null is the bare token', () => {
    const rows = [{ s: 'a,b' }, { s: 'say "hi"' }, { s: 'one\ntwo' }, { s: '  padded  ' }, { s: '' }, { s: NULL_TOKEN }, { s: null }, { s: undefined }];
    expect(rowsLandingOf(rows).text).toBe(`"s"\n"a,b"\n"say ""hi"""\n"one\ntwo"\n"  padded  "\n""\n"${NULL_TOKEN}"\n${NULL_TOKEN}\n${NULL_TOKEN}\n`);
  });

  it('a non-string in a text column is written as the one text the memory engine shows for it (`cellString`)', () => {
    const { text, columns } = rowsLandingOf([{ s: 'a' }, { s: 1 }, { s: true }, { s: new Date(0) }, { s: { k: 1 } }]);
    expect(columns).toEqual([{ name: 's', type: 'VARCHAR' }]);
    expect(text).toBe('"s"\n"a"\n"1"\n"true"\n"1970-01-01T00:00:00.000Z"\n"{""k"":1}"\n');
  });

  it('the columns are the FIRST row s keys, in order — a later row s extra key is not a column, a missing one is null', () => {
    const { text, columns } = rowsLandingOf([
      { z: 1, a: 'x' },
      { a: 'y', z: 2, extra: 'dropped' },
      { z: 3 },
    ]);
    expect(columns).toEqual([
      { name: 'z', type: 'BIGINT' },
      { name: 'a', type: 'VARCHAR' },
    ]);
    expect(text).toBe(`"z","a"\n1,"x"\n2,"y"\n3,${NULL_TOKEN}\n`);
  });

  it('a column name is quoted in the header by the same rule as a cell', () => {
    expect(rowsLandingOf([{ 'we"ird,name': 1 }]).text).toBe('"we""ird,name"\n1\n');
  });

  it('zero rows are refused — no column can be named, and the refusal names the remedy', () => {
    expect(() => rowsLandingOf([])).toThrow(NO_ROWS_TO_LAND);
    expect(NO_ROWS_TO_LAND).toContain('{ csv: … }');
  });
});

describe('the reader: every option spelled out, the columns declared, nothing detected', () => {
  it('is the statically linked CSV reader with the carrier s exact dialect', () => {
    expect(rowsReaderSQL('cases.csv', [{ name: 'id', type: 'BIGINT' }, { name: 'name', type: 'VARCHAR' }])).toBe(
      `read_csv('cases.csv', header=true, delim=',', quote='"', escape='"', new_line='\\n', nullstr='\\N', allow_quoted_nulls=false, columns={'id': 'BIGINT', 'name': 'VARCHAR'})`,
    );
  });

  it('a file name or a column name with a quote in it is a SQL literal, doubled', () => {
    expect(rowsReaderSQL("it's.csv", [{ name: "o'clock", type: 'DOUBLE' }])).toBe(
      `read_csv('it''s.csv', header=true, delim=',', quote='"', escape='"', new_line='\\n', nullstr='\\N', allow_quoted_nulls=false, columns={'o''clock': 'DOUBLE'})`,
    );
  });

  it('the token the reader is told is the token the text was written with — one constant, both sides', () => {
    expect(NULL_TOKEN).toBe('\\N');
    expect(rowsReaderSQL('t.csv', [])).toContain(`nullstr='${NULL_TOKEN}'`);
  });
});

describe('a def s CSV text: the bytes untouched, the types the memory engine s own sniffer says — one law for both kinds', () => {
  it('numbers, booleans and text are typed as `parseCSVTyped` types them, then tallied into DuckDB s words; an empty cell is null and decides nothing', () => {
    const text = 'id,amount,flag,day,note\n1,1.5,true,2026-04-05,\n2,,false,2026-04-06,x\n';
    const { text: same, columns } = csvLandingOf(text);
    expect(same).toBe(text);
    expect(columns).toEqual([
      { name: 'id', type: 'BIGINT' },
      { name: 'amount', type: 'DOUBLE' },
      { name: 'flag', type: 'BOOLEAN' },
      { name: 'day', type: 'VARCHAR' }, // an ISO day is TEXT — the memory engine never sniffs a date out of a string, so neither does this
      { name: 'note', type: 'VARCHAR' },
    ]);
  });

  it('a header with no rows lands its columns and nothing else — the honest empty table', () => {
    expect(csvLandingOf('a,b\n').columns).toEqual([
      { name: 'a', type: 'VARCHAR' },
      { name: 'b', type: 'VARCHAR' },
    ]);
  });

  it('a text with no header is refused — it names no column', () => {
    expect(() => csvLandingOf('')).toThrow(NO_CSV_HEADER);
  });

  it('the reader leaves the dialect to DuckDB and declares only the header law and the types', () => {
    expect(csvReaderSQL('weeks.csv', [{ name: 'id', type: 'BIGINT' }, { name: "o'clock", type: 'VARCHAR' }])).toBe(
      `read_csv('weeks.csv', header=true, types={'id': 'BIGINT', 'o''clock': 'VARCHAR'})`,
    );
  });

  it('`landedColumnsOf` is the one tally both kinds run: the same columns for the same values, whichever way they arrived', () => {
    const rows = [{ n: 1, s: 'a' }, { n: 2.5, s: null }];
    expect(landedColumnsOf(['n', 's'], rows)).toEqual(rowsLandingOf(rows).columns);
    expect(landedColumnsOf(['n', 's'], rows)).toEqual(csvLandingOf('n,s\n1,a\n2.5,\n').columns);
  });
});
