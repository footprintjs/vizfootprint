import { describe, it, expect } from 'vitest';
import { parseCSV, parseCSVTyped } from './csv.js';

describe('parseCSV — RFC-4180-enough tokenizer', () => {
  it('parses a plain header + rows', () => {
    const { header, rows } = parseCSV('category,amount\nData,15\nAnalytics,25\n');
    expect(header).toEqual(['category', 'amount']);
    expect(rows).toEqual([
      { category: 'Data', amount: '15' },
      { category: 'Analytics', amount: '25' },
    ]);
  });

  it('handles a file with no trailing newline', () => {
    const { rows } = parseCSV('a,b\n1,2');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('handles CRLF line endings', () => {
    const { rows } = parseCSV('a,b\r\n1,2\r\n3,4\r\n');
    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('handles a quoted field containing the delimiter', () => {
    const { rows } = parseCSV('name,note\n"Smith, John",hello\n');
    expect(rows).toEqual([{ name: 'Smith, John', note: 'hello' }]);
  });

  it('handles a quoted field containing an embedded newline', () => {
    const { rows } = parseCSV('name,note\n"multi\nline",x\n');
    expect(rows).toEqual([{ name: 'multi\nline', note: 'x' }]);
  });

  it('handles doubled-quote escaping inside a quoted field', () => {
    const { rows } = parseCSV('quote\n"she said ""hi"""\n');
    expect(rows).toEqual([{ quote: 'she said "hi"' }]);
  });

  it('strips a leading UTF-8 BOM', () => {
    const { header } = parseCSV('﻿a,b\n1,2\n');
    expect(header).toEqual(['a', 'b']);
  });

  it('empty document yields no header/rows', () => {
    expect(parseCSV('')).toEqual({ header: [], rows: [] });
  });

  it('preserves an explicit empty cell as an empty string (not dropped)', () => {
    const { rows } = parseCSV('a,b,c\n1,,3\n');
    expect(rows).toEqual([{ a: '1', b: '', c: '3' }]);
  });

  it('a custom single-character delimiter is honored', () => {
    const { header, rows } = parseCSV('a;b\n1;2\n', { delimiter: ';' });
    expect(header).toEqual(['a', 'b']);
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });
});

describe('parseCSVTyped — DuckDB-style auto_detect column sniffing', () => {
  it('sniffs an all-numeric column as number, converting cells', () => {
    const { columnTypes, rows } = parseCSVTyped('amount\n15\n25\n5\n');
    expect(columnTypes.amount).toBe('number');
    expect(rows).toEqual([{ amount: 15 }, { amount: 25 }, { amount: 5 }]);
  });

  it('sniffs an all-boolean column as boolean, converting cells (case-insensitive)', () => {
    const { columnTypes, rows } = parseCSVTyped('active\ntrue\nFALSE\nTrue\n');
    expect(columnTypes.active).toBe('boolean');
    expect(rows).toEqual([{ active: true }, { active: false }, { active: true }]);
  });

  it('a mixed column sniffs as string, cells left as raw strings', () => {
    const { columnTypes, rows } = parseCSVTyped('category\nData\n42\nAnalytics\n');
    expect(columnTypes.category).toBe('string');
    expect(rows).toEqual([{ category: 'Data' }, { category: '42' }, { category: 'Analytics' }]);
  });

  it('an empty cell sniffs as null and does not disqualify the column type', () => {
    // Unambiguous: the empty `amount` cell sits alongside a non-empty sibling
    // cell, so it is definitely a real empty CELL, not a blank line (a bare
    // blank line in a single-column file is intentionally left ambiguous —
    // see the "does NOT special-case blank lines" note in csv.ts).
    const { columnTypes, rows } = parseCSVTyped('amount,tag\n15,a\n,b\n25,c\n');
    expect(columnTypes.amount).toBe('number');
    expect(rows).toEqual([
      { amount: 15, tag: 'a' },
      { amount: null, tag: 'b' },
      { amount: 25, tag: 'c' },
    ]);
  });

  it('an all-empty column sniffs as unknown', () => {
    const { columnTypes } = parseCSVTyped('note\n\n\n');
    expect(columnTypes.note).toBe('unknown');
  });

  it('round-trips a realistic small dataset', () => {
    const csv = 'category,amount,active\nData,15,true\nAnalytics,25,false\n"Ops, Team",5,true\n';
    const { header, columnTypes, rows } = parseCSVTyped(csv);
    expect(header).toEqual(['category', 'amount', 'active']);
    expect(columnTypes).toEqual({ category: 'string', amount: 'number', active: 'boolean' });
    expect(rows).toEqual([
      { category: 'Data', amount: 15, active: true },
      { category: 'Analytics', amount: 25, active: false },
      { category: 'Ops, Team', amount: 5, active: true },
    ]);
  });
});
