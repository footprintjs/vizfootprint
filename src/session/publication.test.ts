import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import { CauseSelectionSession } from '../log/index.js';
import { memoryProvider } from '../data/index.js';
import { SAMPLE_ROWS } from './dashboard.fixture.js';

const cause = { requestedBy: 'user', computedBy: 'user' } as const;

describe('publication follows the settled session transition', () => {
  it('the first selection and its replacement publish the current cursor, refs and live clause', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const seen: unknown[] = [];
    s.log.port.listen(() => seen.push({
      commit: s.log.records.at(-1)!.id,
      cursor: s.cursor(), head: s.head, tip: s.paths()[0]?.tip,
      reaching: s.clausesFor('scatter').map((r) => r.clause),
    }));
    for (const value of ['Formal', 'Party']) {
      const result = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value, cause });
      expect(result.ok).toBe(true);
    }
    expect(seen).toEqual(['Formal', 'Party'].map((value, i) => ({
      commit: `s${i + 1}`, cursor: `s${i + 1}`, head: `s${i + 1}`, tip: `s${i + 1}`,
      reaching: [{ kind: 'point', field: 'category', value }],
    })));
  });

  it('bindings and prose provenance are live when their clauses are announced', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const seen: unknown[] = [];
    s.log.port.listen(() => seen.push({
      cursor: s.cursor(), bindings: s.viewEncodings('scatter'),
      prose: s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' }),
    }));
    await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'rating', cause });
    await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'The rating.', author: { kind: 'human' } }, cause });
    expect(seen[0]).toMatchObject({ cursor: 's1', bindings: { x: 'rating' } });
    expect(seen[1]).toMatchObject({ cursor: 's2', prose: { ok: true, viz: { commitId: 's2' } } });
  });

  it('an analysis publishes only after its columns and why provenance are available', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const seen: unknown[] = [];
    const reads: Promise<unknown>[] = [];
    s.log.port.listen(() => {
      seen.push({ cursor: s.cursor(), why: s.why({ kind: 'column', column: 'cluster_id' }) });
      reads.push(s.viewQuery({ columns: ['cluster_id'], limit: 1 }));
    });
    await s.declareAnalysis('clustering');
    expect(seen).toMatchObject([{ cursor: 's1', why: { ok: true, viz: { commitId: 's1' } } }]);
    expect(await Promise.all(reads)).toMatchObject([{ ok: true, columns: ['cluster_id'] }]);
  });

  it('both proposal clauses publish after the complete proposal, each exactly once', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const seen: unknown[] = [];
    s.log.port.listen(() => seen.push({ cursor: s.cursor(), commits: s.log.records.length, charts: s.charts().map((c) => c.chartId), ledger: s.ledger().length }));
    await s.proposeChart({ id: 'new-chart', spec: { mark: 'point', encoding: { x: { field: 'price' }, y: { field: 'rating' } } } });
    expect(seen).toEqual(Array.from({ length: 2 }, () => ({ cursor: 's2', commits: 2, charts: ['new-chart'], ledger: 1 })));
  });

  it('replay publishes the complete restored tip rather than a half-restored fold', async () => {
    const source = buildDashboard(makeDashboardDef()).createSession();
    await source.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    await source.declareAnalysis('clustering');
    const s = buildDashboard(makeDashboardDef()).createSession();
    const seen: unknown[] = [];
    s.log.port.listen(() => seen.push({ cursor: s.cursor(), why: s.why({ kind: 'column', column: 'cluster_id' }), reaching: s.clausesFor('scatter').map((r) => r.clause) }));
    await s.replay(source.log.records);
    expect(seen).toMatchObject(Array.from({ length: 2 }, () => ({ cursor: 's2', why: { ok: true, viz: { commitId: 's2' } }, reaching: [{ kind: 'point', field: 'category', value: 'Formal' }] })));
  });

  it('a reentrant act follows the settled parent and cannot be overwritten by its publisher', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const observed: string[] = [];
    let nested: Promise<unknown> | undefined;
    let entered = false;
    s.log.port.listen(() => {
      observed.push(s.cursor()!);
      if (!entered) { entered = true; nested = s.dispatch({ verb: 'annotate', target: 'bar', note: 'nested', cause }); }
    });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    await nested;
    expect(s.log.records.map((r) => [r.id, r.parent])).toEqual([['s1', null], ['s2', 's1']]);
    expect(observed).toEqual(['s1', 's2']);
    expect(s.cursor()).toBe('s2');
    expect(s.head).toBe('s2');
  });

  it('a reentrant selection and mounted render effects keep publication order', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const rendered: unknown[] = [];
    s.mountView('bar', { capabilities: { canProbe: true }, applyClause: (clause) => rendered.push(clause.value) });
    let nested: Promise<unknown> | undefined;
    s.log.port.listen(() => {
      if (nested === undefined) nested = s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause });
    });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    await nested;
    expect(rendered).toEqual(['Formal', 'Party']);
    expect(s.log.records.map((r) => r.parent)).toEqual([null, 's1']);
    expect(s.clausesFor('scatter').map((r) => r.clause)).toEqual([{ kind: 'point', field: 'category', value: 'Party' }]);
  });

  it('an observer failure names its record, and later batch effects still run once', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    let attempted = 0;
    s.log.port.listen(() => { if (++attempted === 1) throw new Error('first observer failed'); });
    const result = await s.proposeChart({ id: 'new-chart', spec: { mark: 'point', encoding: { x: { field: 'price' }, y: { field: 'rating' } } } });
    expect(result.ok).toBe(true);
    expect(attempted).toBe(2);
    expect(s.gaps()).toMatchObject([{ code: 'effect-failed', op: 'commit', target: 's1' }]);
  });

  it('an asynchronous materialization stays unpublished until its own result is settled', async () => {
    const provider = memoryProvider(SAMPLE_ROWS, { tableName: 'data' });
    const write = provider.materializeColumn!.bind(provider);
    let begin!: () => void;
    const began = new Promise<void>((resolve) => { begin = resolve; });
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    provider.materializeColumn = async (...args) => { begin(); await finished; return write(...args); };
    const s = buildDashboard(makeDashboardDef(), { providers: { data: provider } }).createSession();
    const seen: unknown[] = [];
    s.log.port.listen(() => seen.push({ cursor: s.cursor(), why: s.why({ kind: 'column', column: 'cluster_id' }) }));
    const analysis = s.declareAnalysis('clustering');
    await began;
    expect(seen).toEqual([]);
    // A separate synchronous act publishes only itself, not the pending analysis.
    await s.dispatch({ verb: 'annotate', target: 'bar', note: 'while writing', cause });
    expect(seen).toHaveLength(1);
    finish();
    await analysis;
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ cursor: 's2', why: { ok: true, viz: { commitId: 's1' } } });
  });

  it('bare logs auto-publish, deferred records publish once and cannot release another transition', () => {
    const log = new CauseSelectionSession();
    let notifications = 0;
    log.port.listen(() => { notifications++; });
    const input = { id: 'first', parent: null, viewId: 'bar', actorMeta: { actor: 'user' as const }, kind: 'point' as const, field: 'category', value: 'Formal', cause };
    const first = log.commit(input);
    expect(notifications).toBe(1);
    const second = log.commit({ ...input, id: 'second', parent: 'first' }, { deferPublication: true });
    const third = log.commit({ ...input, id: 'third', parent: 'second' }, { deferPublication: true });
    log.publish([first.record, second.record]);
    expect(notifications).toBe(2);
    log.publish([second.record]);
    expect(notifications).toBe(2);
    log.publish([third.record]);
    expect(notifications).toBe(3);
  });

  it('replay reports observer failures in both its count and returned overview', async () => {
    const source = buildDashboard(makeDashboardDef()).createSession();
    await source.dispatch({ verb: 'annotate', target: 'bar', note: 'saved', cause });
    const s = buildDashboard(makeDashboardDef()).createSession();
    s.log.port.listen(() => { throw new Error('replay observer failed'); });
    const result = await s.replay(source.log.records);
    expect(result).toMatchObject({ ok: true, filed: 1, overview: { gaps: 1 } });
    expect(s.gaps()).toMatchObject([{ code: 'effect-failed', target: 's1' }]);
  });

  it('a throwing post-publication effect does not discard a nested record effect', () => {
    const log = new CauseSelectionSession();
    const input = { id: 'first', parent: null, viewId: 'bar', actorMeta: { actor: 'user' as const }, kind: 'point' as const, field: 'category', value: 'Formal', cause };
    const first = log.commit(input, { deferPublication: true });
    const seen: unknown[] = [];
    log.port.listen(() => seen.push(log.port.clauses()[0]?.value));
    expect(() => log.publish([first.record], () => {
      log.commit({ ...input, id: 'second', parent: 'first', value: 'Party' });
      throw new Error('effect failed');
    })).toThrow('effect failed');
    expect(seen).toEqual(['Formal', 'Party']);
    // Foreign records and repeated publication cannot trigger a callback.
    const other = new CauseSelectionSession().commit({ ...input, id: 'foreign' });
    log.publish([other.record, first.record], () => { throw new Error('must not run'); });
  });

  it('two failed bare-log notifications attempt both effects and rethrow the first error', () => {
    const log = new CauseSelectionSession();
    const input = { id: 'first', parent: null, viewId: 'bar', actorMeta: { actor: 'user' as const }, kind: 'point' as const, field: 'category', value: 'Formal', cause };
    const first = log.commit(input, { deferPublication: true });
    const second = log.commit({ ...input, id: 'second', parent: 'first' }, { deferPublication: true });
    let attempted = 0;
    log.port.listen(() => { throw new Error(`failure ${++attempted}`); });
    expect(() => log.publish([first.record, second.record])).toThrow('failure 1');
    expect(attempted).toBe(2);
  });
});
