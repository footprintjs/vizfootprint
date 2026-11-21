/** Required-port behavior, including the old body's red-first counterexamples. */
import { describe, expect, it } from 'vitest';
import { routeIntent } from './route.js';
import type { RouteNode, RouteVerdict } from './route.js';

const nodes: RouteNode[] = [
  { id: 'a', viewId: 'a', kinds: ['point'], does: 'alpha apples' },
  { id: 'b', viewId: 'b', kinds: ['interval'], does: 'beta oranges' },
];
const policy = { nearTieMargin: 0.15, menuSize: 3 };
const unmatched = { kind: 'unmatched', ranked: [], decisive: false };
// Reflect.apply intentionally exercises the runtime boundary, including calls
// whose missing or malformed argument cannot be authored through the new types.
const invoke = (port?: unknown) => Reflect.apply(routeIntent, undefined, ['alpha apples', nodes, port]) as Promise<RouteVerdict>;

describe('required routing port', () => {
  it('names the required port rather than silently choosing a scorer', async () => {
    await expect(invoke()).rejects.toThrow(/routing port/i);
  });

  it('passes the phrase to the supplied scorer and uses its supplied decision', async () => {
    const seen: unknown[] = [];
    const port = {
      policy,
      scorer: { name: 'consumer', score: (phrase: string) => {
        seen.push(phrase);
        return [{ id: 'a', score: 1 }, { id: 'b', score: 0 }];
      } },
      decide: () => ({ kind: 'stay', ranked: [{ id: 'a', score: 1, relevance: 1 }, { id: 'b', score: 0, relevance: 0 }], decisive: true }),
    };
    const answer = await invoke(port);
    expect(seen).toEqual(['alpha apples']);
    expect(answer.verdict.kind).toBe('stay');
    expect(answer.scorer).toBe('consumer');
  });

  it('refuses non-number scores before any decision is called', async () => {
    let decisions = 0;
    const answer = await invoke({ policy, scorer: { name: 'broken-number', score: () => [{ id: 'a', score: 'wrong' }, { id: 'b', score: 1 }] },
      decide: () => { decisions++; return unmatched; } });
    expect(answer.verdict).toEqual(unmatched);
    expect(decisions).toBe(0);
  });

  it('validates against owned candidates when a scorer rewrites the copy it receives', async () => {
    const answer = await invoke({ policy, scorer: { name: 'mutating', score: (_phrase: string, candidates: { id: string }[]) => {
      candidates[0]!.id = 'ghost';
      return [{ id: 'ghost', score: 1 }, { id: 'b', score: 0 }];
    } }, decide: () => unmatched });
    expect(answer.verdict).toEqual(unmatched);
    expect(nodes[0]!.id).toBe('a');
  });

  it('captures the scorer label before foreign code can replace it', async () => {
    const scorer = { name: 'original', score: () => {
      scorer.name = 'changed';
      return [{ id: 'a', score: 1 }, { id: 'b', score: 0 }];
    } };
    const answer = await invoke({ policy, scorer, decide: () => ({ kind: 'move', to: 'a', ranked: [{ id: 'a', score: 1, relevance: 1 }, { id: 'b', score: 0, relevance: 0 }], decisive: true }) });
    expect(answer.scorer).toBe('original');
  });
});
