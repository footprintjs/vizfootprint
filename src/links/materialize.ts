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
import { ENCODING_KIND, edgeId, type ChannelPair, type DeclinedEdge, type LinkDecl, type LinkDefault, type LinkEdge, type LinkGraph, type LinkView } from './types.js';
import { DEFAULT_FOLD, crossesGrain } from './grain.js';
import { relationPath, unreachableWords, viewsCanReach, type ReachRelation, type TableReach } from './reach.js';
import { deepFreeze } from '../detach/index.js';
import { splitLayerAddress } from '../def/layerAddress.js';

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

/**
 * Two addresses on one FRAME: the same node (self), or a view and its layers,
 * or two layers of one view. WHY no default edge between them: the layers of
 * a node-link already share a canvas — a select on the nodes cannot filter
 * the edges by a nodes column, and the ruling is that nothing crosses between
 * siblings unless declared (../def/README.md, "Layers"). A plain viewId is its
 * own frame, so a graph with no layers is written exactly as before.
 */
function sharesFrame(a: string, b: string): boolean {
  return splitLayerAddress(a).viewId === splitLayerAddress(b).viewId;
}

/**
 * THE FRAME IS ITS LAYERS: a node that reads no rows at its own address
 * (`LinkView.frame` — a layered view with no view-level `initial`, judged once
 * by `../def/layers.ts` · `readsOwnTable`). WHY the default rule mints no edge
 * into OR out of one: a default edge is a promise the engine can keep, and an
 * edge into a frame would hand a clause to an address that draws no table —
 * a clause no fold reads and `why()` would still list; an edge out of one
 * would carry a gesture that can never land there (the session refuses it by
 * name). The layers that read for it are nodes of their own and take the
 * rule as before. A frame is NOT pushed to `declined`: `declined` records an
 * edge the reach law refused between two places that read rows, and a frame
 * is not a refused edge — it is not a node that reads.
 */
function isFrame(view: LinkView): boolean {
  return view.frame !== undefined;
}

/**
 * THE MAP SAYS WHY AN EDGE CROSSES TABLES: `LinkEdge.via` for one edge — the
 * relation path between the two views' tables, or nothing. Asked of every
 * edge written here, whoever asked for it (the default rule, a declaration,
 * a run-time edit), so a reader of the graph meets the same fact on each.
 * Nothing when either table is unstated (nothing to judge), when the two are
 * one table (a view judges its own sentences), or when no relation joins
 * them — a shared column name is not a relation, and the key is absent, so a
 * graph over tables nothing joins is byte-identical to one built before the
 * key existed.
 */
function viaOf(source: LinkView | undefined, target: LinkView | undefined, relations: readonly ReachRelation[] | undefined): { readonly via?: readonly ReachRelation[] } {
  if (relations === undefined || source?.table === undefined || target?.table === undefined || source.table === target.table) return {};
  const via = relationPath(source.table, target.table, relations);
  return via === undefined ? {} : { via };
}

/**
 * @param reach - What the TABLES say about reaching one another (`./reach.ts`).
 *   Handed in rather than read off a def, because this package knows nothing
 *   about definitions. Omitted = nothing is judged, and the default rule mints
 *   the full n² it always did.
 */
export function materializeLinks(views: readonly LinkView[], declared: readonly LinkDecl[] = [], defaultRule: LinkDefault = 'crossfilter', reach?: TableReach): LinkGraph {
  const edges: LinkEdge[] = [];
  const declined: DeclinedEdge[] = [];
  if (defaultRule === 'crossfilter') {
    for (const source of views) {
      for (const kind of source.voice) {
        if (kind === ENCODING_KIND) continue; // no default encoding edge: absent is a silence (law 1, amended)
        for (const target of views) {
          if (sharesFrame(source.viewId, target.viewId)) continue; // self excluded — the one cycle-breaker; and a frame's layers, which are one place
          if (isFrame(source) || isFrame(target)) continue; // a frame reads no rows at its own address — nothing to carry in, nothing to carry out (`isFrame`)
          // A DEFAULT EDGE IS A PROMISE THE ENGINE CAN KEEP: the rule may only
          // mint an edge whose clause could be judged where it lands. Two views
          // over tables no relation joins and no column shares cannot filter one
          // another, and minting the edge anyway hands the target a sentence
          // about columns it does not have. The refusal is RECORDED, not silent.
          if (!viewsCanReach(source, target, reach)) {
            declined.push({ id: edgeId(source.viewId, kind, target.viewId), source: source.viewId, kind, target: target.viewId, reason: unreachableWords(source, target) });
            continue;
          }
          edges.push({
            id: edgeId(source.viewId, kind, target.viewId),
            source: source.viewId,
            kind,
            target: target.viewId,
            response: 'filter',
            origin: 'default',
            // the rule written out states its fold where it crosses grains — never an implicit crossing
            ...(crossesGrain(source, target) ? { fold: DEFAULT_FOLD } : {}),
            // …and WHY it crosses tables, when a declared relation is the reason (`viaOf`)
            ...viaOf(source, target, reach?.relations),
          });
        }
      }
    }
  }
  const byId = new Map(views.map((v) => [v.viewId, v] as const));
  for (const raw of declared) {
    const decl = writtenOut(raw, views);
    // a declared edge over joined tables carries the same `via` a default one would — the map says what is true, not who asked
    const edge: LinkEdge = { ...decl, id: edgeId(decl.source, decl.kind, decl.target), origin: 'declared', ...viaOf(byId.get(decl.source), byId.get(decl.target), reach?.relations) };
    const at = edges.findIndex((e) => e.id === edge.id);
    if (at >= 0) edges[at] = edge;
    else edges.push(edge);
  }
  // The graph is FINISHED here — it is the MAP, and the map is still. Freezing
  // it (rather than copying it on every read) is what lets `applyLinkOverrides`
  // hand back this very object when there is nothing to lay over it: a
  // reference to something nobody can change is a safe thing to hand a reader.
  // `declined` is absent when the reach law refused nothing, so a graph judged by no reach is byte-identical to one built before this law
  return deepFreeze({ default: defaultRule, views, edges, ...(declined.length > 0 ? { declined } : {}) });
}

/**
 * The graph at the cursor: the materialized base with the session's `link`
 * commits folded over it (one override per edge id, last-wins). An override
 * replaces its base edge IN PLACE (same evaluation position) or appends when
 * the base had none (a declared `none` default); its origin is `edited`.
 *
 * @param relations - The declared relations, so an EDITED edge over joined
 *   tables carries the same `via` the base's edges do (`viaOf`): a run-time
 *   edit of an edge's response must not make the map forget why the edge
 *   crosses tables. Omitted = no edited edge carries one, which is every
 *   caller that folds a graph with no relations to judge by.
 */
export function applyLinkOverrides(base: LinkGraph, overrides: ReadonlyMap<string, LinkDecl>, relations?: readonly ReachRelation[]): LinkGraph {
  // DETACHED, both ways out. With no overrides the base is handed back BY
  // REFERENCE — which used to be the bug (a reader pushed a forged edge into
  // what `overview().links` returned, and the next `overview()` reported it
  // as real, with no commit in between). The reference is safe now because the
  // thing referenced is frozen; freezing costs nothing on an already-frozen
  // graph, and the alternative — copying every edge on every read — would be
  // paid on a call that happens several times per gesture.
  if (overrides.size === 0) return deepFreeze(base);
  const edges = [...base.edges];
  const byId = new Map(base.views.map((v) => [v.viewId, v] as const));
  for (const [id, raw] of overrides) {
    const edge: LinkEdge = { ...writtenOut(raw, base.views), id, origin: 'edited', ...viaOf(byId.get(raw.source), byId.get(raw.target), relations) };
    const at = edges.findIndex((e) => e.id === id);
    if (at >= 0) edges[at] = edge;
    else edges.push(edge);
  }
  // only the NEW edges are actually walked: the base's edges are already frozen
  return deepFreeze({ ...base, edges });
}

/** The edges INTO a target view — what that view listens to. */
export function edgesInto(graph: LinkGraph, target: string): readonly LinkEdge[] {
  return graph.edges.filter((e) => e.target === target);
}

/** The edges OUT of a source view — what that view drives. */
export function edgesFrom(graph: LinkGraph, source: string): readonly LinkEdge[] {
  return graph.edges.filter((e) => e.source === source);
}
