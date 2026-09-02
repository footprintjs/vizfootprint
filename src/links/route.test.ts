/**
 * Routing, read-only: which node would this phrase reach? The kernel decides
 * move / stay / menu / unmatched; a view without a `does` sentence is never a
 * candidate; nothing lands.
 */
import { describe, it, expect } from 'vitest';
import { routeIntent, routeNodes } from './route.js';
import type { LinkView } from './index.js';

const views: LinkView[] = [
  { viewId: 'map', voice: ['point', 'match'] },
  { viewId: 'weeks', voice: ['interval'] },
  { viewId: 'diseases', voice: ['point'] },
  { viewId: 'trend', voice: ['encoding'] },
  { viewId: 'silent', voice: ['point'] },
];
const does = {
  map: 'click a state on the map to select it, shift-click for several',
  weeks: 'brush a range of weeks to narrow the time window',
  diseases: 'pick a disease to focus the dashboard on it',
  trend: "follow one area's weekly trend",
};

describe('routeNodes', () => {
  it('one node per VIEW with a sentence and a voice; an encoding-only view and a silent view are not nodes', () => {
    const nodes = routeNodes(views, does);
    expect(nodes.map((n) => n.id)).toEqual(['map', 'weeks', 'diseases']);
    expect(nodes[0]).toEqual({ id: 'map', viewId: 'map', kinds: ['point', 'match'], does: does.map });
  });
});

describe('routeIntent', () => {
  const nodes = routeNodes(views, does);
  it('a phrase in a node\'s own words moves there; the verdict carries every candidate ranked', async () => {
    const r = await routeIntent('narrow the time window to a range of weeks', nodes);
    expect(r.verdict.kind).toBe('move');
    if (r.verdict.kind === 'move') expect(r.verdict.to).toBe('weeks');
    expect(r.verdict.ranked).toHaveLength(3);
    expect(r.scorer).toBe('keyword');
    expect(r.policy.nearTieMargin).toBeGreaterThan(0);
  });
  it('mid-conversation, a phrase that fits the node we are on says stay; a view with two kinds is ONE node, so the map moves, never a menu of itself', async () => {
    const stay = await routeIntent('narrow the weeks', nodes, { incumbent: 'weeks' });
    expect(stay.verdict.kind).toBe('stay');
    const map = await routeIntent('select a state on the map', nodes);
    expect(map.verdict.kind).toBe('move');
    if (map.verdict.kind === 'move') expect(map.verdict.to).toBe('map');
  });
  it('a scorer that breaks the contract never aborts: honestly unmatched', async () => {
    const broken = { name: 'broken', score: () => [{ id: 'ghost', score: 1 }] };
    const r = await routeIntent('anything', nodes, { scorer: broken });
    expect(r.verdict).toEqual({ kind: 'unmatched', ranked: [], decisive: false });
    expect(r.scorer).toBe('broken');
  });
  it('words that match nothing are unmatched; no nodes = unmatched with nothing ranked', async () => {
    const none = await routeIntent('zebra quartz umbrella', nodes);
    expect(none.verdict.kind).toBe('unmatched');
    const empty = await routeIntent('anything', []);
    expect(empty.verdict).toEqual({ kind: 'unmatched', ranked: [], decisive: false });
  });
});
