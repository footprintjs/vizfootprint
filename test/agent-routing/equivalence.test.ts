import { describe, expect, it } from 'vitest';
import { keywordScorer } from 'agentfootprint/skill-graph';
import type { IntentScorer, RoutingPolicy } from 'agentfootprint/skill-graph';
import { routeIntent, routeNodes } from '../../src/links/route.js';
import type { LinkView } from '../../src/links/index.js';
import { hostPort, oldRouteIntent } from './host.fixture.js';

const graph = {
  views: [{ viewId: 'map', voice: ['point', 'match'] }, { viewId: 'weeks', voice: ['interval'] },
    { viewId: 'diseases', voice: ['point'] }, { viewId: 'trend', voice: ['encoding'] }, { viewId: 'silent', voice: ['point'] }] as LinkView[],
  does: { map: 'click a state on the map to select it, shift-click for several', weeks: 'brush a range of weeks to narrow the time window', diseases: 'pick a disease to focus the dashboard on it', trend: "follow one area's weekly trend" },
};
const encodings = ['object', 'saved-json'] as const;
const decode = <T>(value: T, encoding: typeof encodings[number]): T => encoding === 'object' ? value : JSON.parse(JSON.stringify(value)) as T;

describe.each(encodings)('consumer adapter parity (%s)', encoding => {
  it('keeps every original link fixture and the host keyword rule', async () => {
    const fixture = decode(graph, encoding); const nodes = routeNodes(fixture.views, fixture.does);
    for (const phrase of ['narrow the time window to a range of weeks', 'narrow the weeks', 'select a state on the map', 'zebra quartz umbrella']) {
      for (const incumbent of [undefined, 'weeks']) {
        expect(await routeIntent(phrase, nodes, hostPort(), { incumbent })).toStrictEqual(await oldRouteIntent(phrase, nodes, { incumbent }));
      }
    }
    expect(await routeIntent('anything', [], hostPort())).toStrictEqual(await oldRouteIntent('anything', []));
  });
  it('keeps every verdict kind, scorer trait and policy over generated differences', async () => {
    const fixture = decode(graph, encoding); const nodes = routeNodes(fixture.views, fixture.does);
    const values = [-1, 0, 1, 1.1]; const seen = new Set<string>();
    const traits = [{ floor: 0 }, {}, { categorical: true, floor: 0 }];
    const policies: (Partial<RoutingPolicy> | undefined)[] = [undefined, { nearTieMargin: 0.6, menuSize: 2 }, { floor: 1 }, { floor: undefined }];
    for (const a of values) for (const b of values) for (const c of values) {
      const row = decode([a, b, c], encoding);
      for (const trait of traits) for (const incumbent of [undefined, 'map', 'weeks', 'unscored']) for (const policy of policies) {
        const scorer: IntentScorer = { name: 'table', ...trait, score: (_input, candidates) => candidates.map(({ id }, index) => ({ id, score: row[index]! })).reverse() };
        const result = await routeIntent('table', nodes, hostPort(scorer), { incumbent, policy });
        expect(result).toStrictEqual(await oldRouteIntent('table', nodes, { scorer, incumbent, policy }));
        seen.add(result.verdict.kind);
      }
    }
    expect([...seen].sort()).toEqual(['menu', 'move', 'stay', 'unmatched']);
  });
  it('preserves non-finite NUMBER evidence using symbolic saved values', async () => {
    const symbols = decode(['NaN', '+Infinity', '-Infinity', '-0'] as const, encoding);
    const values = { NaN, '+Infinity': Infinity, '-Infinity': -Infinity, '-0': -0 };
    const fixture = decode(graph, encoding); const nodes = routeNodes(fixture.views, fixture.does);
    for (const symbol of symbols) {
      const scorer: IntentScorer = { name: 'raw-numbers', floor: 0, score: (_input, candidates) => candidates.map(({ id }, index) => ({ id, score: index === 0 ? values[symbol] : index })) };
      const result = await routeIntent('raw', nodes, hostPort(scorer));
      expect(result).toStrictEqual(await oldRouteIntent('raw', nodes, { scorer }));
      expect(Object.is(result.verdict.ranked.find(row => row.id === 'map')!.score, values[symbol])).toBe(true);
    }
  });
  it('preserves ID/cardinality refusals and explicitly corrects non-number admission', async () => {
    const fixture = decode(graph, encoding); const nodes = routeNodes(fixture.views, fixture.does);
    for (const kind of ['foreign', 'missing', 'duplicate']) {
      const scorer: IntentScorer = { name: kind, score: (_input, candidates) => {
        const rows = candidates.map(({ id }) => ({ id, score: 1 }));
        if (kind === 'foreign') rows[0]!.id = 'ghost';
        if (kind === 'missing') rows.pop();
        if (kind === 'duplicate') rows[1]!.id = rows[0]!.id;
        return rows;
      } };
      expect(await routeIntent('bad', nodes, hostPort(scorer))).toStrictEqual(await oldRouteIntent('bad', nodes, { scorer }));
    }
    for (const score of ['1', undefined, null]) {
      const scorer = { name: 'non-number', floor: 0, score: () => [{ id: 'map', score }, { id: 'weeks', score: 1 }, { id: 'diseases', score: 0 }] } as unknown as IntentScorer;
      const before = await oldRouteIntent('bad', nodes, { scorer });
      const after = await routeIntent('bad', nodes, hostPort(scorer));
      expect(before.verdict.ranked).toHaveLength(3);
      expect(after.verdict).toEqual({ kind: 'unmatched', ranked: [], decisive: false });
    }
  });
  it('preserves the adapter signal and keyword scorer floor', async () => {
    const controller = new AbortController(); const scorer = keywordScorer();
    const fixture = decode(graph, encoding); const nodes = routeNodes(fixture.views, fixture.does);
    expect(await routeIntent('nothing matches this', nodes, hostPort(scorer), { signal: controller.signal })).toStrictEqual(await oldRouteIntent('nothing matches this', nodes, { scorer, signal: controller.signal }));
  });
});
