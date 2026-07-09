/**
 * The vizfootprint demo server — dependency-free Node http, serving TWO pages
 * over the landed layers (the dress-shop demo pattern: one process, inline HTML,
 * a handful of GET routes). The browser bundles are built ONCE at boot with the
 * bench's esbuild + DuckDB-stub trick (see build.mjs).
 *
 *   GET /                    → landing (links to both pages)
 *   GET /dashboard           → URL 1 (coordination + provenance)
 *   GET /analyst             → URL 2 (declared analyses + FDR)
 *   GET /bundle/dashboard.js → the dashboard IIFE bundle
 *   GET /bundle/analyst.js   → the analyst IIFE bundle
 *   GET /data/dresses.csv    → the shipped seeded dataset
 *
 * Programmatic: `startServer({ port })` → { server, url, close } (used by tests).
 * CLI: `node demo/server.mjs` (npm run demo) → serves on :5180.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildAllBundles } from './build.mjs';
import { PAGE_DASHBOARD, PAGE_ANALYST, PAGE_INDEX } from './pages.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV = readFileSync(path.join(__dirname, 'data', 'dresses.csv'), 'utf8');

export const DEFAULT_PORT = 5180;

/**
 * Build the bundles and start the demo server.
 * @param {{ port?: number }} [opts]
 * @returns {Promise<{ server: import('node:http').Server, url: string, port: number, close: () => Promise<void> }>}
 */
export async function startServer({ port = DEFAULT_PORT } = {}) {
  const bundles = await buildAllBundles(); // { dashboard, analyst } — JS strings

  const send = (res, status, body, type) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (req.method !== 'GET') return send(res, 405, 'method not allowed', 'text/plain');
    switch (url) {
      case '/':
        return send(res, 200, PAGE_INDEX, 'text/html; charset=utf-8');
      case '/dashboard':
        return send(res, 200, PAGE_DASHBOARD, 'text/html; charset=utf-8');
      case '/analyst':
        return send(res, 200, PAGE_ANALYST, 'text/html; charset=utf-8');
      case '/bundle/dashboard.js':
        return send(res, 200, bundles.dashboard, 'application/javascript; charset=utf-8');
      case '/bundle/analyst.js':
        return send(res, 200, bundles.analyst, 'application/javascript; charset=utf-8');
      case '/data/dresses.csv':
        return send(res, 200, CSV, 'text/csv; charset=utf-8');
      default:
        return send(res, 404, 'not found', 'text/plain');
    }
  });

  await new Promise((resolve) => server.listen(port, resolve));
  const actualPort = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  const url = `http://localhost:${actualPort}`;
  return {
    server,
    url,
    port: actualPort,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// CLI entry: `node demo/server.mjs`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  startServer({ port }).then(({ url }) => {
    // eslint-disable-next-line no-console
    console.log(`\n  vizfootprint demo → ${url}/dashboard   and   ${url}/analyst\n`);
  });
}
