import { describe, expect, it } from 'vitest';
import { routeIntent } from '../route.js';
import type { RouteDecision } from './types.js';
import { decision, nodes, port, scores, unmatched } from './route.fixture.js';

describe('routing decision boundary', () => {
  const mutate = (change: (value: Record<string, unknown>) => void): unknown => {
    const value = decision() as unknown as Record<string, unknown>; change(value); return value;
  };
  const malformed: unknown[] = [undefined, null, 1,
    mutate(value => { value.decisive = 'yes'; }),
    mutate(value => { value.ranked = {}; }),
    mutate(value => { value.ranked = []; }),
    mutate(value => { value.ranked = [null, { id: 'b', score: 0, relevance: 0 }]; }),
    mutate(value => { value.ranked = [{ id: 'ghost', score: 1, relevance: 1 }, { id: 'b', score: 0, relevance: 0 }]; }),
    mutate(value => { value.ranked = [{ id: 'a', score: 1, relevance: 1 }, { id: 'a', score: 1, relevance: 0 }]; }),
    mutate(value => { value.ranked = [{ id: 'a', score: 9, relevance: 1 }, { id: 'b', score: 0, relevance: 0 }]; }),
    ...[NaN, Infinity, -1, 2, '0.5'].map(relevance => mutate(value => { value.ranked = [{ id: 'a', score: 1, relevance }, { id: 'b', score: 0, relevance: 0 }]; })),
    mutate(value => { value.runnerUp = null; }),
    mutate(value => { value.runnerUp = { id: 'ghost', gap: 0.1 }; }),
    mutate(value => { value.runnerUp = { id: 'b', gap: NaN }; }),
    mutate(value => { value.to = 'ghost'; }),
    mutate(value => { value.kind = 'invented'; }),
    mutate(value => { value.kind = 'menu'; value.offered = null; }),
    mutate(value => { value.kind = 'menu'; value.offered = ['a', 'b', 'a']; }),
    mutate(value => { value.kind = 'menu'; value.offered = ['ghost']; }),
    mutate(value => { value.kind = 'menu'; value.offered = ['a', 'a']; }),
    ...[-1, 1.5, NaN].map(length => mutate(value => {
      value.kind = 'menu'; value.offered = new Proxy([], { get: (_target, key) => key === 'length' ? length : undefined });
    })),
  ];
  it.each(malformed.map((value, index) => [index, value] as const))('refuses malformed foreign evidence case %s', async (_index, value) => {
    const p = port(); p.decide = () => value as RouteDecision;
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(unmatched);
  });
  const kinds: readonly RouteDecision['kind'][] = ['move', 'stay', 'menu', 'unmatched'];
  const { ranked, decisive } = decision();
  // The declared union must grow this exhaustive table when a kind is added.
  const cases = {
    move: { ...decision(), kind: 'move', to: 'b' },
    stay: { ranked, decisive, kind: 'stay' },
    menu: { ranked, decisive, kind: 'menu', offered: ['b', 'a'] },
    unmatched: { ranked, decisive, kind: 'unmatched' },
  } satisfies Record<RouteDecision['kind'], RouteDecision>;
  it.each(kinds)('preserves a valid %s decision without choosing a routing policy', async kind => {
    const p = port(); p.decide = () => cases[kind];
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(cases[kind]);
  });
  it('allows an empty menu because the consumer owns menu policy', async () => {
    const empty = { ranked, decisive, kind: 'menu', offered: [] } as const;
    const p = port(); p.decide = () => empty;
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(empty);
  });
  it.each(['stay', 'menu', 'unmatched'] as const)('ignores move-only and unknown fields on %s decisions', async kind => {
    const raw = { ...cases[kind] };
    for (const field of ['to', 'hidden']) Object.defineProperty(raw, field, { enumerable: true, get() { throw Error('irrelevant field'); } });
    const p = port(); p.decide = () => raw;
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(cases[kind]);
  });
  it('captures returned evidence once and breaks retained references', async () => {
    const reads = { kind: 0, ranked: 0, decisive: 0, runner: 0, id: 0, score: 0, relevance: 0, offered: 0, offeredLength: 0 };
    const rows = scores().map(({ id, score }) => ({ get id() { reads.id++; return id; }, get score() { reads.score++; return score; }, get relevance() { reads.relevance++; return 0.5; } }));
    Object.defineProperty(rows, Symbol.iterator, { get() { throw Error('ranked iterator'); } });
    const offered = new Proxy(['b', 'a'], { get(target, key, receiver) { if (key === 'length') reads.offeredLength++; if (key === Symbol.iterator) throw Error('offered iterator'); return Reflect.get(target, key, receiver); } });
    const raw = { get kind() { reads.kind++; return 'menu'; }, get ranked() { reads.ranked++; return rows; }, get decisive() { reads.decisive++; return false; }, get runnerUp() { reads.runner++; return { id: 'b', gap: 0.1 }; }, get offered() { reads.offered++; return offered; } };
    Object.defineProperty(raw, 'hidden', { enumerable: true, get() { throw Error('hidden result'); } });
    const p = port(); p.decide = () => raw as RouteDecision;
    const answer = await routeIntent('alpha', nodes(), p);
    expect(reads).toEqual({ kind: 1, ranked: 1, decisive: 1, runner: 1, id: 2, score: 2, relevance: 2, offered: 1, offeredLength: 1 });
    Reflect.set(offered, '0', 'ghost'); rows.splice(0, 1);
    expect(answer.verdict).toEqual({ kind: 'menu', offered: ['b', 'a'], ranked: [{ id: 'a', score: 1, relevance: 0.5 }, { id: 'b', score: 0, relevance: 0.5 }], runnerUp: { id: 'b', gap: 0.1 }, decisive: false });
  });
  it('contains decision exceptions and input mutation without altering owned evidence', async () => {
    const p = port();
    p.decide = (rows, _incumbent, policy) => {
      Reflect.set(rows[0]!, 'score', 99); Reflect.set(policy, 'menuSize', 99);
      return decision();
    };
    const answer = await routeIntent('alpha', nodes(), p);
    expect(answer.verdict).toEqual(decision());
    expect(answer.policy.menuSize).toBe(3);
    p.decide = () => { throw Error('decision failure'); };
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(unmatched);
  });
  it('refuses oversized rankings before touching a row', async () => {
    const rows = new Proxy([], { get(_target, key) { if (key === 'length') return 1_000_000; throw Error('row read'); } });
    const p = port(); p.decide = () => ({ ...decision(), ranked: rows });
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(unmatched);
  });
  it('does linear bounded work for a large declared candidate list', async () => {
    const size = 2_000; let scoreReads = 0; let rankReads = 0;
    const input = Array.from({ length: size }, (_, index) => ({ id: String(index), viewId: String(index), kinds: ['point'] as const, does: String(index) }));
    const p = port(); p.scorer.score = (_phrase, candidates) => candidates.map(({ id }) => ({ id, get score() { scoreReads++; return 1; } }));
    p.decide = rows => ({ kind: 'move', to: '0', decisive: true, ranked: rows.map(({ id, score }) => ({ id, score, get relevance() { rankReads++; return 1 / size; } })) });
    const answer = await routeIntent('large', input, p);
    expect(answer.verdict.ranked).toHaveLength(size);
    expect(scoreReads).toBe(size); expect(rankReads).toBe(size);
  });
});
