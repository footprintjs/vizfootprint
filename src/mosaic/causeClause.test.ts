import { describe, it, expect } from 'vitest';
import { Selection } from '@uwdata/mosaic-core';
import { SourceRegistry, causeClause, causeOf } from './index.js';
import type { Cause } from '../cause/index.js';

const cause = (over: Partial<Cause> = {}): Cause => ({
  requestedBy: 'user',
  computedBy: 'user',
  ...over,
});

describe('causeClause — builds a real Mosaic clause carrying a cause', () => {
  it('produces a clause with source identity, predicate, and CauseMetadata', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    const clause = causeClause({
      kind: 'point',
      source: a,
      field: 'category',
      value: 'Data',
      cause: cause({ intent: 'pick Data' }),
    });
    expect(clause.source).toBe(a); // identity preserved
    expect(String(clause.predicate)).toContain('category');
    expect(clause.meta.type).toBe('point'); // factory-provided base survives
    expect(causeOf(clause)).toEqual({ requestedBy: 'user', computedBy: 'user', intent: 'pick Data' });
  });

  it('rejects a malformed cause before any clause is built (R12)', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    expect(() =>
      causeClause({
        kind: 'point',
        source: a,
        field: 'x',
        value: 1,
        // @ts-expect-error bad actor enum
        cause: { requestedBy: 'nope', computedBy: 'user' },
      }),
    ).toThrow();
  });

  it('defaults clients to [source] so cross-filter self-exclusion works', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    const clause = causeClause({ kind: 'point', source: a, field: 'x', value: 1, cause: cause() });
    // clients is a Set holding the source identity (used by SelectionResolver.skip)
    expect((clause.clients as unknown as Set<object>).has(a)).toBe(true);
  });

  it('meta.cause survives a live update into Mosaic Selection state', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'agent' });
    const sel = Selection.crossfilter();
    const clause = causeClause({
      kind: 'interval',
      source: a,
      field: 'amount',
      value: [10, 20],
      cause: cause({ requestedBy: 'user', computedBy: 'agent', intent: 'zoom' }),
    });
    sel.update(clause);
    const live = sel.clauses[0];
    expect(causeOf(live!)).toEqual({ requestedBy: 'user', computedBy: 'agent', intent: 'zoom' });
    // and Mosaic's own meta.type is intact alongside our cause
    expect(live!.meta?.type).toBe('interval');
  });

  it('causeOf round-trips exactly through causeClause (equality, not just presence)', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'system' });
    const original = cause({ requestedBy: 'agent', computedBy: 'system', intent: 'recompute' });
    const clause = causeClause({ kind: 'point', source: a, field: 'status', value: 'ok', cause: original });
    expect(causeOf(clause)).toEqual(original);
    expect(causeOf(clause)).not.toBe(original); // validated/rebuilt, not the same reference
  });

  it('causeOf returns undefined for a clause with no cause on its meta', () => {
    // A bare Mosaic clause (no CauseMetadata) — causeOf must not throw or fabricate one.
    expect(causeOf({ source: {}, predicate: null, meta: { type: 'point' } } as never)).toBeUndefined();
  });

  it('cross-filter: clients excludes only self across a TWO-view registry', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    const b = reg.register('B', { actor: 'agent' });

    // A's clause explicitly lists BOTH as clients (self + peer) — the
    // self-exclusion contract only ever excludes the literal member(s)
    // named in `clients`, driven by identity, never a flag.
    const clauseA = causeClause({
      kind: 'point',
      source: a,
      field: 'category',
      value: 'Data',
      cause: cause(),
      clients: [a, b],
    });
    expect(clauseA.clients?.has(a)).toBe(true);
    expect(clauseA.clients?.has(b)).toBe(true);
    expect(clauseA.clients?.size).toBe(2);

    // the default (clients omitted) excludes ONLY the source itself
    const clauseB = causeClause({ kind: 'point', source: b, field: 'category', value: 'X', cause: cause() });
    expect(clauseB.clients?.has(b)).toBe(true);
    expect(clauseB.clients?.has(a)).toBe(false);
    expect(clauseB.clients?.size).toBe(1);
  });
});
