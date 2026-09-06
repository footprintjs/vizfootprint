/**
 * THE BASIS — what the answer was true as of.
 *
 * An answer a reader may narrow is an answer a reader will cache, and a cached
 * part is only safe while the thing it was read off has not moved. Four values
 * say whether it has, and they are four because the answer rests on four
 * independent things:
 *
 *  - `asOf`     — the POSITION. Already the id an act copies back (`src/session/offers.ts`).
 *  - `revision` — the DEFINITION, digested at build (`src/def/revision.ts`).
 *  - `data`     — the ROWS: what each declared source vouched for when it was read.
 *  - `session`  — WHICH SESSION folded it. Two sessions on one dashboard stand
 *                 at two cursors and keep two ledgers of their own.
 *
 * It rides on every answer, whole, and is never omitted — narrowing an answer
 * is exactly when a reader needs the thing it compares against most.
 */
import type { SourceInfo } from '../source/types.js';

/** What an answer was true as of — see the file header. */
export interface AnswerBasis {
  /** The position this answer was made at: the id a `select`/`filter` copies back as `asOf`. */
  readonly asOf: string;
  /** The definition this dashboard was built from (`Dashboard.revision`). */
  readonly revision: string;
  /**
   * Per table that DECLARED a source: the version its adapter vouched for when
   * it was read. A table declared inline as rows or CSV carries no entry — its
   * rows are part of the definition, so `revision` already covers them, and
   * inventing a version for bytes nobody versioned would be the answer making
   * a claim its sources never made.
   */
  readonly data: Readonly<Record<string, string>>;
  /** Which session folded this answer (`sess1`, `sess2`, …). */
  readonly session: string;
}

/** The version each declared source vouched for — the `data` half of the basis. */
export function dataVersionsOf(sources: Readonly<Record<string, SourceInfo>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(sources).map(([table, info]) => [table, info.version]));
}

/** Compose the basis from the position, the build and the session. */
export function basisOf(args: { asOf: string; revision: string; session: string; sources: Readonly<Record<string, SourceInfo>> }): AnswerBasis {
  return { asOf: args.asOf, revision: args.revision, data: dataVersionsOf(args.sources), session: args.session };
}
