/**
 * The single-page HTML shell. Only static CHROME lives here (empty mount
 * points, styles) — every runtime/data string is written by the bundled
 * browser code via textContent (two-string discipline). Theme-aware
 * (light + dark).
 *
 * UX-2: `#dashboard` is now the FLAGSHIP `<VizCockpit>` — a React mount point
 * rendered by `vizfootprint-ui` (`app.tsx`) that locks itself to the full
 * viewport and owns ALL page scrolling (there is none at desktop sizes; a
 * scroll-snap chart carousel on mobile). Its styling ships with the package
 * (`/bundle/vizfootprint-ui.css`, scoped under `.vzf`), so this file no
 * longer authors chart/timeline/ledger/branch-map CSS — and, since the
 * cockpit IS the page, there is no header/main chrome sitting above it (that
 * would push the page taller than one viewport and break the zero-scroll
 * contract). The floating chat popup stays hand-rolled chrome (a position:fixed
 * overlay, so it never adds page height), styled here as before; the 🐛
 * debugger no longer has its own chrome — it rides the cockpit's report-chip
 * modal system now (see app.tsx's `<DebugPanel>`).
 */

const STYLE = `
:root {
  --bg: #f7f8fa; --fg: #1a1d24; --muted: #6b7280; --card: #ffffff; --line: #e4e7ec;
  --accent: #4c8dff; --agent: #b8860b; --chip: #f0f3f8; --shadow: 0 1px 2px rgba(0,0,0,.06);
}
@media (prefers-color-scheme: dark) {
  :root { --bg:#0e1116; --fg:#e6e9ef; --muted:#9aa4b2; --card:#161b22; --line:#2a313c;
    --accent:#5b9bff; --agent:#e6b84d; --chip:#1b222c; --shadow:none; }
}
:root[data-theme="light"] { --bg:#f7f8fa; --fg:#1a1d24; --muted:#6b7280; --card:#fff; --line:#e4e7ec; --chip:#f0f3f8; --agent:#b8860b; }
:root[data-theme="dark"] { --bg:#0e1116; --fg:#e6e9ef; --muted:#9aa4b2; --card:#161b22; --line:#2a313c; --chip:#1b222c; --agent:#e6b84d; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--fg); }
#dashboard { height: 100%; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; box-shadow: var(--shadow); margin-bottom: 14px; }
.section-head { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 8px; }
.btn { font: inherit; padding: 7px 12px; border: 1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 7px; cursor: pointer; box-shadow: var(--shadow); }
.btn:hover { border-color: var(--accent); }
.btn:disabled { opacity: .5; cursor: default; }

/* ── chat (rendered by app.tsx into the floating popup body) ── */
.chatbody .card { display: flex; flex-direction: column; flex: 1 1 auto; border: 0; box-shadow: none; margin: 0; border-radius: 0; background: transparent; padding: 0; min-height: 0; }
.chatbody .section-head { display: none; }
.transcript { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 2px; }
.bubble { max-width: 92%; padding: 8px 12px; border-radius: 12px; font-size: 13px; white-space: pre-wrap; word-wrap: break-word; }
.bubble.you { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 4px; }
.bubble.analyst { align-self: flex-start; background: var(--chip); border: 1px solid var(--line); border-bottom-left-radius: 4px; }
.bubble.sys { align-self: center; color: var(--muted); font-size: 12px; font-style: italic; }
.composer { display: flex; gap: 8px; margin-top: 10px; }
.composer input { flex: 1; font: inherit; padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg); }
.composer input:focus { outline: none; border-color: var(--accent); }
.activity { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; min-height: 8px; }
.activity-step { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; background: var(--chip); border: 1px solid var(--line); border-radius: 7px; padding: 5px 9px; font-size: 12px; }
.activity-step .tool { font-weight: 700; color: var(--agent); white-space: nowrap; }
.activity-step .args { color: var(--muted); font-variant-numeric: tabular-nums; word-break: break-all; }
.activity-step .result { word-break: break-all; }
.working { color: var(--agent); font-size: 12px; font-style: italic; min-height: 16px; margin-top: 6px; }
.suggest { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.suggest button { font: inherit; font-size: 12px; padding: 4px 9px; border: 1px dashed var(--line); background: transparent; color: var(--accent); border-radius: 999px; cursor: pointer; }

/* ── floating analyst popup ──
   bottom: 64px (not 24px) is deliberate: the cockpit's status strip (report
   chips) now sits flush at the very bottom-right of the full-viewport shell
   (there is no page scroll room below it anymore), so the fab/panel must
   clear it — 24px used to be safe over the old dashboard's own bottom
   padding, but now overlaps the chip row and blocks its clicks. */
[hidden] { display: none !important; }
.fab { position: fixed; right: 24px; bottom: 64px; z-index: 40; display: inline-flex; align-items: center; gap: 10px; background: var(--accent); color: #fff; border: 0; border-radius: 999px; padding: 14px 20px; font: 600 15px inherit; cursor: pointer; box-shadow: 0 16px 34px -12px rgba(30,60,120,.5); transition: .2s; }
.fab:hover { transform: translateY(-2px); filter: brightness(1.05); }
.fab .pulse { width: 9px; height: 9px; border-radius: 999px; background: #7CFFB2; animation: beat 1.8s infinite; }
@keyframes beat { 0% { box-shadow: 0 0 0 0 rgba(124,255,178,.6); } 70% { box-shadow: 0 0 0 9px rgba(124,255,178,0); } 100% { box-shadow: 0 0 0 0 rgba(124,255,178,0); } }
.chatpanel { position: fixed; right: 24px; bottom: 64px; z-index: 41; width: 400px; max-width: calc(100vw - 32px); height: 620px; max-height: calc(100vh - 88px); background: var(--card); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 30px 70px -20px rgba(20,30,60,.45); display: flex; flex-direction: column; overflow: hidden; transform-origin: bottom right; animation: pop .2s cubic-bezier(.2,.9,.3,1.2); }
@keyframes pop { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
.cphead { display: flex; align-items: center; gap: 11px; padding: 13px 15px; background: linear-gradient(135deg, var(--accent), #2f6fed); color: #fff; }
.cphead .av { width: 34px; height: 34px; border-radius: 999px; background: rgba(255,255,255,.18); display: grid; place-items: center; font-size: 17px; }
.cphead .ct { font: 600 15px inherit; line-height: 1.15; }
.cphead .ct small { display: block; font-weight: 400; opacity: .82; font-size: 11px; }
.cphead .x { background: rgba(255,255,255,.16); border: 0; color: #fff; width: 30px; height: 30px; border-radius: 999px; font-size: 15px; cursor: pointer; }
.cphead .x:hover { background: rgba(255,255,255,.3); }
.cphead #chatreset { margin-left: auto; }
.chatbody { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 12px 14px; }

/* ── 🐛 "see the thinking" button under a chat reply (opens the cockpit's
   OWN "Analyst debugger" report chip — no separate modal chrome here) ── */
.dbgbtn { align-self: flex-start; margin: 2px 0 2px; background: transparent; border: 1px solid var(--line); color: var(--muted); border-radius: 999px; padding: 3px 10px; font: 600 11.5px inherit; cursor: pointer; }
.dbgbtn:hover { color: var(--accent); border-color: var(--accent); }
`;

export const PAGE = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>vizfootprint — mixed-principal analyst</title>
<link rel="stylesheet" href="/bundle/vizfootprint-ui.css">
<style>${STYLE}</style></head>
<body>
<section id="dashboard"></section>

<button id="fab" class="fab" type="button"><span class="pulse"></span> Ask the analyst</button>

<aside id="chatpanel" class="chatpanel" hidden>
  <div class="cphead">
    <div class="av">📊</div>
    <div class="ct">Viz Analyst<small id="cpsub">real Claude · same live session</small></div>
    <button id="chatreset" class="x" title="Start a fresh session — clears the chat + shared log">↺</button>
    <button id="chatclose" class="x" title="Close">✕</button>
  </div>
  <div id="chatbody" class="chatbody"></div>
</aside>

<script src="/bundle/app.js"></script>
</body></html>`;
