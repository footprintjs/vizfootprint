/**
 * growing.test.ts — A SOURCE WHOSE PARTIAL ANSWER *IS* AN ANSWER, AND THE
 * EXTENT ON THE RECORD.
 *
 * The one question that separates the arrival kinds is whether a partial answer
 * is a usable answer. Half an alignment is not one — it is the first N sequences
 * in file order, a biased subset. The first thousand rows of a time series ARE
 * one, **if the number says it is over a thousand.** So:
 *
 *   **A number over a growing source states the extent it was computed over,
 *   and a commit records the extent it was true of.**
 *
 * The assertion that matters most is the time-travel one, and it is its own
 * describe block below: land at one extent, land again at a larger one, seek
 * back, and the number matches the FIRST extent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDashboard, buildDashboardAsync, validateDashboardDef } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { basisOf, extentsOf } from '../agent/basis.js';
import { digestOf, notGrowing, prefixOf } from '../def/growing.js';
import { fileSource } from './file.js';
import { CauseSelectionSession, deserializeLog, parseCommitLog, replayLog, serializeLog, type CommitRecord } from '../log/index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import type { Cause } from '../cause/index.js';
import type { SourceInfo } from './types.js';

const userCause = (intent: string): Cause => ({ requestedBy: 'user', computedBy: 'user', intent });

const HEAD = 'id,price,rating,category,region\n';
const G1 = `${HEAD}1,40,3,Casual,N\n2,160,5,Formal,N\n3,220,2,Party,S\n`;
/** The SAME three rows, in the same order, with two more appended: the one shape a growing source may take. */
const G2 = `${G1}4,90,4,Casual,S\n5,70,1,Casual,N\n`;

let dir = '';
let clock = 0;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vf-growing-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Write the file and move its mtime forward, so the conditional read sees a new version on any file system. */
async function land(at: string, csv: string): Promise<void> {
  await writeFile(at, csv);
  clock += 2000;
  const when = new Date(Date.now() + clock);
  await utimes(at, when, when);
}

let files = 0;
/** One growing def over a file of its own — the suite writes the same table many times. */
async function growingAt(csv: string, extra: Record<string, unknown> = {}): Promise<{ readonly at: string; readonly def: DashboardDef }> {
  const at = join(dir, `g${files++}.csv`);
  await land(at, csv);
  return { at, def: { ...makeDashboardDef(), data: { data: { source: { format: 'csv', via: 'file', at, arrival: 'growing' }, key: 'id', ...extra } } } };
}

describe('the declaration, and what it is refused for', () => {
  it('names the two kinds; "whole" is the default and declaring it changes nothing', () => {
    const def = makeDashboardDef();
    const withArrival = (arrival: unknown): DashboardDef => ({ ...def, data: { data: { source: { format: 'csv', via: 'inline', at: G1, arrival }, key: 'id' } } }) as DashboardDef;
    expect(validateDashboardDef(withArrival('sideways'))).toEqual(['data["data"].source.arrival must be one of whole|growing — is a partial answer a usable answer?']);
    expect(validateDashboardDef(withArrival('whole'))).toEqual([]);
    expect(validateDashboardDef(withArrival('growing'))).toEqual([]);
    expect(validateDashboardDef(withArrival(undefined))).toEqual([]);
  });

  it('THE HONEST NEGATIVE — "live" is refused as a word, because what it would need is not built: a feed is never complete, so its number says AS OF WHEN rather than over what; and the cursor depends on the record being immutable, so a feed has to accumulate OUTSIDE the record and land by an act at a declared moment. None of that is this packet, and a word here that every door refused would be a promise the library does not keep', () => {
    const def: DashboardDef = { ...makeDashboardDef(), data: { data: { source: { format: 'csv', via: 'inline', at: G1, arrival: 'live' } as never, key: 'id' } } };
    expect(validateDashboardDef(def)).toEqual(['data["data"].source.arrival must be one of whole|growing — is a partial answer a usable answer?']);
  });

  it('a growing source must name its row key — without one a re-reading is "replaced" and nothing could tell an added row from a changed one', () => {
    const def: DashboardDef = { ...makeDashboardDef(), data: { data: { source: { format: 'csv', via: 'inline', at: G1, arrival: 'growing' } } } };
    expect(validateDashboardDef(def)).toEqual(['data["data"].source.arrival is "growing", so data["data"].key must name the row identity column — without one a re-reading is "replaced" and nothing could tell an added row from a changed one']);
  });

  it('a growing source is a memory-engine table: only that engine can bound a read to an extent', () => {
    const def: DashboardDef = { ...makeDashboardDef(), data: { data: { source: { format: 'csv', via: 'inline', at: G1, arrival: 'growing' }, key: 'id', engine: 'wasm' } } };
    expect(validateDashboardDef(def)).toEqual(['data["data"].source.arrival is "growing" on engine "wasm"; a number behind the cursor is read over the extent its commit named, and only the memory engine can bound a read to an extent — declare "memory", or no engine at all']);
    expect(validateDashboardDef({ ...def, data: { data: { source: { format: 'csv', via: 'inline', at: G1, arrival: 'growing' }, key: 'id', engine: 'memory' } } })).toEqual([]);
  });

  it('arrival is a source key, judged in the same words every other stray key is', () => {
    const def: DashboardDef = { ...makeDashboardDef(), data: { data: { source: { format: 'csv', via: 'inline', at: G1, arrivals: 'growing' } as never, key: 'id' } } };
    expect(validateDashboardDef(def)).toEqual(['data["data"].source.arrivals is not a source key']);
  });
});

describe('two extents, both on the record', () => {
  it('lands at one extent, then at a larger one; the source row moves and the earlier commit keeps the earlier extent', async () => {
    const { at, def } = await growingAt(G1);
    const dash = await buildDashboardAsync(def, { sources: [fileSource] });
    expect(dash.sources['data']).toMatchObject({ rows: 3, arrival: 'growing' });
    const s = dash.createSession();
    const first = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('casual') });
    expect(first.ok && first.commit?.extents).toEqual({ data: 3 });

    await land(at, G2);
    const res = (await dash.refresh()).tables['data']!;
    expect('changed' in res && res.rows).toBe(5);
    expect('changed' in res && res.delta).toMatchObject({ keyed: true, added: 2, updated: 0, removed: 0 });
    // the source row is a fact about the LAST READ and moves; the commit is a fact about
    // what a number was true of and does not — they diverge exactly here
    expect(dash.sources['data']!.rows).toBe(5);
    expect(first.ok && first.commit?.extents).toEqual({ data: 3 });

    const later = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('party') });
    expect(later.ok && later.commit?.extents).toEqual({ data: 5 });
  });
});

describe('TIME TRAVEL — the assertion that matters most', () => {
  it('lands at one extent, lands again at a larger one, seeks back, and reads a number that matches the FIRST extent rather than the second', async () => {
    const { at, def } = await growingAt(G1);
    const dash = await buildDashboardAsync(def, { sources: [fileSource] });
    const s = dash.createSession();

    // ONE Casual row among the first three
    const c1 = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('casual') });
    expect((await s.overview()).selectedRowCount).toBe(1);

    // the source grows: the two rows appended are both Casual
    await land(at, G2);
    expect('changed' in (await dash.refresh()).tables['data']!).toBe(true);

    // …and the SAME clause, made again at the head, is now over five rows
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('party') });
    const c3 = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('casual again') });
    expect((await s.overview()).selectedRowCount).toBe(3);

    // THE SEEK. Step back and the number is the one over the prefix that existed THEN —
    // not today's rows judged by yesterday's clause.
    expect(s.seek(c1.ok ? c1.commit!.id : '').ok).toBe(true);
    expect((await s.overview()).selectedRowCount).toBe(1);

    // and forward again: at the head you read what has landed
    expect(s.seek(c3.ok ? c3.commit!.id : '').ok).toBe(true);
    expect((await s.overview()).selectedRowCount).toBe(3);

    // the same two numbers put beside each other, each read AT its own commit
    const both = await s.compare(c1.ok ? c1.commit!.id : '', c3.ok ? c3.commit!.id : '');
    expect(both.ok && both.a.rows).toBe(1);
    expect(both.ok && both.b.rows).toBe(3);
  });
});

describe('a number states the extent it was computed over', () => {
  it('the basis carries the extent of every growing source, and nothing at all when none grows', async () => {
    const { def } = await growingAt(G1);
    const dash = await buildDashboardAsync(def, { sources: [fileSource] });
    const basis = basisOf({ asOf: 'c1', revision: dash.revision, session: 'sess1', sources: dash.sources });
    expect(basis.extents).toEqual({ data: 3 });
    const whole = await buildDashboardAsync(makeDashboardDef());
    expect(basisOf({ asOf: 'c1', revision: whole.revision, session: 'sess1', sources: whole.sources }).extents).toBeUndefined();
    expect('extents' in basisOf({ asOf: 'c1', revision: whole.revision, session: 'sess1', sources: whole.sources })).toBe(false);
  });

  it('extentsOf reads the row count of the growing sources only', () => {
    const grows: SourceInfo = { format: 'csv', via: 'file', version: 'v', retrievedAt: 't', rows: 7, arrival: 'growing' };
    const whole: SourceInfo = { format: 'csv', via: 'file', version: 'v', retrievedAt: 't', rows: 9 };
    expect(extentsOf({ a: grows, b: whole })).toEqual({ a: 7 });
    expect(extentsOf({ b: whole })).toBeUndefined();
  });
});

describe('the declaration is falsified, not trusted', () => {
  it('a re-reading that removes, changes, or reorders a row already landed is refused not-growing by name, and the rows in place stay', async () => {
    const { at, def } = await growingAt(G1);
    const dash = await buildDashboardAsync(def, { sources: [fileSource] });

    await land(at, `${HEAD}1,40,3,Casual,N\n2,160,5,Formal,N\n`);
    const removed = (await dash.refresh()).tables['data']!;
    expect(removed).toEqual({ refused: true, reason: 'not-growing', message: 'data["data"] declares arrival "growing", so a re-reading only ever adds rows — this one holds 2 where 3 had landed, so 1 were removed' });
    expect(dash.sources['data']!.rows).toBe(3); // nothing moved

    await land(at, `${HEAD}1,40,3,Casual,N\n2,170,5,Formal,N\n3,220,2,Party,S\n4,90,4,Casual,S\n`);
    const changed = (await dash.refresh()).tables['data']!;
    expect(changed).toEqual({ refused: true, reason: 'not-growing', message: 'data["data"] declares arrival "growing", so a row already landed never changes — row "2" (position 1) came back different' });

    await land(at, `${HEAD}1,40,3,Casual,N\n3,220,2,Party,S\n4,90,4,Casual,S\n`);
    const dropped = (await dash.refresh()).tables['data']!;
    expect(dropped).toEqual({ refused: true, reason: 'not-growing', message: 'data["data"] declares arrival "growing", so a re-reading only ever adds rows — row "2" (position 1) was removed' });

    await land(at, `${HEAD}1,40,3,Casual,N\n3,220,2,Party,S\n2,160,5,Formal,N\n4,90,4,Casual,S\n`);
    const shuffled = (await dash.refresh()).tables['data']!;
    expect(shuffled).toEqual({ refused: true, reason: 'not-growing', message: 'data["data"] declares arrival "growing", so a re-reading only ever APPENDS — row "2" landed at position 1 and this reading puts "3" there, so the rows already landed are no longer the first 3' });

    // …and the honest append is still accepted after all four refusals: nothing was consumed
    await land(at, G2);
    expect('changed' in (await dash.refresh()).tables['data']!).toBe(true);
    expect(dash.sources['data']!.rows).toBe(5);
  });

  it('the prefix is judged by value and not by column order, and a column the new reading DROPPED is a change', () => {
    expect(digestOf({ a: 1, b: 2 })).toBe(digestOf({ b: 2, a: 1 }));
    expect(digestOf({ a: 1, b: 2 })).not.toBe(digestOf({ a: 1 }));
    expect(digestOf({ a: undefined })).not.toBe(digestOf({ a: null }));
    const was = prefixOf([{ id: 1, v: 'a' }], 'id');
    expect(notGrowing('t', was, prefixOf([{ v: 'a', id: 1 }, { id: 2, v: 'b' }], 'id'))).toBeUndefined();
    expect(notGrowing('t', was, prefixOf([{ id: 1 }], 'id'))).toMatch(/came back different/);
  });
});

describe('the extent is a bound on WHICH ROWS ARE JUDGED', () => {
  it('a sorted read over an extent judges the same rows as an unsorted one', async () => {
    const { memoryProvider } = await import('../data/memoryProvider.js');
    const rows = [{ id: 1, c: 'a' }, { id: 2, c: 'b' }, { id: 3, c: 'a' }, { id: 4, c: 'a' }];
    const p = memoryProvider(rows, { tableName: 't' });
    const clause = { kind: 'point' as const, field: 'c', value: 'a' };
    const counted = await p.evaluate('t', clause, { mode: 'count', extent: 3 });
    expect('count' in counted && counted.count).toBe(2);
    const sorted = await p.evaluate('t', clause, { extent: 3, sort: [{ field: 'id', dir: 'desc' }] });
    expect('rows' in sorted && sorted.rows!.map((r) => r['id'])).toEqual([3, 1]); // the same SET, in another order
    expect('count' in sorted && sorted.count).toBe(2);
    // an extent past the end is every row, and zero is none
    const all = await p.evaluate('t', clause, { mode: 'count', extent: 99 });
    expect('count' in all && all.count).toBe(3);
    const none = await p.evaluate('t', clause, { mode: 'count', extent: 0 });
    expect('count' in none && none.count).toBe(0);
  });

  it('a malformed extent is refused in the same sentence a malformed window is', async () => {
    const { memoryProvider } = await import('../data/memoryProvider.js');
    const p = memoryProvider([{ id: 1 }], { tableName: 't' });
    expect(await p.evaluate('t', null, { extent: -1 })).toMatchObject({ reason: 'bad-window', detail: 'extent must be a whole number at or above zero (got -1)' });
    expect(await p.evaluate('t', null, { extent: 1.5 })).toMatchObject({ reason: 'bad-window', detail: 'extent must be a whole number at or above zero (got 1.5)' });
  });
});

describe('the synchronous door', () => {
  it('carries the tag too — an inline growing source is legal, and its extent is the payload it was built from; it simply never moves', () => {
    const def: DashboardDef = { ...makeDashboardDef(), data: { data: { source: { format: 'csv', via: 'inline', at: G1, arrival: 'growing' }, key: 'id' } } };
    const dash = buildDashboard(def);
    expect(dash.sources['data']).toMatchObject({ rows: 3, arrival: 'growing' });
    const plain = buildDashboard({ ...makeDashboardDef(), data: { data: { source: { format: 'csv', via: 'inline', at: G1 }, key: 'id' } } });
    expect('arrival' in plain.sources['data']!).toBe(false);
  });
});

describe('the extent on the wire', () => {
  it('a commit takes the extents it names, else the log\'s hook, else nothing; the stamp round-trips and replays verbatim', () => {
    const log = new CauseSelectionSession();
    const meta = { actor: 'user' as const };
    const cause = { requestedBy: 'user' as const, computedBy: 'user' as const };
    const one = (id: string, parent: string | null, extra: Record<string, unknown> = {}): CommitRecord =>
      log.commit({ id, parent, viewId: 'v', actorMeta: meta, kind: 'point', field: 'f', value: id, cause, ...extra }).record;
    expect(one('a', null, { extents: { t: 3 } }).extents).toEqual({ t: 3 });
    expect(one('b', 'a').extents).toBeUndefined();
    log.stampExtents = () => ({ t: 5 });
    expect(one('c', 'b').extents).toEqual({ t: 5 });
    log.stampExtents = () => ({});
    expect(one('d', 'c').extents).toBeUndefined(); // an empty map is not an extent
    expect(deserializeLog(serializeLog(log.records)).map((r) => r.extents)).toEqual([{ t: 3 }, undefined, { t: 5 }, undefined]);
    expect(replayLog(deserializeLog(serializeLog(log.records))).records.map((r) => r.extents)).toEqual([{ t: 3 }, undefined, { t: 5 }, undefined]);
  });

  it('an extent that is not a whole row count is refused at the door back in', () => {
    const landed = new CauseSelectionSession().commit({ id: 'a', parent: null, viewId: 'v', actorMeta: { actor: 'user' }, kind: 'point', field: 'f', value: 1, cause: { requestedBy: 'user', computedBy: 'user' }, extents: { t: 3 } }).record;
    const base = JSON.parse(serializeLog([landed])) as Record<string, unknown>[];
    expect(parseCommitLog(base).ok).toBe(true); // …and it comes back with its extent, judged
    const sentence = 'extents, if present, must map table name to a whole row count at or above zero';
    for (const bad of [{ t: 1.5 }, { t: -1 }, { t: 'three' }, 7]) {
      const parsed = parseCommitLog([{ ...base[0], extents: bad }]);
      expect(parsed.ok === false && parsed.problems.some((p) => p.includes(sentence))).toBe(true);
    }
  });
});

describe('a source that declares nothing behaves exactly as it did', () => {
  it('no arrival means no tag on the source row, no extent on any commit, and a log that serializes byte for byte the same as "whole"', async () => {
    const plainAt = join(dir, `w${files++}.csv`);
    await land(plainAt, G1);
    const source = { format: 'csv' as const, via: 'file' as const, at: plainAt };
    const bare: DashboardDef = { ...makeDashboardDef(), data: { data: { source, key: 'id' } } };
    const whole: DashboardDef = { ...makeDashboardDef(), data: { data: { source: { ...source, arrival: 'whole' as const }, key: 'id' } } };

    const runOne = async (def: DashboardDef): Promise<{ readonly source: SourceInfo; readonly log: string }> => {
      const dash = await buildDashboardAsync(def, { sources: [fileSource] });
      const s = dash.createSession();
      await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('casual') });
      return { source: dash.sources['data']!, log: serializeLog(s.commits('anywhere')) };
    };
    const a = await runOne(bare);
    const b = await runOne(whole);
    // …minus the wall clock, which is the one field two reads a millisecond apart may differ in
    expect({ ...a.source, retrievedAt: '' }).toEqual({ ...b.source, retrievedAt: '' });
    expect('arrival' in a.source).toBe(false);
    expect(a.log).not.toContain('extents');
    expect(a.log).toBe(b.log);
  });
});
