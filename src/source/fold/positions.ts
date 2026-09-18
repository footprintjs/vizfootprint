/**
 * THE THREE POSITIONS, as three strategies behind one interface
 * ({@link FoldRun}). Each answers one question: WHEN has this fold's answer
 * become honest?
 *
 * - `head` — the moment its declared bytes have all arrived, and never after.
 * - `incremental` — after every chunk, each answer stamped with the prefix it
 *   is true of.
 * - `whole` — once, when the body ended whole.
 *
 * The strategy is chosen once, where the declaration is judged (`./declare.ts`
 * · `declareFolds`), so a fold's position is read in exactly one place and a
 * head fold's bound reaches its run already checked.
 */
import type { DeclaredFold, FoldAnswer, FoldEnd, FoldRun } from './types.js';

/** One answer, stamped with the fold that made it and the extent it is true of. */
const answerOf = (resource: string, fold: DeclaredFold, bytes: number, value: unknown): FoldAnswer => ({ resource, fold: fold.name, at: fold.at, bytes, value });

/**
 * The head as ONE contiguous run of exactly `need` bytes, however many chunks
 * it came in — which is the promise that makes a head fold a function of the
 * bytes rather than of the framing: a parser handed `#=GF AC PF00` and then
 * `545.26` must see neither half.
 */
function contiguous(held: readonly Uint8Array[], need: number): Uint8Array {
  const head = new Uint8Array(need);
  let at = 0;
  for (const chunk of held) {
    // a VIEW and never a branch: the chunk that crosses the bound is trimmed to it, and the
    // head is what was declared rather than what happened to arrive with it
    const take = Math.min(chunk.byteLength, need - at);
    head.set(chunk.subarray(0, take), at);
    at += take;
  }
  return head;
}

/**
 * `head` — a DECLARED number of leading bytes, and the two things that must be
 * right about them.
 *
 * It buffers only until its bound is met, folds the contiguous head, and
 * releases what it held: after that the rest of the body is none of its
 * business, which is also why a head fold over a 169 MB body costs the head.
 *
 * AND IF THOSE BYTES NEVER COME, IT SAYS SO. A body that ended short of the
 * bound is refused rather than answered from what arrived — a short body is not
 * a small header, and a header parser handed half a header answers a plausible
 * wrong thing.
 */
export function headRun(resource: string, fold: DeclaredFold, need: number): FoldRun {
  const held: Uint8Array[] = [];
  let have = 0;
  let answered = false;
  return {
    push: (chunk) => {
      if (answered) return undefined;
      held.push(chunk);
      have += chunk.byteLength;
      if (have < need) return undefined;
      answered = true;
      const head = contiguous(held, need);
      held.length = 0; // the head is folded; the bytes go
      return answerOf(resource, fold, need, fold.finish(fold.take(fold.start(), head)));
    },
    end: (arrived): FoldEnd =>
      answered
        ? {}
        : { refused: `the fold "${fold.name}" declared it needs the first ${String(need)} bytes and the body ended after ${String(arrived)}; a short body is not a small header, so nothing was folded` },
  };
}

/**
 * `incremental` — a growing prefix, answered after every chunk, each answer
 * carrying the extent it is true of.
 *
 * The claim it makes is MONOTONE: later bytes may add to the answer and may
 * never overturn it. The library cannot check that (`./conformance.ts` can
 * falsify it), so the position IS the claim, and `FoldAnswer.at` is what a host
 * labels the number with — "3,982 sequences SO FAR" is honest, "3,982
 * sequences" is not.
 */
export function incrementalRun(resource: string, fold: DeclaredFold): FoldRun {
  let state = fold.start();
  return {
    push: (chunk, arrived) => {
      state = fold.take(state, chunk);
      return answerOf(resource, fold, arrived, fold.finish(state));
    },
    end: () => ({}),
  };
}

/**
 * `whole` — everything, answered once, at the end, and only if the body ended
 * whole. It is also the one declaration that makes a resource RESIDENT
 * (`./declare.ts` · `residencyOf`): the position that may claim anything is the
 * position whose bytes are kept.
 */
export function wholeRun(resource: string, fold: DeclaredFold): FoldRun {
  let state = fold.start();
  return {
    push: (chunk) => {
      state = fold.take(state, chunk);
      return undefined;
    },
    end: (arrived) => ({ answer: answerOf(resource, fold, arrived, fold.finish(state)) }),
  };
}
