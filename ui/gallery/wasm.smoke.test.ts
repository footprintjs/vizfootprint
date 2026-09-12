// @vitest-environment node
/**
 * Playwright smoke over the WASM page — real headless Chromium, a real Worker,
 * the real `@duckdb/duckdb-wasm` bundle instantiated from this server's own
 * `/duckdb/*` mirror. It proves the one thing no node test can: that the
 * BROWSER arm of `src/data/duckdbConnection.ts` — `duckdbHostOf` answering
 * `browser`, `selectBundle`, a Worker off a blob, `AsyncDuckDB.instantiate`,
 * `open(READ_CONFIG)` — opens, lands a table, and answers the library's own
 * questions with the same values a recount of the same rows gives:
 *
 *   - the page's host judgement is `browser`, and a `Worker` exists;
 *   - the sorted window's first ten keys, in amount order;
 *   - the unsorted window's keys in SOURCE order (the `__row` law) — ids that
 *     do not run in source order would expose a window served in id order;
 *   - a find's position, ordinal and match count;
 *   - the count under an interval clause landed through the session;
 *   - the refresh's delta (`replaceRows` over the async connection), and a
 *     window after it reading the new rows;
 *   - the bundle came from `/duckdb/*` (this origin, not a CDN), a dedicated
 *     Worker really ran, and no console or page error;
 *   - and THE FINDING this proof made: landing `rows` (`read_json_auto`) makes
 *     the bundle fetch the `json` extension from DuckDB's own extension
 *     repository over the network — the one request that leaves this origin —
 *     while the CSV landing (`read_csv_auto`) fetches nothing. Pinned, so a
 *     bundle that stops needing it (or a landing that starts needing more) is
 *     noticed rather than silently accepted.
 *
 * Every expected value is computed HERE from `wasmRows.ts`, the module the
 * page landed — never read back from another engine.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page, type Worker } from 'playwright-core';
import { existsSync } from 'node:fs';
import { startGallery } from './serve.mjs';
import { WASM_CSV_ROWS, WASM_NULL_AT, WASM_REFRESH, WASM_ROW_COUNT, WASM_TABLE, wasmRows, wasmRowsAfter, type WasmRow } from './wasmRows.js';

const CHROME = process.env['VZF_CHROME']; // unset ⇒ playwright-core launches the headless shell it installed

/** The page writes a string answer as itself and everything else as JSON (`asText` in wasm.tsx). */
const text = (page: Page, key: string): Promise<string> => page.locator(`[data-wasm-${key}]`).innerText();
const json = async <T,>(page: Page, key: string): Promise<T> => JSON.parse(await text(page, key)) as T;

/** A window as the page reports it — the fields these assertions read. */
interface Window {
  readonly ok: boolean;
  readonly rows: readonly WasmRow[];
  readonly count: number;
  readonly start: number;
  readonly positional: boolean;
  readonly key?: string;
  readonly clauses: readonly unknown[];
  readonly rejected?: string;
}

/** The rows sorted by amount, descending, source order breaking a tie — the same order `windowSQL` renders (`ORDER BY amount DESC, __row ASC`). */
const byAmountDesc = (rows: readonly WasmRow[]): readonly WasmRow[] =>
  rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => b.row.amount - a.row.amount || a.i - b.i)
    .map(({ row }) => row);

const ROWS = wasmRows();
const AFTER = wasmRowsAfter();
const FIND_TEXT = 'fig';
const FIND_FROM = 10;
const RANGE: readonly [number, number] = [250.5, 1200.5];

describe.skipIf(CHROME !== undefined && !existsSync(CHROME))('the browser opens DuckDB-WASM over a Worker (real headless Chromium)', () => {
  let handle: Awaited<ReturnType<typeof startGallery>>;
  let browser: Browser;
  let page: Page;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requests: string[] = [];
  /** Every response from OFF this origin: the URL, its status and its declared size — the finding's evidence. */
  const offOrigin: { url: string; status: number; bytes: string }[] = [];
  const workers: Worker[] = [];
  /** Wall time from `goto` to the page's last answer — reported as a finding, never pinned. */
  let wallMs = 0;

  beforeAll(async () => {
    handle = await startGallery({ port: 0 });
    browser = await chromium.launch({ ...(CHROME !== undefined ? { executablePath: CHROME } : {}), headless: true });
    page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('request', (r) => requests.push(r.url()));
    page.on('response', (r) => {
      if (!r.url().startsWith(handle.url) && !r.url().startsWith('blob:')) offOrigin.push({ url: r.url(), status: r.status(), bytes: r.headers()['content-length'] ?? '?' });
    });
    page.on('worker', (w) => workers.push(w));
    const started = Date.now();
    await page.goto(`${handle.url}/wasm`);
    // the whole proof, or the error the page wrote instead — whichever comes first, so a failure reads as its own sentence
    await page.waitForSelector('[data-wasm-done], [data-wasm-error]', { timeout: 150_000 });
    wallMs = Date.now() - started;
  }, 180_000);

  afterAll(async () => {
    // the finding the brief asks for, beside the run — a number a reader sees, not a number a test pins
    console.info(`[wasm smoke] goto → last answer: ${String(wallMs)} ms; page's own clock at done: ${await text(page, 'done').catch(() => 'n/a')}`);
    console.info(`[wasm smoke] off-origin responses: ${JSON.stringify(offOrigin)}`);
    await browser.close();
    await handle.close();
  });

  it('nothing threw, and the build noted no failure — the opener opened', async () => {
    expect(await page.locator('[data-wasm-error]').count(), 'the page wrote an error').toBe(0);
    expect(await json<string[]>(page, 'notes')).toEqual([]);
    expect(await text(page, 'engine')).toBe('wasm');
  });

  it('the host judgement is `browser`, made from a real `Worker`, and the bundle came from this server’s /duckdb/* mirror', async () => {
    expect(await text(page, 'worker')).toBe('function');
    expect(await text(page, 'host')).toBe('browser');
    const bundle = await json<{ mainModule: string; mainWorker: string | null }>(page, 'bundle');
    // one of the two browser bundles, and the worker script of the SAME flavour
    expect(bundle.mainModule).toMatch(/^\/duckdb\/duckdb-(eh|mvp)\.wasm$/);
    const flavour = /duckdb-(eh|mvp)\.wasm$/.exec(bundle.mainModule)?.[1];
    expect(bundle.mainWorker).toBe(`/duckdb/duckdb-browser-${String(flavour)}.worker.js`);
    // a dedicated Worker really ran: Chromium reported one, spawned off a blob as the opener does it
    expect(workers.length).toBeGreaterThanOrEqual(1);
    expect(workers[0]!.url()).toMatch(/^blob:/);
    // the module and the worker script were fetched from HERE, never a CDN
    expect(requests).toContain(`${handle.url}${bundle.mainModule}`);
    expect(requests).toContain(`${handle.url}${String(bundle.mainWorker)}`);
    // THE FINDING: exactly ONE request left this origin, and it is not a bundle — it is DuckDB autoloading its
    // `json` extension (the flavour of the bundle it chose) for `read_json_auto`, the reader `rows` land through.
    // The CSV table landed on the same connection and added nothing: `read_csv_auto` is core.
    const left = requests.filter((url) => !url.startsWith(handle.url) && !url.startsWith('blob:'));
    expect(left, left.join('\n')).toHaveLength(1);
    expect(left[0]).toMatch(new RegExp(`^https://extensions\\.duckdb\\.org/v[\\d.]+/wasm_${String(flavour)}/json\\.duckdb_extension\\.wasm$`));
  });

  it('the CSV table landed through the opener’s other reader: three rows, an integer and a text column', async () => {
    const csv = await json<Window & { columns: readonly string[] }>(page, 'csv');
    expect(csv.ok, csv.rejected).toBe(true);
    expect(csv.columns).toEqual(['code', 'qty']);
    expect(csv.rows).toEqual(WASM_CSV_ROWS);
    expect(csv.count).toBe(WASM_CSV_ROWS.length);
  });

  it('a SORTED window: the first ten keys in amount order, the whole table counted, keyed by id', async () => {
    const sorted = await json<Window>(page, 'sorted');
    expect(sorted.ok, sorted.rejected).toBe(true);
    const expected = byAmountDesc(ROWS).slice(0, 10);
    expect(sorted.rows.map((r) => r.id)).toEqual(expected.map((r) => r.id));
    // whole rows: the DATE came back as the ISO day it was landed as, the number as a number (READ_CONFIG's casts took on the async connection)
    expect(sorted.rows).toEqual(expected);
    expect(sorted.count).toBe(WASM_ROW_COUNT);
    expect(sorted.start).toBe(0);
    expect(sorted.positional).toBe(false);
    expect(sorted.key).toBe('id');
  });

  it('an UNSORTED window: ten keys in SOURCE order — the `__row` law — with the one null intact', async () => {
    const unsorted = await json<Window>(page, 'unsorted');
    expect(unsorted.ok, unsorted.rejected).toBe(true);
    const expected = ROWS.slice(20, 30);
    expect(unsorted.rows.map((r) => r.id)).toEqual(expected.map((r) => r.id));
    // the ids visibly do NOT run in order — a window served in id order could not pass the line above
    expect([...expected.map((r) => r.id)].sort((a, b) => a - b)).not.toEqual(expected.map((r) => r.id));
    expect(unsorted.rows).toEqual(expected);
    expect(unsorted.rows[WASM_NULL_AT - 20]!.name).toBeNull();
    expect(unsorted.start).toBe(20);
  });

  it('a FIND: the position, ordinal and match count of the next match, counted in source order', async () => {
    const find = await json<{ ok: boolean; position: number | null; ordinal?: number; matches: number; rejected?: string }>(page, 'find');
    expect(find.ok, find.rejected).toBe(true);
    const hits = ROWS.map((row, i) => ({ row, i })).filter(({ row }) => (row.name ?? '').toLowerCase().includes(FIND_TEXT));
    const hit = hits.find(({ i }) => i >= FIND_FROM)!;
    expect(find.position).toBe(hit.i);
    expect(find.ordinal).toBe(hits.indexOf(hit) + 1);
    expect(find.matches).toBe(hits.length);
  });

  it('a COUNT under a clause the session landed: the rows inside the interval, and the clause named on the window', async () => {
    const filter = await json<{ ok: boolean; rejected?: string }>(page, 'filter');
    expect(filter.ok, filter.rejected).toBe(true);
    const count = await json<Window>(page, 'count');
    expect(count.ok, count.rejected).toBe(true);
    expect(count.count).toBe(ROWS.filter((r) => r.amount >= RANGE[0] && r.amount <= RANGE[1]).length);
    expect(count.clauses).toHaveLength(1);
  });

  it('a REFRESH: the delta the wasm engine computed from its reland, and a sorted window reading the new rows', async () => {
    const refresh = await json<{ tables: Record<string, { changed?: true; from: string; to: string; rows: number; delta: unknown; message?: string }> }>(page, 'refresh');
    const outcome = refresh.tables[WASM_TABLE]!;
    expect(outcome.changed, outcome.message).toBe(true);
    expect(outcome.rows).toBe(AFTER.length);
    // the delta, recounted here by key
    const before = new Map(ROWS.map((r) => [r.id, r]));
    const after = new Map(AFTER.map((r) => [r.id, r]));
    const added = AFTER.filter((r) => !before.has(r.id)).map((r) => String(r.id));
    const removed = ROWS.filter((r) => !after.has(r.id)).map((r) => String(r.id));
    const updated = AFTER.filter((r) => before.has(r.id) && JSON.stringify(before.get(r.id)) !== JSON.stringify(r)).map((r) => String(r.id));
    expect(added).toEqual([String(WASM_REFRESH.addedId)]);
    expect(outcome.delta).toEqual({
      keyed: true,
      key: 'id',
      added: added.length,
      updated: updated.length,
      removed: removed.length,
      sample: { added, updated, removed },
      unkeyed: 0,
    });
    const window = await json<Window>(page, 'after');
    expect(window.ok, window.rejected).toBe(true);
    expect(window.rows).toEqual(byAmountDesc(AFTER).slice(0, 5));
    expect(window.rows[0]!.id).toBe(WASM_REFRESH.addedId);
    expect(window.count).toBe(AFTER.length);
  });

  it('no console error, no page error — the Worker, the fetches and the casts all went quietly', () => {
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
