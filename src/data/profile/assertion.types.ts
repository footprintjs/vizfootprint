/**
 * THE ASSERTION SHAPE THIS LIBRARY SPEAKS — its own, not a dependency's.
 *
 * `profileStatisticAssertion` (`./assertion.ts`) projects one computed profile
 * statistic into a claim a comparator can judge: one subject, one predicate,
 * one value, an epoch, a stratum, a provenance. The first comparator is
 * ContextFootprint's `conflictsOf` (a sibling library), and its `Assertion`
 * is structurally this shape — so a host that uses it hands our record over
 * untouched. WHY the shape is declared HERE (the port law — a port is OUR
 * shape; `../../..//README` "interface + adapter + strategy"): a library that
 * imports another library's type makes every consumer carry that library in
 * its install just to read a `.d.ts`, and ties the wire's shape to a
 * dependency it never calls at runtime (`assertion.ts` never did — its import
 * was `import type`, erased on emit). ContextFootprint is a dev-time
 * dependency of THIS repository only, kept to prove the two shapes stay
 * assignable both ways (`./assertion.test.ts`, a compile-time pin) and to run
 * the comparison example; the packed library carries no dependency on it.
 *
 * The three sentences ContextFootprint's algebra rests on, restated so a
 * reader of this file needs no other: serving is asserting and history is
 * quotation (`stratum`); a key is (subject, predicate, epoch) and only
 * `asserted` facts can contradict; a value that is an unknown never
 * participates in a comparison (honest absence — the consumer owns how
 * absence propagates).
 */

/** WHO a claim is about — a stamped identity, read off the record, never inferred. `kind` is open by design. */
export interface AssertionSubject {
  readonly kind: string;
  readonly id: string;
}

/** The strata rule as a type: only `asserted` facts can contradict; `quoted` history never fires a check. */
export type AssertionStratum = 'asserted' | 'quoted';

/** One typed claim about one subject. */
export interface ProfileAssertion {
  readonly subject: AssertionSubject;
  /** The relation this asserts — for a profile statistic, the statistic's own name over the field. */
  readonly predicate: string;
  /** The claimed value: a plain value, or an unknown that never participates in a comparison. */
  readonly value: unknown;
  /** The version this was asserted UNDER — the host's own counter; absent means the current, unversioned world. */
  readonly epoch?: number;
  readonly stratum: AssertionStratum;
  /** Where this came from — a sentence or a serialised receipt. */
  readonly provenance: string;
  /** The universal join key into commit logs and recordings, when known. */
  readonly runtimeStageId?: string;
  /** A consumer's canary marker; this library never sets it. */
  readonly synthetic?: true;
}
