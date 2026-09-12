/**
 * wasmBackend.ts — ONE DEF, ONE SQL BACKEND: EVERY WASM TABLE IN A BUILD LANDS
 * IN THE SAME DATABASE, ONCE, PUT THERE BY WHOEVER ASKS FIRST.
 *
 * `wasmProvider` is inert on purpose (`../data/wasmProvider.ts`): it opens
 * nothing until a read needs a backend, and it does not know where a table's
 * bytes come from. A def DOES know — `data[t].rows`, `data[t].csv`, or the rows
 * a carrier fetched — so something has to carry them from the declaration to
 * the connection. This is that something, and it keeps four laws:
 *
 *   1. ONE CONNECTION PER BUILD. Two wasm tables are two providers, and two
 *      providers each opening their own DuckDB would be two databases that
 *      cannot see each other's tables. They share this backend's opener, and
 *      that opener is memoised.
 *   2. THE BYTES LAND BEFORE THE FIRST QUERY. The opener each provider is given
 *      opens the connection AND lands every declared table, so the SYNC door —
 *      which cannot await anything — still answers on the first read.
 *   3. A FAILURE IS A SENTENCE, NEVER A THROW. {@link WasmBackend.settle} never
 *      rejects: the async door reads its outcomes as build notes, and the very
 *      same failure reaches a reader as the provider's own
 *      `no-backend-connection` refusal.
 *   4. WHOEVER OPENED IT CLOSES IT. {@link WasmBackend.close} closes the
 *      connection THIS backend opened and nothing else: a host that passed
 *      `openSqlConnection` keeps its own database open, because the host may be
 *      reading it through five other things this build has never heard of.
 *
 * First customers: `buildDashboard` (declares its tables, hands the opener over,
 * notes that nothing has landed yet) and `buildDashboardAsync` (declares, awaits
 * `settle()`, notes whatever did not land). Both surface law 4 as
 * `Dashboard.close()`.
 */

import {
  canLoad,
  duckdbConnection,
  wasmProvider,
  type DataProvider,
  type SqlConnection,
  type TableData,
} from '../data/index.js';

// ── The data: a table's bytes, and what its landing said. ────────────────

/**
 * One table as this engine sees it: the bytes that land in the backend.
 *
 * WHY a named record around one field: it is the thing that travels from a def's
 * declaration to a connection, and it used to carry a second field — a
 * `{ kind, fileName }` DECLARATION the provider read for its keys and nothing
 * else (`WasmProviderOptions.sources` is a list of table NAMES now). One field
 * that is really read beats two where one was decoration.
 */
export interface WasmBytes {
  readonly data: TableData;
}

/** What one declared table's landing said. `failed` carries the whole sentence, ready to be a build note. */
export type WasmLoadOutcome =
  | { readonly table: string; readonly loaded: true }
  | { readonly table: string; readonly failed: string };

// ── The sentences. ───────────────────────────────────────────────────────

/** What a thrown thing SAYS. Quoted into a refusal, never parsed — the R12 firewall, one folder down. */
const causeOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The connection opened and reads fine, but it cannot be asked to LAND a table — the one failure the host's own option can fix. */
export const cannotLandRefusal = (table: string): string =>
  `the SQL connection this build opened cannot land "${table}": it answers queries only (no load) — load that table into your backend yourself before the first read, or pass an opener that can (openSqlConnection: duckdbConnection())`;

/** The connection was there, the load was asked, and the backend said no. The cause is quoted; the load is not asked again. */
export const landFailedRefusal = (table: string, cause: string): string =>
  `the "wasm" engine could not land "${table}" in its SQL backend: ${cause} — every read of it is refused by a backend that never received it`;

/** No connection at all: ONE cause, filed against every table that was waiting for it. */
export const noConnectionRefusal = (table: string, cause: string): string =>
  `the "wasm" engine could not open a SQL connection to land "${table}" in: ${cause} — every read of it is refused in those words`;

// ── Reading a declaration as bytes. ──────────────────────────────────────

/**
 * What a def's inline table hands this engine.
 *
 * WHY `csv` keeps its text instead of being decoded here: DuckDB reads the
 * def's own bytes and detects their dialect; only the TYPES are the library's
 * (`../data/landing.ts` · `csvLandingOf`, the memory engine's own sniff of the
 * same text), so both engines describe one table without this library
 * re-serialising anything.
 */
export function wasmBytesOf(source: { rows?: readonly unknown[]; csv?: string }): WasmBytes {
  if (typeof source.csv === 'string') return { data: { kind: 'csv', text: source.csv } };
  /* v8 ignore next -- rows is guaranteed defined here by the R12 firewall (rows XOR csv); unreachable through either build door */
  return wasmRowBytes((source.rows ?? []) as readonly Record<string, unknown>[]);
}

/** …and what a SOURCE table hands it: a carrier's bytes reach this engine as the rows the carrier decoded. */
export function wasmRowBytes(rows: readonly Record<string, unknown>[]): WasmBytes {
  return { data: { kind: 'rows', rows } };
}

// ── The backend. ─────────────────────────────────────────────────────────

/** This build's ONE wasm backend: every table that runs on the engine goes through it. */
export interface WasmBackend {
  /**
   * The provider for one wasm table. Its bytes are remembered here and it is
   * given this build's shared opener, so construction stays inert: nothing is
   * imported, opened or landed until a read needs an answer.
   */
  provider(table: string, bytes: WasmBytes): DataProvider;
  /**
   * Open the connection and land every remembered table NOW, and say what each
   * landing said. Never rejects, and answers `[]` without opening anything when
   * no table was ever declared — a def with no wasm table spawns no database.
   */
  settle(): Promise<readonly WasmLoadOutcome[]>;
  /**
   * Told when a landing happens — WITHOUT forcing one. Resolves once, with what
   * that landing said, the moment EITHER `settle()` or a read that pays for a
   * lazy table (`ready()`, reached through `provider()`'s `open`) actually lands
   * this build's wasm tables; never resolves for a build that never reads and
   * never calls `settle()` — which is fine, because nothing ever asked.
   *
   * WHY this belongs on the ONE funnel and not a second one: `landAll` is
   * already the only place bytes reach a connection (`ready()` memoises it), so
   * telling a caller "it happened" is a second listener on that same promise,
   * never a second way to trigger it. First customer: the sync door
   * (`./buildDashboard.ts` · `buildDashboard`) — it cannot await a lazy
   * landing, but it still wants to learn what landed once something else pays
   * for it (`learnLanded`).
   */
  whenLanded(): Promise<readonly WasmLoadOutcome[]>;
  /**
   * Release the connection THIS backend opened. A no-op — and never a throw —
   * when there is nothing this backend owns to release: no wasm table was
   * declared, no read ever opened one, the host supplied its own opener, or it
   * has already been closed once. Safe to call twice.
   */
  close(): Promise<void>;
}

/** The connection, and what happened to each table on the way in. */
interface Landed {
  readonly connection: SqlConnection;
  readonly outcomes: readonly WasmLoadOutcome[];
}

/** One table into the backend — the only step that can fail two different ways, so it is the only one that names both. */
async function land(connection: SqlConnection, table: string, data: TableData): Promise<WasmLoadOutcome> {
  if (!canLoad(connection)) return { table, failed: cannotLandRefusal(table) };
  try {
    await connection.load(table, data);
    return { table, loaded: true };
  } catch (error) {
    return { table, failed: landFailedRefusal(table, causeOf(error)) };
  }
}

/**
 * Open a build's wasm backend.
 *
 * @param open how the connection is opened — a host's own, or a test's fake.
 *   Omitted, this backend opens its OWN, and is then the party that closes it.
 * @param openOwn how it opens its own: `duckdbConnection()` in every shipped
 *   call, and still called lazily. Injected for the reason `nodeBundles` takes
 *   its resolver: the OWNER's release path is a law — a connection with nothing
 *   to release, an open that failed, a close asked twice — and a law provable
 *   only against a real database is a law that gets tested once and never again.
 */
export function wasmBackend(open?: () => Promise<SqlConnection>, openOwn?: () => Promise<SqlConnection>): WasmBackend {
  const bytes = new Map<string, TableData>();
  let landing: Promise<Landed> | undefined;
  let closed = false;
  // WHY the OWNER is a fact about the option and not about the connection: a
  // host that passed `openSqlConnection` may be handing out the same database
  // to a dozen readers, and a library that closed it would take a host's
  // handle away over a dashboard it happened to build. Ours is the one we
  // opened, and it is the only one this backend may release.
  const ownsConnection = open === undefined;

  // `whenLanded()`'s deferred: made once, up front, and cheap — nothing is
  // opened by making it. It settles ONCE, the first time `landing` itself
  // settles (below), whichever caller triggers that — `settle()` or the first
  // read through `provider().open`. A failed open resolves it (never rejects
  // it) with synthetic `failed` outcomes, the same words `settle()`'s own
  // catch would quote, so a caller of `whenLanded()` never has to catch. No
  // "already settled" guard is needed here: `ready()` below arms this exactly
  // ONCE (its own `first` gate), on a `landing` promise that itself can only
  // ever settle once — a caller cannot make it fire twice.
  let resolveWhenLanded!: (outcomes: readonly WasmLoadOutcome[]) => void;
  const whenLandedPromise = new Promise<readonly WasmLoadOutcome[]>((resolve) => {
    resolveWhenLanded = resolve;
  });

  const landAll = async (): Promise<Landed> => {
    // WHY the opener is resolved HERE and not at construction: `duckdbConnection()`
    // only makes the promise to import DuckDB — but a build whose wasm tables are
    // never read should not even make that promise.
    const connection = await (open ?? openOwn ?? duckdbConnection())();
    const outcomes: WasmLoadOutcome[] = [];
    // one at a time: two loads racing into one connection is two statements
    // interleaved in a backend that was handed one port, not a pool
    for (const [table, data] of bytes) outcomes.push(await land(connection, table, data));
    return { connection, outcomes };
  };

  // WHY the promise and not the function is what gets reused: two reads that
  // start before the first one lands must join the SAME opening, or the second
  // one races a second database into existence and queries an empty one.
  //
  // …and WHY `whenLanded()`'s notice is armed HERE, not in `settle()` or
  // `provider()`: this is the one place `landing` is CREATED, whichever door
  // asked for it first — arming it anywhere else would miss the door that
  // didn't ask.
  const ready = (): Promise<Landed> => {
    const first = landing === undefined;
    landing ??= landAll();
    if (first) {
      landing.then(
        ({ outcomes }) => resolveWhenLanded(outcomes),
        (error: unknown) => resolveWhenLanded([...bytes.keys()].map((table) => ({ table, failed: noConnectionRefusal(table, causeOf(error)) }))),
      );
    }
    return landing;
  };

  return {
    provider(table: string, carried: WasmBytes): DataProvider {
      bytes.set(table, carried.data);
      return wasmProvider({ sources: [table], open: async () => (await ready()).connection });
    },

    async settle(): Promise<readonly WasmLoadOutcome[]> {
      if (bytes.size === 0) return [];
      try {
        return (await ready()).outcomes;
      } catch (error) {
        const cause = causeOf(error);
        return [...bytes.keys()].map((table) => ({ table, failed: noConnectionRefusal(table, cause) }));
      }
    },

    whenLanded(): Promise<readonly WasmLoadOutcome[]> {
      return whenLandedPromise;
    },

    async close(): Promise<void> {
      if (!ownsConnection || landing === undefined || closed) return; // nothing of ours is open
      closed = true;
      try {
        // WHY the landing is AWAITED and not read off a variable set when it
        // resolved: close() can be called while the first read is still opening,
        // and a connection that arrives after we stopped looking is a connection
        // nobody closes.
        const { connection } = await landing;
        // `close` is OPTIONAL on the port: a backend with nothing to release
        // (a fake, a handle from a pool) simply has no such method.
        await connection.close?.();
      } catch {
        // WHY a failed open is swallowed here and nowhere else: `settle` already
        // reported it as a note against every table that was waiting for it, and
        // a release that threw about a connection that never existed would turn
        // tidying up into the loudest event of the build.
      }
    },
  };
}
