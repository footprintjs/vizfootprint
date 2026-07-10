/**
 * The gallery server: builds once at boot, serves the static page + bundle.
 * `npm run gallery` (in ui/) → http://localhost:5177 — the visual acceptance
 * surface and future consumer documentation. Exported `startGallery` is what
 * the Playwright smoke drives (port 0 = ephemeral).
 */
import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildGallery } from './build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>vizfootprint-ui — gallery</title>
<link rel="stylesheet" href="/vizfootprint-ui.css" />
<style>
  /* host-page chrome only — everything below #root is library-styled */
  html, body { margin: 0; height: 100%; }
  #root { height: 100%; }
</style>
</head>
<body>
<div id="root"></div>
<script src="/gallery.js"></script>
</body>
</html>`;

export async function startGallery({ port = 5177 } = {}) {
  const out = await buildGallery();
  const bundle = readFileSync(path.join(out, 'gallery.js'));
  const css = readFileSync(path.join(out, 'vizfootprint-ui.css'));
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/gallery.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(bundle);
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
