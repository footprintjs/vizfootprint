import { describe, expect, it } from 'vitest';
import { routeIntent } from '../route.js';
import type { RouteDecision, RoutePort, RouteScore } from './types.js';
import { nodes, scores, unmatched } from './route.fixture.js';

/** A genuine admitted Promise subtype; producer mutation follows observer return. */
class AfterDeliveryPromise<T> extends Promise<T> {
  constructor(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void,
    private readonly after?: (value: T) => void) { super(executor); }
  override then<TResult1 = T, TResult2 = never>(
    fulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return super.then<TResult1, TResult2>(fulfilled == null ? fulfilled : value => {
      const result = fulfilled(value); this.after?.(value); return result;
    }, rejected);
  }
}
const decide = (rows: readonly RouteScore[]): RouteDecision => ({
  kind: 'move', to: rows[0]!.score === 1 ? 'a' : 'b', decisive: true,
  ranked: rows.map(({ id, score }) => ({ id, score, relevance: 0.5 })),
});
const port = (score: RoutePort['scorer']['score']): RoutePort => ({
  scorer: { name: 'delivery-fixture', score }, policy: { nearTieMargin: 0.15, menuSize: 3 }, decide,
});
const expectFirst = async (p: RoutePort, value = 1) => {
  const answer = await routeIntent('alpha', nodes(), p);
  expect(answer.verdict).toEqual(decide([{ id: 'a', score: value }, { id: 'b', score: 0 }]));
};

describe('score delivery custody', () => {
  it('captures a synchronous array before queued mutation', async () => {
    await expectFirst(port(() => {
      const rows = scores(); queueMicrotask(() => { Reflect.set(rows[0]!, 'score', 99); }); return rows;
    }));
  });
  it('captures an admitted Promise subclass before post-delivery mutation', async () => {
    const trace: number[] = [];
    // No cast: this subtype satisfies the exact public scorer signature.
    const admitted: RoutePort['scorer']['score'] = () => {
      const rows = scores();
      return new AfterDeliveryPromise<readonly RouteScore[]>(resolve => resolve(rows), delivered => {
        trace.push(delivered[0]!.score); Reflect.set(rows[0]!, 'score', 99);
      });
    };
    await expectFirst(port(admitted));
    expect(trace).toEqual([1]);
  });
  it('matches a snapshot inside the foreign observer control', async () => {
    await expectFirst(port(() => {
      const rows = scores();
      const pending = new AfterDeliveryPromise<readonly RouteScore[]>(resolve => resolve(rows), () => { Reflect.set(rows[0]!, 'score', 99); });
      return new Promise<readonly RouteScore[]>((resolve, reject) => { pending.then(value => resolve(value.map(({ id, score }) => ({ id, score }))), reject); });
    }));
  });
  it('preserves the equivalent decision-subclass boundary', async () => {
    const p = port(scores);
    p.decide = rows => {
      const raw = decide(rows);
      return new AfterDeliveryPromise<RouteDecision>(resolve => resolve(raw), () => { Reflect.set(raw, 'to', 'b'); Reflect.set(raw.ranked[0]!, 'score', 99); });
    };
    await expectFirst(p);
  });
  it('sees native mutation that precedes actual observer delivery', async () => {
    const observed: number[] = [];
    await expectFirst(port(() => {
      const rows = scores(); const pending = Promise.resolve(rows);
      queueMicrotask(() => { Reflect.set(rows[0]!, 'score', 99); });
      pending.then(value => { observed.push(value[0]!.score); });
      return pending;
    }), 99);
    expect(observed).toEqual([99]);
  });
  it('ignores an unrelated throwing then getter on a synchronous array', async () => {
    let reads = 0;
    await expectFirst(port(() => {
      const rows = scores(); Object.defineProperty(rows, 'then', { get() { reads++; throw Error('array then'); } }); return rows;
    }));
    expect(reads).toBe(0);
  });
  it('does not re-assimilate a native Promise array fulfilled before a then getter was added', async () => {
    let reads = 0;
    await expectFirst(port(() => {
      const rows = scores(); const pending = Promise.resolve(rows);
      Object.defineProperty(rows, 'then', { get() { reads++; throw Error('late array then'); } }); return pending;
    }));
    expect(reads).toBe(0);
  });
  it('contains native initial-resolution failure from an array then getter', async () => {
    let reads = 0;
    const answer = await routeIntent('alpha', nodes(), port(() => {
      const rows = scores(); Object.defineProperty(rows, 'then', { get() { reads++; throw Error('initial array then'); } }); return Promise.resolve(rows);
    }));
    expect(answer.verdict).toEqual(unmatched);
    expect(reads).toBe(1);
  });
  it('captures an admitted fulfilled subclass array without re-assimilating its then getter', async () => {
    let reads = 0; const observed: number[] = [];
    await expectFirst(port(() => {
      const rows = scores();
      const pending = new AfterDeliveryPromise<readonly RouteScore[]>(resolve => resolve(rows));
      Object.defineProperty(rows, 'then', { get() { reads++; throw Error('delivered array then'); } });
      pending.then(value => { observed.push(value[0]!.score); });
      return pending;
    }));
    expect(observed).toEqual([1]);
    expect(reads).toBe(0);
  });
});
