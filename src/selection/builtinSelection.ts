/**
 * BUILTIN SELECTION — THE PORT ANSWERED WITH NO ENGINE.
 *
 * The law it transcribes: Mosaic's crossfilter resolution, measured on
 * `@uwdata/mosaic-core@0.28.1` (dist/src/Selection.js):
 *   - resolve (:257-267) — drop every clause standing for the new clause's
 *     `source`; push the new one only if it carries a predicate;
 *   - skip (:278-283) — `clause.clients.has(client)`, identity, never a flag.
 * The verdict and the byte are `judge.ts`'s, shared with the adapter, so a
 * log this port writes is byte-identical to one the Mosaic adapter writes.
 * Nothing here is invented without a caller — no reset, no single-mode, no
 * remove.
 *
 * First customers: the log's default port; every session and test that never
 * asked for Mosaic.
 */

import { judge, rejectionOf } from './judge.js';
import {
  SelectionPortError,
  reject,
  type CauseClause,
  type CauseClauseSpec,
  type RegisteredSource,
  type SelectionListener,
  type SelectionOperation,
  type SelectionPort,
} from './types.js';

const ENGINE = 'builtin';

// ── resolve: Selection.js:257-267, verbatim in our shape ────────────────────

function resolve(standing: readonly CauseClause[], clause: CauseClause): readonly CauseClause[] {
  const kept = standing.filter((c) => c.source !== clause.source);
  if (clause.predicateSQL !== null) kept.push(clause);
  return Object.freeze(kept);
}

// ── the port ────────────────────────────────────────────────────────────────

export function builtinSelection(): SelectionPort {
  let standing: readonly CauseClause[] = Object.freeze([]);
  const listeners = new Set<SelectionListener>();
  // WHY a port-private set per clause: `skip()` must answer off an identity set a caller cannot
  // reach — the public `clients` is a projection (a `Set` cannot be frozen), and the same map is
  // the proof a clause was minted HERE, so `update`/`skip` refuse a stranger as loudly as Mosaic does
  const own = new WeakMap<CauseClause, ReadonlySet<RegisteredSource>>();

  function mint(spec: CauseClauseSpec): CauseClause {
    const verdict = judge(spec);
    const clause: CauseClause = Object.freeze({
      kind: spec.kind,
      source: verdict.source,
      clients: new Set(verdict.clients),
      value: spec.value,
      predicateSQL: verdict.predicateSQL,
      meta: Object.freeze({ type: spec.kind, cause: Object.freeze(verdict.cause) }),
    });
    own.set(clause, new Set(verdict.clients));
    return clause;
  }

  function ownOf(clause: CauseClause, operation: SelectionOperation): ReadonlySet<RegisteredSource> {
    const clients = own.get(clause);
    if (clients === undefined) {
      throw new SelectionPortError(
        reject(ENGINE, operation, 'unknown-source', `a clause for "${String(clause?.source?.viewId)}" was not minted by this port — mint it through the port that stands it`),
      );
    }
    return clients;
  }

  return {
    engine: ENGINE,
    capabilities: { liveSelection: false, canSkip: true },
    clause(spec) {
      try {
        return mint(spec);
      } catch (error) {
        return rejectionOf(ENGINE, error);
      }
    },
    update(clause) {
      ownOf(clause, 'update');
      standing = resolve(standing, clause);
      // WHY synchronous, and a throw propagates: SelectionPort's listener law —
      // the log's outbound try/catch is the one place a failed relay is filed
      for (const fn of listeners) fn(standing);
    },
    clauses: () => standing,
    skip: (client, clause) => ownOf(clause, 'skip').has(client),
    listen(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    native: () =>
      reject(ENGINE, 'native', 'no-live-selection', 'the built-in port is the whole engine; hand mosaicSelection() to the log (or `createSession({ selection })`) for a live Mosaic Selection'),
  };
}
