/**
 * The two-layer fixture — a node-link: edges under nodes, each its own table.
 * Shared by the def, links and session suites (a `.fixture.ts`, like
 * `../session/dashboard.fixture.ts`; vitest ignores it, nothing ships it).
 * `nodes` declares a key and three roles; `edges` declares none and three
 * roles of its own — so a column of one table is a refusal on the other.
 */
import type { DashboardDef, LayerDecl } from './types.js';

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

/** A fresh def each call (built-ins re-instantiated so state never leaks between tests); `extra` lays over the top level. */
export function makeNetworkDef(layers: readonly unknown[] = [nodesLayer, edgesLayer], extra: Partial<DashboardDef> = {}): DashboardDef {
  return {
    meta: { title: 'a node-link' },
    data: {
      nodes: { rows: NODES, key: 'id', columns: { id: { role: 'identifier' }, size: { role: 'measure' }, group: { role: 'dimension' } } },
      edges: { rows: EDGES, columns: { source: { role: 'dimension' }, target: { role: 'dimension' }, weight: { role: 'measure' } } },
    },
    actors: { net: { actor: 'user', label: 'Disease network' } },
    encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'], layers: layers as LayerDecl[] }],
    defaultTable: 'nodes',
    ...extra,
  };
}
