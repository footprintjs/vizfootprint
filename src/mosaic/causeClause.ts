/**
 * causeClause — build a real Mosaic SelectionClause whose `source` is a
 * registry-backed identity and whose `meta` is a CauseMetadata superset of
 * Mosaic's own ClauseMetadata, carrying the two-slot Cause.
 *
 * Why a meta superset works (Q2, verified in the installed package): Mosaic's
 * pre-aggregation reads a clause's metadata by destructuring and switching on
 * KNOWN fields only — it never enumerates or rejects unknown keys:
 *   node_modules/@uwdata/mosaic-core/dist/src/preagg/PreAggregator.js:192-206
 *     `const { source, meta } = clause; ... switch (meta.type) { ... }`
 * So `meta.cause` rides along, untouched, into query generation.
 */

import { clauseInterval, clausePoint } from '@uwdata/mosaic-core';
import type { SelectionClause, ClauseMetadata, MosaicClient } from '@uwdata/mosaic-core';
// mosaic-sql is mosaic-core's own predicate-AST layer (a declared direct
// dependency here, same 0.28.x line): `and` composes the D30 cell's compound
// predicate from the two REAL side factories below — no hand-built AST node.
import { and } from '@uwdata/mosaic-sql';
import type { ExprNode } from '@uwdata/mosaic-sql';
import { validateCause, type Cause } from '../cause/index.js';
import type { RegisteredSource } from './SourceRegistry.js';
import type { CellSide } from '../data/index.js';

/** ClauseMetadata + the two-slot cause. A strict superset of Mosaic's type. */
export interface CauseMetadata extends ClauseMetadata {
  /** The provenance of this clause. */
  cause: Cause;
}

/** A clause whose meta is guaranteed to carry a cause. */
export interface CauseClause extends SelectionClause {
  meta: CauseMetadata;
}

/** The three clause kinds the engine carries: point, interval, and the D30 compound cell. */
export type CauseClauseSpec =
  | {
      kind: 'point';
      source: RegisteredSource;
      field: string;
      value: unknown;
      cause: Cause;
      /** Cross-filter self-exclusion set. Defaults to [source]. */
      clients?: RegisteredSource[];
    }
  | {
      kind: 'interval';
      source: RegisteredSource;
      field: string;
      /**
       * `[lo, hi]`, a half-open pair with one bound `null` ("no bound on this
       * side" — e.g. `[150, null]` is "150 or more"; see `src/data`'s
       * `IntervalBounds`, the seam that actually EVALUATES this shape), or
       * `null` to clear. ISO-8601 date-string bounds ride this rail too (a
       * time-series brush, or an agent `filter` call). This spec only
       * forwards the value into the REAL Mosaic `clauseInterval` below, whose
       * sole consumer is the inert, descriptor-only `CommitRecord.predicateSQL`
       * string (`src/log/log.ts`) — nothing executes it. Mosaic itself has no
       * half-open/string-extent concept, so for those shapes that descriptor
       * can render a technically-nonsensical-but-non-throwing fragment
       * (already true for date strings pre-dating this type — `asNode`
       * treats a string extent as a column reference, see `predicate.ts`'s
       * documented divergence comment); `src/data`'s `resolvePredicateSQL` is
       * the one honest SQL descriptor this package actually relies on.
       */
      value: [number, number] | [number, null] | [null, number] | [string, string] | [string, null] | [null, string] | null;
      cause: Cause;
      clients?: RegisteredSource[];
    }
  | {
      /**
       * The D30 compound CELL: one gesture selects on TWO fields ("price
       * 100–150 AND category Formal") — ONE commit, one clause whose
       * predicate is the AND of both sides. Each side is a `CellSide`
       * (interval `[lo, hi]` or a point value — `src/data`'s shape, the seam
       * that evaluates it); `value: null` clears the whole cell (the
       * cleared-interval rule). Both side predicates come from the REAL
       * Mosaic factories (`clauseInterval`/`clausePoint`) and are composed
       * with the real `and` — half-open/string-extent sides carry the same
       * descriptor-only caveat documented on the interval spec above.
       */
      kind: 'cell';
      source: RegisteredSource;
      fields: readonly [string, string];
      value: readonly [CellSide, CellSide] | null;
      cause: Cause;
      clients?: RegisteredSource[];
    };

/**
 * A registered source is used as BOTH the clause `source` and (via `clients`)
 * the cross-filter "client" — matching Mosaic's own note that a source "in many
 * cases is a reference to the originating component itself". Q9 (resolved,
 * see `SourceRegistry.ts` file header): `RegisteredSource` genuinely extends
 * `MosaicClient`, so this is a real `Set<MosaicClient>` — no cast required.
 */
function asClients(sources: RegisteredSource[]): Set<MosaicClient> {
  return new Set(sources);
}

/**
 * ONE cell side's predicate, built by the REAL Mosaic factory for its shape
 * (array side → `clauseInterval`, anything else → `clausePoint`) — the exact
 * pieces the plain kinds already ride, so a cell side can never drift from a
 * standalone clause on the same value. The `as never` on the interval side is
 * the same documented third-party-type escape as the plain interval below.
 *
 * A non-cleared cell's sides always yield a real predicate node: the interval
 * side is a concrete `[lo, hi]` tuple (never the factory's `value == null`
 * clear), and a point side of `null` is a real IS-NULL predicate. Only
 * `undefined` (unrepresentable in `CellSide`, but reachable from untyped JS)
 * makes `clausePoint` answer "no predicate" — refused honestly rather than
 * landing a half-empty AND.
 */
function cellSidePredicate(
  field: string,
  side: CellSide,
  opts: { source: RegisteredSource; clients: Set<MosaicClient> },
): ExprNode {
  const built = Array.isArray(side)
    ? clauseInterval(field, side as never, opts)
    : clausePoint(field, side, opts);
  if (built.predicate === null) {
    throw new TypeError(
      `causeClause: a cell side must be a concrete value or [lo, hi] — "${field}" got undefined; clear the WHOLE cell with value: null instead`,
    );
  }
  return built.predicate;
}

/**
 * Build a cause-tagged Mosaic clause. Validates the cause first (R12: malformed
 * causes never enter the clause stream), then attaches it to the clause meta.
 */
export function causeClause(spec: CauseClauseSpec): CauseClause {
  const cause = validateCause(spec.cause); // throws on malformed
  const source = spec.source;
  const clients = asClients(spec.clients ?? [source]);

  let clause: SelectionClause;
  if (spec.kind === 'point') {
    clause = clausePoint(spec.field, spec.value, { source, clients });
  } else if (spec.kind === 'cell') {
    // D30: the compound cell — the two side predicates come from the REAL
    // factories (cellSidePredicate above) and the REAL `and` composes them;
    // a cleared cell (`value: null`) carries a `null` predicate exactly like
    // a cleared interval (`String(null)` → the same "null" descriptor at the
    // log boundary). Mosaic has no compound point×interval factory of its
    // own, so the clause literal is assembled here — every part of it is
    // genuine Mosaic output, and `meta.type: 'cell'` is legal because
    // `ClauseMetadata.type` is an open string.
    const predicate =
      spec.value === null
        ? null
        : and(
            cellSidePredicate(spec.fields[0], spec.value[0], { source, clients }),
            cellSidePredicate(spec.fields[1], spec.value[1], { source, clients }),
          );
    clause = { meta: { type: 'cell' }, source, clients, value: spec.value, predicate };
  } else {
    // Real Mosaic's own .d.ts types `clauseInterval`'s value as a plain
    // `[number, number]` domain — it has no half-open/string-extent concept
    // (see the CauseClauseSpec doc above). `as never` is the same escape
    // `src/log/log.ts` already uses at this exact boundary: the CALL is
    // proven non-throwing for every shape this spec accepts (verified
    // against the real factory — predicate.ts's file header), only the
    // THIRD-PARTY type declaration is too narrow to say so.
    clause = clauseInterval(spec.field, spec.value as never, { source, clients });
  }

  // Merge cause into whatever meta the factory produced ({type:'point'} etc.).
  const base: ClauseMetadata = clause.meta ?? { type: spec.kind };
  const meta: CauseMetadata = { ...base, cause };
  return { ...clause, meta };
}

/** Read the cause back out of a clause, or undefined if it carries none. */
export function causeOf(clause: SelectionClause): Cause | undefined {
  const meta = clause.meta as CauseMetadata | undefined;
  return meta?.cause;
}
