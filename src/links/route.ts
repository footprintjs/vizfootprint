/**
 * ROUTE — which node would this phrase reach? (layer 4, step 5; ruling 7)
 *
 * A node is one (view, emission kind) with the view's `does` sentence as its
 * routing text. The scorer and the verdict are agentfootprint's skill-graph
 * kernel, reused as-is (ruling 9: the kernel stays in one place): the scorer
 * scores every candidate, the framework — not the scorer — decides move,
 * stay, menu or unmatched. Read-only: routing never lands a commit; the act
 * that follows a verdict does, with the verdict's numbers as its evidence.
 *
 * Its own module, NOT in the links barrel (the file-carrier precedent): it
 * imports agentfootprint's skill-graph door, and the ui package bundles the
 * core — a host that routes imports `src/links/route` directly.
 */
import { DEFAULT_ROUTING_POLICY, decideTier2, keywordScorer, validateIntentScores } from 'agentfootprint/skill-graph';
import type { IntentCandidate, IntentScorer, RoutingPolicy, Tier2Verdict } from 'agentfootprint/skill-graph';
import type { EmissionKind, LinkView } from './types.js';
import { ENCODING_KIND } from './types.js';

/** One routable node: a VIEW, named by its `does` sentence; which emission kind the act uses is the act's own choice among `kinds`. */
export interface RouteNode {
  /** The view id — one node per view, so two kinds never tie on one sentence. */
  readonly id: string;
  readonly viewId: string;
  /** The selection kinds the view can emit (the act picks one; an offer names it). */
  readonly kinds: readonly EmissionKind[];
  /** The routing text: what acting on the view does, in one sentence. */
  readonly does: string;
  /** Real phrasings, if the author gave any. */
  readonly examples?: readonly string[];
}

export interface RouteOptions {
  /** The node the conversation is already on (mid-conversation ambiguity = stay). */
  readonly incumbent?: string;
  /** The scorer; default = the kernel's keyword scorer (word overlap, a declared floor). */
  readonly scorer?: IntentScorer;
  readonly policy?: Partial<RoutingPolicy>;
  readonly signal?: AbortSignal;
}

/** The verdict, with the scorer and policy that produced it — evidence an act may carry. */
export interface RouteVerdict {
  readonly verdict: Tier2Verdict;
  readonly scorer: string;
  readonly policy: RoutingPolicy;
  readonly nodes: readonly RouteNode[];
}

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
export async function routeIntent(phrase: string, nodes: readonly RouteNode[], opts: RouteOptions = {}): Promise<RouteVerdict> {
  const scorer = opts.scorer ?? keywordScorer();
  const policy: RoutingPolicy = { ...DEFAULT_ROUTING_POLICY, ...opts.policy };
  const candidates: IntentCandidate[] = nodes.map((n) => ({ id: n.id, intent: n.does, examples: n.examples ?? [] }));
  if (candidates.length === 0) return { verdict: { kind: 'unmatched', ranked: [], decisive: false }, scorer: scorer.name, policy, nodes };
  try {
    const raw = await scorer.score({ message: phrase }, candidates, opts.signal);
    const scores = validateIntentScores(scorer.name, candidates, raw);
    return { verdict: decideTier2(scores, opts.incumbent, policy, scorer), scorer: scorer.name, policy, nodes };
  } catch {
    // the kernel's own law: a misbehaving scorer must never abort a run — honestly unmatched, nothing ranked
    return { verdict: { kind: 'unmatched', ranked: [], decisive: false }, scorer: scorer.name, policy, nodes };
  }
}
