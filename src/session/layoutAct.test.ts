/**
 * A LAYOUT IS AN ACT — the end of the road for `src/analysis/layout.ts`.
 *
 * The unit suite proves the arithmetic; this proves the claim the arithmetic
 * was written for: a layout declared as a RECORD lands `x` and `y` on the nodes
 * table at its own slot, a replay rebuilds the same numbers from the log's
 * bytes, and a second layout act reads the first act's positions through the
 * ordinary derived-column path and leaves them where they were.
 *
 * The laws are `../analysis/README.md` ("The layout: a position is data"),
 * `../def/README.md` law 6 (the relation is the permission) and `./README.md`
 * law 6 (the log records acts; column values are recomputed on replay).
 */

import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef, RelationDecl } from '../def/index.js';
import { makeNetworkDef } from '../def/network.fixture.js';

/** `edges.source → nodes.id` and `edges.target → nodes.id` — the permission to read the ties. */
const RELATIONS: readonly RelationDecl[] = [
  { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' } },
  { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'id' } },
];

/** Few passes: this suite is about where the numbers LAND, not how good they are. */
const MAP = { builtin: 'layout', algo: 'stress', table: 'nodes', edges: 'edges', seed: 5, iterations: 6 } as const;

const netWith = (extra: Partial<DashboardDef>): DashboardDef => makeNetworkDef(undefined, extra);
const sessionOn = (def: DashboardDef) => buildDashboard(def).createSession();
const mapped = (): DashboardDef => netWith({ relations: RELATIONS, analyses: { map: { ...MAP } } });

/** The positions as they now stand, in node order. */
async function positionsOn(s: ReturnType<typeof sessionOn>): Promise<{ x: unknown; y: unknown }[]> {
  const res = await s.viewQuery({ columns: ['id', 'x', 'y'], limit: 20 });
  return res.ok ? res.rows.map((r) => ({ x: r['x'], y: r['y'] })) : [{ x: `REJECTED: ${res.rejected}`, y: '' }];
}

describe('a declared layout lands positions on the nodes table', () => {
  it('writes x and y, one value per node, at the act’s own slot', async () => {
    const s = sessionOn(mapped());
    const out = await s.declareAnalysis('map');
    expect(out.gap).toBeUndefined();
    expect(out.materialized).toEqual(['x', 'y']);
    const placed = await positionsOn(s);
    expect(placed).toHaveLength(3);
    for (const p of placed) {
      expect(Number.isFinite(p.x as number)).toBe(true);
      expect(Number.isFinite(p.y as number)).toBe(true);
    }
    // the graph is in the picture: flu—cold are tied, flu—strep are two hops apart
    const gap = (a: number, b: number): number =>
      Math.hypot((placed[a]!.x as number) - (placed[b]!.x as number), (placed[a]!.y as number) - (placed[b]!.y as number));
    expect(gap(0, 1)).toBeLessThan(gap(0, 2));
  });

  it('the act carries the record that made it — a layout is data all the way down', async () => {
    const s = sessionOn(mapped());
    await s.declareAnalysis('map');
    const record = s.log.records.at(-1)!;
    expect(record.value).toMatchObject({ id: 'map', table: 'nodes', def: { builtin: 'layout', algo: 'stress', seed: 5 } });
  });

  it('without a declared relation the act does not happen, and the sentence says what to declare', async () => {
    const s = sessionOn(netWith({ analyses: { map: { ...MAP } } })); // no relations
    const out = await s.declareAnalysis('map');
    expect(out.commit).toBeUndefined();
    expect(out.gap!.detail).toBe('analysis "map" reads table "edges", which no declared relation joins to "nodes" — declare the relation first');
    expect(s.log.records).toHaveLength(0);
  });
});

describe('the same seed and the same rows give the same picture, wherever it is rebuilt', () => {
  it('two sessions on one definition land byte-identical positions', async () => {
    const first = sessionOn(mapped());
    const second = sessionOn(mapped());
    await first.declareAnalysis('map');
    await second.declareAnalysis('map');
    expect(await positionsOn(second)).toEqual(await positionsOn(first));
  });

  it('REPLAY: the log alone rebuilds the positions, with nothing registered first', async () => {
    const source = sessionOn(mapped());
    await source.declareAnalysis('map');
    const placed = await positionsOn(source);

    // the replaying session declares NO analyses: the record rides on the act
    const fresh = sessionOn(netWith({ relations: RELATIONS }));
    const res = await fresh.replay(JSON.stringify(source.log.records));
    expect(res).toMatchObject({ ok: true, landed: 1, reran: 1, filed: 0 });
    expect(await positionsOn(fresh)).toEqual(placed);
  });
});

describe('the mental map holds across two acts', () => {
  it('a second layout leaves every node that already had a position exactly where it was', async () => {
    const s = sessionOn(mapped());
    await s.declareAnalysis('map');
    const before = await positionsOn(s);
    // a second act, over rows that now carry the first act's x and y at the cursor
    const again = await s.declareAnalysis('map');
    expect(again.materialized).toEqual(['x', 'y']);
    expect(await positionsOn(s)).toEqual(before);
  });
});
