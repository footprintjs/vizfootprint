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
 * NOTHING IS FETCHED AFTER THE BUNDLE, IN EITHER HOST. Landing `rows` writes
 * CSV text with every column's type declared (`landing.ts`), and DuckDB's
 * CSV reader is statically linked; a `csv` landing is CSV already, its types
 * declared by the same law. The JSON
 * carrier this adapter used to write made the bundle autoload its `json`
 * extension from the vendor's extension repository — one request off the
 * origin, in both hosts — so an offline or CSP-restricted page could not land
 * rows. `ui/gallery/wasm.smoke.test.ts` pins the count of requests that leave
 * the origin at ZERO. And where the bundle itself comes from is the caller's
 * to say: `bundles` ({@link DuckDBConnectionOptions}) hands the browser arm a
 * self-hosted map in place of the CDN's.
 *
 * WHY the blocking bundle and not `dist/duckdb-node.cjs`: the
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
 * {@link landingOf}, {@link nodeBundles}, {@link browserBundlesOf},
 * {@link duckdbHostOf}) and is; the one part that cannot — instantiating a real
 * database — is a dozen lines per host that do nothing but hand those adapters
 * a real handle.
 */

import { loadTableSQL, type LoadingConnection, type SqlConnection, type TableData } from './sqlConnection.js';
import { csvLandingOf, csvReaderSQL, rowsLandingOf, rowsReaderSQL } from './landing.js';
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

/**
 * One bundle a host chooses between: the wasm module, and the worker script
 * that ships beside it. In the browser both are URLs; in node both are paths.
 */
export interface DuckDBBundle {
  readonly mainModule: string;
  readonly mainWorker: string;
}

/**
 * Both flavours — the shape the package's own `selectBundle` (browser) and
 * `createDuckDB` (node) run their platform-feature check over: `eh` where
 * WebAssembly exceptions are available, `mvp` otherwise. Both entries are
 * needed to choose between; a missing one is a resolution error at open time,
 * not a fallback.
 */
export interface DuckDBBundles {
  readonly mvp: DuckDBBundle;
  readonly eh: DuckDBBundle;
}

/** The node arm's names for the same two shapes — kept, so nothing that named them moves. */
export type DuckDBNodeBundle = DuckDBBundle;
export type DuckDBNodeBundles = DuckDBBundles;

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
 * WHY it is not a default anyone can live with: a landing declares BIGINT for
 * every integer column (`landing.ts`), and a host's own tables hold whatever
 * they hold — HUGEINT, DECIMAL. Unset, DuckDB then answers `amount: 15` as the JS bigint `15n`
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

/** What one table's landing registers and reads: the file name, the text under it, and the reader `loadTableSQL` selects from. */
export interface Landing {
  readonly file: string;
  readonly text: string;
  readonly from: string;
}

/**
 * The landing for a table's bytes — the ONE place both kinds are decided, so
 * the first landing of a def's table and a reland's staging landing
 * (`wasmProvider.replaceRows`, through the same `load`) carry rows one way,
 * and a `csv` table and the rows that later refresh it are typed by one law.
 *
 * `rows` are written as CSV with every column typed (`landing.ts` ·
 * `rowsLandingOf`); a `csv` text is registered as it came — DuckDB reads the
 * def's own bytes and detects their dialect — with its types declared from the
 * memory engine's own sniff of the same text (`csvLandingOf`). Both are CSV,
 * so both register `<table>.csv`.
 */
export function landingOf(table: string, data: TableData): Landing {
  const file = `${table}.csv`;
  if (data.kind === 'csv') {
    const { text, columns } = csvLandingOf(data.text);
    return { file, text, from: csvReaderSQL(file, columns) };
  }
  const { text, columns } = rowsLandingOf(data.rows);
  return { file, text, from: rowsReaderSQL(file, columns) };
}

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
      const { file, text, from } = landingOf(table, data);
      await database.registerFileText(file, text);
      await handle.query(loadTableSQL(table, from));
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
 * The two bundles the node bindings choose between, as paths on disk — the
 * node arm's own map, resolved off the installed peer (see {@link DuckDBBundles}
 * for why both are needed when one is instantiated).
 */
export function nodeBundles(resolve: FileResolver): DuckDBBundles {
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
  /**
   * Where the BROWSER arm's bundles are, when they are not on the CDN: a map
   * of the two flavours, each a wasm module URL and a worker script URL, read
   * by `openInBrowser` in place of the package's jsDelivr map. Omitted, the
   * CDN's. The node arm reads the peer off disk and never consults it.
   *
   * WHY absolute URLs: the worker is spawned off a `blob:` URL that
   * `importScripts` the worker script, and a `blob:` URL is no base for a
   * relative one — spell `mainWorker` out in full.
   *
   *   duckdbConnection({ bundles: {
   *     mvp: { mainModule: `${origin}/duckdb/duckdb-mvp.wasm`, mainWorker: `${origin}/duckdb/duckdb-browser-mvp.worker.js` },
   *     eh:  { mainModule: `${origin}/duckdb/duckdb-eh.wasm`,  mainWorker: `${origin}/duckdb/duckdb-browser-eh.worker.js` },
   *   } })
   */
  readonly bundles?: DuckDBBundles;
}

/**
 * The map the browser arm selects from: the caller's, or the CDN's asked for
 * only when the caller gave none — so a self-hosting page never computes a
 * jsDelivr URL it will not use.
 */
export function browserBundlesOf<Cdn>(given: DuckDBBundles | undefined, cdn: () => Cdn): DuckDBBundles | Cdn {
  return given ?? cdn();
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

/**
 * How long a browser bundle is given to instantiate before its worker is
 * presumed stuck. Not a network budget — a "this will never load" backstop: a
 * worker that throws while compiling a 404'd module (measured: a
 * `WebAssembly.compile` `TypeError`, thrown INSIDE the worker) never rejects
 * the `instantiate()` promise the main thread is holding — the worker's own
 * uncaught exception does not cross that boundary, so `instantiate()` hangs
 * FOREVER, not merely slowly, on a self-hosted `bundles` path that is wrong.
 * Twenty seconds is generous beside every measured instantiate in this suite
 * (low hundreds of milliseconds, `bench/step0-wasm`) and short beside a person
 * watching a blank page.
 */
export const BUNDLE_INSTANTIATE_TIMEOUT_MS = 20_000;

/**
 * The sentence a stuck `instantiate()` is refused in — the bundle's own two
 * paths, so a wrong one is named, not guessed at. `mainWorker` is typed
 * nullable here (and only here) because that is how the package's own
 * `selectBundle` answers it — every bundle THIS adapter builds or accepts
 * ({@link DuckDBBundle}) always has one.
 */
export function bundleTimeoutSentence(bundle: { readonly mainModule: string; readonly mainWorker: string | null }, ms: number): string {
  return `DuckDB-WASM did not open within ${String(ms)}ms — the module ("${bundle.mainModule}") or the worker ("${String(bundle.mainWorker)}") a self-hosted bundles map named may not be reachable there`;
}

/**
 * `promise`, or `sentence` — whichever answers first.
 *
 * WHY this exists at all: {@link BUNDLE_INSTANTIATE_TIMEOUT_MS}'s doc names the
 * hang this races against. A timeout that fires AFTER `promise` settled would
 * leak a timer for the life of the page, so the winning side always clears it.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, sentence: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(sentence)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}

/* v8 ignore start -- fetching a CDN bundle and spawning a browser Worker: unrunnable in this suite by
 * design (a node process has no `Worker`, which is the very fact the judgement above reads). It is kept
 * to a dozen lines that hand a real handle to `sqlConnectionOver`, which IS tested, so the unrun part
 * holds no rules. Its node twin below carries NO such comment: that one the suite really runs. */

/** DuckDB-WASM in a browser: a bundle off the caller's map or the CDN's, a worker off a blob, an async database. */
async function openInBrowser(options: DuckDBConnectionOptions): Promise<SqlConnection> {
  const duckdb = await import('@duckdb/duckdb-wasm');
  const bundle = await duckdb.selectBundle(browserBundlesOf(options.bundles, duckdb.getJsDelivrBundles));
  // The worker is loaded from a blob that imports the bundle's own script — the recipe
  // DuckDB-WASM documents and Mosaic's own connector uses (`connectors/wasm.js`, `initDatabase`).
  const workerUrl = URL.createObjectURL(new Blob([`importScripts("${String(bundle.mainWorker)}");`], { type: 'text/javascript' }));
  const worker = new Worker(workerUrl);
  const logger = options.log === true ? new duckdb.ConsoleLogger() : new duckdb.VoidLogger();
  const database = new duckdb.AsyncDuckDB(logger, worker);
  try {
    await withTimeout(database.instantiate(bundle.mainModule, bundle.pthreadWorker), BUNDLE_INSTANTIATE_TIMEOUT_MS, bundleTimeoutSentence(bundle, BUNDLE_INSTANTIATE_TIMEOUT_MS));
  } catch (error) {
    // the worker never finished opening: nothing to close but the worker and the blob that named it
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
    throw error;
  }
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
