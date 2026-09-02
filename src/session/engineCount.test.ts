/**
 * Seam 1b: the session asks the engine for the live selection — one query
 * with the whole clause list — and counts through count mode; when an engine
 * cannot answer, the count is honestly zero and a tip's count is null.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });

describe('the session and the engine', () => {
  it('two live selections = one AND query: the rows, the count and the analysis input agree', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [50, 200], cause: userCause('mid prices') });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('formal') });
    const rows = await s.selectedRows();
    const o = await s.overview();
    expect(o.selectedRowCount).toBe(rows.length);
    expect(rows.every((r) => r['category'] === 'Formal' && (r['price'] as number) >= 50 && (r['price'] as number) <= 200)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
  it('a stub engine that cannot evaluate: the count is honestly null, the rows are none', async () => {
    const s = buildDashboard({ ...makeDashboardDef(), data: { data: { rows: [], engine: 'wasm' } } }, { availableEngines: ['memory', 'wasm'] }).createSession();
    expect((await s.overview()).selectedRowCount).toBeNull();
    expect(await s.selectedRows()).toEqual([]);
  });
});

describe('the count at a tip keeps every clause kind', () => {
  it('a multi-select (a match) on the path never breaks compare — the same clause builder as the live path', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: ['Formal', 'Party'], exclude: true, cause: userCause('not these') });
    const b = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [50, 200], cause: userCause('mid') });
    const res = await s.compare(a.ok && a.commit ? a.commit.id : '', b.ok && b.commit ? b.commit.id : '');
    expect(res.ok).toBe(true);
    if (res.ok) expect(typeof res.a.rows === 'number' || res.a.rows === null).toBe(true);
  });
});
