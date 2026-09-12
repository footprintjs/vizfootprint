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
 *
 * A landing is BYTES (`TypedBytes`), written in chunks so no string ever holds
 * the whole table — so every pin here is DECODE-AND-COMPARE: the bytes are
 * decoded strictly (`fatal`, so a split multi-byte character would throw
 * rather than read as U+FFFD) and must equal, character for character, the
 * text the one-string writer produced; and the bytes themselves must equal a
 * single `TextEncoder.encode` of that text, byte for byte. The chunk boundary
 * is proven with a forced bound that falls inside a non-ASCII line.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { csvLandingOf, csvReaderSQL, landedColumnsOf, landedTypeOf, rowsReaderSQL, rowsLandingOf, LANDING_CHUNK_CHARS, NO_CSV_HEADER, NO_ROWS_TO_LAND, NULL_TOKEN } from './landing.js';

/** The strict decode every pin rests on: a byte sequence that is not UTF-8 THROWS here, never becomes a replacement character. */
const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

/** The one-shot encode a landing's bytes must be identical to — what the engine's own `registerFileText` did to the one string. */
const encoded = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The text a rows landing decodes to — after the bytes are held to the one-shot encode of it. */
function textOf(rows: Parameters<typeof rowsLandingOf>[0]): string {
  const { bytes } = rowsLandingOf(rows);
  const text = decode(bytes);
  expect(bytes).toEqual(encoded(text));
  return text;
}

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

describe('the bytes: a header of quoted names, one line per row, every cell written by its column s type — decoded, and compared to the one-string text', () => {
  it('numbers are bare digits, `-0` keeps its sign, a non-finite number is the null token', () => {
    const rows = [{ f: 12.5 }, { f: -0 }, { f: Number.NaN }, { f: Number.POSITIVE_INFINITY }, { f: 1e21 }, { f: null }];
    expect(rowsLandingOf(rows).columns).toEqual([{ name: 'f', type: 'DOUBLE' }]);
    expect(textOf(rows)).toBe(`"f"\n12.5\n-0\n${NULL_TOKEN}\n${NULL_TOKEN}\n1e+21\n${NULL_TOKEN}\n`);
  });

  it('booleans are `true`/`false`, a null among them the token', () => {
    expect(textOf([{ b: true }, { b: null }, { b: false }])).toBe(`"b"\ntrue\n${NULL_TOKEN}\nfalse\n`);
  });

  it('Date objects are ISO instants; an invalid Date is absent, so the token', () => {
    const rows = [{ o: new Date('2026-04-05T10:20:30.123Z') }, { o: new Date(Number.NaN) }, { o: null }];
    expect(rowsLandingOf(rows).columns).toEqual([{ name: 'o', type: 'TIMESTAMP' }]);
    expect(textOf(rows)).toBe(`"o"\n2026-04-05T10:20:30.123Z\n${NULL_TOKEN}\n${NULL_TOKEN}\n`);
  });

  it('every string is QUOTED, a quote doubled — a comma, a newline, spaces, the empty string and the token itself all survive; a null is the bare token', () => {
    const rows = [{ s: 'a,b' }, { s: 'say "hi"' }, { s: 'one\ntwo' }, { s: '  padded  ' }, { s: '' }, { s: NULL_TOKEN }, { s: null }, { s: undefined }];
    expect(textOf(rows)).toBe(`"s"\n"a,b"\n"say ""hi"""\n"one\ntwo"\n"  padded  "\n""\n"${NULL_TOKEN}"\n${NULL_TOKEN}\n${NULL_TOKEN}\n`);
  });

  it('a non-string in a text column is written as the one text the memory engine shows for it (`cellString`)', () => {
    const rows = [{ s: 'a' }, { s: 1 }, { s: true }, { s: new Date(0) }, { s: { k: 1 } }];
    expect(rowsLandingOf(rows).columns).toEqual([{ name: 's', type: 'VARCHAR' }]);
    expect(textOf(rows)).toBe('"s"\n"a"\n"1"\n"true"\n"1970-01-01T00:00:00.000Z"\n"{""k"":1}"\n');
  });

  it('the columns are the FIRST row s keys, in order — a later row s extra key is not a column, a missing one is null', () => {
    const rows = [
      { z: 1, a: 'x' },
      { a: 'y', z: 2, extra: 'dropped' },
      { z: 3 },
    ];
    expect(rowsLandingOf(rows).columns).toEqual([
      { name: 'z', type: 'BIGINT' },
      { name: 'a', type: 'VARCHAR' },
    ]);
    expect(textOf(rows)).toBe(`"z","a"\n1,"x"\n2,"y"\n3,${NULL_TOKEN}\n`);
  });

  it('a column name is quoted in the header by the same rule as a cell', () => {
    expect(textOf([{ 'we"ird,name': 1 }])).toBe('"we""ird,name"\n1\n');
  });

  it('a string outside ASCII is UTF-8 on the wire — more bytes than characters, and the same string back', () => {
    const rows = [{ s: 'naïve — 日本 🙂' }];
    const { bytes } = rowsLandingOf(rows);
    const text = '"s"\n"naïve — 日本 🙂"\n';
    expect(bytes.length).toBeGreaterThan(text.length);
    expect(decode(bytes)).toBe(text);
    expect(bytes).toEqual(encoded(text));
  });

  it('zero rows are refused — no column can be named, and the refusal names the remedy', () => {
    expect(() => rowsLandingOf([])).toThrow(NO_ROWS_TO_LAND);
    expect(NO_ROWS_TO_LAND).toContain('{ csv: … }');
  });
});

describe('the chunks: the CSV is joined in pieces of whole lines and encoded into one buffer — the bytes never know it', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * What the encoder was handed — the chunks, as strings, in order. Spied on
   * the prototype, so the module's own encoder is the one watched. Every chunk
   * reaches `encodeInto` TWICE — once to measure, once to write — and `encode`
   * never (an allocation per chunk is what `encodeChunks` exists to avoid).
   */
  function chunksOf(run: () => Uint8Array): { readonly bytes: Uint8Array; readonly chunks: readonly string[] } {
    const encodeInto = vi.spyOn(TextEncoder.prototype, 'encodeInto');
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    const bytes = run();
    expect(encode).not.toHaveBeenCalled();
    const handed = encodeInto.mock.calls.map((call) => String(call[0]));
    const half = handed.length / 2;
    expect(Number.isInteger(half), 'every chunk is handed over exactly twice').toBe(true);
    expect(handed.slice(0, half), 'the measure pass and the write pass see the same chunks in the same order').toEqual(handed.slice(half));
    return { bytes, chunks: handed.slice(0, half) };
  }

  it('the bound is far under V8 s string cap, and a landing under it is ONE chunk — one buffer, holding the CSV and nothing else', () => {
    expect(LANDING_CHUNK_CHARS).toBe(16_777_216);
    // `buffer.constants.MAX_STRING_LENGTH` on this node is 2²⁹ − 24: sixteen bounds fit under it with room, thirty-two overshoot it by 24 characters
    expect(LANDING_CHUNK_CHARS * 16).toBeLessThan(536_870_888);
    expect(LANDING_CHUNK_CHARS * 32).toBe(536_870_888 + 24);
    const rows = [{ s: 'a' }, { s: 'b' }];
    const { bytes, chunks } = chunksOf(() => rowsLandingOf(rows).bytes);
    expect(chunks).toEqual(['"s"\n"a"\n"b"\n']);
    expect(decode(bytes)).toBe('"s"\n"a"\n"b"\n');
    expect(bytes.byteOffset).toBe(0);
    expect(bytes.buffer.byteLength).toBe(bytes.length); // the browser arm transfers the whole buffer: it must be the CSV and nothing else
  });

  it('a FORCED boundary that falls inside a non-ASCII line: the line is encoded whole in the chunk it started, no character is split, and the bytes are byte-identical to the one-string encode', () => {
    const header = '"s"\n';
    const before = '"aaaa"\n';
    const straddling = '"naïve — 日本 🙂"\n'; // ï is 2 bytes, — 3, 日 and 本 3 each, 🙂 4 (and TWO UTF-16 units)
    const after = '"zzzz"\n';
    const rows = [{ s: 'aaaa' }, { s: 'naïve — 日本 🙂' }, { s: 'zzzz' }];
    const whole = `${header}${before}${straddling}${after}`;
    // the bound lands INSIDE the non-ASCII line's span of characters: after the header and the first row, before the line's end
    const bound = header.length + before.length + 1;
    expect(bound).toBeGreaterThan(header.length + before.length);
    expect(bound).toBeLessThan(header.length + before.length + straddling.length);

    const { bytes, chunks } = chunksOf(() => rowsLandingOf(rows, bound).bytes);
    // two chunks: the boundary was crossed by the non-ASCII line, which stayed whole in the first; the last row is the second
    expect(chunks).toEqual([`${header}${before}${straddling}`, after]);
    for (const chunk of chunks) expect(chunk.endsWith('\n'), 'a chunk ends at a line end').toBe(true);
    // strict decode: a split multi-byte sequence would THROW here
    expect(decode(bytes)).toBe(whole);
    expect(bytes).toEqual(encoded(whole));
    expect(bytes.buffer.byteLength, 'the exact buffer: the measured total, not a scratch').toBe(bytes.length);
    // …and the same rows under the default bound are the same bytes
    expect(rowsLandingOf(rows).bytes).toEqual(bytes);
  });

  it('a bound of one character makes every ROW its own chunk — the header rides with the first row, never alone — and the concatenation is still the one text', () => {
    const rows = [{ n: 1, s: 'x' }, { n: 2, s: 'ÿ' }, { n: 3, s: null }];
    const whole = `"n","s"\n1,"x"\n2,"ÿ"\n3,${NULL_TOKEN}\n`;
    const { bytes, chunks } = chunksOf(() => rowsLandingOf(rows, 1).bytes);
    expect(chunks).toEqual(['"n","s"\n1,"x"\n', '2,"ÿ"\n', `3,${NULL_TOKEN}\n`]);
    expect(decode(bytes)).toBe(whole);
    expect(bytes).toEqual(encoded(whole));
    expect(bytes.length).toBe(whole.length + 1); // ÿ is the one two-byte character
  });

  it('a single row LONGER than the bound becomes its own chunk — no line is ever split to fit — and the whole still lands as one text', () => {
    const header = '"s"\n';
    const short1 = '"a"\n';
    const long = `"${'x'.repeat(60)}"\n`; // longer, by itself, than the bound below
    const short2 = '"b"\n';
    const rows = [{ s: 'a' }, { s: 'x'.repeat(60) }, { s: 'b' }];
    const bound = 5; // far under the long row's own length, so it flushes the moment it is pushed
    const whole = `${header}${short1}${long}${short2}`;

    const { bytes, chunks } = chunksOf(() => rowsLandingOf(rows, bound).bytes);
    // the header rides with the first row (never alone); the long row — past the bound by
    // itself — lands in a chunk with nothing else in it; so does the short row after it
    expect(chunks).toEqual([`${header}${short1}`, long, short2]);
    for (const chunk of chunks) expect(chunk.endsWith('\n'), 'a chunk ends at a line end').toBe(true);
    expect(decode(bytes)).toBe(whole);
    expect(bytes).toEqual(encoded(whole));
  });

  it('a run of nothing but 3-byte characters and a lone surrogate — the TIGHTEST case the measure scratch is sized for — is `written` exactly: no truncation, byte for byte with the one-shot oracle', () => {
    // U+65E5 ('日') is a BMP character ≥ U+0800: 3 bytes for 1 UTF-16 unit, the worst ordinary case.
    // '\uD800' alone (no low surrogate follows) is a LONE surrogate: TextEncoder replaces it with
    // U+FFFD on encode, also 3 bytes for 1 unit — the other way a UTF-16 unit reaches the same ratio.
    const worst = `${'日'.repeat(40)}\uD800${'日'.repeat(40)}`; // 81 units, every one of them 3 bytes
    const rows = [{ s: worst }];
    const { bytes } = rowsLandingOf(rows);
    const whole = `"s"\n"${worst}"\n`; // no comma or quote inside `worst`, so nothing here needs escaping
    const asciiChars = whole.length - worst.length; // every character outside `worst` is 1-byte ASCII
    expect(bytes.length).toBe(asciiChars + 3 * worst.length); // the bound is exact here, not merely an upper limit
    expect(bytes).toEqual(encoded(whole));
    expect(decode(bytes)).toBe(decode(encoded(whole))); // strict decode agrees with the oracle — U+FFFD where the surrogate was
  });

  it('a mismeasured chunk throws, naming it, instead of landing a silently truncated table', () => {
    // The measure pass never checks its own `written` against the chunk's length — only the write
    // pass does. So the fault this proves against is the one the measure pass could actually cause:
    // force IT to under-report (as if the 3-bytes-per-unit bound had ever been wrong), and the write
    // pass inherits too small a buffer — `encodeInto` then genuinely cannot write the whole chunk into
    // it, `read` comes back short of the chunk's length, and this throws rather than dropping the tail.
    vi.spyOn(TextEncoder.prototype, 'encodeInto').mockImplementationOnce(() => ({ read: 0, written: 0 }));
    expect(() => rowsLandingOf([{ s: 'hello' }])).toThrow('rowsLandingOf: chunk 0 of 1 was truncated mid-encode');
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
    const { bytes, columns } = csvLandingOf(text);
    expect(decode(bytes)).toBe(text);
    expect(bytes).toEqual(encoded(text));
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

  it('the def s text is encoded ONCE, whole, as UTF-8 — its string already exists, so there is nothing to chunk', () => {
    const text = 'id,name\n1,naïve\n2,日本\n';
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    const { bytes } = csvLandingOf(text);
    expect(encode.mock.calls.map((call) => call[0])).toEqual([text]);
    vi.restoreAllMocks();
    expect(decode(bytes)).toBe(text);
    expect(bytes).toEqual(encoded(text));
    expect(bytes.length).toBe(text.length + 1 + 4); // ï two bytes, 日本 three each
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
