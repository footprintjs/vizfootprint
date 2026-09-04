/**
 * Which gestures REACH a view, and what they are called by the time they get
 * there — the engine-side twin of the renderer's crossfilter law.
 *
 * A view is never filtered by the whole live selection. It is filtered by the
 * clauses that travel to it along the link graph: its own excluded, each edge's
 * `response` carried along, each edge's field `mapping` applied so the clause
 * arrives speaking the consumer's names, and a source that CLEARED still
 * reaching it when the edge's `onClear` says it should. Four rules, and every
 * one of them is a rule about the GRAPH — none of them is about the session.
 *
 * So they are a function of (the graph, the live clauses, the cleared ones) and
 * they live here. That matters more than the line count: `ui/src/contract`
 * enforces the same law over the same edges for the renderer, and
 * [`../../ui/src/adapter/README.md`](../../ui/src/adapter/README.md)'s third law
 * is precisely about what happens when a rule the library knows is restated by
 * a consumer instead of asked for. A rule that is a function is a rule that can
 * be handed over; a rule that is a private method is one the next consumer will
 * write again.
 *
 * **The one thing to know before changing it**: the consumer gets its OWN copy
 * of every clause. The session is still holding those objects and will fold
 * more acts into them, so handing out the live one is the leak
 * [`../detach/README.md`](../detach/README.md) exists to prevent — and a
 * mapping REWRITES field names, which would corrupt the session's own fold if
 * it were done in place.
 */
import { copyClause } from './wire.js';
import type { LinkEdge, LinkGraph } from '../links/index.js';
import type { PredicateClause } from '../data/index.js';
import type { ReachingClause } from './types.js';

/** A view whose last selection was CLEARED, with what it was and the clearing commit. */
export interface ClearedSelection {
  readonly clause: PredicateClause;
  readonly clearedBy: string;
}

/**
 * The clauses that reach `viewId` under `graph` — its own excluded, each edge's
 * response and mapping applied, a cleared source honoured per its `onClear`.
 * Cleared sources are listed first, then the live ones, which is the order the
 * caller's own maps produce and the order a consumer reads them in.
 */
export function clausesReaching(input: {
  readonly viewId: string;
  readonly graph: LinkGraph;
  readonly live: ReadonlyMap<string, PredicateClause>;
  readonly cleared: ReadonlyMap<string, ClearedSelection>;
}): ReachingClause[] {
  const { viewId, graph, live, cleared } = input;
  // one lookup per (source, kind) INTO this consumer — the same law the renderer contract applies (ui/src/contract/selection.ts)
  const into = new Map<string, LinkEdge>();
  for (const e of graph.edges) if (e.target === viewId) into.set(`${e.source}|${e.kind}`, e);
  const reaches = (from: string, kind: string): LinkEdge | undefined => {
    if (from === viewId) return undefined; // never its own clause
    const edge = into.get(`${from}|${kind}`);
    // an encoding edge never matches a clause's kind, so `follow` cannot reach here; the guard keeps the type honest
    return edge === undefined || edge.response === 'none' || edge.response === 'follow' ? undefined : edge;
  };
  // the consumer gets its own copy: a clause handed out is never the session's live object
  const mapped = (edge: LinkEdge, clause: PredicateClause): PredicateClause => {
    const own = copyClause(clause);
    if (edge.mapping === undefined) return own;
    const to = (f: string): string => edge.mapping!.find((m) => m.from === f)?.to ?? f;
    return own.kind === 'cell' ? { ...own, fields: [to(own.fields[0]), to(own.fields[1])] } : { ...own, field: to(own.field) };
  };
  const out: ReachingClause[] = [];
  // a source that CLEARED still reaches a consumer whose edge says so: `leave` keeps the last clause, `excludeAll` keeps nothing, `showAll` (the default) = gone
  for (const [from, rec] of cleared) {
    /* v8 ignore next -- every select door drops the view's cleared record when a live clause lands, so the two maps are disjoint; the guard enforces here what the doors maintain */
    if (live.has(from)) continue; // it is selecting again — the live clause speaks, and it is listed once
    const edge = reaches(from, rec.clause.kind);
    if (edge === undefined) continue;
    const policy = edge.onClear ?? 'showAll';
    if (policy === 'showAll') continue;
    const clause = mapped(edge, rec.clause);
    out.push({ from, response: edge.response, clause: policy === 'leave' ? clause : { kind: 'match', field: clause.kind === 'cell' ? clause.fields[0] : clause.field, values: [] } });
  }
  for (const [from, clause] of live) {
    const edge = reaches(from, clause.kind);
    if (edge === undefined) continue;
    out.push({ from, response: edge.response, clause: mapped(edge, clause) });
  }
  return out;
}

/**
 * The field mappings on the edges INTO a view (none for the whole-dashboard
 * truth): which names a link INVENTED for this consumer. Read only when the
 * engine has refused an unknown column — a name nothing declared is very often
 * a mapping's doing, and a refusal that does not say so leaves a person hunting
 * for a column that never existed.
 */
export function mappingsInto(graph: LinkGraph, viewId: string | undefined): readonly { readonly from: string; readonly field: string; readonly to: string }[] {
  if (viewId === undefined) return [];
  const out: { from: string; field: string; to: string }[] = [];
  for (const e of graph.edges) {
    if (e.target !== viewId || e.mapping === undefined) continue;
    for (const m of e.mapping) out.push({ from: e.source, field: m.from, to: m.to }); // an identity pair names a real column and is never picked as invented
  }
  return out;
}
