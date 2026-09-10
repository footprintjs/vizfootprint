/**
 * The export walk over a REAL session — the consumer path, not a fake ask.
 *
 * What is pinned here: the body is `viewQuery`'s own rows, in `viewQuery`'s own
 * order; the receipt's cursor is the session's cursor, so a reader holding the
 * file can seek back to the state it was read at; and a `filter` act shows up
 * in the receipt twice over — the count shrinks AND the clause that shrank it
 * is named.
 *
 * Nothing in this file asserts a commit was written by the export, because an
 * export writes none: copy and export are READS.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from './dashboard.fixture.js';
import { cellString, exportFromSession } from './export.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent: string): Cause => ({ requestedBy: 'user', computedBy: 'user', intent });
const fresh = () => buildDashboard(makeDashboardDef()).createSession();

describe('exportFromSession — the same rows the sheet shows, plus their address', () => {
  it('the body is viewQuery’s rows in viewQuery’s order, and the receipt names the cursor they were read at', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });

    const columns = ['id', 'price'];
    const sort = [{ field: 'price' as const, dir: 'desc' as const }];
    const window = await s.viewQuery({ columns, sort, limit: SAMPLE_ROWS.length });
    expect(window.ok).toBe(true);
    if (!window.ok) return;

    const res = await exportFromSession(s, { table: 'data', columns, sort, format: 'csv', pageRows: 3 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // the header is the ENGINE's projection (the key rides every window), not the columns asked for
    const lines = res.body.split('\n');
    expect(lines[0]).toBe(window.columns.join(','));
    expect(lines).toHaveLength(window.rows.length + 1);
    expect(lines.slice(1)).toEqual(window.rows.map((row) => window.columns.map((c) => cellString(row[c])).join(',')));

    expect(res.receipt.cursor).toBe(s.cursor());
    expect(res.receipt.version).toBe(window.version);
    expect(res.receipt.count).toBe(window.count);
    expect(res.receipt.exported).toEqual({ start: 0, rows: window.rows.length });
    expect(res.receipt.truncated).toBe(false);
    expect(res.receipt.positional).toBe(true); // the fixture table declares no row key
    expect(res.receipt.key).toBeUndefined();
    expect(res.names).toEqual({ body: 'data.csv', receipt: 'data.receipt.json' });
    // a receipt is a courtesy copy a person keeps: it survives the trip through JSON
    expect(JSON.parse(JSON.stringify(res.receipt))).toEqual(res.receipt);
  });

  it('a filter act shrinks the count AND rides into the receipt as the clause that shrank it', async () => {
    const s = fresh();
    const whole = await exportFromSession(s, { table: 'data', format: 'tsv' });
    expect(whole.ok && [whole.receipt.count, whole.receipt.clauses.length]).toEqual([SAMPLE_ROWS.length, 0]);

    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 100], cause: userCause('brush') });
    const after = await exportFromSession(s, { table: 'data', format: 'tsv' });
    expect(after.ok).toBe(true);
    if (!after.ok || !whole.ok) return;

    expect(after.receipt.count).toBeLessThan(whole.receipt.count);
    expect(after.receipt.count).toBe(SAMPLE_ROWS.filter((r) => (r.price as number) >= 60 && (r.price as number) <= 100).length);
    expect(after.receipt.clauses.map((c) => [c.from, c.response])).toEqual([['scatter', 'filter']]);
    expect(after.receipt.clauses[0]?.clause).toMatchObject({ kind: 'interval', field: 'price' });
    // the cursor moved with the act — which is exactly why the receipt carries it
    expect(after.receipt.cursor).not.toBe(whole.receipt.cursor);
    expect(after.receipt.cursor).toBe(s.cursor());
    expect(after.body.split('\n')).toHaveLength(after.receipt.count + 1);
  });

  it('a view sees what reaches IT: exporting the view’s window carries the view id and its own clauses', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const res = await exportFromSession(s, { table: 'data', viewId: 'bar', format: 'csv' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.viewId).toBe('bar');
    // a view is never filtered by its OWN gesture, so bar exports the whole table
    expect(res.receipt.count).toBe(SAMPLE_ROWS.length);
    expect(res.receipt.clauses).toEqual([]);
  });

  it('the session’s own refusal is the export’s refusal — a table that is not here is not exported', async () => {
    const s = fresh();
    const res = await exportFromSession(s, { table: 'nope', format: 'csv' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('unknown-table');
    expect(res.rejected).toContain('no table "nope" here');
  });
});
