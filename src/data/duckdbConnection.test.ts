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
  duckdbConnection,
  duckdbHostOf,
  hostFactsOf,
  nodeBundles,
  nodeConnectionOver,
  nodeLoggerOf,
  nodeModuleOf,
  rowOf,
  rowsOf,
  sqlConnectionOver,
  NO_DUCKDB_HOST,
  type DuckDBDatabase,
  type DuckDBHandle,
  type DuckDBNodeBindings,
  type DuckDBNodeModule,
  type DuckDBResult,
} from './duckdbConnection.js';
import { canLoad } from './sqlConnection.js';
import { ROW_ORDER_COLUMN } from './sqlWindow.js';

/** An Arrow row as `Table.toArray()` hands it over: fields reachable only through `toJSON`. */
const arrowRow = (fields: Record<string, unknown>): unknown => ({ toJSON: () => fields });

interface FakeDatabase extends DuckDBDatabase {
  readonly registered: readonly (readonly [string, string])[];
  readonly terminated: () => number;
}

interface FakeHandle extends DuckDBHandle {
  readonly asked: readonly string[];
  readonly closed: () => number;
}

function fakeDatabase(): FakeDatabase {
  const registered: [string, string][] = [];
  let terminated = 0;
  return {
    registered,
    terminated: () => terminated,
    async registerFileText(name: string, text: string): Promise<void> {
      registered.push([name, text]);
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

  it('loads rows: registered as JSON text under the table s own name, then landed WITH the source-order column', async () => {
    const database = fakeDatabase();
    const handle = fakeHandle();
    await sqlConnectionOver(database, handle).load('cases', { kind: 'rows', rows: [{ id: 1 }, { id: 2 }] });
    expect(database.registered).toEqual([['cases.json', '[{"id":1},{"id":2}]']]);
    expect(handle.asked[0]).toBe(`CREATE OR REPLACE TABLE "cases" AS SELECT *, (row_number() OVER ()) - 1 AS "${ROW_ORDER_COLUMN}" FROM read_json_auto('cases.json')`);
  });

  it('loads CSV text the same way, through the CSV reader', async () => {
    const database = fakeDatabase();
    const handle = fakeHandle();
    await sqlConnectionOver(database, handle).load('weeks', { kind: 'csv', text: 'id\n1' });
    expect(database.registered).toEqual([['weeks.csv', 'id\n1']]);
    expect(handle.asked[0]).toContain("FROM read_csv_auto('weeks.csv')");
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
  function fakeBindings(result: readonly unknown[] = []): DuckDBNodeBindings & { readonly asked: string[]; readonly registered: [string, string][]; readonly ended: () => string[] } {
    const asked: string[] = [];
    const registered: [string, string][] = [];
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
      registerFileText: (name: string, text: string): void => {
        registered.push([name, text]);
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
    expect(bindings.registered).toEqual([['cases.json', '[{"id":1}]']]);
    expect(bindings.asked[0]).toBe(`CREATE OR REPLACE TABLE "cases" AS SELECT *, (row_number() OVER ()) - 1 AS "${ROW_ORDER_COLUMN}" FROM read_json_auto('cases.json')`);
    expect(canLoad(nodeConnectionOver(bindings))).toBe(true);
  });

  it('closes the connection before it lets the database go — the blocking bundle owns no worker, and the order is still the port’s', async () => {
    const bindings = fakeBindings();
    await nodeConnectionOver(bindings).close?.();
    expect(bindings.ended()).toEqual(['connected', 'closed', 'reset']);
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
