/**
 * KEEPING A DECLARATION HONEST — the falsifier.
 *
 * The library **cannot check** that a fold is really monotone; that is a claim
 * its author makes. So: declare it, and let a conformance check falsify it. Run
 * the fold over a prefix and over the whole, and a monotone declaration that
 * does not agree fails in CI rather than producing a quietly wrong number on
 * somebody's screen.
 *
 * The precedent this copies is not theoretical: the renderer layer's
 * `declared-delivered` conformance step — every emission kind a renderer
 * declares and this state can deliver must have been delivered — caught a
 * capability lie introduced by the next packet, hours after it was added.
 *
 * TWO properties, and the first applies to every position:
 *
 * 1. **The bytes, not their framing.** A fold that answers one thing over three
 *    chunks and another over the same bytes in one was never a fold of the
 *    bytes. This is the failure real folds actually have — a parser that reads
 *    a line and is handed half of one.
 * 2. **The monotone claim**, for an `incremental` fold only: its answer over
 *    each growing prefix must be one later bytes could have added to. What
 *    "added to" MEANS is the author's to say ({@link MonotoneCheck.grew}); the
 *    default is the strictest honest reading, so a fold whose answer genuinely
 *    grows says so rather than being assumed.
 *
 * WHAT IT CANNOT CATCH, stated because a check whose limits are unstated gets
 * trusted past them: it is a spot check over the chunks it was given, not a
 * proof over every body; a fold can be monotone and still wrong; a `head`
 * bound that is too small for a DIFFERENT file passes here; and an author who
 * declares `grew: () => true` has falsified nothing.
 */
import { foldOver } from './run.js';
import type { ResourceFold } from './types.js';

/** The resource name the answers are stamped with while they are being compared — a conformance run reads VALUES, and nothing else ever sees this. */
const UNDER_TEST = 'conformance';

/** What a check is given: the fold, the chunks to run it over, and — when the answer grows — what growing means. */
export interface MonotoneCheck<T> {
  readonly fold: ResourceFold<unknown, T>;
  /** At least two, because a prefix is what this falsifies against and one chunk has none. */
  readonly chunks: readonly Uint8Array[];
  /**
   * "Could `later` have come from `earlier` by adding bytes?" Default: a number
   * may only RISE, and any other answer must be unchanged — the strictest
   * honest reading, so a fold whose answer is a growing set declares its own.
   */
  readonly grew?: (earlier: T, later: T) => boolean;
}

/** Falsified, or not — and a verdict that failed says which two answers disagreed. */
export type MonotoneVerdict = { readonly ok: true } | { readonly failed: string };

/** Two answers that must be the same answer. Identity first, so a number or a string never pays for a serialization. */
const same = (a: unknown, b: unknown): boolean => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);

/** An answer as a sentence can quote it — `undefined` included, which is an answer a fold may give. */
const show = (value: unknown): string => String(JSON.stringify(value));

/** The strictest honest order: a count may rise, and anything else must be untouched. */
const defaultGrew = (earlier: unknown, later: unknown): boolean => (typeof earlier === 'number' && typeof later === 'number' ? later >= earlier : same(earlier, later));

/** Every byte in one chunk — the same body, framed as one piece. */
function oneChunk(chunks: readonly Uint8Array[]): Uint8Array {
  const whole = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    whole.set(chunk, at);
    at += chunk.byteLength;
  }
  return whole;
}

/**
 * What the fold said over these chunks, through the real machinery — a
 * declaration the body could not satisfy included, because a refusal is an
 * outcome a framing may not change either.
 */
function outcomeOf<T>(check: MonotoneCheck<T>, chunks: readonly Uint8Array[]): { readonly value: T } | { readonly refused: string } {
  const out = foldOver(UNDER_TEST, [check.fold], chunks);
  // the value is the fold's own answer; `foldOver` erases the type because a list of folds cannot carry three of them
  return 'refused' in out ? out : { value: out.answers[check.fold.name] as T };
}

/**
 * The answer an INCREMENTAL fold gives over a prefix, driven straight through
 * its own three steps: an incremental fold declares no bound, so there is no
 * prefix it can refuse and no arm here that could not be reached.
 */
function valueOver<T>(fold: ResourceFold<unknown, T>, chunks: readonly Uint8Array[]): T {
  let state = fold.start();
  for (const chunk of chunks) state = fold.take(state, chunk);
  return fold.finish(state);
}

/** Falsify the claims a fold's position makes over the chunks it is given. */
export function falsifyMonotone<T>(check: MonotoneCheck<T>): MonotoneVerdict {
  const { fold, chunks } = check;
  if (chunks.length < 2) return { failed: `the fold "${fold.name}" was checked over ${String(chunks.length)} chunk(s), and what this falsifies is what a PREFIX answers — give it the body in pieces` };
  // 1 · THE BYTES, NOT THEIR FRAMING
  const framed = outcomeOf(check, chunks);
  const whole = outcomeOf(check, [oneChunk(chunks)]);
  if (!same(framed, whole)) {
    return {
      failed: `the fold "${fold.name}" answers ${show(framed)} over ${String(chunks.length)} chunks and ${show(whole)} over the same bytes in one — an answer that turns on how the bytes were FRAMED is not an answer about the bytes`,
    };
  }
  // 2 · THE MONOTONE CLAIM, which is the one `incremental` makes and the others do not
  if (fold.at !== 'incremental') return { ok: true };
  const grew = check.grew ?? defaultGrew;
  let earlier = valueOver(fold, chunks.slice(0, 1));
  for (let n = 2; n <= chunks.length; n++) {
    const later = valueOver(fold, chunks.slice(0, n));
    if (!grew(earlier, later)) {
      return {
        failed: `the fold "${fold.name}" attaches INCREMENTALLY, which claims only facts later bytes cannot overturn — and its answer went from ${show(earlier)} over ${String(n - 1)} chunks to ${show(later)} over ${String(n)}`,
      };
    }
    earlier = later;
  }
  return { ok: true };
}
