/**
 * MATERIALIZE — write the default rule out as edges, then let declared edges
 * override. The result is the ONE graph everybody reads: no rule stays
 * implicit, and a declared `none` is visibly different from an edge that was
 * never written (which, under default `none`, is a silence).
 *
 * Evaluation order is the edge order here: default edges in view order, then
 * declared edges replace the default edge with the same (source, kind, target)
 * IN PLACE — so a declared edge keeps the position the default gave it, and
 * declared edges with no default counterpart append in declaration order.
 */
import { ENCODING_KIND, edgeId, type ChannelPair, type LinkDecl, type LinkDefault, type LinkEdge, type LinkGraph, type LinkView } from './types.js';

/** The channel pairs an encoding edge follows when the author states none: every channel both ends declare, by the same name. */
export function defaultChannelPairs(source: LinkView | undefined, target: LinkView | undefined): readonly ChannelPair[] {
  const targetChannels = new Set(target?.channels ?? []);
  return (source?.channels ?? []).filter((c) => targetChannels.has(c)).map((c) => ({ from: c, to: c }));
}

/** A declared edge written out in full: an encoding edge always states its channel pairs. */
function writtenOut(decl: LinkDecl, views: readonly LinkView[]): LinkDecl {
  if (decl.kind !== ENCODING_KIND || decl.channels !== undefined) return decl;
  const byId = new Map(views.map((v) => [v.viewId, v] as const));
  return { ...decl, channels: defaultChannelPairs(byId.get(decl.source), byId.get(decl.target)) };
}

export function materializeLinks(views: readonly LinkView[], declared: readonly LinkDecl[] = [], defaultRule: LinkDefault = 'crossfilter'): LinkGraph {
  const edges: LinkEdge[] = [];
  if (defaultRule === 'crossfilter') {
    for (const source of views) {
      for (const kind of source.voice) {
        if (kind === ENCODING_KIND) continue; // no default encoding edge: absent is a silence (law 1, amended)
        for (const target of views) {
          if (target.viewId === source.viewId) continue; // self excluded — the one cycle-breaker
          edges.push({ id: edgeId(source.viewId, kind, target.viewId), source: source.viewId, kind, target: target.viewId, response: 'filter', origin: 'default' });
        }
      }
    }
  }
  for (const raw of declared) {
    const decl = writtenOut(raw, views);
    const edge: LinkEdge = { ...decl, id: edgeId(decl.source, decl.kind, decl.target), origin: 'declared' };
    const at = edges.findIndex((e) => e.id === edge.id);
    if (at >= 0) edges[at] = edge;
    else edges.push(edge);
  }
  return { default: defaultRule, views, edges };
}

/**
 * The graph at the cursor: the materialized base with the session's `link`
 * commits folded over it (one override per edge id, last-wins). An override
 * replaces its base edge IN PLACE (same evaluation position) or appends when
 * the base had none (a declared `none` default); its origin is `edited`.
 */
export function applyLinkOverrides(base: LinkGraph, overrides: ReadonlyMap<string, LinkDecl>): LinkGraph {
  if (overrides.size === 0) return base;
  const edges = [...base.edges];
  for (const [id, raw] of overrides) {
    const edge: LinkEdge = { ...writtenOut(raw, base.views), id, origin: 'edited' };
    const at = edges.findIndex((e) => e.id === id);
    if (at >= 0) edges[at] = edge;
    else edges.push(edge);
  }
  return { ...base, edges };
}

/** The edges INTO a target view — what that view listens to. */
export function edgesInto(graph: LinkGraph, target: string): readonly LinkEdge[] {
  return graph.edges.filter((e) => e.target === target);
}

/** The edges OUT of a source view — what that view drives. */
export function edgesFrom(graph: LinkGraph, source: string): readonly LinkEdge[] {
  return graph.edges.filter((e) => e.source === source);
}
