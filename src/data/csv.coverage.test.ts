/**
 * csv.coverage.test.ts — closes the remaining gaps csv.test.ts leaves:
 * a lone `\r` (old-Mac) line terminator not followed by `\n`, a ragged
 * (short) data row whose missing trailing cell falls back to `''`, and a
 * whitespace-only cell that must NOT sniff as numeric.
 */

import { describe, it, expect } from 'vitest';
import { parseCSV, parseCSVTyped } from './csv.js';

describe('parseCSV — a lone \\r line terminator (not part of a \\r\\n pair)', () => {
  it('treats a bare \\r as its own row terminator', () => {
    const { rows } = parseCSV('a,b\r1,2\r3,4\r');
    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('mixed bare-\\r and \\r\\n terminators in the same document both work', () => {
    const { rows } = parseCSV('a,b\r1,2\r\n3,4\r');
    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });
});

describe('parseCSV — a ragged (short) data row', () => {
  it('a row with fewer cells than the header fills the missing trailing cell(s) with \'\' (honest, not a fabricated value)', () => {
    const { rows } = parseCSV('a,b,c\n1,2,3\n9\n4,5,6\n');
    expect(rows).toEqual([
      { a: '1', b: '2', c: '3' },
      { a: '9', b: '', c: '' },
      { a: '4', b: '5', c: '6' },
    ]);
  });
});

describe('parseCSVTyped — a whitespace-only cell does not sniff as numeric', () => {
  it('a lone space alongside real numbers disqualifies the column from "number" (falls to "string")', () => {
    const { columnTypes, rows } = parseCSVTyped('amount\n15\n \n25\n');
    expect(columnTypes.amount).toBe('string');
    // The whitespace cell is non-empty text, so it is NOT treated as a null
    // cell (that's reserved for truly empty '' cells) — it round-trips as-is.
    expect(rows).toEqual([{ amount: '15' }, { amount: ' ' }, { amount: '25' }]);
  });

  it('a whitespace-only cell also disqualifies "boolean"', () => {
    const { columnTypes } = parseCSVTyped('flag\ntrue\n \nfalse\n');
    expect(columnTypes.flag).toBe('string');
  });
});
