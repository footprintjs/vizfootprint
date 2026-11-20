/**
 * ROUTE — which node would this phrase reach? (layer 4, step 5; ruling 7)
 *
 * A node is one (view, emission kind) with the view's `does` sentence as its
 * routing text. The consumer supplies its scorer and decision rule through
 * Viz's own port: the scorer scores every candidate, the decision chooses move,
 * stay, menu or unmatched. Read-only: routing never lands a commit; the act
 * that follows a verdict does, with the verdict's numbers as its evidence.
 *
 * Its own module, NOT in the links barrel (the file-carrier precedent): a
 * host that routes imports `src/links/route` directly. No host package or
 * routing default is loaded by this library.
 */
import type { EmissionKind, LinkView } from './types.js';
import { ENCODING_KIND } from './types.js';
import type { RouteNode, RouteOptions, RoutePort, RouteVerdict } from './route/types.js';
import { candidatesFor, captureNodes, captureOptions, capturePort, copyCandidates } from './route/input.js';
import { captureScores } from './route/scores.js';
import { captureDecisionDelivery, unmatchedDecision } from './route/decision.js';
export type { RouteCandidate, RouteDecision, RouteNode, RouteOptions, RoutePolicy, RoutePort, RouteScore, RouteVerdict, RankedRouteScore } from './route/types.js';

/** The routable nodes of a graph: every view with a `does` sentence and at least one selection kind in its voice. */
export function routeNodes(views: readonly LinkView[], does: Readonly<Record<string, string | undefined>>): RouteNode[] {
  const out: RouteNode[] = [];
  for (const v of views) {
    const sentence = does[v.viewId];
    if (sentence === undefined) continue; // no sentence, no routing — never guess a view's purpose
    const kinds = v.voice.filter((k): k is EmissionKind => k !== ENCODING_KIND);
    if (kinds.length === 0) continue; // a view that emits nothing is not a place an act can go
    out.push({ id: v.viewId, viewId: v.viewId, kinds, does: sentence });
  }
  return out;
}

/** Which node would this phrase reach? Pure over its inputs; never lands a commit. */
export async function routeIntent(phrase: string, nodes: readonly RouteNode[], port: RoutePort, opts: RouteOptions = {}): Promise<RouteVerdict> {
  const options = captureOptions(opts);
  const captured = capturePort(port, options.policy);
  const ownedNodes = captureNodes(nodes);
  const candidates = candidatesFor(ownedNodes);
  const evidence = { scorer: captured.name, policy: captured.policy, nodes: ownedNodes };
  if (candidates.length === 0) return { verdict: unmatchedDecision(), ...evidence };
  try {
    const raw = captured.score(phrase, copyCandidates(candidates), options.signal);
    // A synchronous array is observed before yielding, so a retained reference
    // cannot rewrite the returned facts in a later microtask. Promises are
    // captured when their result is delivered, with no polling or timeout.
    const scores = captureScores(candidates, Array.isArray(raw) ? raw : await raw);
    const result = captured.decide(scores.map(score => ({ ...score })), options.incumbent, { ...captured.policy });
    const delivered = captureDecisionDelivery(result, scores);
    return { verdict: delivered instanceof Promise ? await delivered : delivered, ...evidence };
  } catch {
    // A misbehaving callback cannot invent an action: honestly unmatched,
    // with the scorer and declared policy captured before the foreign call.
    return { verdict: unmatchedDecision(), ...evidence };
  }
}
