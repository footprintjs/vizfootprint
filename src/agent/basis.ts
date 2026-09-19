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
  /**
   * Per table whose source declared `arrival: 'growing'`: **the extent that
   * number was computed over** — how many rows had arrived when it was read
   * (`../source/types.ts` · SOURCE_ARRIVALS).
   *
   * ABSENT when nothing grows, which is every dashboard that declares no
   * arrival — so an answer over `whole` sources is byte-identical to one made
   * before this key existed.
   *
   * WHY AN ANSWER CARRIES IT AT ALL: over a growing source a version alone is
   * not enough to say what a number means. *1,234 cases* with no extent beside
   * it is the defect — not the partial read — because a reader cannot tell a
   * total from a prefix. With it the same number is a stated claim: 1,234, over
   * the 20,000 rows that had arrived.
   */
  readonly extents?: Readonly<Record<string, number>>;
  /** Which session folded this answer (`sess1`, `sess2`, …). */
  readonly session: string;
}

/** The version each declared source vouched for — the `data` half of the basis. */
export function dataVersionsOf(sources: Readonly<Record<string, SourceInfo>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(sources).map(([table, info]) => [table, info.version]));
}

/**
 * The extent each GROWING source had been read to — the `extents` half of the
 * basis, and `undefined` when no declared source grows.
 *
 * It reads the same row `dataVersionsOf` reads, and it is a different fact: a
 * version says WHICH bytes, an extent says HOW MANY of them there were. A
 * `whole` source has no entry, because there is no prefix to name.
 */
export function extentsOf(sources: Readonly<Record<string, SourceInfo>>): Readonly<Record<string, number>> | undefined {
  const growing = Object.entries(sources).filter(([, info]) => info.arrival === 'growing');
  return growing.length === 0 ? undefined : Object.fromEntries(growing.map(([table, info]) => [table, info.rows]));
}

/** Compose the basis from the position, the build and the session. */
export function basisOf(args: { asOf: string; revision: string; session: string; sources: Readonly<Record<string, SourceInfo>> }): AnswerBasis {
  const extents = extentsOf(args.sources);
  return { asOf: args.asOf, revision: args.revision, data: dataVersionsOf(args.sources), session: args.session, ...(extents !== undefined ? { extents } : {}) };
}
