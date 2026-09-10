/**
 * sqlConnection.test.ts — A LOADED TABLE CARRIES ITS OWN SOURCE ORDER, AND A
 * CONNECTION SAYS WHETHER IT MAY LOAD AT ALL.
 *
 * Two laws, one statement and one judgement, both pinned here because the
 * whole in-browser engine reads row identity out of the column this statement
 * writes.
 */
import { describe, it, expect } from 'vitest';
import { canLoad, loadTableSQL, type SqlConnection, type LoadingConnection, type TableData } from './sqlConnection.js';
import { ROW_ORDER_COLUMN } from './sqlWindow.js';

const reading: SqlConnection = {
  async query(): Promise<readonly Record<string, unknown>[]> {
    return [];
  },
};

const loading: LoadingConnection = {
  ...reading,
  async load(): Promise<void> {
    /* a fake lands nothing */
  },
};

describe('reading and loading are different privileges', () => {
  it('a connection that only reads is not asked to load', () => {
    expect(canLoad(reading)).toBe(false);
  });

  it('a connection that can land a table says so by having the method', () => {
    expect(canLoad(loading)).toBe(true);
  });
});

describe('the statement that lands a table', () => {
  const from = "read_csv_auto('cases.csv')";

  it('numbers the rows in the SAME statement that reads them, 0-based, under the one column name', () => {
    expect(loadTableSQL('cases', from)).toBe(
      `CREATE OR REPLACE TABLE "cases" AS SELECT *, (row_number() OVER ()) - 1 AS "${ROW_ORDER_COLUMN}" FROM read_csv_auto('cases.csv')`,
    );
  });

  it('quotes the table name by the one quoting rule the rest of the statement uses', () => {
    expect(loadTableSQL('odd "name"', from)).toContain('CREATE OR REPLACE TABLE "odd ""name"""');
  });

  it('replaces rather than appends — loading a table twice is the same table, not two of it', () => {
    expect(loadTableSQL('cases', from).startsWith('CREATE OR REPLACE TABLE')).toBe(true);
  });

  it('reads from whatever reader it was handed — the statement owns the numbering, never the source', () => {
    const readers: readonly string[] = ["read_json_auto('cases.json')", "read_parquet('cases.parquet')", 'other_table'];
    for (const reader of readers) expect(loadTableSQL('cases', reader).endsWith(`FROM ${reader}`)).toBe(true);
  });
});

describe('the data a table is brought in from', () => {
  it('is either rows or CSV text — the two a def can actually hold', () => {
    const rows: TableData = { kind: 'rows', rows: [{ id: 1 }] };
    const csv: TableData = { kind: 'csv', text: 'id\n1' };
    expect([rows.kind, csv.kind]).toEqual(['rows', 'csv']);
  });
});
