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
import { edgeId, type LinkDecl, type LinkDefault, type LinkEdge, type LinkGraph, type LinkView } from './types.js';

export function materializeLinks(views: readonly LinkView[], declared: readonly LinkDecl[] = [], defaultRule: LinkDefault = 'crossfilter'): LinkGraph {
  const edges: LinkEdge[] = [];
  if (defaultRule === 'crossfilter') {
    for (const source of views) {
      for (const kind of source.voice) {
        for (const target of views) {
          if (target.viewId === source.viewId) continue; // self excluded — the one cycle-breaker
          edges.push({ id: edgeId(source.viewId, kind, target.viewId), source: source.viewId, kind, target: target.viewId, response: 'filter', origin: 'default' });
        }
      }
    }
  }
  for (const decl of declared) {
    const edge: LinkEdge = { ...decl, id: edgeId(decl.source, decl.kind, decl.target), origin: 'declared' };
    const at = edges.findIndex((e) => e.id === edge.id);
    if (at >= 0) edges[at] = edge;
    else edges.push(edge);
  }
  return { default: defaultRule, views, edges };
}

/** The edges INTO a target view — what that view listens to. */
export function edgesInto(graph: LinkGraph, target: string): readonly LinkEdge[] {
  return graph.edges.filter((e) => e.target === target);
}

/** The edges OUT of a source view — what that view drives. */
export function edgesFrom(graph: LinkGraph, source: string): readonly LinkEdge[] {
  return graph.edges.filter((e) => e.source === source);
}
