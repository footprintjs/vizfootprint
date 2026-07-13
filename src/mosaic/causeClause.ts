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
import { validateCause, type Cause } from '../cause/index.js';
import type { RegisteredSource } from './SourceRegistry.js';

/** ClauseMetadata + the two-slot cause. A strict superset of Mosaic's type. */
export interface CauseMetadata extends ClauseMetadata {
  /** The provenance of this clause. */
  cause: Cause;
}

/** A clause whose meta is guaranteed to carry a cause. */
export interface CauseClause extends SelectionClause {
  meta: CauseMetadata;
}

/** The two clause kinds this spike exercises. Extend as the engine grows. */
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
