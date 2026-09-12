/**
 * The WASM page: THE BROWSER OPENS THE ENGINE OVER A WORKER — proven, not claimed.
 *
 * `src/data/duckdbConnection.ts` opens DuckDB-WASM two ways, and every test the
 * library runs takes the node arm. This page is the browser arm's only run:
 * `duckdbConnection({ bundles })` with NO host named, so the host judgement
 * (`duckdbHostOf`) is what is proven — a page with a `Worker` is judged
 * `browser`, and the opener then selects a bundle from the map it was handed,
 * spawns a Worker off a blob, instantiates an `AsyncDuckDB` and opens it with
 * `READ_CONFIG`.
 *
 * Everything after that is the library's own machinery over that connection —
 * a def whose tables are declared `engine: 'wasm'` (one landed as rows, one as
 * CSV — the opener's two readers), built by `buildDashboardAsync`, read
 * through a real session — and every answer is
 * written into the DOM as text under a stable `data-wasm-*` attribute, so the
 * smoke (`wasm.smoke.test.ts`) can read each beside the value it computed from
 * the same rows (`wasmRows.ts`). A failure is written the same way: the build's
 * notes carry the opener's own sentence (the wasm backend never throws — it
 * notes), and anything thrown lands under `data-wasm-error`. Nothing is
 * swallowed.
 *
 * The bundles are NOT fetched from a CDN: the page hands the opener its own
 * map through the library's `bundles` option — this server's `/duckdb/*`
 * mirror of the package's `dist/` (`serve.mjs`) — which is the seam a
 * self-hosting site uses. Nothing else leaves this origin: rows land as typed
 * CSV (`src/data/landing.ts`), and the smoke counts the requests that do.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { buildDashboardAsync } from '../../src/def/index.js';
import type { DashboardDef } from '../../src/def/index.js';
import { duckdbConnection, duckdbHostOf, hostFactsOf } from '../../src/data/index.js';
import type { DuckDBBundles } from '../../src/data/index.js';
import type { SourceAdapter } from '../../src/source/index.js';
import type { Cause } from '../../src/cause/index.js';
import { WASM_CSV, WASM_CSV_TABLE, WASM_TABLE, wasmRows, wasmRowsAfter } from './wasmRows.js';

/** Where `serve.mjs` mirrors `node_modules/@duckdb/duckdb-wasm/dist/` (its `DUCKDB_ROUTE`, spelled once more here because a page cannot import a server). */
const DUCKDB_ROUTE = '/duckdb/';

/**
 * The bundle map the opener selects from: the two browser flavours, at THIS
 * origin. Absolute URLs, because the opener runs the worker off a `blob:` URL,
 * which is no base for a relative `importScripts`.
 */
function localBundles(): DuckDBBundles {
  const at = (file: string): string => new URL(`${DUCKDB_ROUTE}${file}`, globalThis.location.href).href;
  return {
    mvp: { mainModule: at('duckdb-mvp.wasm'), mainWorker: at('duckdb-browser-mvp.worker.js') },
    eh: { mainModule: at('duckdb-eh.wasm'), mainWorker: at('duckdb-browser-eh.worker.js') },
  };
}

/** One answer: the attribute suffix it is written under, and its text. */
type Answer = readonly [key: string, text: string];

/** JSON with a bigint spelled out rather than thrown on — a `READ_CONFIG` cast that did NOT take would show up as `"12n"` instead of a page error. */
const asText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? `${String(v)}n` : v), 1);

const cause = (intent: string): Cause => ({ requestedBy: 'user', computedBy: 'user', intent });

/**
 * The table's source: the proof rows on the first snapshot, the refreshed rows on
 * every later one, so `dashboard.refresh()` finds a NEW version and hands the
 * wasm engine a `replaceRows`.
 *
 * WHY it claims `via: 'http'`: the via vocabulary is closed (`SOURCE_VIAS`) and
 * `inline` always routes to the library's own carrier, whose payload cannot
 * move. The carrier is not what this page proves — the reland over the async
 * connection is — so this stand-in answers in place of the one carrier a
 * browser page would really use.
 */
function pageSource(): SourceAdapter {
  let served = 0;
  return {
    via: 'http',
    async open() {
      return {
        capabilities: { live: false, pushdown: false },
        async snapshot() {
          served += 1;
          return { rows: served === 1 ? wasmRows() : wasmRowsAfter(), version: `page-v${String(served)}`, retrievedAt: new Date().toISOString() };
        },
        async close() {},
      };
    },
  };
}

const DEF: DashboardDef = {
  meta: { title: 'vizfootprint-ui — wasm' },
  data: {
    // the proof table: rows, landed as typed CSV text (`landing.ts`)
    [WASM_TABLE]: { source: { format: 'rows', via: 'http', at: 'page://ledger' }, engine: 'wasm', key: 'id' },
    // the opener's other kind: the def's own CSV text (`read_csv(…, types={…})`) — three rows, so what THIS landing fetched can be told from the first's
    [WASM_CSV_TABLE]: { csv: WASM_CSV, engine: 'wasm' },
  },
  actors: { brush: { actor: 'user', label: 'Amount brush' } },
  defaultTable: WASM_TABLE,
};

/** The proof, in order. Each step reports before the next is asked, so a page that stalls shows how far it got. */
async function prove(report: (key: string, value: unknown) => void): Promise<void> {
  // The two facts the opener's judgement reads, and the judgement itself — the page's own reading, beside the opener's
  report('worker', typeof Worker);
  report('host', duckdbHostOf(hostFactsOf(globalThis)));

  // `duckdbConnection({ bundles })`: the host is judged, never named; only WHERE the bundles are is said
  const bundles = localBundles();
  const dashboard = await buildDashboardAsync(DEF, { openSqlConnection: duckdbConnection({ bundles }), sources: [pageSource()] });
  report('notes', dashboard.notes);
  report('engine', dashboard.engines[WASM_TABLE]);
  // the map the opener was handed — which flavour it chose is a fact the smoke reads off the request log, not off this page
  report('bundles', bundles);

  const session = dashboard.createSession({ as: 'user' });
  const sort = [{ field: 'amount', dir: 'desc' as const }];
  // `viewId: null` = the whole table, no clause — the two windows and the find read the table as landed
  report('sorted', await session.viewQuery({ table: WASM_TABLE, viewId: null, sort, limit: 10, offset: 0 }));
  report('unsorted', await session.viewQuery({ table: WASM_TABLE, viewId: null, limit: 10, offset: 20 }));
  report('find', await session.findInView({ table: WASM_TABLE, text: 'fig', from: 10, direction: 'forward' }));
  report('csv', await session.viewQuery({ table: WASM_CSV_TABLE, viewId: null, limit: 5, offset: 0 }));

  // a clause landed through the session, then the count under it (no `viewId`: every filter that reaches the table)
  report('filter', await session.dispatch({ verb: 'filter', viewId: 'brush', field: 'amount', range: [250.5, 1200.5], cause: cause('brush the middle amounts') }));
  report('count', await session.viewQuery({ table: WASM_TABLE, limit: 1 }));

  // the refresh: the source's second snapshot, re-landed by the wasm engine (`replaceRows`), and a window over the new rows
  report('refresh', await dashboard.refresh([WASM_TABLE]));
  report('after', await session.viewQuery({ table: WASM_TABLE, viewId: null, sort, limit: 5, offset: 0 }));
  report('done', { elapsedMs: Math.round(performance.now()) });
}

function WasmPage(): JSX.Element {
  const [answers, setAnswers] = useState<readonly Answer[]>([]);
  useEffect(() => {
    const report = (key: string, value: unknown): void => setAnswers((prev) => [...prev, [key, asText(value)]]);
    prove(report).catch((error: unknown) => report('error', error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)));
  }, []);
  return (
    <main style={{ padding: 16, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
      <h1 style={{ fontSize: 14 }}>DuckDB-WASM in this browser, over a Worker — every answer below came from it</h1>
      {answers.map(([key, text]) => (
        <section key={key}>
          <h2 style={{ fontSize: 12, margin: '12px 0 4px' }}>{key}</h2>
          <pre {...{ [`data-wasm-${key}`]: '' }} style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {text}
          </pre>
        </section>
      ))}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<WasmPage />);
