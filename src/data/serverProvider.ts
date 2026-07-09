/**
 * serverProvider — D24's "server" engine: a Mosaic connector talking to a
 * remote/server-side DuckDB (or other backend) via `@uwdata/mosaic-core`'s
 * `Coordinator`. TYPED STUB (D24 build step 3), same discipline as
 * `wasmProvider.ts` — honest capability declaration, typed rejection, no
 * fake success.
 *
 * Unlike the wasm engine, the server engine needs NO new dependency at all:
 * `Coordinator`/`socketConnector`/`restConnector` already live in
 * `@uwdata/mosaic-core`, this package's one existing runtime dependency
 * (`SPEC.md §4`: "This is the package's sole runtime dependency"). What was
 * read to shape this stub:
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
 * A full implementation is a later packet: it will hold a `Coordinator`
 * instance, translate `PredicateClause` -> a real SQL `WHERE` fragment via
 * `@uwdata/mosaic-sql` (the same builders `predicate.ts` hand-replicates),
 * and issue it through `coordinator.query(...)`. This stub only fixes the
 * SHAPE that implementation will fill.
 */

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
   * this stub and the future real implementation; unused here.
   */
  readonly coordinator?: unknown;
  /** Known table names, declared up front (a server engine cannot introspect without a live connection). */
  readonly tables?: readonly string[];
}

const capabilities: DataProviderCapabilities = {
  canEvaluateSQL: true,
  canMaterialize: false, // materializing a column on a remote backend is a write-back the server engine does not own (later packet's call)
};

function noBackend(operation: DataProviderRejection['operation']): DataProviderRejection {
  return reject(
    'server',
    operation,
    'no-backend-connection',
    'serverProvider is a typed stub (D24 build step 3) — no Mosaic Coordinator is wired yet',
  );
}

export function serverProvider(options: ServerProviderOptions = {}): DataProvider {
  const declaredTables = options.tables ?? [];

  return {
    engine: 'server',
    capabilities,

    async tables(): Promise<readonly string[] | DataProviderRejection> {
      // Honest partial capability: a declared table LIST is not the same as
      // a live connection — every other operation still rejects below.
      return declaredTables;
    },

    async columns(_table: string): Promise<readonly ColumnInfo[] | DataProviderRejection> {
      return noBackend('columns');
    },

    async evaluate(
      _table: string,
      _clause: PredicateClause | null,
      _options?: EvaluateOptions,
    ): Promise<EvaluateResult | DataProviderRejection> {
      return noBackend('evaluate');
    },

    async materializeColumn(
      _table: string,
      _name: string,
      _values: readonly unknown[],
    ): Promise<{ readonly ok: true } | DataProviderRejection> {
      return reject(
        'server',
        'materializeColumn',
        'not-implemented',
        'the server engine does not yet support write-back materialization (canMaterialize: false)',
      );
    },
  };
}
