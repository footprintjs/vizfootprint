/**
 * duckdbConnection.test.ts — THE ADAPTER IS JUDGED WITHOUT A DATABASE IN THE
 * ROOM, AND THE HEAVY STEP IS JUDGED BY WHAT IT REFUSES TO DO HERE.
 *
 * Everything DuckDB-WASM-specific in this library is either (a) a small
 * adapter over a structural handle — faked here, line for line — or (b) the
 * dozen lines that spawn a real worker, which this suite cannot run and does
 * not pretend to: what it CAN pin is that they never run by accident. Merely
 * importing this module, or building the opener, must fetch nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  browserBundlesOf,
  bundleTimeoutSentence,
  duckdbConnection,
  duckdbHostOf,
  hostFactsOf,
  landingOf,
  nodeBundles,
  nodeConnectionOver,
  nodeLoggerOf,
  withTimeout,
  nodeModuleOf,
  rowOf,
  rowsOf,
  sqlConnectionOver,
  NO_DUCKDB_HOST,
  type DuckDBBundles,
  type DuckDBDatabase,
  type DuckDBHandle,
  type DuckDBNodeBindings,
  type DuckDBNodeModule,
  type DuckDBResult,
} from './duckdbConnection.js';
import { csvReaderSQL, rowsReaderSQL, NO_CSV_HEADER, NO_ROWS_TO_LAND } from './landing.js';
import { canLoad } from './sqlConnection.js';
import { ROW_ORDER_COLUMN } from './sqlWindow.js';

/** An Arrow row as `Table.toArray()` hands it over: fields reachable only through `toJSON`. */
const arrowRow = (fields: Record<string, unknown>): unknown => ({ toJSON: () => fields });

/**
 * What a fake was handed, DECODED: the port registers bytes, and a pin on a
 * registered file compares the text those bytes decode to — strictly, so a
 * byte that is not UTF-8 fails here rather than reading as U+FFFD.
 */
const decoded = (registered: readonly (readonly [string, Uint8Array])[]): (readonly [string, string])[] =>
  registered.map(([name, bytes]) => [name, new TextDecoder('utf-8', { fatal: true }).decode(bytes)] as const);

interface FakeDatabase extends DuckDBDatabase {
  readonly registered: readonly (readonly [string, Uint8Array])[];
  readonly terminated: () => number;
}

interface FakeHandle extends DuckDBHandle {
  readonly asked: readonly string[];
  readonly closed: () => number;
}

function fakeDatabase(): FakeDatabase {
  const registered: [string, Uint8Array][] = [];
  let terminated = 0;
  return {
    registered,
    terminated: () => terminated,
    async registerFileBuffer(name: string, bytes: Uint8Array): Promise<void> {
      registered.push([name, bytes]);
    },
    async terminate(): Promise<void> {
      terminated += 1;
    },
  };
}

function fakeHandle(result: readonly unknown[] = []): FakeHandle {
  const asked: string[] = [];
  let closed = 0;
  return {
    asked,
    closed: () => closed,
    async query(sql: string): Promise<DuckDBResult> {
      asked.push(sql);
      return { toArray: () => result };
    },
    async close(): Promise<void> {
      closed += 1;
    },
  };
}

describe('an Arrow result becomes plain rows', () => {
  it('a proxy row is asked for its plain object — a spread would copy nothing', () => {
    expect(rowOf(arrowRow({ week: 1, disease: 'Lyme' }))).toEqual({ week: 1, disease: 'Lyme' });
  });

  it('a handle that already answers plain objects is copied as it is', () => {
    const row = { week: 2 };
    const copied = rowOf(row);
    expect(copied).toEqual(row);
    expect(copied).not.toBe(row); // a copy, so a later mutation of the driver's buffer cannot rewrite an answered row
  });

  it('a whole result is every row of it, in the order the result gave them', () => {
    expect(rowsOf({ toArray: () => [arrowRow({ id: 'a' }), { id: 'b' }] })).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});

describe('the port over an open handle', () => {
  it('reads: the statement goes to the handle, the rows come back plain', async () => {
    const handle = fakeHandle([arrowRow({ n: 3n })]);
    const connection = sqlConnectionOver(fakeDatabase(), handle);
    expect(await connection.query('SELECT COUNT(*) AS n FROM "cases"')).toEqual([{ n: 3n }]);
    expect(handle.asked).toEqual(['SELECT COUNT(*) AS n FROM "cases"']);
  });

  it('loads rows: registered as CSV BYTES with every column typed, under the table s own name, then landed WITH the source-order column', async () => {
    const database = fakeDatabase();
    const handle = fakeHandle();
    await sqlConnectionOver(database, handle).load('cases', { kind: 'rows', rows: [{ id: 1 }, { id: 2 }] });
    expect(database.registered[0]![1]).toBeInstanceOf(Uint8Array); // bytes, never a string — the engine's own door, with no string cap in front of it
    expect(decoded(database.registered)).toEqual([['cases.csv', '"id"\n1\n2\n']]);
    expect(handle.asked[0]).toBe(
      `CREATE OR REPLACE TABLE "cases" AS SELECT *, (row_number() OVER ()) - 1 AS "${ROW_ORDER_COLUMN}" FROM ${rowsReaderSQL('cases.csv', [{ name: 'id', type: 'BIGINT' }])}`,
    );
    // the reader is the statically linked CSV one, its options spelled out and its columns declared — nothing for the engine to detect, nothing for it to fetch
    expect(handle.asked[0]).toContain(`FROM read_csv('cases.csv', header=true, delim=',', quote='"', escape='"', new_line='\\n', nullstr='\\N', allow_quoted_nulls=false, columns={'id': 'BIGINT'})`);
  });

  it('refuses to land zero rows, in the carrier s own words — the JSON reader used to land a phantom column', async () => {
    const database = fakeDatabase();
    const handle = fakeHandle();
    await expect(sqlConnectionOver(database, handle).load('cases', { kind: 'rows', rows: [] })).rejects.toThrow(NO_ROWS_TO_LAND);
    expect(database.registered).toEqual([]);
    expect(handle.asked).toEqual([]);
  });

  it('loads CSV text as it came — the def s bytes are the def s — with its types declared by the library s own sniff of it', async () => {
    const database = fakeDatabase();
    const handle = fakeHandle();
    await sqlConnectionOver(database, handle).load('weeks', { kind: 'csv', text: 'id,day\n1,2026-04-05' });
    expect(decoded(database.registered)).toEqual([['weeks.csv', 'id,day\n1,2026-04-05']]);
    // the dialect is DuckDB's to detect; the types are the memory engine's words — the day is a string, never a sniffed DATE
    expect(handle.asked[0]).toContain(`FROM read_csv('weeks.csv', header=true, types={'id': 'BIGINT', 'day': 'VARCHAR'})`);
  });

  it('refuses a CSV text with no header, in the carrier s own words', async () => {
    const database = fakeDatabase();
    const handle = fakeHandle();
    await expect(sqlConnectionOver(database, handle).load('weeks', { kind: 'csv', text: '' })).rejects.toThrow(NO_CSV_HEADER);
    expect(database.registered).toEqual([]);
  });

  it('both kinds are ONE landing: the same file name, the same shape — bytes — the same type law, decided in one place', () => {
    const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
    expect(landingOf('t', { kind: 'csv', text: 'a\n1' })).toEqual({ file: 't.csv', bytes: bytes('a\n1'), from: csvReaderSQL('t.csv', [{ name: 'a', type: 'BIGINT' }]) });
    expect(landingOf('t', { kind: 'rows', rows: [{ a: 1 }] })).toEqual({ file: 't.csv', bytes: bytes('"a"\n1\n'), from: rowsReaderSQL('t.csv', [{ name: 'a', type: 'BIGINT' }]) });
  });

  it('closes the connection before it terminates the database — the other order leaves a worker running', async () => {
    const database = fakeDatabase();
    const handle = fakeHandle();
    const connection = sqlConnectionOver(database, handle);
    expect(canLoad(connection)).toBe(true);
    await connection.close?.();
    expect([handle.closed(), database.terminated()]).toEqual([1, 1]);
  });
});

describe('which host opens the database is a judgement over two facts', () => {
  it('reads the two globals, and neither of them by reaching for it', () => {
    expect(hostFactsOf({})).toEqual({ worker: false, node: false });
    expect(hostFactsOf({ Worker: class {} })).toEqual({ worker: true, node: false });
    expect(hostFactsOf({ process: {} })).toEqual({ worker: false, node: false }); // a node older than getBuiltinModule
    expect(hostFactsOf({ process: { getBuiltinModule: (): void => {} } })).toEqual({ worker: false, node: true });
  });

  it('…and THIS environment answers node: a suite that has no Worker and asks node for its own builtins', () => {
    expect(hostFactsOf(globalThis)).toEqual({ worker: false, node: true });
    expect(duckdbHostOf(hostFactsOf(globalThis))).toBe('node');
  });

  it('a Worker means browser, node alone means node, neither means neither', () => {
    expect(duckdbHostOf({ worker: true, node: false })).toBe('browser');
    expect(duckdbHostOf({ worker: false, node: true })).toBe('node');
    expect(duckdbHostOf({ worker: false, node: false })).toBe('neither');
  });

  it('an Electron renderer answers to both, and the browser wins — its Worker is the real thing', () => {
    expect(duckdbHostOf({ worker: true, node: true })).toBe('browser');
  });
});

describe('the node bundle is four files, named once', () => {
  it('both bundles are resolved through the injected resolver, off the package this library declares as a peer', () => {
    const asked: string[] = [];
    const bundles = nodeBundles((specifier) => {
      asked.push(specifier);
      return `/node_modules/${specifier}`;
    });
    expect(bundles).toEqual({
      mvp: { mainModule: '/node_modules/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm', mainWorker: '/node_modules/@duckdb/duckdb-wasm/dist/duckdb-node-mvp.worker.cjs' },
      eh: { mainModule: '/node_modules/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm', mainWorker: '/node_modules/@duckdb/duckdb-wasm/dist/duckdb-node-eh.worker.cjs' },
    });
    expect(asked.every((specifier) => specifier.startsWith('@duckdb/duckdb-wasm/dist/'))).toBe(true);
  });

  it('the four files really are in the installed peer — the paths are resolved, not hoped for', () => {
    // The one test here that touches the real package, and it opens nothing: `require.resolve`
    // answers a path or throws, so a renamed bundle file fails HERE rather than inside an instantiate.
    const resolve = process.getBuiltinModule('module').createRequire(import.meta.url).resolve;
    const bundles = nodeBundles(resolve);
    for (const path of [bundles.mvp.mainModule, bundles.mvp.mainWorker, bundles.eh.mainModule, bundles.eh.mainWorker]) {
      expect(statSync(path).size).toBeGreaterThan(0);
    }
  });

  it('the module is read whichever way the loader answered it — named exports, or a CJS default', () => {
    const named = { createDuckDB: (): void => {}, NODE_RUNTIME: {} };
    expect(nodeModuleOf(named)).toBe(named);
    expect(nodeModuleOf({ default: named })).toBe(named);
  });

  it('and it is opened silently unless the caller asked for DuckDB’s own output', () => {
    class Console {}
    class Void {}
    const module = { ConsoleLogger: Console, VoidLogger: Void } as unknown as DuckDBNodeModule;
    expect(nodeLoggerOf(module, undefined)).toBeInstanceOf(Void);
    expect(nodeLoggerOf(module, false)).toBeInstanceOf(Void);
    expect(nodeLoggerOf(module, true)).toBeInstanceOf(Console);
  });
});

describe('the port over the node bundle is the SAME port, promised', () => {
  /** The blocking bindings, faked: every call synchronous, and each one written down. */
  function fakeBindings(result: readonly unknown[] = []): DuckDBNodeBindings & { readonly asked: string[]; readonly registered: [string, Uint8Array][]; readonly ended: () => string[] } {
    const asked: string[] = [];
    const registered: [string, Uint8Array][] = [];
    const ended: string[] = [];
    return {
      asked,
      registered,
      ended: () => ended,
      open: (config): void => {
        ended.push(`opened ${JSON.stringify(config)}`);
      },
      connect: () => {
        ended.push('connected');
        return {
          query: (sql: string): DuckDBResult => {
            asked.push(sql);
            return { toArray: () => result };
          },
          close: (): void => {
            ended.push('closed');
          },
        };
      },
      registerFileBuffer: (name: string, bytes: Uint8Array): void => {
        registered.push([name, bytes]);
      },
      reset: (): void => {
        ended.push('reset');
      },
      instantiate: async (): Promise<unknown> => undefined,
    };
  }

  it('connects ONCE, and reads through that one connection', async () => {
    const bindings = fakeBindings([arrowRow({ n: 3n })]);
    const connection = nodeConnectionOver(bindings);
    expect(await connection.query('SELECT COUNT(*) AS n FROM "cases"')).toEqual([{ n: 3n }]);
    expect(await connection.query('SELECT COUNT(*) AS n FROM "cases"')).toEqual([{ n: 3n }]);
    expect(bindings.ended()).toEqual(['connected']); // …not one connection per statement
  });

  it('lands a table through the same registered file and the same one statement as the browser port', async () => {
    const bindings = fakeBindings();
    await nodeConnectionOver(bindings).load('cases', { kind: 'rows', rows: [{ id: 1 }] });
    expect(decoded(bindings.registered)).toEqual([['cases.csv', '"id"\n1\n']]);
    expect(bindings.asked[0]).toBe(
      `CREATE OR REPLACE TABLE "cases" AS SELECT *, (row_number() OVER ()) - 1 AS "${ROW_ORDER_COLUMN}" FROM ${rowsReaderSQL('cases.csv', [{ name: 'id', type: 'BIGINT' }])}`,
    );
    expect(canLoad(nodeConnectionOver(bindings))).toBe(true);
  });

  it('closes the connection before it lets the database go — the blocking bundle owns no worker, and the order is still the port’s', async () => {
    const bindings = fakeBindings();
    await nodeConnectionOver(bindings).close?.();
    expect(bindings.ended()).toEqual(['connected', 'closed', 'reset']);
  });
});

describe('where the browser arm s bundles come from is the caller s to say', () => {
  const own: DuckDBBundles = {
    mvp: { mainModule: 'https://example.test/duckdb/duckdb-mvp.wasm', mainWorker: 'https://example.test/duckdb/duckdb-browser-mvp.worker.js' },
    eh: { mainModule: 'https://example.test/duckdb/duckdb-eh.wasm', mainWorker: 'https://example.test/duckdb/duckdb-browser-eh.worker.js' },
  };

  it('a given map is the map, and the CDN s is never even computed', () => {
    const cdn = vi.fn(() => ({ mvp: { mainModule: 'cdn', mainWorker: 'cdn' }, eh: { mainModule: 'cdn', mainWorker: 'cdn' } }));
    expect(browserBundlesOf(own, cdn)).toBe(own);
    expect(cdn).not.toHaveBeenCalled();
  });

  it('no map given, the CDN s is asked for — today s behaviour, untouched', () => {
    const cdn = vi.fn(() => ({ mvp: { mainModule: 'cdn-mvp', mainWorker: 'cdn-mvp-worker' }, eh: { mainModule: 'cdn-eh', mainWorker: 'cdn-eh-worker' } }));
    expect(browserBundlesOf(undefined, cdn)).toEqual({ mvp: { mainModule: 'cdn-mvp', mainWorker: 'cdn-mvp-worker' }, eh: { mainModule: 'cdn-eh', mainWorker: 'cdn-eh-worker' } });
    expect(cdn).toHaveBeenCalledTimes(1);
  });

  it('the option is carried by the opener without being read until the browser arm runs — the node arm never consults it', async () => {
    // built with a map, opened in node: the map is not what the node arm reads (it resolves the peer off disk), so the open still succeeds
    const connection = await duckdbConnection({ host: 'node', bundles: own })();
    expect(await connection.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    await connection.close?.();
  });
});

describe('a bundle that never opens gets a sentence, not a hang — a caller s wrong path is named', () => {
  // real, short timeouts throughout: fake timers and a bare `Promise.reject` raced each other in this
  // suite's runner and tripped an unhandled-rejection warning even though `withTimeout` DID handle it —
  // a few real milliseconds sidesteps that entirely and is still an instant test.

  it('the fast side wins: a promise that resolves before the clock does answers', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'never')).resolves.toBe('ok');
  });

  it('the fast side wins the other way too: a promise that REJECTS before the clock still answers with ITS OWN reason', async () => {
    await expect(withTimeout(Promise.reject(new Error('real cause')), 50, 'never')).rejects.toThrow('real cause');
  });

  it('a promise that never settles — the worker-hang this guards against — loses to the clock, in the named sentence', async () => {
    const stuck = new Promise<never>(() => {}); // exactly what a 404'd module's worker leaves `instantiate()` holding
    const sentence = bundleTimeoutSentence({ mainModule: 'https://example.test/duckdb-mvp.wasm', mainWorker: 'https://example.test/duckdb-browser-mvp.worker.js' }, 10);
    await expect(withTimeout(stuck, 10, sentence)).rejects.toThrow(/did not open within 10ms.*duckdb-mvp\.wasm.*duckdb-browser-mvp\.worker\.js/s);
  });
});

describe('the heavy step is a promise to open, not an opening', () => {
  it('building the opener imports no DuckDB and spawns nothing — it just answers a function', () => {
    expect(typeof duckdbConnection()).toBe('function');
    expect(typeof duckdbConnection({ log: true })).toBe('function');
  });

  it('called where neither host exists, it says so BEFORE it would import anything', async () => {
    // The judgement is the FIRST thing the opener does and it is synchronous, so the
    // stubbed global is only in place for one statement — and the refusal is already
    // decided when `opener()` returns. `{}` is an honest stand-in: a node too old to
    // have `process.getBuiltinModule`, which is the floor the sentence names.
    const opener = duckdbConnection();
    vi.stubGlobal('process', {});
    const refused = opener();
    vi.unstubAllGlobals();
    await expect(refused).rejects.toThrow(NO_DUCKDB_HOST);
    expect(NO_DUCKDB_HOST).toContain('hand wasmProvider its own { connection }');
  });
});

describe('the optional peer is named ONCE, and named late', () => {
  // The law PACKAGING.md rests on (Law 3, "the third optional peer"): the
  // package is on the ordinary `vizfootprint/data` barrel with no door of its
  // own, and what makes that safe is that no shipped module STATICALLY imports
  // it. Pinned the way the `@uwdata` peers are pinned in src/mosaic.
  it('no shipped module under src/ imports @duckdb, and the one that names it does so inside a function', () => {
    const src = fileURLToPath(new URL('..', import.meta.url));
    const staticImporters: string[] = [];
    const namers: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const file = join(dir, name);
        if (statSync(file).isDirectory()) walk(file);
        else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.includes('.coverage.helpers.')) {
          const text = readFileSync(file, 'utf8');
          if (/from\s+['"]@duckdb\//.test(text)) staticImporters.push(file.slice(src.length));
          if (text.includes('@duckdb/')) namers.push(file.slice(src.length));
        }
      }
    };
    walk(src);
    expect(staticImporters).toEqual([]);
    expect(namers).toEqual(['data/duckdbConnection.ts']);
    // …and in that one module the name sits in an `await import(…)`, never at the top
    const text = readFileSync(join(src, 'data/duckdbConnection.ts'), 'utf8');
    expect(text).toContain("await import('@duckdb/duckdb-wasm')");
    // …and the node bundle is named too, but as a CONST a bundler cannot resolve: the
    // package ships that one as CJS only, and a browser build that tried to resolve it
    // would fail on an `.mjs` the tarball does not contain
    expect(text).toContain("const NODE_BUNDLE = '@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'");
    expect(text).toContain('await import(/* @vite-ignore */ NODE_BUNDLE)');
    // the node arm reaches its own builtins through `process`, never through a `node:` specifier a browser bundler would have to resolve
    expect(/from\s+['\"]node:/.test(text)).toBe(false);
  });
});
