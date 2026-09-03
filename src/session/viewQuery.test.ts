/**
 * The view-query port — the sheet's window on a table, judged by the same
 * laws as a chart: `clausesFor(viewId)` is what reaches a view through the
 * link graph (own clause excluded, responses and mappings applied, a cleared
 * source remembered per its edge); `viewQuery` is ONE evaluate per window
 * with a row identity per row. The parity oracle: with no view, the count is
 * exactly what `Overview.selectedRowCount` counts, at the same cursor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileSource } from '../source/file.js';
import { buildDashboard, buildDashboardAsync } from '../def/index.js';
import { VIEW_QUERY_DEFAULT_LIMIT } from './index.js';
import { makeDashboardDef, SAMPLE_ROWS } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const fresh = () => buildDashboard(makeDashboardDef()).createSession();

describe('viewQuery — the whole-dashboard truth and the window', () => {
  it('parity: with no view every live clause filters, and the count is what selectedRowCount counts; a positional table names rows by version and source index', async () => {
    const s = fresh();
    const empty = await s.viewQuery();
    expect(empty.ok && [empty.count, empty.rows.length, empty.start, empty.positional]).toEqual([40, 40, 0, true]);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 100], cause: userCause('brush') });
    const o = await s.overview();
    const q = await s.viewQuery({});
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.count).toBe(o.selectedRowCount);
    expect(q.rows).toHaveLength(q.count);
    expect(q.rows.every((r) => r['category'] === 'Formal' && (r['price'] as number) >= 60 && (r['price'] as number) <= 100)).toBe(true);
    expect(q.clauses.map((c) => [c.from, c.response])).toEqual([
      ['bar', 'filter'],
      ['scatter', 'filter'],
    ]);
    // identity: no declared key → `<version>#<source index>`, marked positional; the same row keeps its id across windows
    expect(q.positional).toBe(true);
    expect(q.rowIds.every((id) => /^(inline|[^#]+)#\d+$/.test(id))).toBe(true);
    expect(q.rowIds[0]!.endsWith(`#${SAMPLE_ROWS.findIndex((r) => r.category === 'Formal' && (r.price as number) >= 60)}`)).toBe(true);
    expect(q.version === null || typeof q.version === 'string').toBe(true);
    expect(q.rowIds[0]!.startsWith(`${q.version ?? 'inline'}#`)).toBe(true);
  });

  it('a window: sort, offset and limit ride to the engine as one evaluate; start is answered; a projection is honoured; the visible columns are the default', async () => {
    const s = fresh();
    const page = await s.viewQuery({ sort: [{ field: 'price', dir: 'desc' }], offset: 5, limit: 3, columns: ['id', 'price'] });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const byPriceDesc = [...SAMPLE_ROWS].sort((a, b) => (b.price as number) - (a.price as number));
    expect(page.rows).toEqual(byPriceDesc.slice(5, 8).map((r) => ({ id: r.id, price: r.price })));
    expect([page.count, page.start]).toEqual([40, 5]);
    expect(page.rowIds).toEqual(byPriceDesc.slice(5, 8).map((r) => `${page.version ?? 'inline'}#${SAMPLE_ROWS.indexOf(r)}`)); // ids follow the ROW, not the window position
    const past = await s.viewQuery({ offset: 100, limit: 5 });
    expect(past.ok && [past.rows.length, past.count, past.start]).toEqual([0, 40, 40]);
    const all = await s.viewQuery({ limit: 1 });
    expect(all.ok && Object.keys(all.rows[0]!).sort()).toEqual(['category', 'id', 'price', 'rating']); // every visible column
  });

  it('a declared row key is the identity: rowIds are its values, positional is false, and the key is projected even when the caller leaves it out', async () => {
    const def = makeDashboardDef();
    const keyed = buildDashboard({ ...def, data: { data: { ...def.data['data']!, key: 'id' } } }).createSession();
    const q = await keyed.viewQuery({ columns: ['price'], sort: [{ field: 'price', dir: 'asc' }], limit: 2 });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.positional).toBe(false);
    expect(q.rowIds).toEqual(['d0', 'd1']);
    expect(q.rows).toEqual([
      { price: 50, id: 'd0' },
      { price: 53, id: 'd1' },
    ]);
  });

  it('is refused with a sentence — an undeclared table, an undeclared view, a sort by a column the table lacks, an engine that cannot sort, a bad window', async () => {
    const s = fresh();
    expect(await s.viewQuery({ table: 'ghost' })).toEqual({ ok: false, reason: 'unknown-table', rejected: 'no table "ghost" is declared — the tables are data' });
    const view = await s.viewQuery({ viewId: 'ghost' });
    expect(!view.ok && [view.reason, view.rejected.startsWith('no declared view "ghost" — the views are ')]).toEqual(['unknown-view', true]);
    const col = await s.viewQuery({ sort: [{ field: 'ghost', dir: 'asc' }] });
    expect(col).toEqual({ ok: false, reason: 'engine', engineReason: 'unknown-column', rejected: 'table "data" has no column "ghost" to sort by' });
    const window = await s.viewQuery({ offset: -3 });
    expect(window).toEqual({ ok: false, reason: 'engine', engineReason: 'bad-window', rejected: 'offset must be a whole number at or above zero (got -3)' });
    const stub = buildDashboard(makeDashboardDef({ engine: 'wasm' })).createSession();
    expect(await stub.viewQuery({ sort: [{ field: 'price', dir: 'asc' }] })).toEqual({ ok: false, reason: 'unsupported-sort', rejected: 'the wasm engine cannot sort. Ask for this window without a sort' });
    const unsorted = await stub.viewQuery();
    expect(!unsorted.ok && unsorted.reason).toBe('no-columns'); // the stub engine's own sentence, never a fabricated window
  });

  it('a window is a window: the default limit bounds it, the result names its columns and the cursor it was read at', async () => {
    const big = buildDashboard(makeDashboardDef({ rows: Array.from({ length: 300 }, (_, i) => ({ id: `r${i}`, category: 'Casual', price: i, rating: 1 })) })).createSession();
    const q = await big.viewQuery({ columns: ['price'] });
    expect(q.ok && [q.rows.length, q.count, q.columns, q.cursor]).toEqual([VIEW_QUERY_DEFAULT_LIMIT, 300, ['price'], null]);
    const sel = await big.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('pick') });
    const at = await big.viewQuery({ limit: 1 });
    expect(at.ok && at.cursor).toBe(sel.ok ? sel.commit!.id : 'never');
  });
});

describe('clausesFor — what reaches a view', () => {
  it('excludes the view\'s own clause; a filter edge restricts the rows, a highlight edge reaches but keeps every row; the whole-dashboard truth still counts both', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    expect(s.clausesFor('bar')).toEqual([]); // its own clause never reaches it
    expect(s.clausesFor('scatter')).toMatchObject([{ from: 'bar', response: 'filter', clause: { kind: 'point', field: 'category', value: 'Formal' } }]);
    const scatter = await s.viewQuery({ viewId: 'scatter' });
    const bar = await s.viewQuery({ viewId: 'bar' });
    expect([scatter.ok && scatter.count, bar.ok && bar.count]).toEqual([8, 40]);
    // the edge is edited to highlight: the clause still reaches the scatter, the rows are no longer restricted
    const edit = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight', cause: userCause('light, do not filter') });
    expect(edit.ok).toBe(true);
    expect(s.clausesFor('scatter')).toMatchObject([{ from: 'bar', response: 'highlight' }]);
    const lit = await s.viewQuery({ viewId: 'scatter' });
    expect(lit.ok && [lit.count, lit.clauses.length]).toEqual([40, 1]);
    const truth = await s.viewQuery();
    expect(truth.ok && truth.count).toBe((await s.overview()).selectedRowCount); // parity holds regardless of edges
    // `none` on the edge: nothing from the bar reaches the scatter
    await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'none', cause: userCause('cut') });
    expect(s.clausesFor('scatter')).toEqual([]);
  });

  it('a field mapping on the edge renames the clause for the consumer — and a mapped field the table lacks is refused with the engine\'s sentence', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'filter', mapping: [{ from: 'price', to: 'price' }, { from: 'category', to: 'kind' }], cause: userCause('map') }); // an identity pair invents nothing
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    expect(s.clausesFor('scatter')).toMatchObject([{ from: 'bar', clause: { field: 'kind', value: 'Formal' } }]);
    const q = await s.viewQuery({ viewId: 'scatter' });
    expect(q).toEqual({ ok: false, reason: 'engine', engineReason: 'unknown-column', rejected: 'table "data" has no column "kind" — the link from bar maps category → kind' });
    // the hint is judged against the table's columns, not the caller's projection — an innocent mapping is never named
    const narrow = await s.viewQuery({ viewId: 'scatter', columns: ['id'] });
    expect(!narrow.ok && narrow.rejected).toBe('table "data" has no column "kind" — the link from bar maps category → kind');
  });

  it('a cleared source is remembered per the edge\'s onClear: leave keeps the last clause, excludeAll keeps nothing, showAll (the default) forgets it — and selecting again speaks live', async () => {
    const leave = fresh();
    await leave.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'filter', onClear: 'leave', cause: userCause('leave it') });
    await leave.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    await leave.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: undefined, cause: userCause('clear') });
    expect(leave.clausesFor('scatter')).toMatchObject([{ from: 'bar', response: 'filter', clause: { kind: 'point', field: 'category', value: 'Formal' } }]);
    expect(leave.clausesFor('bar')).toEqual([]);
    const kept = await leave.viewQuery({ viewId: 'scatter' });
    expect(kept.ok && kept.count).toBe(8); // the scatter still sees the last pick
    await leave.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('pick again') });
    expect(leave.clausesFor('scatter')).toMatchObject([{ from: 'bar', clause: { value: 'Party' } }]); // live again: the remembered clause is not listed twice

    const exclude = fresh();
    await exclude.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'filter', onClear: 'excludeAll', mapping: [{ from: 'category', to: 'category' }], cause: userCause('nothing on clear') });
    await exclude.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    await exclude.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: undefined, cause: userCause('clear') });
    expect(exclude.clausesFor('scatter')).toEqual([{ from: 'bar', response: 'filter', clause: { kind: 'match', field: 'category', values: [] } }]);
    const none = await exclude.viewQuery({ viewId: 'scatter' });
    expect(none.ok && [none.count, none.rows.length]).toEqual([0, 0]);

    const forget = fresh(); // the default edge: showAll
    await forget.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    await forget.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: undefined, cause: userCause('clear') });
    expect(forget.clausesFor('scatter')).toEqual([]);
  });

  it('a cell clause is mapped on both of its fields, and its excludeAll stand-in names the first', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'link', source: 'scatter', kind: 'cell', target: 'bar', response: 'filter', onClear: 'excludeAll', mapping: [{ from: 'price', to: 'price' }, { from: 'rating', to: 'rating' }], cause: userCause('cells') });
    const cell = await s.dispatch({ verb: 'select', viewId: 'scatter', fields: ['price', 'rating'], values: [[50, 60], [1, 2]], cause: userCause('cell') });
    expect(cell.ok).toBe(true);
    expect(s.clausesFor('bar')).toMatchObject([{ from: 'scatter', clause: { kind: 'cell', fields: ['price', 'rating'] } }]);
    await s.dispatch({ verb: 'select', viewId: 'scatter', fields: ['price', 'rating'], values: null, cause: userCause('clear the cell') });
    // the cell door remembers its own clear, live — no seek needed; the stand-in names the cell's first field
    expect(s.clausesFor('bar')).toEqual([{ from: 'scatter', response: 'filter', clause: { kind: 'match', field: 'price', values: [] } }]);
    expect((await s.overview()).clearedSelections?.map((c) => c.viewId)).toEqual(['scatter']);
    const none = await s.viewQuery({ viewId: 'bar' });
    expect(none.ok && none.count).toBe(0);
    // a live cell drops what was cleared beside it: one source is listed once, by its live clause
    await s.dispatch({ verb: 'select', viewId: 'scatter', fields: ['price', 'rating'], values: [[50, 60], [1, 2]], cause: userCause('cell again') });
    expect(s.clausesFor('bar').map((c) => c.clause.kind)).toEqual(['cell']);
  });

  it('handed-out clauses are the consumer\'s own copies, never the session\'s live objects', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: ['Formal', 'Party'], cause: userCause('two') });
    const reaching = s.clausesFor('scatter')[0]!;
    (reaching.clause as unknown as { values: unknown[] }).values.push('Casual');
    expect(s.clausesFor('scatter')[0]!.clause).toMatchObject({ values: ['Formal', 'Party'] });
    const truth = await s.viewQuery();
    expect(truth.ok && truth.count).toBe(16);
  });
});

describe('clausesFor — the mapping fallback', () => {
  it('a mapping that does not name the clause\'s field leaves the field as it is', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'filter', mapping: [{ from: 'price', to: 'rating' }], cause: userCause('map another field') });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    expect(s.clausesFor('scatter')).toMatchObject([{ from: 'bar', clause: { field: 'category', value: 'Formal' } }]);
    const q = await s.viewQuery({ viewId: 'scatter' });
    expect(q.ok && q.count).toBe(8);
  });
});

describe('viewQuery — a table with a source has a version, and every positional row id carries it', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vf-viewquery-'));
    await writeFile(join(dir, 'data.csv'), 'id,category,price,rating\n' + SAMPLE_ROWS.map((r) => `${r.id},${r.category},${r.price},${r.rating}`).join('\n') + '\n');
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it('stamps the window with the table version the source reported', async () => {
    const def = makeDashboardDef();
    const dash = await buildDashboardAsync({ ...def, data: { data: { source: { format: 'csv', via: 'file', at: join(dir, 'data.csv') } } } }, { sources: [fileSource] });
    const s = dash.createSession();
    const q = await s.viewQuery({ limit: 2, sort: [{ field: 'price', dir: 'asc' }] });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(typeof q.version).toBe('string');
    expect(q.version!.length).toBeGreaterThan(0);
    expect(q.positional).toBe(true);
    expect(q.rowIds).toEqual([`${q.version}#0`, `${q.version}#1`]);
    expect((await s.overview()).tables[0]!.name).toBe('data');
  });

  it('a refresh landing while the rows are read is a moved version, refused — never rows from the old table stamped with the new version', async () => {
    const def = makeDashboardDef();
    const dash = await buildDashboardAsync({ ...def, data: { data: { source: { format: 'csv', via: 'file', at: join(dir, 'data.csv') } } } }, { sources: [fileSource] });
    const s = dash.createSession();
    const rt = (s as unknown as { runtime: { sources: Record<string, { version: string }>; providerFor: (t: string) => { evaluate: (...a: unknown[]) => Promise<unknown>; columns: (...a: unknown[]) => Promise<unknown> } } }).runtime;
    const provider = rt.providerFor('data');
    const realEvaluate = provider.evaluate.bind(provider);
    provider.evaluate = async (...args: unknown[]) => {
      rt.sources['data'] = { ...rt.sources['data']!, version: 'moved-under-us' }; // the refresh lands while the rows are read
      return realEvaluate(...args);
    };
    const q = await s.viewQuery({ limit: 1 });
    expect(!q.ok && q.reason).toBe('version-moved');
    expect(!q.ok && q.rejected).toBe('table "data" was refreshed while the window was read — ask again');
    // ...and while the COLUMNS are read (before the rows): the version was captured beside the provider, so this is caught too
    provider.evaluate = realEvaluate;
    const realColumns = provider.columns.bind(provider);
    provider.columns = async (...args: unknown[]) => {
      rt.sources['data'] = { ...rt.sources['data']!, version: 'moved-again' };
      return realColumns(...args);
    };
    const early = await s.viewQuery({ limit: 1 });
    expect(!early.ok && early.reason).toBe('version-moved');
  });
});
