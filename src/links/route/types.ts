import type { EmissionKind } from '../types.js';

/** One routable view; the act chooses among its declared emission kinds. */
export interface RouteNode {
  readonly id: string;
  readonly viewId: string;
  readonly kinds: readonly EmissionKind[];
  readonly does: string;
  readonly examples?: readonly string[];
}

/** What Viz asks a consumer's scorer to judge. */
export interface RouteCandidate {
  readonly id: string;
  readonly text: string;
  readonly examples: readonly string[];
}

/** Raw numbers are evidence: NaN and infinities are left to the decision rule. */
export interface RouteScore {
  readonly id: string;
  readonly score: number;
}

/** Declared policy data, supplied by the consumer rather than invented by Viz. */
export interface RoutePolicy {
  readonly nearTieMargin: number;
  readonly menuSize: number;
  readonly floor?: number;
}

export interface RankedRouteScore extends RouteScore {
  /** The consumer's recorded relevance share, from zero through one. */
  readonly relevance: number;
}

interface RouteEvidence {
  readonly ranked: readonly RankedRouteScore[];
  readonly decisive: boolean;
  readonly runnerUp?: { readonly id: string; readonly gap: number };
}

/** A consumer's decision, with all candidate scores retained as evidence. */
export type RouteDecision =
  | (RouteEvidence & { readonly kind: 'move'; readonly to: string })
  | (RouteEvidence & { readonly kind: 'stay' })
  | (RouteEvidence & { readonly kind: 'menu'; readonly offered: readonly string[] })
  | (RouteEvidence & { readonly kind: 'unmatched' });

/** The only routing mechanism Viz needs; the consumer owns both callbacks. */
export interface RoutePort {
  readonly scorer: {
    readonly name: string;
    score(phrase: string, candidates: readonly RouteCandidate[], signal?: AbortSignal): readonly RouteScore[] | Promise<readonly RouteScore[]>;
  };
  readonly policy: RoutePolicy;
  decide(scores: readonly RouteScore[], incumbent: string | undefined, policy: RoutePolicy): RouteDecision;
}

export interface RouteOptions {
  readonly incumbent?: string;
  readonly policy?: Partial<RoutePolicy>;
  readonly signal?: AbortSignal;
}

/** A read-only answer; a later act may carry this evidence but routing lands nothing. */
export interface RouteVerdict {
  readonly verdict: RouteDecision;
  readonly scorer: string;
  readonly policy: RoutePolicy;
  readonly nodes: readonly RouteNode[];
}
