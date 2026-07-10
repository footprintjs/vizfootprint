/**
 * Coverage packet (COV-trace) — closes branches `log.test.ts` /
 * `branch.test.ts` / `viewport-replay.test.ts` never needed:
 *
 *   - `commit()`'s explicit `clientViewIds` (a client id OTHER than the
 *     committing view itself — every other test lets it default to
 *     `[viewId]`, which never exercises the `this.registry.require(id)` arm);
 *   - `commit()`'s explicit `ts` (every other test lets it default to
 *     `this.records.length`);
 *   - `deserializeLog`'s "not an array" guard (a parseable-but-wrong-shape
 *     JSON payload);
 *   - `replayLog` called with an in-memory RECORD ARRAY directly (every other
 *     test always round-trips through `serializeLog` first, so the
 *     `typeof log === 'string' ? … : log` branch never took the `log` arm).
 */

import { describe, expect, it } from 'vitest';
import { CauseSelectionSession, deserializeLog, replayLog, serializeLog, type CommitRecord } from './log.js';
import type { Cause } from '../cause/index.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user' };

describe('commit() — explicit clientViewIds naming a DIFFERENT view than the committing one', () => {
  it('a client id other than viewId is resolved via registry.require, not defaulted to [source]', () => {
    const s = new CauseSelectionSession();
    // 'B' must be registered before it can be named as a client.
    s.registry.register('B', { actor: 'agent' });
    const { record, clause } = s.commit({
      id: 'c1',
      parent: null,
      viewId: 'A',
      actorMeta: { actor: 'user' },
      kind: 'point',
      field: 'category',
      value: 'Data',
      cause,
      clientViewIds: ['B'], // note: NOT ['A'] (the default) — exercises the else arm
    });
    expect(record.clientViewIds).toEqual(['B']);
    const b = s.registry.require('B');
    // the live clause's `clients` set holds B's identity (resolved via require, not `source`).
    expect((clause.clients as unknown as Set<object>).has(b)).toBe(true);
    expect((clause.clients as unknown as Set<object>).has(s.registry.require('A'))).toBe(false);
  });

  it('a client list mixing the committing view AND another view resolves each correctly', () => {
    const s = new CauseSelectionSession();
    s.registry.register('B', { actor: 'agent' });
    const { record, clause } = s.commit({
      id: 'c1',
      parent: null,
      viewId: 'A',
      actorMeta: { actor: 'user' },
      kind: 'point',
      field: 'category',
      value: 'Data',
      cause,
      clientViewIds: ['A', 'B'],
    });
    expect(record.clientViewIds).toEqual(['A', 'B']);
    const clients = clause.clients as unknown as Set<object>;
    expect(clients.has(s.registry.require('A'))).toBe(true);
    expect(clients.has(s.registry.require('B'))).toBe(true);
    expect(clients.size).toBe(2);
  });
});

describe('commit() — explicit ts overrides the records.length default', () => {
  it('a caller-supplied ts lands verbatim on the record', () => {
    const s = new CauseSelectionSession();
    const { record } = s.commit({
      id: 'c1',
      parent: null,
      viewId: 'A',
      actorMeta: { actor: 'user' },
      kind: 'point',
      field: 'category',
      value: 'Data',
      cause,
      ts: 999,
    });
    expect(record.ts).toBe(999); // NOT records.length (which would be 0)
  });

  it('omitting ts still defaults to records.length (the other arm, for contrast)', () => {
    const s = new CauseSelectionSession();
    s.commit({ id: 'c1', parent: null, viewId: 'A', actorMeta: { actor: 'user' }, kind: 'point', field: 'category', value: 'Data', cause });
    const { record } = s.commit({ id: 'c2', parent: 'c1', viewId: 'A', actorMeta: { actor: 'user' }, kind: 'point', field: 'category', value: 'Ops', cause });
    expect(record.ts).toBe(1); // records.length at the time of this commit
  });
});

describe('deserializeLog — rejects a parseable-but-non-array payload', () => {
  it('throws for a JSON object (valid JSON, wrong shape)', () => {
    expect(() => deserializeLog('{"not":"an array"}')).toThrow('log must be a JSON array');
  });

  it('accepts a genuine JSON array (the non-throwing arm, for contrast)', () => {
    const s = new CauseSelectionSession();
    s.commit({ id: 'c1', parent: null, viewId: 'A', actorMeta: { actor: 'user' }, kind: 'point', field: 'category', value: 'Data', cause });
    const parsed = deserializeLog(serializeLog(s.records));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.id).toBe('c1');
  });
});

describe('replayLog — accepts an in-memory record array directly (not just a serialized string)', () => {
  it('replaying the array form (no serializeLog round-trip) produces the same result as replaying its JSON', () => {
    const live = new CauseSelectionSession();
    live.commit({ id: 'c1', parent: null, viewId: 'A', actorMeta: { actor: 'user' }, kind: 'point', field: 'category', value: 'Data', cause });
    live.commit({ id: 'c2', parent: 'c1', viewId: 'B', actorMeta: { actor: 'agent' }, kind: 'interval', field: 'amount', value: [10, 20], cause });

    // the ARRAY arm: `log` is `readonly CommitRecord[]`, never turned into a string.
    const fromArray = replayLog(live.records);
    // the STRING arm, for a byte-identical cross-check.
    const fromString = replayLog(serializeLog(live.records));

    expect(fromArray.records.map((r: CommitRecord) => r.id)).toEqual(fromString.records.map((r) => r.id));
    expect(serializeLog(fromArray.records)).toBe(serializeLog(fromString.records));
    expect(fromArray.records.every((r) => r.cause.replayed === true)).toBe(true);
  });
});
