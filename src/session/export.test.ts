/**
 * Export is a read that carries its address — the walk, the quoting and the
 * receipt, judged without a session.
 *
 * The laws under test: nothing here touches a log (there is no log in this
 * file); a refusal on ANY page refuses the whole export; a version, a cursor or
 * the projection that changes between pages refuses it by name ('moved'), as do
 * a page answered at an offset nobody asked for ('misaligned') and one answered
 * short of its count ('short'); the ceiling bounds the WALK and never the count,
 * and the receipt says it truncated; and NO cell can abort an export.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPORT_PAGE_ROWS,
  EXPORT_ROW_CEILING,
  cellString,
  exportWindows,
  tabularText,
  type ExportAsk,
  type ExportWindow,
} from './export.js';
import type { Row } from '../data/index.js';

const AT = new Date('2026-09-10T12:00:00.000Z');
const pinned = () => AT;

/** A fake table of `count` rows, walked one page at a time; every call is recorded. */
function makeAsk(
  count: number,
  over: {
    readonly columns?: readonly string[];
    readonly rows?: readonly Row[];
    /** Answer something other than a page of rows, keyed by the call index (0 = the first page). */
    readonly onPage?: Record<number, Partial<ExportWindow> | { ok: false; reason: string; rejected: string }>;
    readonly key?: string;
    readonly clauses?: ExportWindow['clauses'];
  } = {},
) {
  const columns = over.columns ?? ['id', 'name'];
  const all: readonly Row[] = over.rows ?? Array.from({ length: count }, (_, i) => ({ id: i, name: `r${i}` }));
  const calls: { offset: number; limit: number }[] = [];
  const ask: ExportAsk = async (offset, limit) => {
    const page = calls.length;
    calls.push({ offset, limit });
    const special = over.onPage?.[page];
    if (special !== undefined && special.ok === false) return special;
    return {
      ok: true,
      columns,
      rows: all.slice(offset, offset + limit),
      rowIds: all.slice(offset, offset + limit).map((_, i) => String(offset + i)),
      positional: over.key === undefined,
      ...(over.key !== undefined ? { key: over.key } : {}),
      count,
      start: offset,
      version: 'v1',
      cursor: 'c1',
      ...(over.clauses !== undefined ? { clauses: over.clauses } : {}),
      ...(special ?? {}),
    } as ExportWindow;
  };
  return { ask, calls };
}

describe('cellString — one cell as text, never locale-formatted', () => {
  it('names every value shape a row can hold', () => {
    expect(cellString(null)).toBe('');
    expect(cellString(undefined)).toBe('');
    expect(cellString('plain')).toBe('plain');
    expect(cellString(1234.5)).toBe('1234.5');
    expect(cellString(1_000_000)).toBe('1000000'); // never "1,000,000": a receipt is read by programs too
    expect(cellString(true)).toBe('true');
    expect(cellString(false)).toBe('false');
    expect(cellString(10n)).toBe('10');
    expect(cellString(new Date('2020-01-02T03:04:05.000Z'))).toBe('2020-01-02T03:04:05.000Z');
    expect(cellString({ a: 1 })).toBe('{"a":1}');
    expect(cellString([1, 'x'])).toBe('[1,"x"]');
    // JSON.stringify answers undefined for a symbol; String() still names it
    expect(cellString(Symbol('sym'))).toBe('Symbol(sym)');
  });

  it('NO cell can abort an export: an invalid date, a nested bigint and a circular value are each a sentence, never a throw', () => {
    // `new Date('nope').toISOString()` throws `Invalid time value` — one such cell
    // would reject the whole walk and freeze the door that awaited it
    expect(cellString(new Date('nope'))).toBe('Invalid Date');
    // JSON.stringify throws on a nested bigint; its digits are the honest cell
    expect(cellString({ big: 10n })).toBe('{"big":"10"}');
    expect(cellString([1n])).toBe('["1"]');
    // and on a circular value, which has no JSON at all — so it names itself
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(cellString(circular)).toBe('[object Object]');
    // nested arrays and a nested date ride through the same JSON
    expect(cellString([[1, 2], [3]])).toBe('[[1,2],[3]]');
    expect(cellString({ at: new Date('2020-01-02T03:04:05.000Z') })).toBe('{"at":"2020-01-02T03:04:05.000Z"}');
  });

  it('the numbers a spreadsheet has to read: -0 loses its sign, NaN and Infinity ride as their own words', () => {
    expect(cellString(-0)).toBe('0');
    expect(cellString(Number.NaN)).toBe('NaN');
    expect(cellString(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(cellString(Number.NEGATIVE_INFINITY)).toBe('-Infinity');
  });
});

describe('tabularText — the quoting matrix', () => {
  const columns = ['plain', 'comma', 'quote', 'newline', 'tab', 'nil', 'num', 'bool', 'date', 'obj'];
  const rows: Row[] = [
    {
      plain: 'a',
      comma: 'x,y',
      quote: 'he said "hi"',
      newline: 'one\ntwo',
      tab: 'a\tb',
      nil: null,
      num: 42,
      bool: false,
      date: new Date('2021-05-06T00:00:00.000Z'),
      obj: { k: 'v' },
    },
  ];

  it('CSV quotes per RFC 4180 — the delimiter, a quote, CR or LF; inner quotes doubled; a tab rides bare', () => {
    const text = tabularText(columns, rows, 'csv');
    const [header, body] = text.split('\n'); // the newline INSIDE a quoted field keeps the row on two lines
    expect(header).toBe(columns.join(','));
    expect(body).toBe('a,"x,y","he said ""hi""","one');
    expect(text.endsWith('two",a\tb,,42,false,2021-05-06T00:00:00.000Z,"{""k"":""v""}"')).toBe(true);
  });

  it('TSV quotes the same way against the TAB — a comma rides bare, and Excel accepts the quoted form', () => {
    const text = tabularText(columns, rows, 'tsv');
    expect(text.split('\n')[0]).toBe(columns.join('\t'));
    expect(text).toContain('x,y\t'); // a comma needs nothing here
    expect(text).toContain('"a\tb"'); // the tab does
    expect(text).toContain('"he said ""hi"""');
  });

  it('quotes a COLUMN NAME that holds the delimiter, and answers a header-only body for no rows', () => {
    expect(tabularText(['a,b', 'c'], [], 'csv')).toBe('"a,b",c');
  });

  it('reads a missing column as an empty cell, never as the string "undefined"', () => {
    expect(tabularText(['a', 'gone'], [{ a: 1 }], 'csv')).toBe('a,gone\n1,');
  });

  it('quotes a field that BEGINS with a quote, an embedded CRLF and a lone CR — and leaves a whitespace-only cell whole', () => {
    // RFC 4180 has no special case for position: a leading quote is quoted and doubled like any other
    expect(tabularText(['f'], [{ f: '"lead' }], 'csv')).toBe('f\n"""lead"');
    expect(tabularText(['f'], [{ f: 'a\r\nb' }], 'csv')).toBe('f\n"a\r\nb"');
    expect(tabularText(['f'], [{ f: 'c\rd' }], 'csv')).toBe('f\n"c\rd"');
    // spaces are DATA: they ride bare and whole, never trimmed
    expect(tabularText(['f'], [{ f: '   ' }], 'csv')).toBe('f\n   ');
  });

  it('a FORMULA-shaped cell rides through exactly as it reads — the body always matches the rows the receipt addresses', () => {
    // the "CSV injection" class is the READER's concern, said out loud in README.md.
    // Mangling a person's data to protect their spreadsheet would make the body
    // disagree with the rows its receipt names — this test is here so that stays true.
    expect(tabularText(['f'], [{ f: '=1+1' }, { f: '+A1' }, { f: '@SUM(A1)' }, { f: '-2+3' }], 'csv')).toBe('f\n=1+1\n+A1\n@SUM(A1)\n-2+3');
  });
});

describe('exportWindows — the walk', () => {
  it('walks three pages, asks each with the offset it reached, and stops at the count', async () => {
    const { ask, calls } = makeAsk(7);
    const res = await exportWindows(ask, { table: 'cells', format: 'csv', pageRows: 3, now: pinned });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls).toEqual([
      { offset: 0, limit: 3 },
      { offset: 3, limit: 3 },
      { offset: 6, limit: 1 }, // the last page asks for exactly what remains
    ]);
    expect(res.body.split('\n')).toHaveLength(8); // a header plus seven rows
    expect(res.body.split('\n')[1]).toBe('0,r0');
    expect(res.body.split('\n')[7]).toBe('6,r6');
    expect(res.receipt).toEqual({
      kind: 'vizfootprint-export',
      table: 'cells',
      version: 'v1',
      cursor: 'c1',
      sort: [],
      columns: ['id', 'name'],
      positional: true,
      count: 7,
      exported: { start: 0, rows: 7 },
      truncated: false,
      ceiling: EXPORT_ROW_CEILING,
      clauses: [],
      at: AT.toISOString(),
    });
    expect(res.names).toEqual({ body: 'cells.csv', receipt: 'cells.receipt.json' });
  });

  it('carries the view, the sort, the key and the clauses it was given into the receipt', async () => {
    const clauses = [{ from: 'bar', clause: { kind: 'point' as const, field: 'category', value: 'Formal' }, response: 'filter' as const }];
    const { ask } = makeAsk(2, { key: 'id', clauses });
    const res = await exportWindows(ask, {
      table: 'cells',
      viewId: 'grid',
      sort: [{ field: 'name', dir: 'desc' }],
      format: 'tsv',
      now: pinned,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.viewId).toBe('grid');
    expect(res.receipt.key).toBe('id');
    expect(res.receipt.positional).toBe(false);
    expect(res.receipt.sort).toEqual([{ field: 'name', dir: 'desc' }]);
    expect(res.receipt.clauses).toEqual(clauses);
    expect(res.names.body).toBe('cells.tsv');
  });

  it('the ceiling bounds the WALK, never the count: exactly `ceiling` rows, the count intact, truncated said out loud', async () => {
    const { ask, calls } = makeAsk(25);
    const res = await exportWindows(ask, { table: 'big', format: 'csv', pageRows: 4, rowCeiling: 10, now: pinned });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.body.split('\n')).toHaveLength(11); // header + exactly the ceiling
    expect(calls).toEqual([
      { offset: 0, limit: 4 },
      { offset: 4, limit: 4 },
      { offset: 8, limit: 2 }, // never past the ceiling
    ]);
    expect(res.receipt.count).toBe(25);
    expect(res.receipt.exported).toEqual({ start: 0, rows: 10 });
    expect(res.receipt.truncated).toBe(true);
    expect(res.receipt.ceiling).toBe(10);
  });

  it('a refusal on the FIRST page refuses the export, in the ask’s own words', async () => {
    const { ask } = makeAsk(5, { onPage: { 0: { ok: false, reason: 'unknown-table', rejected: 'no table "cells" here' } } });
    const res = await exportWindows(ask, { table: 'cells', format: 'csv', pageRows: 2, now: pinned });
    expect(res).toEqual({ ok: false, reason: 'unknown-table', rejected: 'no table "cells" here' });
  });

  it('a refusal on page 2 refuses ALL of it — there is no partial export', async () => {
    const { ask, calls } = makeAsk(5, { onPage: { 1: { ok: false, reason: 'engine', rejected: 'the engine gave up' } } });
    const res = await exportWindows(ask, { table: 'cells', format: 'csv', pageRows: 2, now: pinned });
    expect(res).toEqual({ ok: false, reason: 'engine', rejected: 'the engine gave up' });
    expect(calls).toHaveLength(2); // it stopped asking the moment it was refused
  });

  it('a VERSION that moved between pages refuses the whole export and names both versions', async () => {
    const { ask } = makeAsk(5, { onPage: { 1: { version: 'v2' } } });
    const res = await exportWindows(ask, { table: 'cells', format: 'csv', pageRows: 2, now: pinned });
    expect(res).toEqual({
      ok: false,
      reason: 'moved',
      rejected: 'the table moved while exporting (version v1 → v2) — export again',
    });
  });

  it('a CURSOR that moved refuses it too — two versions never share a file', async () => {
    const { ask } = makeAsk(5, { onPage: { 1: { cursor: 'c2' } } });
    const res = await exportWindows(ask, { table: 'cells', format: 'csv', pageRows: 2, now: pinned });
    expect(res).toEqual({
      ok: false,
      reason: 'moved',
      rejected: 'the table moved while exporting (cursor c1 → c2) — export again',
    });
  });

  it('an absent version or cursor is NAMED ("none"), never blanked', async () => {
    const { ask } = makeAsk(5, { onPage: { 0: { version: null }, 1: { version: 'v9' } } });
    const res = await exportWindows(ask, { table: 'cells', format: 'csv', pageRows: 2, now: pinned });
    expect(res.ok === false && res.rejected).toContain('(version none → v9)');
  });

  it('a page that answers no rows where rows were promised refuses, rather than passing off a short body as whole', async () => {
    const { ask } = makeAsk(5, { onPage: { 1: { rows: [] } } });
    const res = await exportWindows(ask, { table: 'cells', format: 'csv', pageRows: 2, now: pinned });
    expect(res).toEqual({
      ok: false,
      reason: 'short',
      rejected: 'the table answered no rows at offset 2 while 3 of 5 remained — export again',
    });
  });

  it('a PROJECTION that changed between pages refuses the whole export — a blank cell is not an answer', async () => {
    // page 2 answering [id, price] would write its rows with a blank `name` column
    // and drop `price` on the floor, under a receipt claiming [id, name]
    const { ask } = makeAsk(5, { onPage: { 1: { columns: ['id', 'price'] } } });
    const res = await exportWindows(ask, { table: 'cells', format: 'csv', pageRows: 2, now: pinned });
    expect(res).toEqual({
      ok: false,
      reason: 'moved',
      rejected: 'the projection changed while exporting (id, name → id, price) — export again',
    });
    // a projection that only LOST a column is the same refusal
    const shorter = makeAsk(5, { onPage: { 1: { columns: ['id'] } } });
    const res2 = await exportWindows(shorter.ask, { table: 'cells', format: 'csv', pageRows: 2, now: pinned });
    expect(res2.ok === false && res2.rejected).toBe('the projection changed while exporting (id, name → id) — export again');
  });

  it('a door that answers a window nobody asked for is refused, never walked into a file of one page repeated', async () => {
    // the FIRST page: a door answering rows 5–9 for offset 0 would put them in a
    // file whose receipt says `exported: { start: 0 }`
    const firstOff = makeAsk(10, { onPage: { 0: { start: 5 } } });
    const res = await exportWindows(firstOff.ask, { table: 'cells', format: 'csv', pageRows: 5, now: pinned });
    expect(res).toEqual({
      ok: false,
      reason: 'misaligned',
      rejected: 'the table answered a window starting at row 5 where row 0 was asked for — the rows cannot be walked in order',
    });

    // and a LATER page: a door that ignores `offset` answers page 1 forever, which
    // would ride into the body as the same rows over and over
    const ignoresOffset: ExportAsk = (_offset, limit) =>
      Promise.resolve({
        ok: true,
        columns: ['id'],
        rows: Array.from({ length: limit }, (_, i) => ({ id: i })),
        rowIds: Array.from({ length: limit }, (_, i) => String(i)),
        positional: true,
        count: 6,
        start: 0,
        version: 'v1',
        cursor: 'c1',
      });
    const res2 = await exportWindows(ignoresOffset, { table: 'cells', format: 'csv', pageRows: 2, now: pinned });
    expect(res2).toEqual({
      ok: false,
      reason: 'misaligned',
      rejected: 'the table answered a window starting at row 0 where row 2 was asked for — the rows cannot be walked in order',
    });
  });

  it('a count that is not a whole number of rows is not a count: the receipt says one that survives JSON', async () => {
    const { ask } = makeAsk(Number.NaN, { rows: [{ id: 0, name: 'r0' }] });
    const res = await exportWindows(ask, { table: 'cells', format: 'csv', now: pinned });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // NaN would be written as `null` by JSON.stringify — a receipt claiming no count at all
    expect(res.receipt.count).toBe(0);
    expect((JSON.parse(JSON.stringify(res.receipt)) as { count: unknown }).count).toBe(0);
    expect(res.receipt.exported).toEqual({ start: 0, rows: 0 });

    const negative = makeAsk(-3, { rows: [{ id: 0, name: 'r0' }] });
    const res2 = await exportWindows(negative.ask, { table: 'cells', format: 'csv', now: pinned });
    expect(res2.ok && [res2.receipt.count, res2.receipt.exported.rows]).toEqual([0, 0]);
  });

  it('an empty view exports a header and a receipt that says nothing was in it', async () => {
    const { ask, calls } = makeAsk(0);
    const res = await exportWindows(ask, { table: 'cells', format: 'csv', now: pinned });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.body).toBe('id,name');
    expect(res.receipt.exported).toEqual({ start: 0, rows: 0 });
    expect(res.receipt.truncated).toBe(false);
    expect(calls).toEqual([{ offset: 0, limit: EXPORT_PAGE_ROWS }]); // the default page size
  });

  it('stamps `at` from its own clock when none is injected, and defends against a page size of zero', async () => {
    const before = Date.now();
    const { ask, calls } = makeAsk(2, {});
    const res = await exportWindows(ask, { table: 'cells', format: 'csv', pageRows: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls[0]).toEqual({ offset: 0, limit: 1 }); // a page of zero rows would never finish; one is the floor
    expect(Date.parse(res.receipt.at ?? '')).toBeGreaterThanOrEqual(before);
  });
});
