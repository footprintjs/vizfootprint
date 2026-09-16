// @vitest-environment node
/**
 * THE MAP'S REFUSALS REACH THE COCKPIT — `LinkGraphView.declined`.
 *
 * `src/links/materialize.ts` records every default edge the reach law declined
 * and the sentence `unreachableWords` composes for it; the overview serves the
 * list and, until this packet, the projection dropped it — so a cockpit could
 * watch a brush reach nothing at a chart and had no way to learn the map had
 * declined that edge (omit-never-deny at the map, denied on screen).
 *
 * Law 1 (`./README.md`): the whole fact is copied, off BOTH hosts, and the key
 * stays absent where the wire carries none.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from 'vizfootprint/agent';
import { layerAddress, type RelationDecl } from 'vizfootprint/def';
import { createSessionView, mapPollState, sessionSource, type RawPollState, type SessionView } from './sessionView.js';
import { EDGES, NETWORK_RELATIONS, NODES, edgesLayer } from './network.fixture.js';

const TIES_AT = layerAddress('ties', 'edges');

/**
 * TWO PLACES NOTHING JOINS, as a real session: a bar over the default table
 * `nodes` and a chart whose one layer reads `edges`. Both column lists are
 * declared and no relation joins the two tables, so the reach law can PROVE
 * every crossfilter edge between them unkeepable — which is the only way to
 * make a real session decline anything (`src/links/reach.ts`, "refuse on
 * evidence, never on ignorance").
 *
 * Handing in a relation flips it: the same two places, now reachable, so the
 * rule mints the edges instead and declines nothing.
 */
async function buildDeclinedFixture(relations: readonly RelationDecl[] = []): Promise<SessionView> {
  const dashboard = buildDashboard({
    meta: { title: 'two places nothing joins' },
    data: {
      nodes: { rows: NODES, key: 'id', columns: { id: { role: 'identifier' }, size: { role: 'measure' }, group: { role: 'dimension' } } },
      edges: { rows: EDGES, columns: { source: { role: 'dimension' }, target: { role: 'dimension' }, weight: { role: 'measure' } } },
    },
    actors: { diseases: { actor: 'user' }, ties: { actor: 'user' } },
    encodings: [
      { viewId: 'diseases', chartKind: 'bar', channels: ['category', 'value'], initial: { category: 'group', value: 'size' } },
      { viewId: 'ties', chartKind: 'network', channels: ['x', 'y'], layers: [edgesLayer] },
    ],
    defaultTable: 'nodes',
    ...(relations.length > 0 ? { relations } : {}),
  });
  const view = createSessionView(sessionSource(dashboard.createSession({ as: 'user' })), { as: 'user' });
  await view.refresh();
  return view;
}

/**
 * `src/links` · `unreachableWords`, written out.
 *
 * The ui has no import of that door, and a pin that re-derived the sentence
 * would pin nothing: these are the words a reader sees, so they are quoted
 * here and the projection is checked against the quote.
 */
const unreachable = (source: string, sourceTable: string, target: string, targetTable: string): string =>
  `view "${source}" draws table "${sourceTable}" and view "${target}" draws table "${targetTable}" — no relation joins those tables and they share no column, so nothing this edge carries could be judged there`;

describe('LinkGraphView.declined — the map\'s refusals, projected', () => {
  it('over a REAL session every declined default edge arrives WHOLE, both ways round, with the map\'s reason verbatim', async () => {
    const view = await buildDeclinedFixture();
    const links = view.getState().links!;

    // nothing joins `nodes` and `edges`, so the rule minted no edge at all…
    expect(links.edges).toEqual([]);
    // …and recorded its refusal once per clause kind the two places voice, in each direction
    expect(links.declined!.map((d) => d.id)).toEqual([
      `diseases:point→${TIES_AT}`,
      `diseases:interval→${TIES_AT}`,
      `diseases:cell→${TIES_AT}`,
      `diseases:match→${TIES_AT}`,
      `${TIES_AT}:point→diseases`,
      `${TIES_AT}:interval→diseases`,
      `${TIES_AT}:cell→diseases`,
      `${TIES_AT}:match→diseases`,
    ]);
    expect(links.declined![0]).toEqual({
      id: `diseases:point→${TIES_AT}`,
      source: 'diseases',
      kind: 'point',
      target: TIES_AT,
      reason: unreachable('diseases', 'nodes', TIES_AT, 'edges'),
    });
    // the sentence names the SOURCE's table first, so the two directions do not read alike
    expect(links.declined!.find((d) => d.id === `${TIES_AT}:point→diseases`)!.reason).toBe(unreachable(TIES_AT, 'edges', 'diseases', 'nodes'));
    // a frame is not a refused edge — `ties` reads no rows of its own, so nothing is declined at its bare address
    expect(links.views.find((v) => v.viewId === 'ties')!.frame).toEqual([TIES_AT]);
    expect(links.declined!.some((d) => d.source === 'ties' || d.target === 'ties')).toBe(false);
  });

  it('the same two places, joined by one declared relation: the rule mints the edges and the key is ABSENT', async () => {
    const view = await buildDeclinedFixture([NETWORK_RELATIONS[0]!]);
    const links = view.getState().links!;
    expect(links.edges).toHaveLength(8);
    // byte-identical to a graph projected before this key existed — absent, never an empty list
    expect('declined' in links).toBe(false);
    expect(JSON.stringify(links)).not.toContain('declined');
  });

  it('the poll mapper carries each entry WHOLE or drops it alone, and never invents a list', () => {
    const good = { id: `spread:interval→${TIES_AT}`, source: 'spread', kind: 'interval', target: TIES_AT, reason: unreachable('spread', 'radii_per_planet', TIES_AT, 'edges') };
    const raw = {
      records: [],
      views: [],
      cursor: null,
      head: null,
      links: {
        default: 'crossfilter',
        views: [],
        edges: [],
        declined: [
          good,
          { ...good, id: undefined }, // no id — not an entry
          { ...good, source: 7 },
          { ...good, target: null },
          { ...good, reason: undefined }, // a refusal with no reason is the one thing this note cannot print
          { ...good, kind: 9 },
          { ...good, kind: 'whisper' }, // a kind this vocabulary does not have
          'nonsense',
          null,
        ],
      },
    } as unknown as RawPollState;
    // the well-formed one stands, by itself, unchanged
    expect(mapPollState(raw).links!.declined).toEqual([good]);

    // a list that is not a list, an empty one and a missing one all leave the key absent
    for (const declined of ['not a list', [], undefined]) {
      const links = mapPollState({ ...raw, links: { default: 'none', views: [], edges: [], declined } } as unknown as RawPollState).links!;
      expect('declined' in links).toBe(false);
    }
    // …and a graph the mapper refuses outright is still refused outright, declines and all
    expect(mapPollState({ ...raw, links: { default: 'crossfilter', views: [], declined: [good] } } as unknown as RawPollState).links).toBeUndefined();
  });
});
