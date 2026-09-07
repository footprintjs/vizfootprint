/**
 * serverProvider — D24's "server" engine: a Mosaic connector talking to a
 * remote/server-side DuckDB (or other backend) via `@uwdata/mosaic-core`'s
 * `Coordinator`. TYPED STUB (D24 build step 3), same discipline as
 * `wasmProvider.ts` — honest capability declaration, typed rejection, no
 * fake success.
 *
 * Unlike the wasm engine, the server engine needs NO new dependency at all:
 * `Coordinator`/`socketConnector`/`restConnector` already live in
 * `@uwdata/mosaic-core` — an OPTIONAL peer since the selection port landed,
 * imported only behind `vizfootprint/mosaic` (PACKAGING.md), so a real
 * implementation here would live behind that door too. What was read to
 * shape this stub:
 *   - `node_modules/@uwdata/mosaic-core/dist/src/Coordinator.js` — the class
 *     doc comment: "manages all database communication for clients and
 *     handles selection updates ... query caching, consolidation, and
 *     pre-aggregation." `constructor(db = new SocketConnector(), options)`;
 *     `exec(query, options)` — "Issue a query for which no result is needed";
 *     `query(query, options)` — returns request data (used by `updateClient`).
 *   - `node_modules/@uwdata/mosaic-core/dist/src/connectors/socket.js` /
 *     `rest.js` — the two ready-made connector transports a real
 *     implementation would hand to `new Coordinator(db)`.
 *
 * Capability declaration (R14), the same discipline as `wasmProvider`:
 * `canEvaluateSQL` states what the server engine WILL do once a Coordinator is
 * wired, not what it does today — every call rejects. `canSort` is absent
 * because absent means NO, and that flag is read at CALL time by the session's
 * sort gate, so it must be true of this version.
 *
 * A full implementation is a later packet: it will hold a `Coordinator`
 * instance, translate `PredicateClause` -> a real SQL `WHERE` fragment via
 * `@uwdata/mosaic-sql` (the same builders `predicate.ts` hand-replicates),
 * and issue it through `coordinator.query(...)`. This stub only fixes the
 * SHAPE that implementation will fill.
 */

import { stubEngineRefusal } from './stubEngines.js';
import {
  reject,
  type ColumnInfo,
  type DataProvider,
  type DataProviderCapabilities,
  type DataProviderRejection,
  type EvaluateOptions,
  type EvaluateResult,
  type PredicateClause,
} from './types.js';

export interface ServerProviderOptions {
  /**
   * A pre-built `Coordinator` (`@uwdata/mosaic-core`) or connection
   * descriptor. Accepted now so the constructor signature is stable across
   * this stub and the future real implementation; DELIBERATELY IGNORED here —
   * which is why the reads below file `not-implemented` (a stub, whether or
   * not a handle was supplied) and never `no-backend-connection`, whose
   * documented meaning is that a handle was required and was not given.
   */
  readonly coordinator?: unknown;
  /** Known table names, declared up front (a server engine cannot introspect without a live connection). */
  readonly tables?: readonly string[];
}

const capabilities: DataProviderCapabilities = {
  canEvaluateSQL: true, // R14 forward-looking: what the server engine WILL do once a Coordinator is wired — every call rejects today
  canMaterialize: false, // a write-back into someone else's warehouse is not this engine's to own — a real Coordinator here would refuse it too (see README)
};

/**
 * The stub-ness rejections this stub files, in the ONE sentence
 * `stubEngines.ts` mints — the same words `wasmProvider` files, differing only
 * in the engine it names. WHY not "no Mosaic Coordinator is wired yet": that
 * names our build order, where the reader needs the remedy for the table in
 * their hand.
 *
 * WHY the code is `not-implemented` and not `no-backend-connection`, which
 * this stub used to file: `options.coordinator` is never inspected, so the
 * connection code would claim something unmeasured — it says a handle was
 * required and not supplied, to a caller who may be holding one. The union's
 * own doc names this engine under `not-implemented` ("the engine is a stub —
 * no backend is wired yet (wasm/server today)"), which is the code the wasm
 * twin already files for the identical situation. `no-backend-connection` is
 * left for the real implementation to file when a handle is genuinely missing
 * or dropped at call time.
 */
function notImplemented(operation: DataProviderRejection['operation'], table: string): DataProviderRejection {
  return reject('server', operation, 'not-implemented', stubEngineRefusal('server', table));
}

export function serverProvider(options: ServerProviderOptions = {}): DataProvider {
  // a COPY, taken once: the answer `tables()` gives is this provider's own, never
  // an array the caller can still push into after construction
  const declaredTables = [...(options.tables ?? [])];

  return {
    engine: 'server',
    capabilities,

    async tables(): Promise<readonly string[] | DataProviderRejection> {
      // Honest partial capability: a declared table LIST is not the same as
      // a live connection — every other operation still rejects below.
      return declaredTables;
    },

    async columns(table: string): Promise<readonly ColumnInfo[] | DataProviderRejection> {
      return notImplemented('columns', table);
    },

    async evaluate(
      table: string,
      _clause: PredicateClause | readonly PredicateClause[] | null,
      options?: EvaluateOptions,
    ): Promise<EvaluateResult | DataProviderRejection> {
      // the one law every engine keeps: a sort it cannot honour is refused, never answered in source order.
      // The REASON stays the contract's own; the DETAIL is the minted refusal, because "ask for this window
      // without a sort" pointed at a second refusal — this stub answers no window, sorted or not.
      if (options?.sort !== undefined && options.sort.length > 0) return reject('server', 'evaluate', 'unsupported-sort', stubEngineRefusal('server', table));
      return notImplemented('evaluate', table);
    },

    async materializeColumn(
      table: string,
      _name: string,
      _values: readonly unknown[],
    ): Promise<{ readonly ok: true } | DataProviderRejection> {
      // its OWN reason, and its own words: this one is refused by the declared
      // capability (`canMaterialize: false`), not by the missing connection —
      // a real Coordinator behind this provider would still refuse a write-back
      return reject(
        'server',
        'materializeColumn',
        'not-implemented',
        `the server engine does not support write-back materialization on "${table}" (canMaterialize: false) — materialize on a memory table, or land the column in your backend`,
      );
    },
  };
}
