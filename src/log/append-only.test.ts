/**
 * DEFECT 1 — "the log is not append-only" — pinned.
 *
 * Three things were true an hour ago and must never be true again:
 *   1. `session.records` was a public mutable array; a forged commit could be
 *      pushed onto it and the length grew.
 *   2. `Object.freeze(record)` was ONE LEVEL DEEP, so `record.cause.intent`
 *      could be rewritten to 'REWRITTEN' after the fact — the record of WHY
 *      was editable.
 *   3. `deserializeLog` checked only `Array.isArray`, so any shape at all came
 *      back in through the door and was trusted as history.
 *
 * Each numbered test below is one of those reproductions, now failing.
 */
import { describe, expect, it } from 'vitest';
import {
  CauseSelectionSession,
  CommitLogParseError,
  deserializeLog,
  parseCommitLog,
  replayLog,
  serializeLog,
  type CommitRecord,
} from './log.js';

function landOne(session = new CauseSelectionSession()): { session: CauseSelectionSession; record: CommitRecord } {
  const { record } = session.commit({
    id: 'c1',
    parent: null,
    viewId: 'scatter',
    actorMeta: { actor: 'user', label: 'Scatter' },
    kind: 'interval',
    field: 'price',
    value: [10, 90],
    cause: { requestedBy: 'user', computedBy: 'user', intent: 'brushed the mid band' },
    data: { dresses: 'v1' },
  });
  return { session, record };
}

describe('1. the records array is private, and the view of it is frozen', () => {
  it('a forged commit cannot be pushed onto `records` — the length does not grow', () => {
    const { session, record } = landOne();
    const forged = { ...record, id: 'FORGED', cause: { requestedBy: 'system', computedBy: 'system' } };

    expect(Object.isFrozen(session.records)).toBe(true);
    expect(() => (session.records as CommitRecord[]).push(forged as CommitRecord)).toThrow(TypeError);
    expect(() => {
      (session.records as CommitRecord[])[0] = forged as CommitRecord;
    }).toThrow(TypeError);
    expect(() => {
      (session.records as CommitRecord[]).length = 0;
    }).toThrow(TypeError);
    expect(session.records).toHaveLength(1);
    expect(session.records[0]!.id).toBe('c1');
  });

  it('the private array is unreachable even through a cast — `#records` is a real private field', () => {
    const { session } = landOne();
    expect((session as unknown as { records?: unknown })['records']).toBe(session.records);
    // there is no other own/prototype name holding the live array
    const names = [...Object.getOwnPropertyNames(session), ...Object.getOwnPropertyNames(CauseSelectionSession.prototype)];
    for (const name of names) {
      const held = (session as unknown as Record<string, unknown>)[name];
      if (Array.isArray(held)) expect(Object.isFrozen(held)).toBe(true);
    }
  });

  it('the snapshot is DETACHED: a reader holding it keeps the moment it asked about', () => {
    const { session } = landOne();
    const before = session.records;
    session.commit({
      id: 'c2', parent: 'c1', viewId: 'scatter', actorMeta: { actor: 'user', label: 'Scatter' },
      kind: 'point', field: 'category', value: 'Casual',
      cause: { requestedBy: 'user', computedBy: 'user' },
    });
    expect(before).toHaveLength(1); // the fold that asked earlier still sees what it asked about
    expect(session.records).toHaveLength(2); // asking again shows the moment after
  });

  it('repeated reads with no commit in between share one snapshot (the copy is not per read)', () => {
    const { session } = landOne();
    expect(session.records).toBe(session.records);
  });
});

describe('2. the freeze is deep — the record of WHY cannot be rewritten', () => {
  it('`record.cause.intent = "REWRITTEN"` throws instead of sticking', () => {
    const { session, record } = landOne();
    expect(Object.isFrozen(record.cause)).toBe(true);
    expect(() => {
      (record.cause as { intent?: string }).intent = 'REWRITTEN';
    }).toThrow(TypeError);
    expect(() => {
      delete (record.cause as { intent?: string }).intent;
    }).toThrow(TypeError);
    expect(session.records[0]!.cause.intent).toBe('brushed the mid band');
  });

  it('the value, the field pair, the client ids, the actor meta and the data versions are all sealed', () => {
    const { record } = landOne();
    expect(Object.isFrozen(record.value)).toBe(true);
    expect(Object.isFrozen(record.clientViewIds)).toBe(true);
    expect(Object.isFrozen(record.actorMeta)).toBe(true);
    expect(Object.isFrozen(record.data)).toBe(true);
    expect(() => (record.value as number[]).push(999)).toThrow(TypeError);
    expect(() => (record.clientViewIds as string[]).push('smuggled')).toThrow(TypeError);
    expect(() => {
      (record.data as Record<string, string>).dresses = 'v99';
    }).toThrow(TypeError);
  });

  it('a cell commit\'s field pair is sealed too', () => {
    const session = new CauseSelectionSession();
    const { record } = session.commit({
      id: 'c1', parent: null, viewId: 'heat', actorMeta: { actor: 'agent' },
      kind: 'cell', field: 'price × rating', fields: ['price', 'rating'],
      value: [[10, 90], [1, 5]],
      cause: { requestedBy: 'agent', computedBy: 'agent' },
    });
    expect(Object.isFrozen(record.fields)).toBe(true);
    expect(() => {
      (record.fields as unknown as string[])[0] = 'FORGED';
    }).toThrow(TypeError);
  });

  it('the record never aliases the caller\'s own VALUE — freezing history does not freeze the caller', () => {
    // The one that is easiest to get wrong: a multi-select hands in the array
    // the UI is still holding. If the record aliased it, landing the commit
    // would freeze the caller's array under it.
    const session = new CauseSelectionSession();
    const values = ['Formal', 'Party'];
    const { record, clause } = session.commit({
      id: 'c1', parent: null, viewId: 'bar', actorMeta: { actor: 'user' },
      kind: 'match', field: 'category', value: { values },
      cause: { requestedBy: 'user', computedBy: 'user' },
    });
    expect(Object.isFrozen(values)).toBe(false);
    values.push('Casual'); // the caller goes on using its own array
    expect((record.value as { values: string[] }).values).toEqual(['Formal', 'Party']);
    expect(Object.isFrozen((record.value as { values: string[] }).values)).toBe(true); // history is sealed

    // BOTH doors, not just the record: the clause the live selection keeps is
    // built from the same copy, so a caller still filling its own array is not
    // editing the selection that is already standing.
    expect((clause.value as { values: string[] }).values).toEqual(['Formal', 'Party']);
  });

  it('the record never aliases the caller\'s own arrays — freezing history does not freeze the caller', () => {
    const session = new CauseSelectionSession();
    session.registry.register('b', { actor: 'user' });
    const clients = ['a', 'b'];
    const pair: [string, string] = ['price', 'rating'];
    session.commit({
      id: 'c1', parent: null, viewId: 'a', actorMeta: { actor: 'user' },
      kind: 'cell', field: 'price × rating', fields: pair, value: null,
      clientViewIds: clients,
      cause: { requestedBy: 'user', computedBy: 'user' },
    });
    expect(Object.isFrozen(clients)).toBe(false);
    expect(Object.isFrozen(pair)).toBe(false);
    clients.push('c'); // still the caller's own array
    expect(session.records[0]!.clientViewIds).toEqual(['a', 'b']);
  });
});

describe('3. parseCommitLog — the door back in', () => {
  const good = (): Record<string, unknown> => JSON.parse(serializeLog(landOne().session.records))[0] as Record<string, unknown>;
  const refuse = (records: unknown): string[] => {
    const res = parseCommitLog(records);
    if (res.ok) throw new Error('expected a refusal');
    return res.problems;
  };

  it('accepts a real log and keeps the serialize/replay round trip green', () => {
    const { session } = landOne();
    session.commit({
      id: 'c2', parent: 'c1', viewId: 'bars', actorMeta: { actor: 'agent', label: 'Bars' },
      correlationId: 'tool-7', kind: 'point', field: 'category', value: 'Casual',
      cause: { requestedBy: 'agent', computedBy: 'agent', intent: 'agent picked Casual' },
    });
    const wire = serializeLog(session.records);
    const back = deserializeLog(wire);
    expect(serializeLog(back)).toBe(wire);
    expect(back[1]!.correlationId).toBe('tool-7');
    expect(back[1]!.actorMeta.label).toBe('Bars');
    const replayed = replayLog(wire);
    expect(replayed.records.map((r) => r.id)).toEqual(['c1', 'c2']);
    expect(replayed.records.every((r) => r.cause.replayed === true)).toBe(true);
  });

  it('every parsed record comes back deeply frozen too', () => {
    const back = deserializeLog(serializeLog(landOne().session.records));
    expect(Object.isFrozen(back[0])).toBe(true);
    expect(Object.isFrozen(back[0]!.cause)).toBe(true);
    expect(() => {
      (back[0]!.cause as { intent?: string }).intent = 'REWRITTEN';
    }).toThrow(TypeError);
  });

  it('rebuilds data-only: an extra key is refused, never silently carried', () => {
    expect(refuse([{ ...good(), smuggled: 'payload' }])).toEqual(['commit #0 "c1": unknown key "smuggled"']);
  });

  it('names the bad record ONCE and then lists everything wrong with it', () => {
    const problems = refuse([{ anything: 'at all' }]);
    expect(problems).toHaveLength(1); // one sentence, not one line per problem
    expect(problems[0]).toMatch(/^commit #0 \(no id\): unknown key "anything"; id must be a non-empty string; missing parent/);
  });

  it('refuses a payload that is not an array', () => {
    expect(refuse({ not: 'an array' })).toEqual(['log must be a JSON array']);
    expect(() => deserializeLog('{"not":"an array"}')).toThrow('log must be a JSON array');
  });

  it('names the first bad record — and says "(no id)" when it has not even got one', () => {
    expect(refuse([null])).toEqual(['commit #0 (no id): a commit must be a plain object']);
    expect(refuse([[]])).toEqual(['commit #0 (no id): a commit must be a plain object']);
    expect(refuse(['nope'])).toEqual(['commit #0 (no id): a commit must be a plain object']);
    const problems = refuse([good(), { ...good(), id: 'c2', ts: 'soon' }]);
    expect(problems).toEqual(['commit #1 "c2": ts must be a finite number']);
  });

  it('refuses a missing or wrongly typed required field, one sentence each', () => {
    expect(refuse([{ ...good(), id: '' }])[0]).toContain('id must be a non-empty string');
    expect(refuse([{ ...good(), id: 7 }])[0]).toContain('id must be a non-empty string');

    const noParent = good();
    delete noParent.parent;
    expect(refuse([noParent])[0]).toContain('missing parent (use null for a root commit)');
    expect(refuse([{ ...good(), parent: 7 }])[0]).toContain('parent must be a commit id or null');
    expect(refuse([{ ...good(), parent: '' }])[0]).toContain('parent must be a commit id or null');

    expect(refuse([{ ...good(), correlationId: 7 }])[0]).toContain('correlationId, if present, must be a string');
    expect(refuse([{ ...good(), viewId: '' }])[0]).toContain('viewId must be a non-empty string');

    expect(refuse([{ ...good(), actorMeta: 'user' }])[0]).toContain('actorMeta must be an object');
    expect(refuse([{ ...good(), actorMeta: { actor: 'robot' } }])[0]).toContain('actorMeta.actor must be one of user|agent|system');
    expect(refuse([{ ...good(), actorMeta: { actor: 'user', label: 7 } }])[0]).toContain('actorMeta.label, if present, must be a string');
    expect(refuse([{ ...good(), actorMeta: { actor: 'user', does: 7 } }])[0]).toContain('actorMeta.does, if present, must be a string');

    expect(refuse([{ ...good(), kind: 'lasso' }])[0]).toContain('kind must be one of point|interval|cell|match');
    expect(refuse([{ ...good(), kind: 7 }])[0]).toContain('kind must be one of point|interval|cell|match');
    expect(refuse([{ ...good(), field: 7 }])[0]).toContain('field must be a string');

    expect(refuse([{ ...good(), clientViewIds: 'scatter' }])[0]).toContain('clientViewIds must be an array of view ids');
    expect(refuse([{ ...good(), clientViewIds: [7] }])[0]).toContain('clientViewIds must be an array of view ids');
    expect(refuse([{ ...good(), predicateSQL: 7 }])[0]).toContain('predicateSQL must be a string');
    expect(refuse([{ ...good(), ts: Number.NaN }])[0]).toContain('ts must be a finite number');

    expect(refuse([{ ...good(), data: 'v1' }])[0]).toContain('data, if present, must map table name to version string');
    expect(refuse([{ ...good(), data: { dresses: 3 } }])[0]).toContain('data, if present, must map table name to version string');
  });

  it('refuses a bad field pair, and a cell commit that carries none', () => {
    expect(refuse([{ ...good(), fields: 'price' }])[0]).toContain('fields, if present, must be exactly two column names');
    expect(refuse([{ ...good(), fields: ['price'] }])[0]).toContain('fields, if present, must be exactly two column names');
    expect(refuse([{ ...good(), fields: ['price', 7] }])[0]).toContain('fields, if present, must be exactly two column names');
    expect(refuse([{ ...good(), kind: 'cell' }])[0]).toContain('a cell commit needs `fields`');
  });

  it('runs the cause through the existing cause validator', () => {
    expect(refuse([{ ...good(), cause: { requestedBy: 'user' } }])).toEqual(['commit #0 "c1": cause: missing computedBy']);
    expect(refuse([{ ...good(), cause: { requestedBy: 'user', computedBy: 'user', evil: 1 } }])[0]).toContain('cause: unknown key "evil"');
    expect(refuse([{ ...good(), cause: 'user' }])[0]).toContain('cause: cause must be a plain object');
  });

  it('refuses duplicate ids — an id must name one commit', () => {
    expect(refuse([good(), good()])).toEqual(['commit #1 "c1": duplicate id — commit #0 already has it']);
  });

  it('refuses a parent that is not in the log — history with a hole in it', () => {
    expect(refuse([{ ...good(), parent: 'ghost' }])).toEqual(['commit #0 "c1": parent "ghost" is not in the log']);
  });

  it('refuses a parent chain that loops', () => {
    const a = { ...good(), id: 'a', parent: 'b' };
    const b = { ...good(), id: 'b', parent: 'a' };
    expect(refuse([a, b])[0]).toContain('its parent chain loops back to "a"');
    const self = { ...good(), id: 'a', parent: 'a' };
    expect(refuse([self])[0]).toContain('its parent chain loops back to "a"');
  });

  it('walks a long shared chain once (the settled short-circuit)', () => {
    const chain = [
      { ...good(), id: 'a', parent: null },
      { ...good(), id: 'b', parent: 'a' },
      { ...good(), id: 'c', parent: 'b' },
      { ...good(), id: 'd', parent: 'b' },
    ];
    const res = parseCommitLog(chain);
    expect(res.ok).toBe(true);
  });

  it('keeps an actorMeta `does` sentence that a host wrote into the wire', () => {
    const res = parseCommitLog([{ ...good(), actorMeta: { actor: 'user', label: 'Scatter', does: 'brushes prices' } }]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.records[0]!.actorMeta).toEqual({ actor: 'user', label: 'Scatter', does: 'brushes prices' });
  });

  it('a value that JSON dropped (it was undefined) comes back as undefined, not a refusal', () => {
    const noValue = good();
    delete noValue.value;
    const res = parseCommitLog([noValue]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.records[0]!.value).toBeUndefined();
  });

  it('accepts a log whose parent appears LATER in the array — an export need not be topologically ordered', () => {
    const [a, b] = [good(), { ...good(), id: 'c2', parent: 'c1' }];
    expect(parseCommitLog([b, a]).ok).toBe(true);
  });

  it('catches a longer cycle, not just a two-step one', () => {
    const ring = [
      { ...good(), id: 'x', parent: 'y' },
      { ...good(), id: 'y', parent: 'z' },
      { ...good(), id: 'z', parent: 'x' },
    ];
    expect(refuse(ring)[0]).toContain('its parent chain loops back to "x"');
  });

  it('an empty log is a valid log', () => {
    const res = parseCommitLog([]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.records).toEqual([]);
  });

  it('a JSON `__proto__` own key is refused as an unknown key, and pollutes nothing', () => {
    const parsed: unknown = JSON.parse('[{"__proto__":{"polluted":1}}]');
    expect(refuse(parsed)[0]).toContain('unknown key "__proto__"');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('deserializeLog throws a CommitLogParseError carrying the problems', () => {
    let thrown: unknown;
    try {
      deserializeLog(JSON.stringify([{ ...good(), cause: { requestedBy: 'user' } }]));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CommitLogParseError);
    expect((thrown as CommitLogParseError).problems).toEqual(['commit #0 "c1": cause: missing computedBy']);
    expect((thrown as Error).message).toBe('invalid commit log: commit #0 "c1": cause: missing computedBy');
  });
});
