/**
 * The mixed-principal demo server — dependency-free Node http (dress-shop
 * pattern). One process holds ONE analyst (session + tool port + agent) shared
 * by both principals:
 *   GET  /                    → the single page (dashboard + chat)
 *   GET  /bundle/app.js       → the browser IIFE (React dashboard on vizfootprint-ui + kept chat/debugger chrome)
 *   GET  /bundle/vizfootprint-ui.css → the package's stylesheet (UI-2 — the dashboard is styled by the package, not this demo)
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
import { buildCoreModule, buildAppBundle, vendorDebuggerAssets, readUiStylesheet } from './build.mjs';
import { DEBUG_PAGE } from './debug-page.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV = readFileSync(path.join(__dirname, '..', 'demo', 'data', 'dresses.csv'), 'utf8');

export const DEFAULT_PORT = 5181;

/** MIME by vendored asset extension — served LOCAL (never a CDN). */
const VENDOR_TYPE = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/** Claude's REAL "why this tool?" — a raw fetch to the Anthropic Messages API
 *  (same transport as the demo's `browserAnthropic`; no @anthropic-ai/sdk peer
 *  dep). Reads the key from process.env; a missing key surfaces as a clean 401. */
async function explainWithClaude(prompt) {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) throw new Error('No usable Claude API key');
  const model = process.env['ANTHROPIC_MODEL'] ?? 'claude-opus-4-8';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 500, messages: [{ role: 'user', content: String(prompt ?? '') }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Anthropic API ${res.status}`);
  return (data.content ?? []).map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
}

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
 * @param {{ port?: number, mock?: boolean, provider?: unknown }} [opts]
 * @returns {Promise<{ server: import('node:http').Server, url: string, port: number, mock: boolean, close: () => Promise<void> }>}
 */
export async function startServer({ port = DEFAULT_PORT, mock, provider } = {}) {
  const useMock = mock ?? process.env['VIZ_AGENT_MOCK'] === '1';
  if (!useMock) loadDotEnv(); // real mode reads the key into process.env (never logged)

  const [coreFile, appBundle, uiCss] = await Promise.all([buildCoreModule(), buildAppBundle(), Promise.resolve(readUiStylesheet())]);
  const core = await import(pathToFileURL(coreFile).href);
  const { PAGE } = await import('./page.mjs');

  // Vendor the atui + React UMD/CSS into demo-agent/vendor and read them once —
  // the /debug page loads them all LOCALLY (never a CDN), so the debugger works
  // offline and the iframe-isolation smoke check renders with no network.
  const vendorRoutes = vendorDebuggerAssets();
  const vendor = Object.fromEntries(
    Object.entries(vendorRoutes).map(([route, file]) => [
      route,
      { body: readFileSync(file), type: VENDOR_TYPE[path.extname(file)] ?? 'application/octet-stream' },
    ]),
  );

  // One live analyst; POST /api/reset swaps it for a fresh one (a session is cheap).
  let analyst = core.createAnalyst({ csv: CSV, mock: useMock, provider });

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = (req.url ?? '/').split('?')[0];
        if (req.method === 'GET' && url === '/') return send(res, 200, PAGE, 'text/html; charset=utf-8');
        if (req.method === 'GET' && url === '/debug') {
          // The agent debugger — atui renders the live reasoning trace. `?embed=1`
          // strips the chrome for iframing inside the dashboard's 🐛 modal.
          return send(res, 200, DEBUG_PAGE, 'text/html; charset=utf-8');
        }
        if (req.method === 'GET' && vendor[url]) {
          res.writeHead(200, { 'content-type': vendor[url].type, 'cache-control': 'no-store' });
          return res.end(vendor[url].body);
        }
        if (req.method === 'GET' && url === '/bundle/app.js') return send(res, 200, appBundle, 'application/javascript; charset=utf-8');
        if (req.method === 'GET' && url === '/bundle/vizfootprint-ui.css') return send(res, 200, uiCss, 'text/css; charset=utf-8');
        if (req.method === 'GET' && url === '/data/dresses.csv') return send(res, 200, CSV, 'text/csv; charset=utf-8');
        if (req.method === 'GET' && url === '/api/state') return send(res, 200, await analyst.state());
        if (req.method === 'GET' && url === '/api/trace') {
          // The current turn's reasoning as an AgentThinkingUI trace (grows live).
          return send(res, 200, analyst.trace());
        }
        if (req.method === 'POST' && url === '/api/explain') {
          // The REAL "why this tool?" — hand atui's prepared prompt (task +
          // trajectory + tool menu) to Claude for the model's own reasoning.
          const { prompt } = await readBody(req);
          try {
            return send(res, 200, { reason: await explainWithClaude(prompt) });
          } catch (error) {
            return send(res, 200, { error: String(error instanceof Error ? error.message : error) });
          }
        }

        if (req.method === 'POST' && url === '/api/dispatch') {
          const result = await analyst.dispatchUser(await readBody(req));
          return send(res, 200, result);
        }
        if (req.method === 'POST' && url === '/api/seek') {
          // Time-travel: move the read-only cursor (charts/log/ledger re-render at it).
          const { commitId } = await readBody(req);
          return send(res, 200, await analyst.seek(commitId));
        }
        if (req.method === 'POST' && url === '/api/checkpoint') {
          const { label } = await readBody(req);
          return send(res, 200, await analyst.checkpoint(label));
        }
        if (req.method === 'POST' && url === '/api/chat') {
          const { message } = await readBody(req);
          if (typeof message !== 'string' || !message.trim()) return send(res, 400, { error: 'message required' });
          return send(res, 200, await analyst.chat(message));
        }
        if (req.method === 'POST' && url === '/api/reset') {
          analyst = core.createAnalyst({ csv: CSV, mock: useMock, provider });
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
    console.log(`  debugger: ${url}/debug  ·  atui served LOCAL from /vendor (not a CDN)`);
    console.log('  Brush the scatter / click a bar (you). Ask the analyst (bottom-right popup). 🐛 replays its thinking.\n');
  });
}
