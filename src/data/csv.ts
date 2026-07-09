/**
 * csv — a hand-rolled, RFC-4180-enough CSV parser (D24 build step 2: "no new
 * heavy dep"). The memory engine is meant to be the always-on, zero-extra-
 * install engine (D24: "the X4-proven pattern"); pulling in a parsing
 * library for it would undercut that.
 *
 * Covers: quoted fields, embedded delimiters/newlines inside quotes,
 * doubled-quote escaping (`""` -> `"`), CRLF and bare-LF line endings, an
 * optional trailing newline, and a header row. Does NOT cover: alternate
 * delimiters beyond the single configurable `delimiter` character, BOM
 * stripping beyond a leading UTF-8 BOM, or multi-char delimiters — out of
 * scope for what L2/L1 ever need to load (small demo/test datasets), and
 * documented here rather than silently mishandled.
 *
 * Type sniffing mirrors DuckDB's own `read_csv` default
 * (`auto_detect: true`, `@uwdata/mosaic-sql/dist/src/load/load.js:12`): each
 * column is inferred from its values, not declared up front.
 */

import type { ColumnType, Row } from './types.js';

export interface ParsedCSV {
  readonly header: readonly string[];
  /** Raw string cells, NOT yet type-sniffed — see `sniffRows`. */
  readonly rows: ReadonlyArray<Record<string, string>>;
}

const BOM = '﻿';

/**
 * Tokenize one CSV document into a header row + string-cell data rows.
 * State machine over characters — no regex backtracking risk on adversarial
 * input, and every quote/delimiter/newline rule is one `if` away from its
 * citation above.
 */
export function parseCSV(text: string, options: { delimiter?: string } = {}): ParsedCSV {
  const delimiter = options.delimiter ?? ',';
  const src = text.startsWith(BOM) ? text.slice(1) : text;

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = src.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field.length === 0) {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === delimiter) {
      endField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      // Consume a lone \r or a \r\n pair as one row terminator.
      endRow();
      i += src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (c === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Trailing field/row (no terminating newline), but skip a wholly-empty
  // trailing line (the common "file ends with a newline" case).
  if (field.length > 0 || row.length > 0) {
    endRow();
  }

  const [header, ...dataRows] = rows;
  if (!header) return { header: [], rows: [] };

  // Deliberately does NOT special-case blank lines: for a single-column
  // table a blank line and an explicit empty cell are indistinguishable, so
  // guessing would silently drop real data. A stray blank line elsewhere in
  // a file produces one short row (missing trailing cells read as `''` via
  // `r[idx] ?? ''` below) rather than a fabricated correction.
  const parsedRows: Record<string, string>[] = dataRows.map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = r[idx] ?? '';
    });
    return obj;
  });

  return { header, rows: parsedRows };
}

/** One column's sniffed type, from its raw string values. Empty cells are skipped when deciding. */
function sniffColumnType(values: readonly string[]): ColumnType {
  let sawAny = false;
  let allNumber = true;
  let allBoolean = true;
  for (const raw of values) {
    if (raw === '') continue; // null cell — does not disqualify a type
    sawAny = true;
    if (allNumber && !isNumericLiteral(raw)) allNumber = false;
    if (allBoolean && !isBooleanLiteral(raw)) allBoolean = false;
    if (!allNumber && !allBoolean) break;
  }
  if (!sawAny) return 'unknown';
  if (allBoolean) return 'boolean';
  if (allNumber) return 'number';
  return 'string';
}

function isNumericLiteral(raw: string): boolean {
  if (raw.trim() === '') return false;
  return Number.isFinite(Number(raw));
}

function isBooleanLiteral(raw: string): boolean {
  const lower = raw.toLowerCase();
  return lower === 'true' || lower === 'false';
}

function sniffCell(raw: string, type: ColumnType): unknown {
  if (raw === '') return null;
  switch (type) {
    case 'number':
      return Number(raw);
    case 'boolean':
      return raw.toLowerCase() === 'true';
    default:
      return raw;
  }
}

export interface SniffedCSV {
  readonly header: readonly string[];
  readonly columnTypes: Readonly<Record<string, ColumnType>>;
  readonly rows: readonly Row[];
}

/** Parse + type-sniff a CSV document into ready-to-filter `Row`s. */
export function parseCSVTyped(text: string, options?: { delimiter?: string }): SniffedCSV {
  const { header, rows } = parseCSV(text, options);
  const columnTypes: Record<string, ColumnType> = {};
  for (const h of header) {
    columnTypes[h] = sniffColumnType(rows.map((r) => r[h] ?? ''));
  }
  const typedRows: Row[] = rows.map((r) => {
    const out: Row = {};
    for (const h of header) out[h] = sniffCell(r[h] ?? '', columnTypes[h]!);
    return out;
  });
  return { header, columnTypes, rows: typedRows };
}
