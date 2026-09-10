/**
 * builtinSelection — the port answered with no engine. Three laws under test:
 * the crossfilter transcription (resolve + skip), the predicateSQL byte law
 * (every minted clause carries mosaicDescriptorSQL's byte — whose parity with
 * the REAL factories is pinned in src/data/predicate.test.ts), and the
 * listener law (synchronous, throws propagate).
 */
import { describe, expect, it } from 'vitest';
import { mosaicDescriptorSQL, pointValueFromWire } from '../data/index.js';
import { CauseValidationError, type Cause } from '../cause/index.js';
import { SelectionPortError, SourceRegistry, builtinSelection, isRejection } from './index.js';
import type { CauseClause, CauseClauseSpec, RegisteredSource, SelectionPort } from './index.js';

const cause = (over: Partial<Cause> = {}): Cause => ({ requestedBy: 'user', computedBy: 'user', ...over });

/** Mint and insist — every spec below is one the port accepts. */
function minted(port: SelectionPort, spec: CauseClauseSpec): CauseClause {
  const clause = port.clause(spec);
  if (isRejection(clause)) throw new Error(`unexpected rejection: ${clause.reason} — ${clause.detail}`);
  return clause;
}

function two(): { port: SelectionPort; a: RegisteredSource; b: RegisteredSource } {
  const reg = new SourceRegistry();
  return { port: builtinSelection(), a: reg.register('A', { actor: 'user' }), b: reg.register('B', { actor: 'agent' }) };
}

describe('builtinSelection — engine and capabilities', () => {
  it('names itself, and declares honestly: no live selection, skip supported', () => {
    const port = builtinSelection();
    expect(port.engine).toBe('builtin');
    expect(port.capabilities).toEqual({ liveSelection: false, canSkip: true });
  });

  it('native() is a typed rejection — there is no engine object to hand back', () => {
    const answer = builtinSelection().native();
    expect(isRejection(answer)).toBe(true);
    expect(answer).toMatchObject({ ok: false, engine: 'builtin', operation: 'native', reason: 'no-live-selection' });
    if (isRejection(answer)) expect(answer.detail).toContain('mosaicSelection()'); // the union narrows both ways
  });
});

describe('builtinSelection.clause — mints our shape, carrying the byte law', () => {
  it('a point: source identity, default clients [source], meta.type = kind, the cause validated and rebuilt', () => {
    const { port, a } = two();
    const original = cause({ intent: 'pick Data' });
    const clause = minted(port, { kind: 'point', source: a, field: 'category', value: 'Data', cause: original });
    expect(clause.kind).toBe('point');
    expect(clause.source).toBe(a);
    expect(clause.clients.has(a)).toBe(true);
    expect(clause.clients.size).toBe(1);
    expect(clause.value).toBe('Data');
    expect(clause.predicateSQL).toBe(`("category" IN ('Data'))`);
    expect(clause.meta.type).toBe('point');
    expect(clause.meta.cause).toEqual(original);
    expect(clause.meta.cause).not.toBe(original); // validated/rebuilt, not the same reference
  });

  it('explicit clients are kept as given — self + peer, by identity', () => {
    const { port, a, b } = two();
    const clause = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause(), clients: [a, b] });
    expect(clause.clients.has(a)).toBe(true);
    expect(clause.clients.has(b)).toBe(true);
    expect(clause.clients.size).toBe(2);
  });

  it('every kind × shape carries exactly mosaicDescriptorSQL\'s byte, the wire\'s point null read as cleared', () => {
    const { port, a } = two();
    const specs: CauseClauseSpec[] = [
      { kind: 'point', source: a, field: 'category', value: 'Data', cause: cause() },
      { kind: 'point', source: a, field: 'x', value: 7, cause: cause() },
      { kind: 'point', source: a, field: 'pValue', value: { id: 'a1', table: 'data' }, cause: cause() },
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
      { kind: 'neighbourhood', source: a, fields: ['from', 'to'], value: { seed: 'Zika', derivation: 'ego', hops: 1, ids: ['Zika', 'Lyme'] }, cause: cause() },
      { kind: 'neighbourhood', source: a, fields: ['from', 'to'], value: { seed: 'Zika', derivation: 'ego', hops: 1, ids: [] }, cause: cause() },
    ];
    for (const spec of specs) {
      const expected =
        spec.kind === 'cell' || spec.kind === 'neighbourhood'
          ? mosaicDescriptorSQL(spec.kind, spec.fields, spec.value)
          : mosaicDescriptorSQL(spec.kind, spec.field, spec.kind === 'point' ? pointValueFromWire(spec.value) : spec.value);
      expect(minted(port, spec).predicateSQL, JSON.stringify(spec.value)).toBe(expected);
    }
    // the odd renderings, by value — the byte a Mosaic-written log carries
    expect(minted(port, specs[2]!).predicateSQL).toBe('("pValue" IN ([object Object]))'); // Mosaic's coercion — the analysis lane's byte
    expect(minted(port, specs[4]!).predicateSQL).toBe('("amount" BETWEEN 150 AND NULL)');
    expect(minted(port, specs[5]!).predicateSQL).toBe('("amount" BETWEEN NULL AND 150)');
    expect(minted(port, specs[6]!).predicateSQL).toBe('("date" BETWEEN "2026-04-01" AND "2026-04-30")');
    expect(minted(port, specs[11]!).predicateSQL).toBe('FALSE');
    expect(minted(port, specs[12]!).predicateSQL).toBe('(NOT FALSE)');
    // the neighbourhood's AND of two endpoint IN-lists, and an empty walked set as the same always-false
    expect(minted(port, specs[13]!).predicateSQL).toBe(`(("from" IN ('Zika', 'Lyme')) AND ("to" IN ('Zika', 'Lyme')))`);
    expect(minted(port, specs[14]!).predicateSQL).toBe('FALSE');
  });

  it('a cleared clause of any kind carries predicateSQL null — what a cleared Mosaic clause carries as its predicate', () => {
    const { port, a } = two();
    expect(minted(port, { kind: 'point', source: a, field: 'x', value: null, cause: cause() }).predicateSQL).toBeNull();
    expect(minted(port, { kind: 'interval', source: a, field: 'x', value: null, cause: cause() }).predicateSQL).toBeNull();
    expect(minted(port, { kind: 'cell', source: a, fields: ['x', 'y'], value: null, cause: cause() }).predicateSQL).toBeNull();
    expect(minted(port, { kind: 'match', source: a, field: 'x', value: null, cause: cause() }).predicateSQL).toBeNull();
    expect(minted(port, { kind: 'neighbourhood', source: a, fields: ['x', 'y'], value: null, cause: cause() }).predicateSQL).toBeNull();
    // a null INSIDE a compound is a value (IS NULL), never the clause's clear
    expect(minted(port, { kind: 'match', source: a, field: 'x', value: { values: [null] }, cause: cause() }).predicateSQL).toBe('("x" IS NULL)');
  });

  it('rejects unsupported-shape, typed, for every shape the real builders refuse — never a throw, never a fabricated byte', () => {
    const { port, a } = two();
    const shapes: CauseClauseSpec[] = [
      { kind: 'cell', source: a, fields: ['price', 'category'], value: [[10, 20], undefined as unknown as null], cause: cause() },
      { kind: 'match', source: a, field: 'category', value: { values: [undefined] }, cause: cause() },
      { kind: 'interval', source: a, field: 'amount', value: 42 as unknown as null, cause: cause() },
      { kind: 'point', source: a, field: 'x', value: Symbol('s'), cause: cause() },
      // a neighbourhood body carrying no walked set: the ids ARE the predicate, so there is nothing to render
      { kind: 'neighbourhood', source: a, fields: ['from', 'to'], value: { seed: 'Zika' } as unknown as null, cause: cause() },
    ];
    for (const spec of shapes) {
      const answer = port.clause(spec);
      expect(isRejection(answer), spec.kind).toBe(true);
      expect(answer).toMatchObject({ ok: false, engine: 'builtin', operation: 'clause', reason: 'unsupported-shape' });
      expect(isRejection(answer) && typeof answer.detail).toBe('string');
    }
    expect(port.clauses()).toEqual([]); // nothing minted, nothing standing
  });

  it('rejects a walk that records an ANSWER with no question — the seed, the derivation and the hop count', () => {
    const { port, a } = two();
    const walk = (value: unknown) => port.clause({ kind: 'neighbourhood', source: a, fields: ['from', 'to'], value: value as never, cause: cause() });
    // the byte is made of the ids alone, so nothing downstream would notice — until a bring-over
    // or a saved picture re-asks the walk from a seed that was never recorded
    for (const [body, slot] of [
      [{ derivation: 'ego', hops: 1, ids: ['Zika'] }, 'seed'],
      [{ seed: 'Zika', hops: 1, ids: ['Zika'] }, 'derivation'],
      [{ seed: 'Zika', derivation: 'ego', ids: ['Zika'] }, 'hops'],
      // a PATH's far end is half its question: without `to` the walk can only be refused later, by
      // the ACT that re-asks it — the mis-blame this judge exists to prevent
      [{ seed: 'Zika', derivation: 'path', hops: 2, ids: ['Zika', 'Lyme'] }, 'to'],
    ] as const) {
      expect(walk(body), slot).toMatchObject({ ok: false, reason: 'unsupported-shape', detail: expect.stringContaining(`no ${slot}`) });
    }
    // all three missing are named in one sentence, and a cleared walk records no question at all
    expect(walk({ ids: [] })).toMatchObject({ detail: expect.stringContaining('no seed, no derivation, no hops') });
    // `to` is asked of a PATH and of nothing else — an ego body has no far end to be missing
    expect(isRejection(walk({ seed: 'Zika', derivation: 'ego', hops: 1, ids: ['Zika'] }))).toBe(false);
    expect(walk({ seed: 'Zika', derivation: 'path', hops: null, to: null, ids: ['Zika', 'Lyme'] })).toMatchObject({ detail: expect.stringContaining('no to') });
    expect(isRejection(walk(null))).toBe(false);
    expect(port.clauses()).toEqual([]);
  });

  it('rejects unknown-source when the source — or ANY clients entry — is not a registry-minted RegisteredSource', () => {
    const { port, a } = two();
    const answer = port.clause({ kind: 'point', source: { viewId: 'fake', meta: { actor: 'user' } } as unknown as RegisteredSource, field: 'x', value: 1, cause: cause() });
    expect(answer).toMatchObject({ ok: false, engine: 'builtin', operation: 'clause', reason: 'unknown-source', detail: expect.stringContaining('source') });
    // a string client would never be skipped for anyone — silently; the gate is the same one the source passes
    const client = port.clause({ kind: 'point', source: a, field: 'x', value: 1, cause: cause(), clients: [a, 'bar' as unknown as RegisteredSource] });
    expect(client).toMatchObject({ ok: false, engine: 'builtin', operation: 'clause', reason: 'unknown-source', detail: expect.stringContaining('client') });
    // WHICH entry, and the value itself — a view id string is exactly what the caller meant to hand `require`
    expect(isRejection(client) && client.detail).toContain('client [1]');
    expect(isRejection(client) && client.detail).toContain('"bar"');
    expect(port.clauses()).toEqual([]);
  });

  it('rejects unsupported-shape for a kind no port knows (an untyped caller) — never a clause with no byte', () => {
    const { port, a } = two();
    const answer = port.clause({ kind: 'bogus' as never, source: a, field: 'x', value: 1, cause: cause() });
    expect(answer).toMatchObject({ ok: false, engine: 'builtin', operation: 'clause', reason: 'unsupported-shape', detail: 'unknown clause kind "bogus"' });
  });

  it('the clause and its meta are frozen, and the public clients set is a projection — mutating it steers nothing', () => {
    const { port, a, b } = two();
    const clause = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    port.update(clause);
    expect(Object.isFrozen(clause)).toBe(true);
    expect(Object.isFrozen(clause.meta)).toBe(true);
    expect(Object.isFrozen(clause.meta.cause)).toBe(true);
    expect(() => {
      (clause.meta as { cause: Cause }).cause = { requestedBy: 'agent', computedBy: 'agent' };
    }).toThrow(TypeError);
    (port.clauses()[0]!.clients as Set<RegisteredSource>).add(b);
    expect(port.skip(b, clause)).toBe(false); // the port's own set, untouched
    expect(port.clauses()[0]!.meta.cause).toEqual({ requestedBy: 'user', computedBy: 'user' });
  });

  it('a malformed cause THROWS (R12 — the cause gate is not a shape problem, and the log judges it first)', () => {
    const { port, a } = two();
    expect(() =>
      port.clause({ kind: 'point', source: a, field: 'x', value: 1, cause: { requestedBy: 'nope', computedBy: 'user' } as unknown as Cause }),
    ).toThrow(CauseValidationError);
  });
});

describe('builtinSelection.update — Selection.js:257-267 transcribed (crossfilter resolve)', () => {
  it('pushes a clause with a predicate; clauses() is a frozen snapshot in arrival order', () => {
    const { port, a, b } = two();
    const ca = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    const cb = minted(port, { kind: 'interval', source: b, field: 'y', value: [1, 2], cause: cause() });
    port.update(ca);
    port.update(cb);
    expect(port.clauses()).toEqual([ca, cb]);
    expect(Object.isFrozen(port.clauses())).toBe(true);
  });

  it('drops the clause standing for the SAME source before pushing (one clause per source)', () => {
    const { port, a, b } = two();
    const first = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    const other = minted(port, { kind: 'point', source: b, field: 'y', value: 2, cause: cause() });
    const second = minted(port, { kind: 'point', source: a, field: 'x', value: 3, cause: cause() });
    port.update(first);
    port.update(other);
    port.update(second);
    expect(port.clauses()).toEqual([other, second]); // a's first clause gone, a's new one LAST
  });

  it('a cleared clause (predicateSQL null) removes the source\'s clause and is NOT pushed', () => {
    const { port, a, b } = two();
    port.update(minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() }));
    const kept = minted(port, { kind: 'point', source: b, field: 'y', value: 2, cause: cause() });
    port.update(kept);
    port.update(minted(port, { kind: 'point', source: a, field: 'x', value: null, cause: cause() }));
    expect(port.clauses()).toEqual([kept]);
    // clearing a source that has nothing standing is a no-op, not an error
    port.update(minted(port, { kind: 'interval', source: a, field: 'x', value: null, cause: cause() }));
    expect(port.clauses()).toEqual([kept]);
  });

  it('a snapshot held across a later update keeps showing the earlier moment', () => {
    const { port, a, b } = two();
    port.update(minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() }));
    const before = port.clauses();
    port.update(minted(port, { kind: 'point', source: b, field: 'y', value: 2, cause: cause() }));
    expect(before.length).toBe(1);
    expect(port.clauses().length).toBe(2);
  });
});

describe('builtinSelection.update / skip — a clause this port did not mint is a typed SelectionPortError, as loud as on Mosaic', () => {
  it('a clause minted on another built-in, or a hand-built object, throws out of update() and skip() naming the act — nothing moves', () => {
    const { port, a } = two();
    const stranger = minted(builtinSelection(), { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    const handBuilt = { source: a, predicateSQL: 'x', clients: new Set([a]) } as unknown as CauseClause;
    for (const clause of [stranger, handBuilt]) {
      let onUpdate: unknown;
      try {
        port.update(clause);
      } catch (error) {
        onUpdate = error;
      }
      expect(onUpdate).toBeInstanceOf(SelectionPortError);
      expect((onUpdate as SelectionPortError).rejection).toMatchObject({ ok: false, engine: 'builtin', operation: 'update', reason: 'unknown-source' });
      expect((onUpdate as SelectionPortError).message).toContain('"A"');
      let onSkip: unknown;
      try {
        port.skip(a, clause);
      } catch (error) {
        onSkip = error;
      }
      expect((onSkip as SelectionPortError).rejection).toMatchObject({ ok: false, engine: 'builtin', operation: 'skip', reason: 'unknown-source' });
    }
    expect(port.clauses()).toEqual([]);
    // a clause with no source at all still names its act, never a TypeError out of the message builder
    expect(() => port.update(undefined as unknown as CauseClause)).toThrow(SelectionPortError);
  });
});

describe('builtinSelection.skip — Selection.js:278-283 (cross-filter self-exclusion, by identity)', () => {
  it('skips exactly the clients the clause names, never a peer', () => {
    const { port, a, b } = two();
    const own = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    expect(port.skip(a, own)).toBe(true);
    expect(port.skip(b, own)).toBe(false);
    const shared = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause(), clients: [a, b] });
    expect(port.skip(b, shared)).toBe(true);
  });

  it('is the filter a chart runs: clauses().filter(c => !skip(client, c))', () => {
    const { port, a, b } = two();
    const ca = minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    const cb = minted(port, { kind: 'point', source: b, field: 'y', value: 2, cause: cause() });
    port.update(ca);
    port.update(cb);
    expect(port.clauses().filter((c) => !port.skip(a, c))).toEqual([cb]);
    expect(port.clauses().filter((c) => !port.skip(b, c))).toEqual([ca]);
  });
});

describe('builtinSelection.listen — synchronous, in order, and a throw propagates', () => {
  it('calls every listener synchronously with the standing clauses, on every update', () => {
    const { port, a } = two();
    const seen: number[] = [];
    const seenToo: Array<readonly CauseClause[]> = [];
    port.listen((clauses) => seen.push(clauses.length));
    port.listen((clauses) => seenToo.push(clauses));
    port.update(minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() }));
    expect(seen).toEqual([1]); // already, on return
    port.update(minted(port, { kind: 'point', source: a, field: 'x', value: null, cause: cause() }));
    expect(seen).toEqual([1, 0]);
    expect(seenToo[1]).toBe(port.clauses()); // the same frozen snapshot clauses() hands out
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

  it('the returned function unsubscribes; unsubscribing twice is harmless', () => {
    const { port, a } = two();
    let calls = 0;
    const stop = port.listen(() => {
      calls += 1;
    });
    port.update(minted(port, { kind: 'point', source: a, field: 'x', value: 1, cause: cause() }));
    stop();
    stop();
    port.update(minted(port, { kind: 'point', source: a, field: 'x', value: 2, cause: cause() }));
    expect(calls).toBe(1);
  });
});
