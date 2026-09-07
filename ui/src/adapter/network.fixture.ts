/**
 * The two-table fixture — a node-link over `nodes` and `edges`, ONE view
 * (`net`) with two layers, each its own table. Shared by the adapter, the
 * contract and the conformance suites (a `.fixture.ts`, the studio's
 * pattern; vitest ignores it). `nodes` declares a key and three roles;
 * `edges` declares three of its own — so a column of one is a refusal on
 * the other, which is what every layer test leans on.
 */
import { buildDashboard, type LayerDecl } from 'vizfootprint/agent';
import type { CapabilityDecl, RelationDecl } from 'vizfootprint/def';
import { createSessionView, sessionSource, type SessionView } from './sessionView.js';

export const NODES = [
  { id: 'flu', size: 12, group: 'viral' },
  { id: 'cold', size: 7, group: 'viral' },
  { id: 'strep', size: 3, group: 'bacterial' },
];
export const EDGES = [
  { source: 'flu', target: 'cold', weight: 5 },
  { source: 'cold', target: 'strep', weight: 1 },
];

/**
 * What makes this fixture WALKABLE (protocol 1.3): the two relations that say
 * `edges` is an edge table over `nodes`, and the capability that DECLARES the
 * walk — a neighbourhood is never assumed, so a view that does not say it
 * walks is refused in a sentence. Handed in through `extra` so every def that
 * does not ask for them is byte-identical to the one before they existed.
 */
export const NETWORK_RELATIONS: readonly RelationDecl[] = [
  { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' }, label: 'one end of the tie' },
  { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'id' }, label: 'the other end' },
];

/** The frame's voice, which is every layer's voice (a layer answers with its view's capability). */
export const NETWORK_CAPABILITIES: readonly CapabilityDecl[] = [
  { viewId: 'net', canProbe: true, encodings: ['point', 'match', 'neighbourhood'] },
];

/** Everything a walk needs, as one spread: `networkDashboard(WALKABLE)`. */
export const WALKABLE = { relations: NETWORK_RELATIONS, capabilities: NETWORK_CAPABILITIES } as const;

export const nodesLayer: LayerDecl = { layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y', 'size', 'color'], initial: { size: 'size', color: 'group' }, label: 'Diseases' };
export const edgesLayer: LayerDecl = { layerId: 'edges', table: 'edges', chartKind: 'line', channels: ['x', 'y', 'size'], initial: { size: 'weight' } };

/** A fresh dashboard each call: two tables, the `net` view with its two layers, `nodes` as the default table. `extra` lays over the top level (see {@link WALKABLE}). */
export function networkDashboard(extra: Record<string, unknown> = {}): ReturnType<typeof buildDashboard> {
  return buildDashboard({
    meta: { title: 'a node-link' },
    data: {
      nodes: { rows: NODES, key: 'id', columns: { id: { role: 'identifier' }, size: { role: 'measure' }, group: { role: 'dimension' } } },
      edges: { rows: EDGES, columns: { source: { role: 'dimension' }, target: { role: 'dimension' }, weight: { role: 'measure' } } },
    },
    actors: { net: { actor: 'user', label: 'Disease network' } },
    encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'], layers: [nodesLayer, edgesLayer] }],
    defaultTable: 'nodes',
    ...extra,
  });
}

/** A REAL session over the network dashboard, behind the adapter's store, refreshed once. */
export async function buildNetworkFixture(extra: Record<string, unknown> = {}): Promise<{ session: ReturnType<ReturnType<typeof buildDashboard>['createSession']>; view: SessionView }> {
  const session = networkDashboard(extra).createSession({ as: 'user' });
  const view = createSessionView(sessionSource(session), { as: 'user' });
  await view.refresh();
  return { session, view };
}
