/**
 * WHERE A DECLARATION IS JUDGED, AND WHERE RESIDENCY IS DERIVED — the only
 * module that reads a fold's `at`.
 *
 * A declaration is judged BEFORE a byte moves, because a bad one is the
 * author's mistake and not the server's: a nameless fold, two folds answering
 * under one name, a position that is not one of the three, a `head` with no
 * bound. Each is a sentence, in the shape this folder's neighbours refuse
 * things in ({@link FoldRejection}), and the carrier turns it into the refusal
 * a host reads (`../http.ts` · the `fold` door).
 *
 * AND RESIDENCY IS DERIVED, NEVER DECLARED ({@link residencyOf}). The library
 * computes from the declarations whether the bytes have to be held, and does
 * not ask: a resource is resident exactly when some computation attached at
 * `whole`. That is the one line behind "a body nobody needs whole stops having
 * a size limit".
 */
import { headRun, incrementalRun, wholeRun } from './positions.js';
import { FOLD_POSITIONS } from './types.js';
import type { DeclaredFold, FoldAnswer, FoldRejection, FoldRun, FoldTap, Residency } from './types.js';

/** The three steps every fold must actually have — a JS host can hand over half a fold, and half a fold is not one. */
const STEPS = ['start', 'take', 'finish'] as const;

/**
 * **RESIDENCY IS DERIVED, NOT DECLARED.** `retained` when some fold attaches at
 * `whole` — the bytes land, and every law about a landing holds exactly as
 * before. `streamed` when none does: the body goes through, folded chunk by
 * chunk, and is never held, so its SIZE stops being a limit.
 *
 * A list with nothing in it is `streamed` for the same reason and by the same
 * rule — nobody declared they need it whole — which is why this is one
 * expression and not a special case. (The carrier refuses an empty list before
 * it gets here: a read that folds nothing is `snapshot()`.)
 */
export const residencyOf = (folds: readonly DeclaredFold[]): Residency => (folds.some((fold) => fold.at === 'whole') ? 'retained' : 'streamed');

/** One fold's declaration judged, and the run its position names — the ONE place `at` is read. */
function runOf(resource: string, fold: DeclaredFold): FoldRun | FoldRejection {
  const name: unknown = fold.name;
  // read BEFORE the three arms narrow it away: the last line's sentence is about a position that is none of them
  const at: unknown = fold.at;
  if (typeof name !== 'string' || name.length === 0) return { rejected: `a fold's name is how its answer is told apart, so it must be a non-empty string, and this one declares ${JSON.stringify(name)}` };
  for (const step of STEPS) {
    if (typeof fold[step] !== 'function') return { rejected: `the fold "${name}" must declare start, take and finish — three small pure functions — and \`${step}\` is ${JSON.stringify(fold[step])}` };
  }
  if (fold.at === 'head') {
    // the head is not a natural quantity, so it is DECLARED — and a bound that is not a count declares nothing
    if (!Number.isSafeInteger(fold.headBytes) || fold.headBytes <= 0) {
      return { rejected: `the fold "${name}" attaches at head, so it must declare how many bytes the head is — the head is not a natural quantity — and \`headBytes\` is ${JSON.stringify(fold.headBytes)}` };
    }
    return headRun(resource, fold, fold.headBytes);
  }
  if (fold.at === 'incremental') return incrementalRun(resource, fold);
  if (fold.at === 'whole') return wholeRun(resource, fold);
  return { rejected: `the fold "${name}" declares it attaches at ${JSON.stringify(at)}, and the positions are ${FOLD_POSITIONS.join(', ')}` };
}

/** Every fold over one resource, driven together: the answers each step made honest, and the first refusal the END earns. */
const tapOver = (runs: readonly FoldRun[]): FoldTap => ({
  push: (chunk, arrived) => runs.map((run) => run.push(chunk, arrived)).filter((answer): answer is FoldAnswer => answer !== undefined),
  end: (arrived) => {
    const answers: FoldAnswer[] = [];
    for (const run of runs) {
      const end = run.end(arrived);
      if ('refused' in end) return end;
      if (end.answer !== undefined) answers.push(end.answer);
    }
    return { answers };
  },
});

/**
 * THE DOOR: a resource's name, the folds declared over it, and either the tap
 * that drives them or the one sentence saying why it will not.
 *
 * Judged in declaration order, and the FIRST fault is the answer — a host
 * fixing one declaration does not need a list of everything else that follows
 * from it.
 */
export function declareFolds(resource: string, folds: readonly DeclaredFold[]): { readonly tap: FoldTap } | FoldRejection {
  if (folds.length === 0) return { rejected: 'no fold was declared, and a read that folds nothing is `snapshot()` — which lands the bytes' };
  const runs: FoldRun[] = [];
  const named = new Set<string>();
  for (const fold of folds) {
    const run = runOf(resource, fold);
    if ('rejected' in run) return run;
    if (named.has(fold.name)) return { rejected: `two folds are both named "${fold.name}" — a fold's name is how its answer is told apart` };
    named.add(fold.name);
    runs.push(run);
  }
  return { tap: tapOver(runs) };
}
