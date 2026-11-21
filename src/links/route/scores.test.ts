import { describe, expect, it } from 'vitest';
import { routeIntent } from '../route.js';
import type { RouteScore } from './types.js';
import { decision, nodes, port, scores, unmatched } from './route.fixture.js';

describe('routing score boundary', () => {
  const malformed: unknown[] = [undefined, null, {}, 'scores', [], [{ id: 'a', score: 1 }],
    [...scores(), { id: 'c', score: 0 }], [null, { id: 'b', score: 0 }],
    [{ id: 1, score: 1 }, { id: 'b', score: 0 }],
    [{ id: 'a', score: '1' }, { id: 'b', score: 0 }],
    [{ id: 'a', score: undefined }, { id: 'b', score: 0 }],
    [{ id: 'a', score: null }, { id: 'b', score: 0 }],
    [{ id: 'ghost', score: 1 }, { id: 'b', score: 0 }],
    [{ id: 'a', score: 1 }, { id: 'a', score: 0 }]];
  it.each(malformed.map((raw, index) => [index, raw] as const))('refuses malformed scores case %s before deciding', async (_index, raw) => {
    const p = port(); let decisions = 0;
    p.scorer.score = () => raw as RouteScore[];
    p.decide = () => { decisions++; return decision(); };
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(unmatched);
    expect(decisions).toBe(0);
  });
  it('restores declaration order and reads each foreign field once without foreign iteration', async () => {
    const counts = { id: 0, score: 0, length: 0 };
    const rows = ['b', 'a'].map(id => ({ get id() { counts.id++; return id; }, get score() { counts.score++; return id === 'a' ? 1 : 0; } }));
    Object.defineProperty(rows[0], 'hidden', { enumerable: true, get() { throw Error('hidden score'); } });
    Object.defineProperty(rows, Symbol.iterator, { get() { throw Error('foreign iterator'); } });
    Object.defineProperty(rows, 'map', { get() { throw Error('foreign map'); } });
    const raw = new Proxy(rows, { get(target, key, receiver) { if (key === 'length') counts.length++; return Reflect.get(target, key, receiver); } });
    const p = port(); p.scorer.score = () => raw;
    p.decide = got => { expect(got).toEqual(scores()); return decision(got); };
    expect((await routeIntent('alpha', nodes(), p)).verdict.kind).toBe('move');
    expect(counts).toEqual({ id: 2, score: 2, length: 1 });
  });
  it('refuses oversized output before reading any row', async () => {
    const raw = new Proxy([], { get(_target, key) { if (key === 'length') return 1_000_000; throw Error('row read'); } });
    const p = port(); p.scorer.score = () => raw;
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(unmatched);
  });
  it.each([NaN, Infinity, -Infinity, -0])('retains raw numeric evidence %s', async value => {
    const p = port(); p.scorer.score = () => [{ id: 'a', score: value }, { id: 'b', score: 1 }];
    p.decide = rows => ({ ...decision(rows), kind: 'move', to: 'b' });
    const answer = await routeIntent('alpha', nodes(), p);
    expect(Object.is(answer.verdict.ranked[0]!.score, value)).toBe(true);
  });
  it.each(['sync', 'deferred'] as const)('captures callback facts and owned node data (%s)', async delivery => {
    const input = nodes(); const p = port(); const raw = scores();
    let release!: (rows: RouteScore[]) => void;
    p.scorer.score = (_phrase, candidates, signal) => {
      expect(signal?.aborted).toBe(false);
      (candidates[0]!.examples as string[])[0] = 'foreign';
      if (delivery === 'sync') {
        queueMicrotask(() => { raw[0] = { id: 'ghost', score: 99 }; });
        return raw;
      }
      return new Promise(resolve => { release = resolve; });
    };
    const controller = new AbortController();
    const pending = routeIntent('alpha', input, p, { signal: controller.signal });
    Reflect.set(input[0]!, 'kinds', ['interval']); Reflect.set(input[0]!, 'examples', ['changed']);
    Reflect.set(p.scorer, 'name', 'changed'); Reflect.set(p, 'policy', { nearTieMargin: 9, menuSize: 99 });
    p.decide = () => { throw Error('replaced late'); };
    if (delivery === 'deferred') release(raw);
    const answer = await pending;
    expect(answer.scorer).toBe('fixture');
    expect(answer.policy).toEqual({ nearTieMargin: 0.15, menuSize: 3 });
    expect(answer.nodes[0]).toEqual({ id: 'a', viewId: 'a', kinds: ['point'], does: 'alpha', examples: ['choose alpha'] });
    expect(answer.verdict.kind).toBe('move');
  });
  it('forwards cancellation without inventing completion or a retry', async () => {
    const p = port(); const controller = new AbortController(); let called = 0;
    let reject!: (reason: unknown) => void;
    p.scorer.score = (_phrase, _candidates, signal) => {
      called++; expect(signal).toBe(controller.signal);
      return new Promise((_resolve, fail) => { reject = fail; });
    };
    const pending = routeIntent('alpha', nodes(), p, { signal: controller.signal });
    controller.abort(); reject(controller.signal.reason);
    expect((await pending).verdict).toEqual(unmatched);
    expect(called).toBe(1);
  });
  it('contains synchronous failures too', async () => {
    const p = port(); p.scorer.score = () => { throw Error('scorer failed'); };
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(unmatched);
  });
  it('ignores mutations to callback copies when the returned IDs still match', async () => {
    const p = port(); p.scorer.score = (_phrase, candidates) => {
      Reflect.set(candidates[0]!, 'id', 'ghost'); Reflect.set(candidates[0]!, 'text', 'foreign');
      return scores();
    };
    const answer = await routeIntent('alpha', nodes(), p);
    expect(answer.verdict).toEqual(decision());
    expect(answer.nodes[0]!.id).toBe('a');
  });
});
