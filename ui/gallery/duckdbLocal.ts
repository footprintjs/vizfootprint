/**
 * `@duckdb/duckdb-wasm` as the `/wasm` page sees it: the REAL package, with its
 * CDN bundle map answered from this gallery's own `/duckdb/*` route instead.
 *
 * WHY this module exists: the library's opener (`src/data/duckdbConnection.ts`,
 * `openInBrowser`) asks `getJsDelivrBundles()` for its bundles — jsDelivr URLs,
 * hard-wired — and takes no bundle map from a caller. A proof that "the browser
 * arm runs" must not depend on a CDN being reachable from the test machine, so
 * the wasm page's build (`build.mjs`, `local-duckdb-wasm`) resolves the bare
 * specifier to THIS file, which re-exports everything the package exports and
 * shadows exactly one name. `selectBundle` is wrapped only to REMEMBER what it
 * chose, so the page can name the bundle it ran on.
 *
 * WHY absolute URLs: the opener runs the worker off a `blob:` URL, and a
 * `blob:` URL cannot be a base for a relative `importScripts` — the worker's
 * own script location must be spelled out in full.
 *
 * Nothing else changes: the same `selectBundle` platform check, the same
 * worker-off-a-blob recipe, the same `AsyncDuckDB` — the opener is untouched.
 */
import * as real from '@duckdb/duckdb-wasm';
import type { DuckDBBundle, DuckDBBundles } from '@duckdb/duckdb-wasm';

export * from '@duckdb/duckdb-wasm';

/** Where `serve.mjs` mirrors `node_modules/@duckdb/duckdb-wasm/dist/`. */
export const LOCAL_DUCKDB_ROUTE = '/duckdb/';

/** The bundle map the opener will select from — the two browser bundles, at this origin. */
export function getJsDelivrBundles(): DuckDBBundles {
  const at = (file: string): string => new URL(`${LOCAL_DUCKDB_ROUTE}${file}`, globalThis.location.href).href;
  return {
    mvp: { mainModule: at('duckdb-mvp.wasm'), mainWorker: at('duckdb-browser-mvp.worker.js') },
    eh: { mainModule: at('duckdb-eh.wasm'), mainWorker: at('duckdb-browser-eh.worker.js') },
  };
}

let chosen: DuckDBBundle | null = null;

/** The real selection, remembered — the page reads it back through {@link chosenBundle}. */
export async function selectBundle(bundles: DuckDBBundles): Promise<DuckDBBundle> {
  chosen = await real.selectBundle(bundles);
  return chosen;
}

/** What `selectBundle` chose on this page, or null before the opener ran. */
export const chosenBundle = (): DuckDBBundle | null => chosen;
