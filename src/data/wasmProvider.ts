/**
 * wasmProvider — D24's "wasm" engine: DuckDB-WASM in-browser, via
 * `@uwdata/mosaic-sql`'s `loadCSV`/`loadObjects`/`loadParquet` to build the
 * load queries and a `@uwdata/mosaic-core` `DuckDBWASMConnector` to run them.
 * TYPED STUB (D24 build step 3) — a full implementation is a later packet;
 * this packet's job is to make the interface HONESTLY fit that later work,
 * not to fake it working today.
 *
 * What was actually read to shape this stub (quoted, not guessed):
 *   - `node_modules/@uwdata/mosaic-sql/dist/src/load/load.js:11-19,42-49`:
 *       `loadCSV(tableName, fileName, options)`   -> `load('read_csv', ...)`
 *       `loadObjects(tableName, data, options)`   -> builds a `VALUES (...)` query via `sqlFrom`
 *       `loadParquet(tableName, fileName, options)` -> `load('read_parquet', ...)`
 *     Each returns a `CREATE TABLE ... AS SELECT ...` QUERY OBJECT — it does
 *     not execute anything by itself.
 *   - `node_modules/@uwdata/mosaic-sql/dist/src/index.js:34`:
 *       `export { loadCSV, loadJSON, loadObjects, loadParquet, loadSpatial } from './load/load.js';`
 *   - `node_modules/@uwdata/mosaic-core/dist/src/connectors/wasm.js:1,9`:
 *       `wasmConnector(options)` -> `new DuckDBWASMConnector(options)`, which
 *       lazily `import * as duckdb from '@duckdb/duckdb-wasm'` only once a
 *       query actually runs (`getDuckDB()` in that file).
 *   - `node_modules/@uwdata/mosaic-core/dist/src/Coordinator.js` (`exec`,
 *     `query`, `class Coordinator` doc comment): "manages all database
 *     communication for clients ... query caching, consolidation, and
 *     pre-aggregation." `exec(query, options)` issues a fire-and-forget
 *     statement (e.g. the `CREATE TABLE` a `load*` call produces);
 *     `query(query, options)` returns rows.
 *   - Why `bench/x4` stubs this connector out at all
 *     (`bench/x4/runner.mjs:30-34`): importing the `@uwdata/mosaic-core`
 *     BARREL statically pulls in `connectors/wasm.js`, which statically
 *     imports `@duckdb/duckdb-wasm` — a real, heavy, browser-only module.
 *     That import happens whether or not a caller ever asks for the wasm
 *     engine, which is exactly why this stub does NOT eagerly import
 *     `wasmConnector`/`@uwdata/mosaic-core`'s WASM path itself: constructing
 *     a `wasmProvider()` today must stay inert (typed rejection only), never
 *     trigger a WASM fetch as a side effect of merely choosing the engine.
 *
 * Capability declaration (R14): `capabilities` describes what the WASM
 * engine WILL support once implemented — used by `chooseEngine`'s policy to
 * route — while every actual call returns a typed `not-implemented`
 * rejection today. Never a silent no-op.
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

/**
 * The load-query shape a full implementation will build via
 * `@uwdata/mosaic-sql`'s `load*` functions (see file header). Declared
 * locally — NOT imported from `@uwdata/mosaic-sql` — so this stub compiles
 * and typechecks without that package installed; `@uwdata/mosaic-sql` is an
 * optional peer (`package.json`) exactly because only the wasm/server
 * engines need it, never the always-on memory engine.
 */
export type WasmLoadSource =
  | { readonly kind: 'csv'; readonly fileName: string }
  | { readonly kind: 'objects'; readonly data: ReadonlyArray<Record<string, unknown>> }
  | { readonly kind: 'parquet'; readonly fileName: string };

export interface WasmProviderOptions {
  /** Tables to load once a real connector is wired (declared now so the def's data seam can validate shape). */
  readonly sources?: Readonly<Record<string, WasmLoadSource>>;
  /**
   * A pre-built `DuckDBWASMConnector` (`@uwdata/mosaic-core`'s `wasmConnector()`)
   * or `Coordinator`. Accepted now so the CONSTRUCTOR signature does not need
   * to change when the real implementation lands; unused by this stub.
   */
  readonly connector?: unknown;
}

const capabilities: DataProviderCapabilities = {
  // Declares what the WASM engine WILL do once implemented — real SQL,
  // executed by DuckDB-WASM, is the whole point of this engine.
  canEvaluateSQL: true,
  canMaterialize: true,
};

function notImplemented(operation: DataProviderRejection['operation']): DataProviderRejection {
  return reject(
    'wasm',
    operation,
    'not-implemented',
    'wasmProvider is a typed stub (D24 build step 3) — no DuckDB-WASM connector is wired yet',
  );
}

/**
 * Construct a (stub) wasm engine. Never touches DuckDB-WASM as a side
 * effect of construction (see file header) — every method call honestly
 * rejects until a later packet lands the real connector wiring.
 */
export function wasmProvider(options: WasmProviderOptions = {}): DataProvider {
  const declaredTables = Object.keys(options.sources ?? {});

  return {
    engine: 'wasm',
    capabilities,

    async tables(): Promise<readonly string[] | DataProviderRejection> {
      // Honest partial capability, mirroring serverProvider: a DECLARED
      // source list is not a live connection, but it is real information —
      // return it rather than lying with an empty array. Every operation
      // that needs the actual backend still rejects below.
      return declaredTables;
    },

    async columns(_table: string): Promise<readonly ColumnInfo[] | DataProviderRejection> {
      return notImplemented('columns');
    },

    async evaluate(
      _table: string,
      _clause: PredicateClause | null,
      _options?: EvaluateOptions,
    ): Promise<EvaluateResult | DataProviderRejection> {
      return notImplemented('evaluate');
    },

    async materializeColumn(
      _table: string,
      _name: string,
      _values: readonly unknown[],
    ): Promise<{ readonly ok: true } | DataProviderRejection> {
      return notImplemented('materializeColumn');
    },
  };
}
