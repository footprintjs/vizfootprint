/**
 * mosaicSelection — the port answered by the REAL `@uwdata/mosaic-core`
 * Selection (a dev dependency; the optional peer a consumer brings). Laws
 * under test: the byte law (a clause minted here carries the engine's own
 * `String(predicate)`, and it equals the built-in's byte for every shape),
 * one client per source (the host's own through `clientFor`, else the port's
 * wrapper), one port per Selection, Mosaic's own resolve/skip/remove by
 * identity, a host's foreign clauses omitted-with-a-counter, the honest
 * `canSkip` dial, the port's own synchronous listeners, and the refusals —
 * identical to the built-in's for a spec, typed and loud for a clause the
 * port did not mint.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MosaicClient, Selection, clauseInterval } from '@uwdata/mosaic-core';
import { CauseValidationError, type Cause } from '../cause/index.js';
import { mosaicDescriptorSQL, pointValueFromWire } from '../data/index.js';
import { buildDashboard } from '../def/index.js';
import { CauseSelectionSession, replayLog, serializeLog, type CommitInput } from '../log/log.js';
import { SelectionPortError, SourceRegistry, builtinSelection, isRejection } from '../selection/index.js';
import type { CauseClause, CauseClauseSpec, RegisteredSource, SelectionPort } from '../selection/index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import { MosaicRegisteredSource, causeOf, mosaicSelection, type MosaicSelectionPort } from './index.js';

const cause = (over: Partial<Cause> = {}): Cause => ({ requestedBy: 'user', computedBy: 'user', ...over });

/** Mint and insist — every spec below is one the port accepts. */
function minted(port: SelectionPort, spec: CauseClauseSpec): CauseClause {
  const clause = port.clause(spec);
  if (isRejection(clause)) throw new Error(`unexpected rejection: ${clause.reason} — ${clause.detail}`);
  return clause;
}

function two(): { port: MosaicSelectionPort; a: RegisteredSource; b: RegisteredSource } {
  const reg = new SourceRegistry();
  return { port: mosaicSelection(), a: reg.register('A', { actor: 'user' }), b: reg.register('B', { actor: 'agent' }) };
}

/** The live Selection behind a port — `native()` never rejects on this engine. */
const live = (port: MosaicSelectionPort): Selection => port.native().selection;

function thrown(fn: () => unknown): SelectionPortError {
  try {
    fn();
  } catch (error) {
    if (error instanceof SelectionPortError) return error;
    throw error;
  }
  throw new Error('expected a SelectionPortError');
}

/** Every kind × shape the log can carry, the odd Mosaic renderings included. */
function shapes(a: RegisteredSource): CauseClauseSpec[] {
  return [
    { kind: 'point', source: a, field: 'category', value: 'Data', cause: cause() },
    { kind: 'point', source: a, field: 'x', value: 7, cause: cause() },
    { kind: 'point', source: a, field: 'pValue', value: { id: 'a1', table: 'data', pValue: 0.03 }, cause: cause() },
    { kind: 'interval', source: a, field: 'amount', value: [10, 20], cause: cause() },
    { kind: 'interval', source: a, field: 'amount', value: [150, null], cause: cause() },
    { kind: 'interval', source: a, field: 'amount', value: [null, 150], cause: cause() },
    { kind: 'interval', source: a, field: 'date', value: ['2026-04-01', '2026-04-30'], cause: cause() },
    { kind: 'cell', source: a, fields: ['price', 'category'], value: [[100, 150], 'Formal'], cause: cause() },
    { kind: 'cell', source: a, fields: ['price', 'region'], value: [[10, 20], null], cause: cause() },
    { kind: 'match', source: a, field: 'category', value: { values: ['Formal', 'Party'] }, cause: cause() },
    { kind: 'match', source: a, field: 'category', value: { values: ['Formal'], exclude: true }, cause: cause() },
    { kind: 'match', source: a, field: 'category', value: { values: [] }, cause: cause() },
    { kind: 'match', source: a, field: 'category', value: { values: [], exclude: true }, cause: cause() },
    { kind: 'match', source: a, field: 'category', value: { values: [null] }, cause: cause() },
    { kind: 'neighbourhood', source: a, fields: ['from', 'to'], value: { seed: 'Zika', derivation: 'ego', hops: 1, ids: ['Zika', 'Lyme'] }, cause: cause() },
    { kind: 'neighbourhood', source: a, fields: ['from', 'to'], value: { seed: 'Zika', derivation: 'ego', hops: 1, ids: [] }, cause: cause() },
  ];
}

const descriptorOf = (spec: CauseClauseSpec): string =>
  spec.kind === 'cell' || spec.kind === 'neighbourhood'
    ? mosaicDescriptorSQL(spec.kind, spec.fields, spec.value)
    : mosaicDescriptorSQL(spec.kind, spec.field, spec.kind === 'point' ? pointValueFromWire(spec.value) : spec.value);

describe('mosaicSelection — engine, capabilities, native()', () => {
  it('names itself, declares a live selection, and hands the very Selection it was given back through native().selection', () => {
    const selection = Selection.crossfilter();
    const port = mosaicSelection(selection);
    expect(port.engine).toBe('mosaic');
    expect(port.capabilities).toEqual({ liveSelection: true, canSkip: true });
    expect(port.native()).toEqual({ ok: true, selection });
    expect(isRejection(port.native())).toBe(false);
  });

  it('builds a fresh crossfilter Selection when given none', () => {
    const port = mosaicSelection();
    expect(live(port)).toBeInstanceOf(Selection);
    expect(live(port).clauses).toEqual([]);
  });

  it('canSkip is read off the engine: false on intersect/union/single, where Mosaic\'s skip is `cross && …` and answers false for the clause\'s own source', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    for (const selection of [Selection.intersect(), Selection.union(), Selection.single()]) {
      const port = mosaicSelection(selection);
      expect(port.capabilities.canSkip).toBe(false);
      const c = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
      port.update(c);
      expect(port.skip(a, c)).toBe(false); // honest: the dial said so
    }
    const cross = mosaicSelection(Selection.intersect({ cross: true }));
    expect(cross.capabilities.canSkip).toBe(true);
    const c = minted(cross, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    expect(cross.skip(a, c)).toBe(true);
  });
});

describe('mosaicSelection — one port per Selection, ever (the door is idempotent)', () => {
  it('a second call on the same Selection returns the port already standing on it — same clients, same clauses', () => {
    const { port, a } = two();
    const selection = live(port);
    expect(mosaicSelection(selection)).toBe(port);
    const c = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    port.update(c);
    expect(mosaicSelection(selection).clauses()).toEqual([c]);
    expect(mosaicSelection(selection).client(a)).toBe(port.client(a));
  });

  it('the first call\'s clientFor holds: the same function again is fine, a different one is a typed port-conflict', () => {
    const selection = Selection.crossfilter();
    const clientFor = (): MosaicClient | undefined => undefined;
    const port = mosaicSelection(selection, { clientFor });
    expect(mosaicSelection(selection, { clientFor })).toBe(port);
    expect(mosaicSelection(selection)).toBe(port);
    const error = thrown(() => mosaicSelection(selection, { clientFor: () => undefined }));
    expect(error.rejection).toEqual({ ok: false, engine: 'mosaic', operation: 'port', reason: 'port-conflict', detail: expect.stringContaining('one port per Selection') });
  });
});

describe('mosaicSelection.clause — a REAL Mosaic clause beside our projection', () => {
  it('the native clause comes from the real factories, carries the cause on its meta, and our clause reads its byte', () => {
    const { port, a } = two();
    const original = cause({ intent: 'pick Data' });
    const clause = minted(port, { kind: 'point', source: a, field: 'category', value: 'Data', cause: original });
    port.update(clause);
    const native = live(port).active!;
    expect(native.source).toBe(a); // identity: the registry object itself
    expect(native.meta?.type).toBe('point'); // the factory's own meta.type is intact...
    expect(causeOf(native)).toEqual(original); // ...with the cause laid on top
    expect(causeOf(native)).not.toBe(original); // validated/rebuilt, not the same reference
    expect(clause.predicateSQL).toBe(String(native.predicate));
    expect(clause).toMatchObject({ kind: 'point', source: a, value: 'Data', meta: { type: 'point', cause: original } });
    expect(clause.clients.has(a)).toBe(true);
    expect(clause.clients.size).toBe(1);
  });

  it('the byte law: every kind × shape carries the engine\'s String(predicate), which IS mosaicDescriptorSQL\'s byte and the built-in\'s byte', () => {
    const { port, a } = two();
    const builtin = builtinSelection();
    for (const spec of shapes(a)) {
      const ours = minted(port, spec);
      port.update(ours);
      expect(ours.predicateSQL, JSON.stringify(spec.value)).toBe(String(live(port).active!.predicate));
      expect(ours.predicateSQL, JSON.stringify(spec.value)).toBe(descriptorOf(spec));
      expect(ours.predicateSQL, JSON.stringify(spec.value)).toBe(minted(builtin, spec).predicateSQL);
    }
    // the odd renderings, by value — measured on @uwdata/mosaic-core 0.28.1
    const [, , objectValued, , halfOpenLo, halfOpenHi, dated] = shapes(a);
    expect(minted(port, objectValued!).predicateSQL).toBe('("pValue" IN ([object Object]))'); // the coercion the analysis lane has always persisted
    expect(minted(port, halfOpenLo!).predicateSQL).toBe('("amount" BETWEEN 150 AND NULL)');
    expect(minted(port, halfOpenHi!).predicateSQL).toBe('("amount" BETWEEN NULL AND 150)');
    expect(minted(port, dated!).predicateSQL).toBe('("date" BETWEEN "2026-04-01" AND "2026-04-30")');
  });

  it('the compound kinds are genuine factory output composed with the real and/or/not/literal', () => {
    const { port, a } = two();
    expect(minted(port, { kind: 'cell', source: a, fields: ['price', 'category'], value: [[100, 150], 'Formal'], cause: cause() }).predicateSQL).toBe(
      `(("price" BETWEEN 100 AND 150) AND ("category" IN ('Formal')))`,
    );
    expect(minted(port, { kind: 'cell', source: a, fields: ['a', 'b'], value: ['x', 7], cause: cause() }).predicateSQL).toBe(`(("a" IN ('x')) AND ("b" IN (7)))`);
    expect(minted(port, { kind: 'match', source: a, field: 'c', value: { values: ['Formal', 'Party'] }, cause: cause() }).predicateSQL).toBe(
      `(("c" IN ('Formal')) OR ("c" IN ('Party')))`,
    );
    expect(minted(port, { kind: 'match', source: a, field: 'c', value: { values: ['Formal'] }, cause: cause() }).predicateSQL).toBe(`("c" IN ('Formal'))`);
    expect(minted(port, { kind: 'match', source: a, field: 'c', value: { values: ['Formal'], exclude: true }, cause: cause() }).predicateSQL).toBe(`(NOT ("c" IN ('Formal')))`);
    expect(minted(port, { kind: 'match', source: a, field: 'c', value: { values: [] }, cause: cause() }).predicateSQL).toBe('FALSE');
    expect(minted(port, { kind: 'match', source: a, field: 'c', value: { values: [], exclude: true }, cause: cause() }).predicateSQL).toBe('(NOT FALSE)');
    expect(minted(port, { kind: 'match', source: a, field: 'c', value: { values: [null] }, cause: cause() }).predicateSQL).toBe('("c" IS NULL)');
    // the neighbourhood: the real `and` of two real `isIn` lists over ONE walked set
    const hood = (ids: readonly unknown[]): CauseClauseSpec => ({
      kind: 'neighbourhood',
      source: a,
      fields: ['from', 'to'],
      value: { seed: 'Zika', derivation: 'ego', hops: 1, ids },
      cause: cause(),
    });
    expect(minted(port, hood(['Zika', 'Lyme'])).predicateSQL).toBe(`(("from" IN ('Zika', 'Lyme')) AND ("to" IN ('Zika', 'Lyme')))`);
    expect(minted(port, hood(['Zika'])).predicateSQL).toBe(`(("from" IN ('Zika')) AND ("to" IN ('Zika')))`);
    // an empty walked set is the real literal(false) — the same always-false an empty keep-list renders
    expect(minted(port, hood([])).predicateSQL).toBe('FALSE');
    // an id is a literal, NOT the point factory's null-safe rewrite: a null id stays the literal NULL
    expect(minted(port, hood([null])).predicateSQL).toBe(`(("from" IN (NULL)) AND ("to" IN (NULL)))`);
  });

  it('a cleared clause of any kind carries predicateSQL null — and a null native predicate', () => {
    const { port, a } = two();
    const cleared: CauseClauseSpec[] = [
      { kind: 'point', source: a, field: 'x', value: null, cause: cause() },
      { kind: 'interval', source: a, field: 'x', value: null, cause: cause() },
      { kind: 'cell', source: a, fields: ['x', 'y'], value: null, cause: cause() },
      { kind: 'match', source: a, field: 'x', value: null, cause: cause() },
      { kind: 'neighbourhood', source: a, fields: ['x', 'y'], value: null, cause: cause() },
    ];
    for (const spec of cleared) {
      const clause = minted(port, spec);
      expect(clause.predicateSQL, spec.kind).toBeNull();
      expect(clause.meta.type).toBe(spec.kind);
    }
  });

  it('explicit clients are kept as given, by identity, on both the projection and the native clause (as the engine\'s clients)', () => {
    const { port, a, b } = two();
    const clause = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause(), clients: [a, b] });
    expect(clause.clients.has(a) && clause.clients.has(b)).toBe(true);
    port.update(clause);
    const native = live(port).active!;
    expect(native.clients!.has(port.client(a))).toBe(true);
    expect(native.clients!.has(port.client(b))).toBe(true);
    expect(native.clients!.size).toBe(2);
  });

  it('the clause and its meta are frozen, and the public clients set is a projection — mutating it steers nothing', () => {
    const { port, a, b } = two();
    const clause = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    port.update(clause);
    expect(Object.isFrozen(clause)).toBe(true);
    expect(Object.isFrozen(clause.meta)).toBe(true);
    expect(Object.isFrozen(clause.meta.cause)).toBe(true);
    (clause.clients as Set<RegisteredSource>).add(b);
    expect(port.skip(b, clause)).toBe(false); // the engine's own set, untouched
    expect(live(port).skip(port.client(b), live(port).active!)).toBe(false);
  });

  it('rejects exactly what the built-in rejects — unsupported-shape ×5, unknown-source ×2 — with engine "mosaic"', () => {
    const { port, a } = two();
    const builtin = builtinSelection();
    const refused: CauseClauseSpec[] = [
      { kind: 'cell', source: a, fields: ['price', 'category'], value: [[10, 20], undefined as unknown as null], cause: cause() },
      { kind: 'match', source: a, field: 'category', value: { values: [undefined] }, cause: cause() },
      { kind: 'interval', source: a, field: 'amount', value: 42 as unknown as null, cause: cause() },
      { kind: 'point', source: a, field: 'x', value: Symbol('s'), cause: cause() },
      { kind: 'bogus' as never, source: a, field: 'x', value: 1, cause: cause() },
      { kind: 'point', source: { viewId: 'fake', meta: { actor: 'user' } } as unknown as RegisteredSource, field: 'x', value: 1, cause: cause() },
      { kind: 'point', source: a, field: 'x', value: 1, cause: cause(), clients: ['bar' as unknown as RegisteredSource] },
    ];
    const reasons: string[] = [];
    for (const spec of refused) {
      const ours = port.clause(spec);
      const theirs = builtin.clause(spec);
      expect(isRejection(ours), spec.kind).toBe(true);
      expect(isRejection(theirs), spec.kind).toBe(true);
      if (!isRejection(ours) || !isRejection(theirs)) throw new Error('unreachable');
      expect(ours.engine).toBe('mosaic');
      expect(ours.operation).toBe('clause');
      expect(ours.reason).toBe(theirs.reason); // one verdict per spec, whichever engine answers
      expect(typeof ours.detail).toBe('string');
      reasons.push(ours.reason);
    }
    expect(reasons).toEqual(['unsupported-shape', 'unsupported-shape', 'unsupported-shape', 'unsupported-shape', 'unsupported-shape', 'unknown-source', 'unknown-source']);
    expect(live(port).clauses).toEqual([]); // nothing minted, nothing standing
  });

  it('a malformed cause THROWS (R12 — not a shape problem; the log judges it first)', () => {
    const { port, a } = two();
    expect(() => port.clause({ kind: 'point', source: a, field: 'x', value: 1, cause: { requestedBy: 'nope', computedBy: 'user' } as unknown as Cause })).toThrow(
      CauseValidationError,
    );
  });
});

describe('mosaicSelection.update / clauses — Mosaic\'s own crossfilter resolve, projected back by identity', () => {
  it('pushes onto the real Selection; clauses() hands back the SAME clause objects, frozen, in arrival order', () => {
    const { port, a, b } = two();
    const ca = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    const cb = minted(port, { kind: 'interval', source: b, field: 'y', value: [1, 2], cause: cause() });
    port.update(ca);
    port.update(cb);
    expect(live(port).clauses.length).toBe(2);
    expect(port.clauses()[0]).toBe(ca);
    expect(port.clauses()[1]).toBe(cb);
    expect(Object.isFrozen(port.clauses())).toBe(true);
  });

  it('drops the clause standing for the SAME source before pushing; a cleared clause removes and is not pushed', () => {
    const { port, a, b } = two();
    port.update(minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() }));
    const kept = minted(port, { kind: 'point', source: b, field: 'y', value: 2, cause: cause() });
    port.update(kept);
    const second = minted(port, { kind: 'point', source: a, field: 'x', value: 3, cause: cause() });
    port.update(second);
    expect(port.clauses()).toEqual([kept, second]);
    port.update(minted(port, { kind: 'point', source: a, field: 'x', value: null, cause: cause() }));
    expect(port.clauses()).toEqual([kept]);
    expect(live(port).clauses.length).toBe(1);
  });

  it('a clause minted by ANOTHER port throws a typed SelectionPortError out of update() — and out of skip(), each naming its own act', () => {
    const { port, a } = two();
    const foreign = minted(builtinSelection(), { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    const fromTwin = minted(mosaicSelection(), { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    for (const clause of [foreign, fromTwin]) {
      const onUpdate = thrown(() => port.update(clause));
      expect(onUpdate.rejection).toMatchObject({ ok: false, engine: 'mosaic', operation: 'update', reason: 'unknown-source' });
      expect(onUpdate.message).toContain('"A"');
      const onSkip = thrown(() => port.skip(a, clause));
      expect(onSkip.rejection).toMatchObject({ ok: false, engine: 'mosaic', operation: 'skip', reason: 'unknown-source' });
    }
    expect(live(port).clauses).toEqual([]);
  });

  it('a raw clause pushed onto native() is OMITTED from clauses() and COUNTED by foreign() — until the port\'s own clause for that source replaces it', () => {
    const { port, a } = two();
    // the bench's hot path: transient engine-only updates with the registry object as source
    const raw = clauseInterval('amount', [1, 2], { source: a, clients: new Set([port.client(a)]) });
    live(port).update(raw);
    expect(live(port).clauses.length).toBe(1);
    expect(port.clauses()).toEqual([]);
    expect(port.foreign()).toEqual([raw]);
    expect(Object.isFrozen(port.foreign())).toBe(true);
    // the ONE commit at gesture end replaces the transient clause — same source, Mosaic's resolve
    const committed = minted(port, { kind: 'interval', source: a, field: 'amount', value: [1, 3], cause: cause() });
    port.update(committed);
    expect(live(port).clauses.length).toBe(1);
    expect(port.clauses()).toEqual([committed]);
    expect(port.foreign()).toEqual([]);
  });

  it('a host Selection carrying its own interactor\'s clause (a source the port can never replace): every commit lands, listeners hear, nothing is filed as a gap', () => {
    const host = Selection.crossfilter();
    const interactor = { name: 'vgplot-interval-x' }; // what a vgplot interactor mints: `source: this`
    const hostClause = clauseInterval('amount', [1, 2], { source: interactor });
    host.update(hostClause);
    const port = mosaicSelection(host);
    const log = new CauseSelectionSession(port);
    const a = log.registry.register('scatter', { actor: 'user' });
    const reported: unknown[] = [];
    log.onSelectionUpdateFailed = (error) => reported.push(error);
    const heard: number[] = [];
    port.listen((clauses) => heard.push(clauses.length));
    const one = log.commit({ id: 'c1', parent: null, viewId: 'scatter', actorMeta: a.meta, kind: 'point', field: 'x', value: 1, cause: cause() });
    const two_ = log.commit({ id: 'c2', parent: 'c1', viewId: 'scatter', actorMeta: a.meta, kind: 'point', field: 'x', value: 2, cause: cause() });
    expect(log.records.map((r) => r.id)).toEqual(['c1', 'c2']);
    expect(reported).toEqual([]);
    expect(heard).toEqual([1, 1]);
    expect(port.clauses()).toEqual([two_.clause]);
    expect(port.foreign()).toEqual([hostClause]); // still standing, still counted
    expect(host.clauses.length).toBe(2); // the engine holds both — theirs and ours
    expect(one.clause).not.toBe(two_.clause);
  });

  it('through the log: the OUTBOUND step files a foreign-clause throw as the failed relay, and the commit still stands', () => {
    const port = mosaicSelection();
    const log = new CauseSelectionSession(port);
    const a = log.registry.register('A', { actor: 'user' });
    const reported: string[] = [];
    log.onSelectionUpdateFailed = (error) => reported.push((error as Error).name);
    // a listener that pushes a clause minted elsewhere back onto the port is the reachable throw
    const stranger = minted(builtinSelection(), { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    port.listen(() => port.update(stranger));
    const { record } = log.commit({ id: 'c1', parent: null, viewId: 'A', actorMeta: a.meta, kind: 'point', field: 'x', value: 1, cause: cause() });
    expect(log.records).toEqual([record]);
    expect(reported).toEqual(['SelectionPortError']);
  });
});

describe('mosaicSelection.client / skip — one client per source, ever', () => {
  it('client(source) is the same wrapper every time, a real inert MosaicClient standing for that source', () => {
    const { port, a } = two();
    const wrapper = port.client(a);
    expect(port.client(a)).toBe(wrapper);
    expect(wrapper).toBeInstanceOf(MosaicRegisteredSource);
    expect(wrapper).toBeInstanceOf(MosaicClient); // the nominal check Mosaic's own isMosaicClient() makes
    expect((wrapper as MosaicRegisteredSource).source).toBe(a);
    expect(wrapper.coordinator).toBeNull(); // never connected
    expect(wrapper.initialized).toBe(false);
    expect(mosaicSelection().client(a)).not.toBe(wrapper); // per Selection: another engine object is another identity table
  });

  it('clientFor: a host\'s REAL MosaicClient answers for its source, memoized, and Mosaic\'s own predicate() self-excludes it', () => {
    const host = Selection.crossfilter();
    const reg = new SourceRegistry();
    const scatter = reg.register('scatter', { actor: 'user' });
    const bar = reg.register('bar', { actor: 'user' });
    const plot = new MosaicClient(host); // the view the coordinator queries for
    let asked = 0;
    const port = mosaicSelection(host, {
      clientFor: (source) => {
        asked += 1;
        return source === scatter ? plot : undefined;
      },
    });
    expect(port.client(scatter)).toBe(plot);
    expect(port.client(scatter)).toBe(plot);
    expect(port.client(bar)).toBeInstanceOf(MosaicRegisteredSource); // no host view: the port's wrapper
    expect(asked).toBe(2); // once per source, then memoized
    const brush = minted(port, { kind: 'interval', source: scatter, field: 'amount', value: [1, 2], cause: cause() });
    port.update(brush);
    expect(host.predicate(plot, true)).toEqual([]); // the real client is NOT filtered by its own brush
    expect(host.skip(plot, host.active!)).toBe(true);
    expect(port.skip(scatter, brush)).toBe(true);
    expect(host.predicate(port.client(bar), true)).toEqual([expect.objectContaining({})]); // the peer is
    expect(String(host.predicate(port.client(bar), true))).toBe('("amount" BETWEEN 1 AND 2)');
  });

  it('skip() is Selection.skip over the source\'s client: self yes, peer no, a named peer yes', () => {
    const { port, a, b } = two();
    const own = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    port.update(own);
    expect(port.skip(a, own)).toBe(true);
    expect(port.skip(b, own)).toBe(false);
    expect(live(port).skip(port.client(a), live(port).active!)).toBe(true); // the real API, same answer
    const shared = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause(), clients: [a, b] });
    expect(port.skip(b, shared)).toBe(true);
  });

  it('the identity rule: a second wrapper minted by hand is a second identity, and Mosaic skips nothing for it', () => {
    const { port, a } = two();
    port.update(minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() }));
    const native = live(port).active!;
    expect(live(port).skip(port.client(a), native)).toBe(true);
    expect(live(port).skip(new MosaicRegisteredSource(a), native)).toBe(false);
  });

  it('Selection.predicate(client, noSkip) — Mosaic\'s own self-exclusion — agrees with clauses().filter(!skip)', () => {
    const { port, a, b } = two();
    const ca = minted(port, { kind: 'point', source: a, field: 'category', value: 'Data', cause: cause() });
    const cb = minted(port, { kind: 'interval', source: b, field: 'amount', value: [10, 20], cause: cause() });
    port.update(ca);
    port.update(cb);
    const visible = (client: RegisteredSource): string[] => {
      const pred = live(port).predicate(port.client(client), true);
      const arr = Array.isArray(pred) ? pred : [pred];
      return arr.map(String).sort();
    };
    expect(visible(a)).toEqual([cb.predicateSQL]);
    expect(visible(b)).toEqual([ca.predicateSQL]);
    expect(port.clauses().filter((c) => !port.skip(a, c))).toEqual([cb]);
    expect(port.clauses().filter((c) => !port.skip(b, c))).toEqual([ca]);
  });
});

describe('mosaicSelection.listen — the port\'s own listeners: synchronous on every update, a throw propagates, unsubscribe removes', () => {
  it('calls the listener synchronously with the standing clauses on every update', () => {
    const { port, a } = two();
    const seen: number[] = [];
    port.listen((clauses) => seen.push(clauses.length));
    port.update(minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() }));
    expect(seen).toEqual([1]);
    port.update(minted(port, { kind: 'point', source: a, field: 'x', value: null, cause: cause() }));
    expect(seen).toEqual([1, 0]);
  });

  it('a listener that throws throws out of update() — the clause is standing anyway', () => {
    const { port, a } = two();
    port.listen(() => {
      throw new Error('chart broke');
    });
    const clause = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    expect(() => port.update(clause)).toThrow('chart broke');
    expect(port.clauses()).toEqual([clause]);
  });

  it('the returned function unsubscribes', () => {
    const { port, a } = two();
    let calls = 0;
    const stop = port.listen(() => {
      calls += 1;
    });
    port.update(minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() }));
    stop();
    port.update(minted(port, { kind: 'point', source: a, field: 'x', value: 2, cause: cause() }));
    expect(calls).toBe(1);
  });
});

// ── H4 against the real engine: the log on the adapter ──────────────────────

const MAIN_LINE: CommitInput[] = [
  { id: 'c1', parent: null, viewId: 'A', actorMeta: { actor: 'user', label: 'Category picker' }, kind: 'point', field: 'category', value: 'Data', cause: cause({ intent: 'click Data' }) },
  { id: 'c2', parent: 'c1', viewId: 'B', actorMeta: { actor: 'agent', label: 'Amount brush' }, kind: 'interval', field: 'amount', value: [10, 20], cause: cause({ computedBy: 'agent' }) },
  { id: 'c3', parent: 'c2', viewId: 'A', actorMeta: { actor: 'user', label: 'Category picker' }, kind: 'point', field: 'category', value: 'Analytics', cause: cause({ requestedBy: 'agent', computedBy: 'agent' }) },
  { id: 'c4', parent: 'c3', viewId: 'C', actorMeta: { actor: 'user' }, kind: 'interval', field: 'amount', value: [150, null], cause: cause() },
  { id: 'c5', parent: 'c4', viewId: 'D', actorMeta: { actor: 'user' }, kind: 'interval', field: 'date', value: ['2026-04-01', '2026-04-30'], cause: cause() },
  { id: 'c6', parent: 'c5', viewId: 'H', actorMeta: { actor: 'user' }, kind: 'cell', field: 'price × category', fields: ['price', 'category'], value: [[100, 150], 'Formal'], cause: cause() },
  { id: 'c7', parent: 'c6', viewId: 'M', actorMeta: { actor: 'user' }, kind: 'match', field: 'category', value: { values: ['Formal', 'Party'], exclude: true }, cause: cause() },
  { id: 'c8', parent: 'c7', viewId: 'D', actorMeta: { actor: 'user' }, kind: 'interval', field: 'date', value: null, cause: cause() },
];

function author(port: SelectionPort): CauseSelectionSession {
  const s = new CauseSelectionSession(port);
  for (const c of MAIN_LINE) s.commit(c);
  return s;
}

describe('the log on mosaicSelection() — byte-identical to the log on the built-in, replayable onto a live Selection, remove(source) by identity', () => {
  it('a log written through the adapter is byte-identical to one written through the built-in (every kind, the cleared "null" included)', () => {
    const viaMosaic = author(mosaicSelection());
    const viaBuiltin = author(builtinSelection());
    expect(serializeLog(viaMosaic.records)).toBe(serializeLog(viaBuiltin.records));
    expect(viaMosaic.records.map((r) => r.predicateSQL)).toEqual([
      `("category" IN ('Data'))`,
      '("amount" BETWEEN 10 AND 20)',
      `("category" IN ('Analytics'))`,
      '("amount" BETWEEN 150 AND NULL)',
      '("date" BETWEEN "2026-04-01" AND "2026-04-30")',
      `(("price" BETWEEN 100 AND 150) AND ("category" IN ('Formal')))`,
      `(NOT (("category" IN ('Formal')) OR ("category" IN ('Party'))))`,
      'null',
    ]);
    // and the live Selection holds one real clause per standing source: A, B, C, H, M (D cleared)
    expect(viaMosaic.port.clauses().map((c) => c.source.viewId).sort()).toEqual(['A', 'B', 'C', 'H', 'M']);
  });

  it('A1 on the real engine: self-exclusion is identical pre- and post-replay, through replayLog(…, port) and Selection.predicate', () => {
    const live_ = author(mosaicSelection());
    const livePort = live_.port as MosaicSelectionPort;
    const visible = (port: MosaicSelectionPort, client: RegisteredSource): string[] => {
      const pred = live(port).predicate(port.client(client), true);
      const arr = Array.isArray(pred) ? pred : [pred];
      return arr.map(String).sort();
    };
    const aOwn = live_.records.find((r) => r.id === 'c3')!.predicateSQL;
    const bOwn = live_.records.find((r) => r.id === 'c2')!.predicateSQL;
    const preA = visible(livePort, live_.registry.require('A'));
    expect(preA).not.toContain(aOwn);
    expect(preA).toContain(bOwn);

    const replayedPort = mosaicSelection();
    const replayed = replayLog(serializeLog(live_.records), undefined, replayedPort);
    expect(replayed.port).toBe(replayedPort); // the library path, not a hand-rolled loop
    expect(replayed.registry.require('A')).not.toBe(live_.registry.require('A')); // fresh identity
    expect(visible(replayedPort, replayed.registry.require('A'))).toEqual(preA);
    expect(replayed.records.every((r) => r.cause.replayed === true)).toBe(true);
  });

  it('A2 on the real engine: Selection.remove(replayed source-for-A) removes exactly A — and never shrinks the log', () => {
    const live_ = author(mosaicSelection());
    const port = mosaicSelection();
    const replayed = replayLog(live_.records, undefined, port);
    const ids = (sel: Selection): string[] => sel.clauses.map((c) => (c.source as RegisteredSource).viewId).sort();
    expect(ids(live(port))).toEqual(['A', 'B', 'C', 'H', 'M']);

    const afterRemove = live(port).remove(replayed.registry.require('A'));
    expect(ids(afterRemove)).toEqual(['B', 'C', 'H', 'M']); // exactly A removed, by identity
    expect(ids(live(port))).toEqual(['A', 'B', 'C', 'H', 'M']); // remove() returns a clone
    expect(replayed.records.map((r) => r.id)).toEqual(MAIN_LINE.map((c) => c.id)); // the trace is untouched
  });

  it('causeOf reads the cause off every native clause the log stood, and undefined off a bare one', () => {
    const live_ = author(mosaicSelection());
    const native = live(live_.port as MosaicSelectionPort);
    for (const clause of native.clauses) expect(causeOf(clause)).toMatchObject({ requestedBy: expect.any(String), computedBy: expect.any(String) });
    expect(causeOf({ source: {}, predicate: null, value: null, meta: { type: 'point' } })).toBeUndefined();
    expect(causeOf({ source: {}, predicate: null, value: null })).toBeUndefined();
  });
});

describe('the session on mosaicSelection() — createSession({ selection }) is the consumer path to the adapter', () => {
  it('a dispatched select lands its clause on the host\'s live Selection; a session opened without the option stays on the built-in', async () => {
    const port = mosaicSelection();
    const dash = buildDashboard(makeDashboardDef());
    const session = dash.createSession({ selection: port });
    expect(session.log.port).toBe(port);
    const res = await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: cause({ intent: 'pick Formal' }) });
    expect(res.ok).toBe(true);
    expect(live(port).clauses.length).toBe(1);
    expect(String(live(port).active!.predicate)).toBe(`("category" IN ('Formal'))`);
    expect(causeOf(live(port).active!)).toMatchObject({ requestedBy: 'user', computedBy: 'user', intent: 'pick Formal' });

    const plain = dash.createSession();
    expect(plain.log.port.engine).toBe('builtin');
    expect(isRejection(plain.log.port.native())).toBe(true);
  });
});

describe('vizfootprint/mosaic — the door, and the only importer of the peers', () => {
  it('exports the adapter and nothing that belongs to vizfootprint/selection — never a raw clause factory', async () => {
    const barrel = await import('./index.js');
    expect(Object.keys(barrel).sort()).toEqual(['MosaicRegisteredSource', 'causeOf', 'mosaicSelection']);
  });

  it('no shipped module under src/ imports @uwdata except src/mosaic/mosaicSelection.ts', () => {
    const src = fileURLToPath(new URL('..', import.meta.url));
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && /from\s+['"]@uwdata\//.test(readFileSync(path, 'utf8'))) importers.push(path.slice(src.length));
      }
    };
    walk(src);
    expect(importers).toEqual(['mosaic/mosaicSelection.ts']);
  });
});
