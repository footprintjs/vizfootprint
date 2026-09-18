/**
 * A COMPUTATION DECLARES WHERE IT MAY ATTACH — the port, and nothing else.
 *
 * `whole` and `progressive` are not opposites. A curated protein alignment's
 * Stockholm header carries its accession and its depth — `#=GF AC PF00545.26`
 * — in the first couple of hundred bytes, while the per-column score genuinely
 * needs all 169 MB. One resource, two computations, two honest moments. So a
 * computation says WHERE it attaches, and the law is one sentence:
 *
 * **A computation may attach before completion only if bytes that have not
 * arrived cannot invalidate its answer.**
 *
 * | position | sees | may claim |
 * |---|---|---|
 * | `head` | a DECLARED number of leading bytes | facts structurally present in the head |
 * | `incremental` | a growing prefix | only MONOTONE facts — ones later bytes can add to but never overturn |
 * | `whole` | everything | anything |
 *
 * THIS FOLDER IS PURE, and that is why the layer is portable, not merely tidy:
 * nothing here imports anything outside it, touches the DOM, opens a socket or
 * reads a clock (`./purity.test.ts` reads the imports and fails on one). The
 * same fold runs in a browser and on a server, so MOVING A COMPUTATION between
 * them cannot change what its number means. See ./README.md.
 */

/** The three positions a computation may declare, and there is no fourth. */
export const FOLD_POSITIONS = ['head', 'incremental', 'whole'] as const;
export type FoldPosition = (typeof FOLD_POSITIONS)[number];

/**
 * The three small pure functions a fold IS: begin, take the bytes that just
 * arrived, answer. Nothing more — a fold that needs a lifecycle is a fold that
 * is doing too much, and several folds compose over one resource rather than
 * one fold growing.
 *
 * Declared as METHODS on purpose: a list of folds over one resource is one type
 * ({@link DeclaredFold}) only because method parameters are compared
 * bivariantly, and the state a fold makes is its own business — it is only ever
 * handed back to the fold that made it.
 */
interface FoldSteps<S, T> {
  /** The empty state, before a byte has arrived. */
  start(): S;
  /** The state after these bytes. Pure: the same state and the same chunk answer the same thing. */
  take(state: S, chunk: Uint8Array): S;
  /** The answer this state holds — asked whenever the answer has become honest, which is what the POSITION decides. */
  finish(state: S): T;
}

/**
 * A declared computation over a resource's bytes: its name, its three steps,
 * and where it attaches.
 *
 * **A `head` fold DECLARES ITS BOUND**, in the type and not in a runtime
 * check: "the head" is not a natural quantity, so `at: 'head'` without
 * `headBytes` does not compile. The two consequences that follow are the
 * strategy's job (`./positions.ts`): a head that arrives across several chunks
 * is still handed ONE contiguous head, and a head fold that never receives its
 * declared bytes says so rather than answering from what it got — a short body
 * is not a small header.
 */
export type ResourceFold<S, T> = FoldSteps<S, T> & {
  /** How its answer is told apart from the others over the same resource. */
  readonly name: string;
} & ({ readonly at: 'head'; readonly headBytes: number } | { readonly at: 'incremental' } | { readonly at: 'whole' });

/**
 * The type a LIST of folds over one resource has. The state is erased because
 * nothing outside a fold may look at it, let alone make one.
 */
export type DeclaredFold = ResourceFold<unknown, unknown>;

/**
 * One answer, and what it is true OF — which is the whole honesty of an early
 * value. `bytes` is the EXTENT: the declared head for a `head` fold, the prefix
 * that had arrived for an `incremental` one, the whole body for a `whole` one.
 * An incremental answer is honest only if labelled "so far", and `at` plus
 * `bytes` is what a host labels it with.
 *
 * A VALUE NEVER RIDES THE OVERVIEW. This is delivered to the host that asked
 * for it and carried on the read's own result; the overview keeps carrying the
 * resource's STATE and its declared facts and no payload, exactly as before
 * (`../README.md`). A host that wants a head fact on the record lands it the
 * way every other computed answer lands: as an act.
 */
export interface FoldAnswer {
  /** The declared resource these bytes are of, so ONE observer can serve every fold over every resource. */
  readonly resource: string;
  /** The fold's declared name. */
  readonly fold: string;
  /** Where it attached — the same word that says what it may claim. */
  readonly at: FoldPosition;
  /** How many bytes of the body this answer is true of. */
  readonly bytes: number;
  /** The fold's own answer. `unknown` here, and typed where the fold is declared. */
  readonly value: unknown;
}

/** What a host passes to be told an answer as soon as it is computed. */
export type FoldAnswerObserver = (answer: FoldAnswer) => void;

/**
 * Whether a resource's bytes have to be HELD — **derived from the declarations,
 * never asked for** (`./declare.ts` · `residencyOf`).
 *
 * `retained` when some declared fold attaches at `whole`: the bytes land, the
 * previous law untouched. `streamed` when none does: a 169 MB body then goes
 * THROUGH, folded chunk by chunk, and never becomes a 169 MB buffer — so a body
 * nobody declared they need whole stops having a size limit at all.
 */
export type Residency = 'retained' | 'streamed';

/** What the end of a body makes honest for ONE fold: an answer, nothing, or a declaration the body could not satisfy. */
export type FoldEnd = { readonly answer?: FoldAnswer } | { readonly refused: string };

/**
 * One fold, mid-flight: its state held, its answers handed back as they become
 * honest. A run is made by the STRATEGY its position names (`./positions.ts`),
 * and it is the only mutable thing in this folder.
 */
export interface FoldRun {
  /** The bytes that just arrived, and how many have arrived in all. Answers the value this chunk made honest, or nothing. */
  push(chunk: Uint8Array, arrived: number): FoldAnswer | undefined;
  /** The body ended WHOLE. Answers what the end made honest, or refuses a declaration the body could not satisfy. */
  end(arrived: number): FoldEnd;
}

/**
 * Every fold over one resource, driven together — what a carrier holds
 * (`../http.ts`) and what the pure driver drives (`./run.ts`). It returns
 * answers rather than calling anything, so a carrier owns the delivery and this
 * folder stays pure.
 */
export interface FoldTap {
  /** The answers these bytes made honest, in declaration order. */
  push(chunk: Uint8Array, arrived: number): readonly FoldAnswer[];
  /** The answers the whole body made honest — or the FIRST declaration the body could not satisfy, which is a refusal and not an answer. */
  end(arrived: number): { readonly answers: readonly FoldAnswer[] } | { readonly refused: string };
}

/**
 * A declaration this folder will not accept, in the shape the source layer
 * already refuses things in (`../types.ts` · `SourceRejection`) — spelled here
 * rather than imported, because this folder imports nothing.
 */
export interface FoldRejection {
  readonly rejected: string;
}
