/**
 * The two-table fixture — a node-link over `nodes` and `edges`, ONE view
 * (`net`) with two layers, each its own table. Shared by the adapter, the
 * contract and the conformance suites (a `.fixture.ts`, the studio's
 * pattern; vitest ignores it). `nodes` declares a key and three roles;
 * `edges` declares three of its own — so a column of one is a refusal on
 * the other, which is what every layer test leans on.
 */
import { buildDashboard, type LayerDecl } from 'vizfootprint/agent';
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

export const nodesLayer: LayerDecl = { layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y', 'size', 'color'], initial: { size: 'size', color: 'group' }, label: 'Diseases' };
export const edgesLayer: LayerDecl = { layerId: 'edges', table: 'edges', chartKind: 'line', channels: ['x', 'y', 'size'], initial: { size: 'weight' } };

/** A fresh dashboard each call: two tables, the `net` view with its two layers, `nodes` as the default table. */
export function networkDashboard(): ReturnType<typeof buildDashboard> {
  return buildDashboard({
    meta: { title: 'a node-link' },
    data: {
      nodes: { rows: NODES, key: 'id', columns: { id: { role: 'identifier' }, size: { role: 'measure' }, group: { role: 'dimension' } } },
      edges: { rows: EDGES, columns: { source: { role: 'dimension' }, target: { role: 'dimension' }, weight: { role: 'measure' } } },
    },
    actors: { net: { actor: 'user', label: 'Disease network' } },
    encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'], layers: [nodesLayer, edgesLayer] }],
    defaultTable: 'nodes',
  });
}

/** A REAL session over the network dashboard, behind the adapter's store, refreshed once. */
export async function buildNetworkFixture(): Promise<{ session: ReturnType<ReturnType<typeof buildDashboard>['createSession']>; view: SessionView }> {
  const session = networkDashboard().createSession({ as: 'user' });
  const view = createSessionView(sessionSource(session), { as: 'user' });
  await view.refresh();
  return { session, view };
}
