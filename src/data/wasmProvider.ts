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
 *       `wasmConnector(options)` -> `new DuckDBWASMConnector(options)`. What
 *       that connector defers is only the DATABASE: `getDuckDB()` ->
 *       `connect()` -> `initDatabase()` selects a JSDelivr bundle and spawns a
 *       Worker on the first query. The MODULE import at line 1 —
 *       `import * as duckdb from '@duckdb/duckdb-wasm'` — is STATIC, and
 *       therefore eager the moment that file loads — which is exactly why the
 *       `bench/x4` note below matters.
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
 * Capability declaration (R14): `capabilities` describes what the WASM engine
 * WILL support once implemented — read by any caller branching on the port,
 * which today is the session's pre-flight sort gate (`src/session/session.ts`,
 * `capabilities.canSort`) and nothing else. NOT `chooseEngine`: it resolves
 * `auto` from `DatasetStats` plus the engines a host listed, and never receives
 * a provider at all. Meanwhile every actual call is refused today — a sort by
 * the reason the contract keeps for it (`unsupported-sort`), every other read
 * as `not-implemented`. Never a silent no-op.
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
  // executed by DuckDB-WASM, is the whole point of this engine. No live code
  // reads either flag today; they declare the plan.
  canEvaluateSQL: true,
  canMaterialize: true,
  // WHY `canSort` is deliberately ABSENT (= no) while its two neighbours state
  // the plan: it is the one flag live code reads at CALL time — the session's
  // sort gate refuses a sorted window before this provider is ever asked — so
  // it must say what this engine does TODAY, which is nothing. Completing the
  // block by the comment above it would hand a sort to a stub that refuses
  // every one, and the sheet would draw a toggle for it.
};

/**
 * The `not-implemented` rejections this stub files, in the ONE sentence
 * `stubEngines.ts` mints: which engine, that it answers no query in this
 * version, and what to do instead. (The sort refusal below keeps its own
 * REASON and quotes the same sentence.) WHY not "no DuckDB-WASM connector is
 * wired yet": that is a fact about our build order, and the person reading it
 * is holding a table that answers nothing — the remedy is the half they can
 * act on.
 */
function notImplemented(operation: DataProviderRejection['operation'], table: string): DataProviderRejection {
  return reject('wasm', operation, 'not-implemented', stubEngineRefusal('wasm', table));
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
      if (options?.sort !== undefined && options.sort.length > 0) return reject('wasm', 'evaluate', 'unsupported-sort', stubEngineRefusal('wasm', table));
      return notImplemented('evaluate', table);
    },

    async materializeColumn(
      table: string,
      _name: string,
      _values: readonly unknown[],
    ): Promise<{ readonly ok: true } | DataProviderRejection> {
      return notImplemented('materializeColumn', table);
    },
  };
}
