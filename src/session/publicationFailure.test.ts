import { describe, expect, it, vi } from 'vitest';
import { buildDashboard, layerAddress } from '../def/index.js';
import { makeNetworkDef, NETWORK_RELATIONS } from '../def/network.fixture.js';
import { makeDashboardDef, SAMPLE_ROWS } from './dashboard.fixture.js';
import { memoryProvider } from '../data/index.js';
import type { CommitRecord } from '../log/index.js';
import type { RegisteredAnalysis } from '../def/types.js';

const cause = { requestedBy: 'user', computedBy: 'user' } as const;
const pick = { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause } as const;
const words = { text: 'The rating', author: { kind: 'human' as const } };
const proposed = { verb: 'describe', viewId: 'scatter', slot: 'caption', proposal: true, record: words, cause } as const;
const chart = { id: 'proposal', spec: { mark: 'point', encoding: { x: { field: 'price' }, y: { field: 'rating' } } } };
function fresh() {
  const base = makeDashboardDef();
  return buildDashboard({ ...base, capabilities: [...base.capabilities!, { viewId: 'scatter', canProbe: true, encodings: ['point', 'interval', 'cell'] }] }).createSession();
}
type Session = ReturnType<typeof fresh>;
type TestSession = Session & {
  landed(record: CommitRecord): void;
  seekTo(id: string): void;
  rebuildFold(id: string | null): void;
  landEncoding(...args: unknown[]): CommitRecord;
  noteColumnProvenance(...args: unknown[]): void;
  analysis(id: string): RegisteredAnalysis | undefined;
  proseOf(...args: unknown[]): unknown;
  proposalsOf(...args: unknown[]): unknown;
};
interface Scenario { name: string; create?: () => Session; setup?: (s: Session) => Promise<unknown>; invoke: (s: Session) => Promise<unknown> }
const scenarios: Scenario[] = [
  { name: 'link', invoke: s => s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight', cause }) },
  { name: 'point', invoke: s => s.dispatch(pick) },
  { name: 'interval', invoke: s => s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 100], cause }) },
  { name: 'match', invoke: s => s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: ['Formal', 'Party'], cause }) },
  { name: 'cell', invoke: s => s.dispatch({ verb: 'select', viewId: 'scatter', fields: ['price', 'rating'], values: [[60, 100], [1, 3]], cause }) },
  { name: 'neighbourhood', create: () => buildDashboard(makeNetworkDef(undefined, { relations: NETWORK_RELATIONS, capabilities: [{ viewId: 'net', canProbe: true, encodings: ['neighbourhood'] }] })).createSession(), invoke: s => s.dispatch({ verb: 'select', viewId: layerAddress('net', 'edges'), field: 'source', seed: 'cold', cause }) },
  { name: 'encoding single', invoke: s => s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'rating', cause }) },
  { name: 'encoding set', invoke: s => s.dispatch({ verb: 'reencode', viewId: 'scatter', bindings: { x: 'rating', y: 'price' }, cause }) },
  { name: 'prose set', invoke: s => s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: words, cause }) },
  { name: 'prose propose', invoke: s => s.dispatch(proposed) },
  { name: 'prose accept', setup: s => s.dispatch(proposed), invoke: s => s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', accept: 's1', cause }) },
  { name: 'prose decline', setup: s => s.dispatch(proposed), invoke: s => s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', decline: { proposal: 's1', reason: 'not needed' }, cause }) },
  { name: 'annotation', invoke: s => s.dispatch({ verb: 'annotate', target: 'bar', note: 'note', cause }) },
  { name: 'layout', invoke: s => s.dispatch({ verb: 'navigate', viewId: 'layout:dashboard', field: 'preset', value: 'grid', cause }) },
  { name: 'analysis', invoke: s => s.declareAnalysis('correlation') },
  { name: 'chart proposal', invoke: s => s.proposeChart(chart) },
];

describe('B2 — every live semantic door owns its landed records through exceptions', () => {
  it.each(scenarios)('$name releases once after a post-land callback fails', async ({ create, setup, invoke }) => {
    const s = (create ?? fresh)();
    await setup?.(s);
    const before = s.log.records.length;
    const failure = new Error('post-land failure');
    const debug = s as TestSession;
    const land = debug.landed.bind(s);
    vi.spyOn(debug, 'landed').mockImplementationOnce((record) => { land(record); throw failure; });
    const seen: unknown[] = [];
    s.log.port.listen(() => seen.push({ cursor: s.cursor(), head: s.head, commit: s.log.records.at(-1)!.id }));
    await expect(invoke(s)).rejects.toBe(failure);
    expect(s.log.records).toHaveLength(before + 1);
    const commit = s.log.records.at(-1)!;
    expect(seen).toEqual([{ cursor: commit.id, head: commit.id, commit: commit.id }]);
    expect(s.log.port.clauses().some(c => c.source.viewId === commit.viewId)).toBe(true);
    expect(s.gaps().at(-1)).toMatchObject({ code: 'effect-failed', target: commit.id });
    if (commit.viewId === 'bar') expect(s.clausesFor('scatter').map(r => r.clause)).toEqual([commit.kind === 'match' ? { kind: commit.kind, field: commit.field, ...(commit.value as Record<string, unknown>) } : { kind: commit.kind, field: commit.field, value: commit.value }]);
    if (commit.viewId === 'encoding:scatter') expect(s.viewEncodings('scatter').x).toBe('rating');
    if (commit.viewId === 'layout:dashboard') expect((await s.overview()).layouts.dashboard?.preset).toBe('grid');
    // An analysis/proposal really spent its FDR step: do not invent a refund.
    if (commit.viewId.startsWith('analysis:') || commit.viewId.startsWith('chart:')) expect(s.ledger()).toHaveLength(1);
  });

  it.each(scenarios.filter(s => s.name.startsWith('prose') || s.name.startsWith('encoding')))('$name keeps ownership through the semantic return projection', async ({ setup, invoke, name }) => {
    const s = fresh();
    await setup?.(s);
    const before = s.log.records.length;
    const debug = s as TestSession;
    const failure = new Error('projection failure');
    let failedProjection = false;
    if (name.startsWith('encoding')) {
      const encode = debug.landEncoding.bind(s);
      vi.spyOn(debug, 'landEncoding').mockImplementationOnce((...args) => { encode(...args); failedProjection = true; throw failure; });
    } else if (name === 'prose set') {
      const read = debug.proseOf.bind(s);
      vi.spyOn(debug, 'proseOf').mockImplementation((...args) => { if (s.log.records.length > before && !failedProjection) { failedProjection = true; throw failure; } return read(...args); });
    } else {
      const read = debug.proposalsOf.bind(s);
      vi.spyOn(debug, 'proposalsOf').mockImplementation((...args) => { if (s.log.records.length > before && !failedProjection) { failedProjection = true; throw failure; } return read(...args); });
    }
    const seen: unknown[] = [];
    s.log.port.listen(() => seen.push({ failedProjection, cursor: s.cursor() }));
    await expect(invoke(s)).rejects.toBe(failure);
    expect(seen).toEqual([{ failedProjection: true, cursor: s.log.records.at(-1)!.id }]);
  });
});

describe('escaped provider failures and replay finalization', () => {
  it('a failure after the second proposal record releases both records without refunding its ledger step', async () => {
    const s = fresh();
    const debug = s as TestSession;
    const land = debug.landed.bind(s);
    const failure = new Error('second record completion failed');
    vi.spyOn(debug, 'landed').mockImplementation(record => { land(record); if (record.id === 's2') throw failure; });
    const seen: string[] = [];
    s.log.port.listen(() => seen.push(s.cursor()!));
    await expect(s.proposeChart(chart)).rejects.toBe(failure);
    expect(s.log.records).toHaveLength(2);
    expect(s.ledger()).toHaveLength(1);
    expect(seen).toEqual(['s2', 's2']);
    expect(s.gaps().at(-1)).toMatchObject({ code: 'effect-failed', target: 's2' });
  });

  it('a later writer refusal releases the earlier owned proposal record and preserves the original error', async () => {
    const s = fresh();
    const failure = new Error('second writer failed');
    let attempts = 0;
    s.log.stampData = () => { if (++attempts === 2) throw failure; return undefined; };
    let notifications = 0;
    s.log.port.listen(() => { notifications++; });
    await expect(s.proposeChart(chart)).rejects.toBe(failure);
    expect(s.log.records).toHaveLength(1);
    expect(s.ledger()).toHaveLength(1);
    expect(notifications).toBe(1);
    expect(s.gaps().at(-1)).toMatchObject({ code: 'effect-failed', target: 's1' });
  });

  it('a columns failure after analysis landing cannot strand its record', async () => {
    const provider = memoryProvider(SAMPLE_ROWS, { tableName: 'data' });
    const columns = provider.columns.bind(provider);
    const s = buildDashboard(makeDashboardDef(), { providers: { data: provider } }).createSession();
    const failure = new Error('column metadata unavailable');
    provider.columns = async (...args) => { if (s.log.records.length > 0) throw failure; return columns(...args); };
    let notifications = 0;
    s.log.port.listen(() => { notifications++; expect(s.head).toBe('s1'); expect(s.cursor()).toBe('s1'); });
    await expect(s.declareAnalysis('clustering')).rejects.toBe(failure);
    expect(notifications).toBe(1);
    expect(s.log.records).toHaveLength(1);
    expect(s.log.port.clauses()).toHaveLength(1);
    expect(s.gaps()).toMatchObject([{ code: 'effect-failed', op: 'declareAnalysis', target: 's1' }]);
  });

  it('escaped replay metadata failure restores the complete current head before all notifications', async () => {
    const source = fresh();
    await source.declareAnalysis('clustering');
    await source.dispatch(pick);
    const provider = memoryProvider(SAMPLE_ROWS, { tableName: 'data' });
    const columns = provider.columns.bind(provider);
    const s = buildDashboard(makeDashboardDef(), { providers: { data: provider } }).createSession();
    const failure = new Error('replay metadata unavailable');
    provider.columns = async (...args) => { if (s.log.records.length > 0) throw failure; return columns(...args); };
    const seen: unknown[] = [];
    s.log.port.listen(() => seen.push({ head: s.head, cursor: s.cursor(), selections: s.clausesFor('scatter').map(r => r.clause) }));
    await expect(s.replay(source.log.records)).rejects.toBe(failure);
    expect(seen).toEqual(Array.from({ length: 2 }, () => ({ head: 's2', cursor: 's2', selections: [{ kind: 'point', field: 'category', value: 'Formal' }] })));
    expect(s.log.port.clauses()).toHaveLength(2);
  });

  it('a replay re-performance throw remains a typed gap, with its own records published and current tip restored', async () => {
    const source = fresh();
    await source.declareAnalysis('clustering');
    await source.dispatch(pick);
    const s = fresh();
    const debug = s as TestSession;
    const analysis = debug.analysis.bind(s);
    const failure = new Error('re-performance unavailable');
    vi.spyOn(debug, 'analysis').mockImplementation(id => {
      const known = analysis(id);
      return known !== undefined && id === 'clustering' && s.log.records.length > 0 ? { ...known, run: async () => { throw failure; } } : known;
    });
    const seen: string[] = [];
    s.log.port.listen(() => seen.push(s.cursor()!));
    const replay = await s.replay(source.log.records);
    expect(replay).toMatchObject({ ok: true, reran: 0, filed: 1 });
    expect(seen).toEqual(['s2', 's2']);
    expect(s.gaps()).toMatchObject([{ code: 'effect-failed', op: 'replay' }]);
  });

  it('a reentrant listener action survives replay cleanup instead of being rewound after publication', async () => {
    const source = fresh();
    await source.dispatch(pick);
    await source.dispatch({ verb: 'annotate', target: 'bar', note: 'saved', cause });
    const s = fresh();
    let entered = false;
    let nested: Promise<unknown> | undefined;
    s.log.port.listen(() => { if (!entered) { entered = true; nested = s.dispatch({ verb: 'annotate', target: 'bar', note: 'nested', cause }); } });
    await s.replay(source.log.records);
    await nested;
    expect(s.head).toBe('s3');
    expect(s.cursor()).toBe('s3');
    expect(s.log.records.at(-1)!.parent).toBe('s2');
  });

  it('two pending analyses and a concurrent annotation release only each invocation records', async () => {
    const provider = memoryProvider(SAMPLE_ROWS, { tableName: 'data' });
    const materialize = provider.materializeColumn!.bind(provider);
    const gates: { started: Promise<void>; start: () => void; wait: Promise<void>; finish: () => void }[] = [];
    for (let i = 0; i < 2; i++) {
      let start!: () => void;
      let finish!: () => void;
      const started = new Promise<void>(resolve => { start = resolve; });
      const wait = new Promise<void>(resolve => { finish = resolve; });
      gates.push({ started, start, wait, finish });
    }
    let calls = 0;
    provider.materializeColumn = async (...args) => { const gate = gates[calls++]!; gate.start(); await gate.wait; return materialize(...args); };
    const s = buildDashboard(makeDashboardDef(), { providers: { data: provider } }).createSession();
    const seen: string[] = [];
    s.log.port.listen(() => seen.push(s.log.port.clauses().map(c => c.source.viewId).join(',')));
    const first = s.declareAnalysis('clustering');
    await gates[0]!.started;
    const second = s.declareAnalysis('clustering');
    await gates[1]!.started;
    await s.dispatch({ verb: 'annotate', target: 'bar', note: 'concurrent', cause });
    expect(seen).toEqual(['annotation:user']);
    const failure = new Error('first completion failed');
    vi.spyOn(s as TestSession, 'noteColumnProvenance').mockImplementationOnce(() => { throw failure; });
    const failed = first.catch((error: unknown) => error);
    gates[0]!.finish();
    expect(await failed).toBe(failure);
    expect(seen).toHaveLength(2);
    expect(s.head).toBe('s3');
    expect(s.cursor()).toBe('s3');
    gates[1]!.finish();
    await second;
    expect(seen).toHaveLength(3);
    expect(s.cursor()).toBe('s3');
  });

  it('ordinary background failure preserves a later human seek and its historical fold', async () => {
    const provider = memoryProvider(SAMPLE_ROWS, { tableName: 'data' });
    const materialize = provider.materializeColumn!.bind(provider);
    let begin!: () => void;
    const began = new Promise<void>(resolve => { begin = resolve; });
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    provider.materializeColumn = async (...args) => { begin(); await finished; return materialize(...args); };
    const s = buildDashboard(makeDashboardDef(), { providers: { data: provider } }).createSession();
    await s.dispatch(pick);
    await s.dispatch({ ...pick, value: 'Party' });
    const pending = s.declareAnalysis('clustering');
    await began;
    expect(s.head).toBe('s3');
    expect(s.seek('s1').ok).toBe(true);
    const failure = new Error('background provenance failed');
    vi.spyOn(s as TestSession, 'noteColumnProvenance').mockImplementationOnce(() => { throw failure; });
    const seen: unknown[] = [];
    s.log.port.listen(() => seen.push({ cursor: s.cursor(), head: s.head, selections: s.clausesFor('scatter').map(r => r.clause) }));
    const rejected = pending.catch((error: unknown) => error);
    finish();
    expect(await rejected).toBe(failure);
    expect(seen).toEqual([{ cursor: 's1', head: 's3', selections: [{ kind: 'point', field: 'category', value: 'Formal' }] }]);
    expect(s.cursor()).toBe('s1');
  });

  it('the original primitive survives restoration failure while publication is still attempted', async () => {
    const s = fresh();
    const debug = s as TestSession;
    const land = debug.landed.bind(s);
    vi.spyOn(debug, 'landed').mockImplementationOnce(record => { land(record); throw 0; });
    vi.spyOn(debug, 'rebuildFold').mockImplementationOnce(() => { throw new Error('restore failed'); });
    let attempted = 0;
    s.log.port.listen(() => { attempted++; });
    const result = await s.dispatch({ verb: 'annotate', target: 'bar', note: 'landed', cause }).catch((error: unknown) => ({ error }));
    expect(result).toEqual({ error: 0 });
    expect(attempted).toBe(1);
    expect(s.gaps()).toMatchObject([{ code: 'effect-failed', target: 's1' }, { code: 'effect-failed', target: 's1' }]);
  });
});
