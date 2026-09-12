/**
 * duckdbConnection — THE ONE PLACE `@duckdb/duckdb-wasm` IS NAMED, IT IS NAMED
 * LATE, AND IT NOW NAMES TWO HOSTS.
 *
 * The law: nothing in this library imports DuckDB-WASM statically. Not the
 * data barrel, not `wasmProvider`, not this module's own top. The import sits
 * inside {@link duckdbConnection}'s returned function, which the provider
 * calls at most once, on the first read that actually needs a backend — so an
 * app that never chose the wasm engine never fetches a WASM bundle, and a
 * bench that merely imports the data seam never spawns a worker
 * (`bench/x4/runner.mjs` had to stub `@uwdata/mosaic-core` precisely because
 * ITS barrel imports DuckDB eagerly).
 *
 * WHICH host is decided at CALL time, never at import, and there are two:
 *
 *   browser — `@duckdb/duckdb-wasm`, an `AsyncDuckDB` over a Worker off a blob.
 *   node    — `@duckdb/duckdb-wasm/blocking`, the BLOCKING bindings the same
 *             package ships for node: no worker, the `.wasm` read off disk.
 *
 * ONE FETCH HAPPENS IN BOTH HOSTS, AND IT IS NOT THE BUNDLE: landing `rows`
 * goes through `read_json_auto` (`sqlConnection.ts` · `loadTableSQL`), and
 * this bundle autoloads DuckDB's `json` extension from the vendor's extension
 * repository the first time it is asked — one request off the origin, proven
 * by `ui/gallery/wasm.smoke.test.ts`, which pins it as exactly one. A CSV
 * landing needs nothing (its reader is statically linked). So an offline or
 * CSP-restricted page can land CSV and cannot land `rows` on this engine
 * today; the remedy is a library decision (land rows as CSV, or self-host the
 * extension) and is named in `./README.md`, not hidden here. WHY the blocking bundle and not `dist/duckdb-node.cjs`: the
 *             async node bundle wants a `worker_threads` worker per database,
 *             and this engine asks one statement at a time through a port that
 *             is already a promise — a second thread would buy nothing and cost
 *             a worker script to locate. It is also what lets the cross-engine
 *             invariant be proven against a REAL DuckDB in the test suite
 *             (`engineInvariant.test.ts`) and measured in `bench/step0-wasm`.
 *
 * First customer: `wasmProvider({ open: duckdbConnection() })` — the only
 * caller, and the reason the return type is a FUNCTION rather than a
 * connection.
 *
 * How the file is arranged so it can be judged without a database in the room:
 * everything that can be tested is a small pure adapter over a structural
 * handle ({@link sqlConnectionOver}, {@link nodeConnectionOver}, {@link rowsOf},
 * {@link nodeBundles}, {@link duckdbHostOf}) and is; the one part that cannot —
 * instantiating a real database — is a dozen lines per host that do nothing but
 * hand those adapters a real handle.
 */

import { loadTableSQL, type LoadingConnection, type SqlConnection, type TableData } from './sqlConnection.js';
import { literalToSQL } from './predicate.js';

// ── The data: the sliver of DuckDB-WASM this adapter actually touches. ───

/** What `AsyncDuckDBConnection.query` answers, narrowed to the one method this module reads. */
export interface DuckDBResult {
  toArray(): readonly unknown[];
}

/** An open DuckDB-WASM connection (`AsyncDuckDBConnection`), structurally. */
export interface DuckDBHandle {
  query(sql: string): Promise<DuckDBResult>;
  close(): Promise<void>;
}

/** The database behind it (`AsyncDuckDB`), structurally — it owns the virtual file system and the worker. */
export interface DuckDBDatabase {
  registerFileText(name: string, text: string): Promise<void>;
  terminate(): Promise<void>;
}

/** One connection of the node bundle's BLOCKING bindings (`DuckDBConnection`), structurally — sync where the browser's is async. */
export interface DuckDBNodeConnection {
  query(sql: string): DuckDBResult;
  close(): void;
}

/**
 * The node bundle's bindings (`DuckDBNodeBindings`), structurally: the database
 * AND its file system in one object, and every method synchronous.
 */
export interface DuckDBNodeBindings {
  instantiate(): Promise<unknown>;
  /** The database's own configuration door — where {@link READ_CONFIG} is set, before the first connection. */
  open(config: DuckDBReadConfig): void;
  connect(): DuckDBNodeConnection;
  registerFileText(name: string, text: string): void;
  reset(): void;
}

/** One bundle the node bindings choose between: the wasm module, and the worker script that ships beside it. */
export interface DuckDBNodeBundle {
  readonly mainModule: string;
  readonly mainWorker: string;
}

/** Both of them — what `createDuckDB` is handed, and what it runs its own platform-feature check over. */
export interface DuckDBNodeBundles {
  readonly mvp: DuckDBNodeBundle;
  readonly eh: DuckDBNodeBundle;
}

/** The node bundle's own module surface, narrowed to the four names this adapter reads. */
export interface DuckDBNodeModule {
  createDuckDB(bundles: DuckDBNodeBundles, logger: unknown, runtime: unknown): Promise<DuckDBNodeBindings>;
  readonly NODE_RUNTIME: unknown;
  readonly ConsoleLogger: new () => unknown;
  readonly VoidLogger: new () => unknown;
}

/**
 * The sliver of DuckDB-WASM's own `DuckDBConfig` this adapter sets, structurally
 * — so the config can be written, read and pinned without importing the package.
 */
export interface DuckDBReadConfig {
  readonly query: {
    readonly castBigIntToDouble: boolean;
    readonly castDecimalToDouble: boolean;
  };
}

/**
 * THE CONFIG EVERY DATABASE HERE IS OPENED WITH, in both hosts.
 *
 * WHY it is not a default anyone can live with: `read_json_auto` and
 * `read_csv_auto` infer BIGINT for every integer column, and HUGEINT/DECIMAL for
 * the wider ones. Unset, DuckDB then answers `amount: 15` as the JS bigint `15n`
 * — while `columns()` reports that column as a `number`. A bigint is a value
 * `JSON.stringify` THROWS on, `equalWidthBins` and `boxSummary` read as absent
 * (they test `typeof value === 'number'`), and no `===` in a predicate matches.
 * These two casts are DuckDB-WASM's own answer to it, and they are set once,
 * here, so neither host can be the one that forgot.
 *
 * WHAT IT DOES NOT COVER, measured against a real DuckDB (2026-09-10): a DATE
 * and a TIMESTAMP still arrive as epoch-millisecond NUMBERS — read back as this
 * library's ISO strings by `wasmProvider` (`withoutRowOrder`), which is where
 * the per-column type words live — and a TIME still arrives as a bigint of
 * microseconds, a value this library has no shape for and does not invent one
 * for.
 */
export const READ_CONFIG: DuckDBReadConfig = { query: { castBigIntToDouble: true, castDecimalToDouble: true } };

/** Which reader a table's bytes are landed through, and under what name they are registered. */
const READERS = {
  rows: { suffix: '.json', reader: (file: string): string => `read_json_auto(${literalToSQL(file)})` },
  csv: { suffix: '.csv', reader: (file: string): string => `read_csv_auto(${literalToSQL(file)})` },
} as const;

// ── The judgement: which host can open a database HERE. ──────────────────

/** The one bundle each host opens, and the word for an environment that is neither. */
export type DuckDBHost = 'browser' | 'node' | 'neither';

/** The two facts the choice rests on. Data, so all three answers can be measured from one environment. */
export interface HostFacts {
  readonly worker: boolean;
  readonly node: boolean;
}

/**
 * The globals the facts are read off, passed in rather than reached for.
 *
 * WHY `process.getBuiltinModule` and not a `node:` import: the node arm needs
 * `createRequire` to find the `.wasm` file on disk, and a bare `node:module`
 * specifier ANYWHERE in this file — even inside a dynamic import in an arm a
 * browser never reaches — is a module every browser bundler must resolve, warn
 * about and stub in each build that merely mentions the data seam. Asking
 * `process` for the same builtin passes a string no bundler reads. It also
 * dates the floor honestly: node 22.3 / 20.16, where that method landed.
 */
export interface HostGlobals {
  readonly Worker?: unknown;
  readonly process?: { readonly getBuiltinModule?: unknown };
}

/** What this environment says about itself. */
export function hostFactsOf(globals: HostGlobals): HostFacts {
  return { worker: typeof globals.Worker === 'function', node: typeof globals.process?.getBuiltinModule === 'function' };
}

/**
 * Which host opens the database.
 *
 * WHY the browser is asked first: an Electron renderer answers to BOTH
 * questions, and there a real `Worker` and a fetched bundle are what the page
 * already runs on — the node arm would read a `.wasm` off the app's own disk
 * layout instead.
 */
export function duckdbHostOf(facts: HostFacts): DuckDBHost {
  if (facts.worker) return 'browser';
  if (facts.node) return 'node';
  return 'neither';
}

/** Neither host: the refusal an exotic runtime meets instead of a stack from inside a worker. */
export const NO_DUCKDB_HOST =
  'duckdbConnection() opens DuckDB-WASM in a browser (a Worker) or in node 22.3+/20.16+ (the bundle it ships for node): this environment is neither, ' +
  'so no database can be spawned — run the wasm engine in one of those, or hand wasmProvider its own { connection }';

// ── The adapters — every line of them runnable without a WASM bundle. ────

/**
 * One Arrow row as a plain object.
 *
 * WHY the two arms: `Table.toArray()` hands back `StructRowProxy` objects,
 * whose fields are reachable but whose OWN enumerable properties are not what
 * a spread would copy — `toJSON()` is Arrow's own way of asking for the plain
 * object. A handle that already answers plain objects (a fake, a future
 * non-Arrow driver) is copied as it is.
 */
export function rowOf(value: unknown): Record<string, unknown> {
  const row = value as { toJSON?: () => Record<string, unknown> };
  return typeof row.toJSON === 'function' ? row.toJSON() : { ...(value as Record<string, unknown>) };
}

/** A whole result as the port's rows. */
export function rowsOf(result: DuckDBResult): readonly Record<string, unknown>[] {
  return result.toArray().map(rowOf);
}

/**
 * The port over an already-open DuckDB handle: read, load, close.
 *
 * WHY `load` lands the bytes through the virtual file system rather than a
 * `VALUES` list: a table of any size becomes ONE registered text and one
 * `CREATE TABLE … AS SELECT`, and the source order the rows are read in is the
 * order the reader hands them over — which is the order `loadTableSQL` writes
 * into `__row`, in that same statement.
 */
export function sqlConnectionOver(database: DuckDBDatabase, handle: DuckDBHandle): LoadingConnection {
  return {
    async query(sql: string): Promise<readonly Record<string, unknown>[]> {
      return rowsOf(await handle.query(sql));
    },

    async load(table: string, data: TableData): Promise<void> {
      const { suffix, reader } = READERS[data.kind];
      const file = `${table}${suffix}`;
      await database.registerFileText(file, data.kind === 'csv' ? data.text : JSON.stringify(data.rows));
      await handle.query(loadTableSQL(table, reader(file)));
    },

    async close(): Promise<void> {
      // Both, in this order: the connection is the database's, and a terminated
      // database leaves a worker running if its connection was never closed.
      await handle.close();
      await database.terminate();
    },
  };
}

/**
 * The port over the node bundle's blocking bindings — the SAME port, promised.
 *
 * WHY it ends in `sqlConnectionOver` instead of building its own object: the
 * load statement, the registered file name and the closing order are laws, and
 * a second implementation of them is a second place they can drift. All this
 * function does is promise four synchronous calls.
 */
export function nodeConnectionOver(bindings: DuckDBNodeBindings): LoadingConnection {
  const connection = bindings.connect();
  return sqlConnectionOver(
    {
      async registerFileText(name: string, text: string): Promise<void> {
        bindings.registerFileText(name, text);
      },
      async terminate(): Promise<void> {
        // WHY `reset` is what "terminate" means here: the blocking bindings own no
        // worker to stop, so letting go of the database IS the whole release.
        bindings.reset();
      },
    },
    {
      async query(sql: string): Promise<DuckDBResult> {
        return connection.query(sql);
      },
      async close(): Promise<void> {
        connection.close();
      },
    },
  );
}

/** How a file inside `@duckdb/duckdb-wasm` becomes a path on disk (node's `require.resolve`, injected so the four names below are pinned without resolving anything). */
export type FileResolver = (specifier: string) => string;

/**
 * The two bundles the node bindings choose between, as paths on disk.
 *
 * WHY both, when only one is ever instantiated: `createDuckDB` runs the same
 * platform-feature check the browser's `selectBundle` runs and picks `eh` where
 * WebAssembly exceptions are available — it needs both entries to choose
 * between, and a missing one is a resolution error at open time, not a fallback.
 */
export function nodeBundles(resolve: FileResolver): DuckDBNodeBundles {
  const at = (file: string): string => resolve(`@duckdb/duckdb-wasm/dist/${file}`);
  return {
    mvp: { mainModule: at('duckdb-mvp.wasm'), mainWorker: at('duckdb-node-mvp.worker.cjs') },
    eh: { mainModule: at('duckdb-eh.wasm'), mainWorker: at('duckdb-node-eh.worker.cjs') },
  };
}

/**
 * The node bundle's module, however the loader answered it: named exports (node's
 * own ESM-over-CJS lexer) or the CJS `default` (a bundler that kept the namespace).
 */
export function nodeModuleOf(imported: unknown): DuckDBNodeModule {
  const namespace = imported as { readonly default?: unknown; readonly createDuckDB?: unknown };
  return (typeof namespace.createDuckDB === 'function' ? namespace : namespace.default) as DuckDBNodeModule;
}

/** The logger the node bundle is opened with: silent unless the caller asked for DuckDB's own output, exactly like the browser arm. */
export function nodeLoggerOf(duckdb: DuckDBNodeModule, log: boolean | undefined): unknown {
  return log === true ? new duckdb.ConsoleLogger() : new duckdb.VoidLogger();
}

// ── The one heavy step. ──────────────────────────────────────────────────

export interface DuckDBConnectionOptions {
  /** Let DuckDB log to the console. Off by default: a library does not print into someone else's app. */
  readonly log?: boolean;
  /**
   * Which host opens the database, when the caller knows better than the
   * judgement ({@link duckdbHostOf}). Omitted, today's judgement stands.
   *
   * WHY a caller ever knows better: jsdom defines a `Worker`, so a jsdom test
   * of a browser app is judged 'browser' and reaches for a CDN bundle over a
   * network the test does not have. `host: 'node'` is that suite saying which
   * host it really is. A named host is not checked against the environment: it
   * is an assertion, and a wrong one fails inside the bundle it named.
   */
  readonly host?: Exclude<DuckDBHost, 'neither'>;
}

/** What node lends this adapter through `process`, narrowed to the one call it makes. */
interface NodeBuiltins {
  getBuiltinModule(name: 'module'): { createRequire(from: string): { resolve: FileResolver } };
}

/**
 * The node bundle's specifier — deliberately a CONST, and deliberately not the
 * package's own `./blocking` subpath.
 *
 * WHY it is not written inside the `import(…)`: a bundler resolves every literal
 * specifier it can see, including one in an arm that only node ever reaches. This
 * package ships the node-blocking bundle as CJS ONLY, while its `./blocking` entry
 * names an `.mjs` file that is not in the tarball — so a browser build of an app
 * that merely imports the data seam FAILS at that unresolvable file. (This repo's
 * own demo bundles did exactly that: their `stub-duckdb-wasm` plugins stub the BARE
 * specifier only, so a subpath reaches the resolver — which is how a consumer's build
 * would meet it too.) A specifier a bundler cannot see statically is one it cannot try
 * to resolve, and node resolves it at run time — where the file really is.
 */
const NODE_BUNDLE = '@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs';

/* v8 ignore start -- fetching a CDN bundle and spawning a browser Worker: unrunnable in this suite by
 * design (a node process has no `Worker`, which is the very fact the judgement above reads). It is kept
 * to a dozen lines that hand a real handle to `sqlConnectionOver`, which IS tested, so the unrun part
 * holds no rules. Its node twin below carries NO such comment: that one the suite really runs. */

/** DuckDB-WASM in a browser: a bundle off the CDN, a worker off a blob, an async database. */
async function openInBrowser(options: DuckDBConnectionOptions): Promise<SqlConnection> {
  const duckdb = await import('@duckdb/duckdb-wasm');
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  // The worker is loaded from a blob that imports the bundle's own script — the recipe
  // DuckDB-WASM documents and Mosaic's own connector uses (`connectors/wasm.js`, `initDatabase`).
  const workerUrl = URL.createObjectURL(new Blob([`importScripts("${String(bundle.mainWorker)}");`], { type: 'text/javascript' }));
  const worker = new Worker(workerUrl);
  const logger = options.log === true ? new duckdb.ConsoleLogger() : new duckdb.VoidLogger();
  const database = new duckdb.AsyncDuckDB(logger, worker);
  await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
  // BEFORE the first connection, exactly where Mosaic's own connector sets its
  // config (`@uwdata/mosaic-core`, `connectors/wasm.ts`): a query config is read
  // when a statement runs, and a connection opened first would already be running them.
  await database.open(READ_CONFIG);
  URL.revokeObjectURL(workerUrl);
  return sqlConnectionOver(database, await database.connect());
}
/* v8 ignore stop */

/** DuckDB-WASM in node: the blocking bindings, the `.wasm` read off disk, no worker anywhere. */
async function openInNode(options: DuckDBConnectionOptions): Promise<SqlConnection> {
  const duckdb = nodeModuleOf(await import(/* @vite-ignore */ NODE_BUNDLE));
  // Resolved from THIS module's own location, so a hoisted, nested or linked
  // copy of the peer is found the same way the import above found it.
  const { resolve } = (globalThis as unknown as { process: NodeBuiltins }).process.getBuiltinModule('module').createRequire(import.meta.url);
  const bindings = await duckdb.createDuckDB(nodeBundles(resolve), nodeLoggerOf(duckdb, options.log), duckdb.NODE_RUNTIME);
  await bindings.instantiate();
  bindings.open(READ_CONFIG); // the same config as the browser arm, set the same way: on the database, before any connection
  return nodeConnectionOver(bindings);
}

/**
 * The opener each host is served by.
 *
 * WHY a lookup and not an `if`: the browser arm cannot run where this suite
 * runs, and a branch nothing takes is a branch nothing PINS. A table says the
 * same thing and is read the same way in both hosts.
 */
const OPENERS: Readonly<Record<Exclude<DuckDBHost, 'neither'>, (options: DuckDBConnectionOptions) => Promise<SqlConnection>>> = {
  browser: openInBrowser,
  node: openInNode,
};

/**
 * The `open` a `wasmProvider` takes: a function that, when finally
 * called, imports DuckDB-WASM, opens a database and answers a connection.
 *
 * Calling THIS function does none of that — it only makes the promise to.
 *
 * WHOEVER OPENED IT CLOSES IT: the connection this opener answers owns a worker
 * (browser) or a database instance (node), and its `close()` releases both. The
 * party that PASSED this opener is the one that closes it — a `wasmProvider`
 * never closes a connection it did not open, and a def's build surfaces the act
 * as `Dashboard.close()` (`../def/wasmBackend.ts`). Nothing in this library
 * closes it on your behalf.
 */
export function duckdbConnection(options: DuckDBConnectionOptions = {}): () => Promise<SqlConnection> {
  return async (): Promise<SqlConnection> => {
    // Judged before the import, so a caller in neither host pays no download to hear "not here".
    const host = options.host ?? duckdbHostOf(hostFactsOf(globalThis as HostGlobals));
    if (host === 'neither') throw new Error(NO_DUCKDB_HOST);
    return OPENERS[host](options);
  };
}
