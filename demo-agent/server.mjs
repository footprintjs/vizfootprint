/**
 * The mixed-principal demo server — dependency-free Node http (dress-shop
 * pattern). One process holds ONE analyst (session + tool port + agent) shared
 * by both principals:
 *   GET  /                    → the single page (dashboard + chat)
 *   GET  /bundle/app.js       → the browser IIFE
 *   GET  /data/dresses.csv    → the seeded dataset (also fetched by the browser)
 *   GET  /api/state           → commits + ledger + gaps + selection + activity
 *   POST /api/dispatch        → the human's brush/click → a `user`-badged commit
 *   POST /api/chat            → one analyst turn → `agent`-badged commits + reply
 *   POST /api/reset           → a brand-new session (cheap; nothing reset in place)
 *
 * Programmatic: `startServer({ port, mock })` → { server, url, port, close }
 *   (used by the tests). CLI: `node demo-agent/server.mjs` (npm run demo:agent).
 *
 * The Anthropic key is read from .env into process.env by env.mjs and handed to
 * the provider inside the bundled core — it is NEVER printed or logged here.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadDotEnv } from './env.mjs';
import { buildCoreModule, buildAppBundle } from './build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV = readFileSync(path.join(__dirname, '..', 'demo', 'data', 'dresses.csv'), 'utf8');

export const DEFAULT_PORT = 5181;

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, body, type = 'application/json') {
  const payload = type === 'application/json' ? JSON.stringify(body) : String(body);
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(payload);
}

/**
 * Build the bundles, wire the analyst, and start the server.
 * @param {{ port?: number, mock?: boolean }} [opts]
 * @returns {Promise<{ server: import('node:http').Server, url: string, port: number, mock: boolean, close: () => Promise<void> }>}
 */
export async function startServer({ port = DEFAULT_PORT, mock } = {}) {
  const useMock = mock ?? process.env['VIZ_AGENT_MOCK'] === '1';
  if (!useMock) loadDotEnv(); // real mode reads the key into process.env (never logged)

  const [coreFile, appBundle] = await Promise.all([buildCoreModule(), buildAppBundle()]);
  const core = await import(pathToFileURL(coreFile).href);
  const { PAGE } = await import('./page.mjs');

  // One live analyst; POST /api/reset swaps it for a fresh one (a session is cheap).
  let analyst = core.createAnalyst({ csv: CSV, mock: useMock });

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = (req.url ?? '/').split('?')[0];
        if (req.method === 'GET' && url === '/') return send(res, 200, PAGE, 'text/html; charset=utf-8');
        if (req.method === 'GET' && url === '/bundle/app.js') return send(res, 200, appBundle, 'application/javascript; charset=utf-8');
        if (req.method === 'GET' && url === '/data/dresses.csv') return send(res, 200, CSV, 'text/csv; charset=utf-8');
        if (req.method === 'GET' && url === '/api/state') return send(res, 200, await analyst.state());

        if (req.method === 'POST' && url === '/api/dispatch') {
          const result = await analyst.dispatchUser(await readBody(req));
          return send(res, 200, result);
        }
        if (req.method === 'POST' && url === '/api/chat') {
          const { message } = await readBody(req);
          if (typeof message !== 'string' || !message.trim()) return send(res, 400, { error: 'message required' });
          return send(res, 200, await analyst.chat(message));
        }
        if (req.method === 'POST' && url === '/api/reset') {
          analyst = core.createAnalyst({ csv: CSV, mock: useMock });
          return send(res, 200, { ok: true });
        }
        return send(res, 404, { error: 'not found' });
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        const credProblem = message.toLowerCase().includes('api key') || message.includes('401');
        send(res, credProblem ? 401 : 500, {
          error: credProblem
            ? 'No usable Claude API key — put ANTHROPIC_API_KEY in vizfootprint/.env (or run with mock mode).'
            : message,
        });
      }
    })();
  });

  await new Promise((resolve) => server.listen(port, resolve));
  const actualPort = server.address().port;
  const url = `http://localhost:${actualPort}`;
  return { server, url, port: actualPort, mock: useMock, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

// CLI entry: `node demo-agent/server.mjs`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  const mock = process.env['VIZ_AGENT_MOCK'] === '1';
  startServer({ port, mock }).then(({ url, mock: m }) => {
    const hasKey = !!process.env['ANTHROPIC_API_KEY'];
    // eslint-disable-next-line no-console
    console.log(`\n  vizfootprint mixed-principal analyst → ${url}`);
    console.log(`  provider: ${m ? 'scripted MOCK (no API calls)' : `Anthropic (${process.env['ANTHROPIC_MODEL'] ?? 'claude-opus-4-8'}) — key ${hasKey ? 'loaded' : 'MISSING'}`}`);
    console.log('  Left: brush the scatter / click a bar (you). Right: ask the analyst to work alongside you.\n');
  });
}
