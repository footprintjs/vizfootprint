/**
 * The gallery server: builds once at boot, serves the static page + bundle.
 * `npm run gallery` (in ui/) → http://localhost:5177 — the visual acceptance
 * surface and future consumer documentation. Exported `startGallery` is what
 * the Playwright smoke drives (port 0 = ephemeral).
 */
import http from 'node:http';
import path from 'node:path';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildGallery } from './build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const page = (title, script) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<link rel="stylesheet" href="/vizfootprint-ui.css" />
<style>
  /* host-page chrome only — everything below #root is library-styled */
  html, body { margin: 0; height: 100%; }
  #root { height: 100%; }
</style>
</head>
<body>
<div id="root"></div>
<script src="${script}"></script>
</body>
</html>`;

const PAGE = page('vizfootprint-ui — gallery', '/gallery.js');
/* the Sheet over 90,300 rows, on its own page */
const SHEET_PAGE = page('vizfootprint-ui — sheet', '/sheet.js');
/* the FRAME — two layers of marks on one frame — on its own page */
const FRAME_PAGE = page('vizfootprint-ui — frame', '/frame.js');
/* the WASM page — DuckDB-WASM opened in the browser over a Worker, its answers in the DOM */
const WASM_PAGE = page('vizfootprint-ui — wasm', '/wasm.js');

/**
 * `/duckdb/<file>` mirrors `node_modules/@duckdb/duckdb-wasm/dist/` for the four
 * files a BROWSER bundle is made of — the `eh` and `mvp` wasm modules and their
 * worker scripts — so the WASM page selects its bundle from this origin and never
 * a CDN. An allowlist, resolved through the package's own exports map (the way the
 * library's node arm finds the same `dist/`): nothing else under `dist/` is served,
 * and no path is joined from the request.
 *
 * WHY `application/wasm` is spelled out: the worker instantiates the module with
 * `WebAssembly.instantiateStreaming`, which REFUSES a response of any other type.
 * The worker then logs "wasm streaming compile failed … falling back to
 * ArrayBuffer instantiation" and fetches the module a SECOND time to compile it
 * from bytes (those words are in `duckdb-browser-eh.worker.js`) — twice the
 * ~35 MB and an error in the console, on a page that otherwise looks fine.
 */
const DUCKDB_ROUTE = '/duckdb/';
const DUCKDB_TYPES = { '.wasm': 'application/wasm', '.js': 'text/javascript; charset=utf-8' };
const duckdbFiles = (() => {
  const resolve = createRequire(import.meta.url).resolve;
  const files = new Map();
  for (const file of ['duckdb-eh.wasm', 'duckdb-mvp.wasm', 'duckdb-browser-eh.worker.js', 'duckdb-browser-mvp.worker.js']) {
    files.set(file, resolve(`@duckdb/duckdb-wasm/dist/${file}`));
  }
  return files;
})();

export async function startGallery({ port = 5177 } = {}) {
  const out = await buildGallery();
  const bundle = readFileSync(path.join(out, 'gallery.js'));
  const sheetBundle = readFileSync(path.join(out, 'sheet.js'));
  const frameBundle = readFileSync(path.join(out, 'frame.js'));
  const wasmBundle = readFileSync(path.join(out, 'wasm.js'));
  const css = readFileSync(path.join(out, 'vizfootprint-ui.css'));
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/gallery.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(bundle);
    } else if (url === '/sheet.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(sheetBundle);
    } else if (url === '/frame.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(frameBundle);
    } else if (url === '/wasm.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(wasmBundle);
    } else if (url === '/wasm' || url === '/wasm.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(WASM_PAGE);
    } else if (url.startsWith(DUCKDB_ROUTE) && duckdbFiles.has(url.slice(DUCKDB_ROUTE.length))) {
      // streamed, not read at boot: the `eh` module alone is ~35 MB
      const file = duckdbFiles.get(url.slice(DUCKDB_ROUTE.length));
      res.writeHead(200, { 'content-type': DUCKDB_TYPES[path.extname(file)], 'content-length': statSync(file).size });
      createReadStream(file).pipe(res);
    } else if (url === '/sheet' || url === '/sheet.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(SHEET_PAGE);
    } else if (url === '/frame' || url === '/frame.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(FRAME_PAGE);
    } else if (url === '/vizfootprint-ui.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      res.end(css);
    } else if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(port, resolve));
  const actual = server.address().port;
  return {
    url: `http://localhost:${actual}`,
    port: actual,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// CLI: node gallery/serve.mjs
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const handle = await startGallery({});
  console.log(`vizfootprint-ui gallery → ${handle.url}`);
}
