/**
 * Round 5: a commit says which data it was true of; a conditional read moves
 * no bytes when the version holds; a refresh replaces a table's rows in place
 * and, with a declared row key, says exactly what changed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDashboard, buildDashboardAsync, validateDashboardDef, deltaByKey, inlineSource } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { fileSource } from './file.js';
import { makeDashboardDef, SAMPLE_ROWS } from '../session/dashboard.fixture.js';
import { CauseSelectionSession, serializeLog, deserializeLog, replayLog } from '../log/index.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const CSV1 = 'id,price,rating,category,region\n1,40,3,Casual,N\n2,160,5,Formal,N\n3,220,2,Party,S\n';
const CSV2 = 'id,price,rating,category,region\n1,40,3,Casual,N\n2,170,5,Formal,N\n4,90,4,Work,S\n'; // 2 updated, 3 removed, 4 added

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vf-refresh-'));
  await writeFile(join(dir, 'data.csv'), CSV1);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const withFile = (key?: string): DashboardDef => ({ ...makeDashboardDef(), data: { data: { source: { format: 'csv', via: 'file', at: join(dir, 'data.csv') }, ...(key !== undefined ? { key } : {}) } } });

describe('the row key at the def door', () => {
  it('must be a column name, and a declared column when columns are declared', () => {
    const def = makeDashboardDef();
    expect(validateDashboardDef({ ...def, data: { data: { rows: [], key: '' } } })).toEqual(['data["data"].key must be a column name']);
    expect(validateDashboardDef({ ...def, data: { data: { rows: [], key: 'id', columns: { price: { role: 'measure' } } } } })).toEqual(['data["data"].key "id" is not a declared column']);
    expect(validateDashboardDef({ ...def, data: { data: { rows: [], key: 'id' } } })).toEqual([]);
  });
});

describe('deltaByKey', () => {
  it('exact with a key (added, updated, removed, unkeyed counted); replaced without one', () => {
    const before = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 3, v: 'c' }, { v: 'no key' }, { id: null, v: 'null key' }];
    const after = [{ id: 1, v: 'a' }, { id: 2, v: 'B' }, { id: 4, v: 'd' }, { id: 4, v: 'dup' }];
    expect(deltaByKey(before, after, 'id')).toEqual({ keyed: true, key: 'id', added: 1, updated: 1, removed: 1, sample: { added: ['4'], updated: ['2'], removed: ['3'] }, unkeyed: 3 });
    expect(deltaByKey(before, after, undefined)).toEqual({ keyed: false, replaced: 4 });
    expect(deltaByKey([], [{ id: 1 }], 'id')).toMatchObject({ added: 1, updated: 0, removed: 0 }); // nothing before: nothing to remove
  });
});

describe('conditional reads', () => {
  it('the file carrier answers by a stat; the inline carrier by its own version', async () => {
    const h = await fileSource.open({ format: 'csv', via: 'file', at: join(dir, 'data.csv') }, { table: 'data' });
    const first = await h.snapshot();
    if ('unchanged' in first) throw new Error('first read');
    expect(await h.snapshot({ sinceVersion: first.version })).toEqual({ unchanged: true, version: first.version });
    const again = await h.snapshot({ sinceVersion: 'mtime:never;size:0' });
    expect('unchanged' in again).toBe(false);
    const inline = await inlineSource.open({ format: 'rows', via: 'inline', at: [{ a: 1 }] }, { table: 't' });
    const v = await inline.snapshot();
    if ('unchanged' in v) throw new Error('first read');
    expect(await inline.snapshot({ sinceVersion: v.version })).toEqual({ unchanged: true, version: v.version });
  });
});

describe('refresh', () => {
  it('unchanged moves nothing; a changed file replaces the rows in place, every session sees them, and the delta is exact with a key; earlier commits are marked as true of the old data', async () => {
    const dash = await buildDashboardAsync(withFile('id'), { sources: [fileSource] });
    const s = dash.createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('formal') });
    const v1 = dash.sources['data']!.version;
    expect(pick.ok && pick.commit?.data).toEqual({ data: v1 }); // the commit says which data it was true of
    expect((await dash.refresh()).tables['data']).toEqual({ unchanged: true, version: v1 });
    expect((await s.selectedRows()).map((r) => r['id'])).toEqual([2]);

    await writeFile(join(dir, 'data.csv'), CSV2);
    const later = new Date(Date.now() + 2000);
    await utimes(join(dir, 'data.csv'), later, later); // a distinct mtime even on a coarse file system
    const res = (await dash.refresh(['data'])).tables['data']!;
    expect('changed' in res && res.changed).toBe(true);
    if (!('changed' in res)) return;
    expect(res.from).toBe(v1);
    expect(res.to).not.toBe(v1);
    expect(res.rows).toBe(3);
    expect(res.delta).toEqual({ keyed: true, key: 'id', added: 1, updated: 1, removed: 1, sample: { added: ['4'], updated: ['2'], removed: ['3'] }, unkeyed: 0 });
    expect(dash.sources['data']!.version).toBe(res.to);
    expect((await s.overview()).sources['data']!.version).toBe(res.to); // the session reads the same provenance
    expect((await s.selectedRows()).map((r) => [r['id'], r['price']])).toEqual([[2, 170]]); // the live selection now keeps the new bytes

    // the earlier commit stays true of the old data; a new one is stamped with the new version
    const after = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Work', cause: userCause('work') });
    expect(pick.ok && pick.commit?.data).toEqual({ data: v1 });
    expect(after.ok && after.commit?.data).toEqual({ data: res.to });
  });
  it('without a key the table is replaced, nothing guessed; a missing file is refused by its reason; a table with no source has nothing to refresh', async () => {
    const dash = await buildDashboardAsync(withFile(), { sources: [fileSource] });
    await writeFile(join(dir, 'data.csv'), CSV1);
    const later = new Date(Date.now() + 4000);
    await utimes(join(dir, 'data.csv'), later, later);
    const res = (await dash.refresh()).tables['data']!;
    expect('changed' in res && res.delta).toEqual({ keyed: false, replaced: 3 });
    await rm(join(dir, 'data.csv'));
    const gone = (await dash.refresh()).tables['data']!;
    expect('refused' in gone && gone.reason).toBe('unavailable');
    expect((await dash.refresh(['ghost'])).tables['ghost']).toEqual({ refused: true, reason: 'no-source', message: 'no table "ghost" is declared — the tables are data' });
    await writeFile(join(dir, 'data.csv'), CSV1);
  });
  it('a column layout is kept across a refresh; a carrier that throws a plain error is reported as no-source with its words', async () => {
    const columnar: DashboardDef = { ...makeDashboardDef(), data: { data: { source: { format: 'csv', via: 'file', at: join(dir, 'data.csv') }, layout: 'column', key: 'id' } } };
    const dash = await buildDashboardAsync(columnar, { sources: [fileSource] });
    await writeFile(join(dir, 'data.csv'), CSV2);
    const later = new Date(Date.now() + 6000);
    await utimes(join(dir, 'data.csv'), later, later);
    const res = (await dash.refresh()).tables['data']!;
    expect('changed' in res && res.delta.keyed).toBe(true);
    expect((await dash.createSession().selectedRows()).map((r) => r['id'])).toEqual([1, 2, 4]);
    await writeFile(join(dir, 'data.csv'), CSV1);
    const flaky = { via: 'http' as const, open: async () => ({ capabilities: { live: false, pushdown: false as const }, snapshot: async () => { throw 'the door is closed'; }, close: async () => {} }) };
    const remote: DashboardDef = { ...makeDashboardDef(), data: { data: { source: { format: 'rows', via: 'inline', at: [{ id: 1, price: 1, rating: 1, category: 'a', region: 'n' }] } }, other: { source: { format: 'json', via: 'http', at: 'https://example.test/x' } } } };
    const okOnce = { ...flaky, open: async () => ({ capabilities: { live: false, pushdown: false as const }, snapshot: async () => ({ rows: [{ a: 1 }], version: 'v', retrievedAt: 'now' }), close: async () => {} }) };
    const dash2 = await buildDashboardAsync(remote, { sources: [okOnce] });
    const dash3 = await buildDashboardAsync(remote, { sources: [flaky] }).catch(() => null);
    expect(dash3).toBeNull(); // the first read refuses through the def error
    // swap the carrier: the same dashboard now refreshes through one that throws a bare string
    const withFlaky = await buildDashboardAsync(remote, { sources: [{ via: 'http', open: okOnce.open }] });
    expect((await withFlaky.refresh(['other'])).tables['other']).toEqual({ unchanged: true, version: 'v' }); // a carrier vouching the same version
    const thrower = await buildDashboardAsync(remote, { sources: [{ via: 'http', open: async () => ({ capabilities: { live: false, pushdown: false as const }, snapshot: async (o?: { sinceVersion?: string }) => (o?.sinceVersion === undefined ? { rows: [{ a: 1 }], version: 'v', retrievedAt: 'now' } : Promise.reject('the door is closed')), close: async () => {} }) }] });
    expect((await thrower.refresh(['other'])).tables['other']).toEqual({ refused: true, reason: 'no-source', message: 'the door is closed' });
    expect(dash2.sources['other']?.version).toBe('v');
  });
  it('a synchronous dashboard: inline sources never move; a rows table has nothing to refresh', async () => {
    const inline = buildDashboard({ ...makeDashboardDef(), data: { data: { source: { format: 'csv', via: 'inline', at: CSV1 } } } });
    expect((await inline.refresh()).tables['data']).toEqual({ unchanged: true, version: inline.sources['data']!.version });
    const plain = buildDashboard(makeDashboardDef());
    expect((await plain.refresh(['data'])).tables['data']).toEqual({ refused: true, reason: 'no-source', message: 'data["data"] declares no source — inline rows never move' });
    expect((await plain.refresh()).tables['data']).toMatchObject({ refused: true, reason: 'no-source' }); // both doors walk the def
  });
});

describe('the review\'s laws', () => {
  it('a column an analysis materialised is stripped before the compare and reported lost — never read as every row updated', async () => {
    await writeFile(join(dir, 'data.csv'), CSV1);
    const dash = await buildDashboardAsync(withFile('id'), { sources: [fileSource] });
    const s = dash.createSession();
    const ran = await s.dispatch({ verb: 'analyze', analysisId: 'clustering', cause: userCause('cluster') });
    expect(ran.ok).toBe(true);
    const cols = await s.overview();
    expect(cols.columns['data']!.map((c) => c.field)).toContain('cluster_id');
    await writeFile(join(dir, 'data.csv'), CSV1.replace('3,220,2,Party,S', '3,230,2,Party,S'));
    const later = new Date(Date.now() + 8000);
    await utimes(join(dir, 'data.csv'), later, later);
    const res = (await dash.refresh()).tables['data']!;
    expect('changed' in res && res.materialisedLost).toEqual(['cluster_id']);
    expect('changed' in res && res.delta).toMatchObject({ keyed: true, added: 0, updated: 1, removed: 0 });
    expect((await s.overview()).columns['data']!.map((c) => c.field)).not.toContain('cluster_id');
    await writeFile(join(dir, 'data.csv'), CSV1);
  });
  it('a key that names no column says so instead of "nothing changed"', () => {
    expect(deltaByKey([{ a: 1 }], [{ a: 2 }, { a: 3 }], 'id')).toEqual({ keyed: false, replaced: 2, keyAbsent: 'id' });
  });
  it('two refreshes at once run one after another: the second reads the first\'s swap as unchanged', async () => {
    await writeFile(join(dir, 'data.csv'), CSV1);
    const dash = await buildDashboardAsync(withFile('id'), { sources: [fileSource] });
    await writeFile(join(dir, 'data.csv'), CSV2);
    const later = new Date(Date.now() + 10000);
    await utimes(join(dir, 'data.csv'), later, later);
    const [a, b] = await Promise.all([dash.refresh(), dash.refresh()]);
    expect('changed' in a.tables['data']!).toBe(true);
    expect(b.tables['data']).toMatchObject({ unchanged: true });
    await writeFile(join(dir, 'data.csv'), CSV1);
  });
  it('both doors walk the def: a rows table is refused the same way by the synchronous and the asynchronous dashboard', async () => {
    const def: DashboardDef = { ...makeDashboardDef(), data: { data: { rows: SAMPLE_ROWS }, extra: { source: { format: 'rows', via: 'inline', at: [{ a: 1 }] } } } };
    const sync = buildDashboard(def);
    const async_ = await buildDashboardAsync(def);
    const expected = { data: { refused: true, reason: 'no-source', message: 'data["data"] declares no source — inline rows never move' }, extra: { unchanged: true, version: sync.sources['extra']!.version } };
    expect((await sync.refresh()).tables).toEqual(expected);
    expect((await async_.refresh()).tables).toEqual(expected);
  });
  it('lintData judges the key against the engine\'s columns; the overview carries the keys; the stamp names the default table only', async () => {
    const bad = buildDashboard({ ...makeDashboardDef(), data: { data: { rows: SAMPLE_ROWS, key: 'ghost' } } });
    const lint = await bad.lintData();
    expect(lint).toHaveLength(1);
    expect(lint[0]).toMatch(/^data\["data"\]\.key "ghost" names no column of the table — the columns are .*\bprice\b/);
    const good = buildDashboard({ ...makeDashboardDef(), data: { data: { rows: SAMPLE_ROWS, key: 'id' }, other: { source: { format: 'rows', via: 'inline', at: [{ a: 1 }] }, key: 'a' } } });
    expect(await good.lintData()).toEqual([]);
    const s = good.createSession();
    expect((await s.overview()).keys).toEqual({ data: 'id', other: 'a' });
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    expect(pick.ok && pick.commit?.data).toBeUndefined(); // the default table is inline rows: nothing to stamp, even though `other` has a source
    const stub = buildDashboard({ ...makeDashboardDef(), data: { data: { rows: [], engine: 'wasm', key: 'id' } } }, { availableEngines: ['memory', 'wasm'] });
    expect((await stub.lintData())[0]).toMatch(/^data\["data"\]\.key "id": the engine cannot list this table's columns — /);
  });
});

describe('the stamp on the log', () => {
  it('a commit takes the data it names, else the log\'s hook, else nothing; the stamp round-trips through JSON', () => {
    const log = new CauseSelectionSession();
    const meta = { actor: 'user' as const };
    const cause = { requestedBy: 'user' as const, computedBy: 'user' as const };
    const a = log.commit({ id: 'a', parent: null, viewId: 'v', actorMeta: meta, kind: 'point', field: 'f', value: 1, cause, data: { t: 'v1' } }).record;
    expect(a.data).toEqual({ t: 'v1' });
    const b = log.commit({ id: 'b', parent: 'a', viewId: 'v', actorMeta: meta, kind: 'point', field: 'f', value: 2, cause }).record;
    expect(b.data).toBeUndefined();
    log.stampData = () => ({ t: 'v2' });
    const c = log.commit({ id: 'c', parent: 'b', viewId: 'v', actorMeta: meta, kind: 'point', field: 'f', value: 3, cause }).record;
    expect(c.data).toEqual({ t: 'v2' });
    log.stampData = () => ({});
    const d = log.commit({ id: 'd', parent: 'c', viewId: 'v', actorMeta: meta, kind: 'point', field: 'f', value: 4, cause }).record;
    expect(d.data).toBeUndefined();
    expect(deserializeLog(serializeLog(log.records)).map((r) => r.data)).toEqual([{ t: 'v1' }, undefined, { t: 'v2' }, undefined]);
    // a replayed log keeps every stamp: provenance travels verbatim, whatever the replaying session would stamp
    const replayed = replayLog(deserializeLog(serializeLog(log.records)));
    expect(replayed.records.map((r) => r.data)).toEqual([{ t: 'v1' }, undefined, { t: 'v2' }, undefined]);
  });
});
