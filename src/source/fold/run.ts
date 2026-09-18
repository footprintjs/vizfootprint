/**
 * THE PURE DRIVER, and the one function here that calls out.
 *
 * {@link foldOver} runs declared folds over a list of chunks and answers what
 * they said — no stream, no request, no environment. It is what the conformance
 * check drives (`./conformance.ts`), what a test can run on both sides of the
 * wire, and the smallest complete statement of what a carrier does with a
 * declaration: a carrier differs only in where the chunks come from
 * (`../http.ts` drives the same {@link FoldTap} off a response's stream).
 *
 * {@link reportAnswer} hands one computed answer to the observer the host
 * passed, and swallows what that observer throws — for the reason a progress
 * report does (`../progress.ts` · `reportProgress`): the answer is already
 * computed and already on the read's own result, so the delivery is a courtesy
 * and nothing about the read may turn on it.
 */
import { declareFolds } from './declare.js';
import type { DeclaredFold, FoldAnswer, FoldAnswerObserver } from './types.js';

/**
 * What a whole run of folds over a body said: the last answer each fold gave,
 * by name, and every answer in the order it became honest — or the one sentence
 * saying the folds never ran, which is either a declaration that was not one or
 * a declared head the body could not satisfy.
 */
export type FoldOutcome = { readonly answers: Readonly<Record<string, unknown>>; readonly delivered: readonly FoldAnswer[] } | { readonly refused: string };

/**
 * Declared folds over a body that arrived in these chunks. PURE: the same folds
 * and the same chunks answer the same thing, on a server or in a browser, which
 * is the whole reason this layer is portable and not merely tidy.
 */
export function foldOver(resource: string, folds: readonly DeclaredFold[], chunks: readonly Uint8Array[]): FoldOutcome {
  const declared = declareFolds(resource, folds);
  if ('rejected' in declared) return { refused: declared.rejected };
  const delivered: FoldAnswer[] = [];
  let arrived = 0;
  for (const chunk of chunks) {
    arrived += chunk.byteLength;
    delivered.push(...declared.tap.push(chunk, arrived));
  }
  const end = declared.tap.end(arrived);
  if ('refused' in end) return end;
  delivered.push(...end.answers);
  return { answers: answersOf(delivered), delivered };
}

/**
 * name → the last answer that fold gave. The LAST, because an incremental fold
 * answers over every prefix and the one over the whole body is the one a caller
 * that ignored the channel should be handed.
 */
export const answersOf = (delivered: readonly FoldAnswer[]): Readonly<Record<string, unknown>> => Object.fromEntries(delivered.map((answer) => [answer.fold, answer.value] as const));

/** Tell the host, and let nothing about the read turn on it. */
export function reportAnswer(onFoldValue: FoldAnswerObserver, answer: FoldAnswer): void {
  try {
    onFoldValue(answer);
  } catch {
    // deliberately nothing: see above
  }
}
