/**
 * The single-page HTML shell. Only static CHROME lives here (headings, layout,
 * empty mount points, styles) — every runtime/data string is written by the
 * bundled browser code via textContent (two-string discipline). Theme-aware
 * (light + dark). The left pane is the dashboard; the right pane is the chat.
 */

const STYLE = `
:root {
  --bg: #f7f8fa; --fg: #1a1d24; --muted: #6b7280; --card: #ffffff; --line: #e4e7ec;
  --accent: #4c8dff; --user: #2f6fed; --agent: #b8860b; --chip: #f0f3f8; --shadow: 0 1px 2px rgba(0,0,0,.06);
}
@media (prefers-color-scheme: dark) {
  :root { --bg:#0e1116; --fg:#e6e9ef; --muted:#9aa4b2; --card:#161b22; --line:#2a313c;
    --accent:#5b9bff; --user:#7aa7ff; --agent:#e6b84d; --chip:#1b222c; --shadow:none; }
}
:root[data-theme="light"] { --bg:#f7f8fa; --fg:#1a1d24; --muted:#6b7280; --card:#fff; --line:#e4e7ec; --chip:#f0f3f8; --user:#2f6fed; --agent:#b8860b; }
:root[data-theme="dark"] { --bg:#0e1116; --fg:#e6e9ef; --muted:#9aa4b2; --card:#161b22; --line:#2a313c; --chip:#1b222c; --user:#7aa7ff; --agent:#e6b84d; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--fg); }
header { padding: 16px 24px; border-bottom: 1px solid var(--line); background: var(--card); }
header h1 { margin: 0; font-size: 18px; }
header p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
header .legend { margin-top: 8px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; font-size: 12px; color: var(--muted); }
main { display: flex; gap: 18px; padding: 18px 24px 40px; align-items: flex-start; flex-wrap: wrap; }
.pane { background: transparent; }
.dashboard { flex: 1 1 560px; min-width: 380px; }
.chatpane { flex: 1 1 380px; min-width: 320px; display: flex; flex-direction: column; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; box-shadow: var(--shadow); margin-bottom: 14px; }
.section-head { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 8px; }
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.btn { font: inherit; padding: 7px 12px; border: 1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 7px; cursor: pointer; box-shadow: var(--shadow); }
.btn:hover { border-color: var(--accent); }
.btn:disabled { opacity: .5; cursor: default; }
.charts { display: flex; gap: 14px; flex-wrap: wrap; }
.chartbox { margin: 0; flex: 1 1 300px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px; box-shadow: var(--shadow); }
.chartbox figcaption { color: var(--muted); font-size: 12px; margin-top: 6px; text-align: center; }
.chart { width: 100%; height: auto; display: block; touch-action: none; }
svg .axis { stroke: var(--line); stroke-width: 1; }
svg .tick, svg .axis-label { fill: var(--muted); font-size: 10px; }
svg .barval { fill: var(--fg); font-size: 11px; font-weight: 600; }
svg .dot { transition: opacity .1s; cursor: crosshair; }
svg .dot.dim { opacity: .12; }
svg .brush { fill: var(--accent); opacity: .16; stroke: var(--accent); stroke-width: 1; }
svg .regline { stroke: #ff5c9d; stroke-width: 2.5; stroke-dasharray: 5 3; }
svg .barrect { transition: y .12s, height .12s; }
svg .barrect.selected { stroke: var(--fg); stroke-width: 2; }
.sel-readout { color: var(--muted); font-size: 13px; margin-bottom: 10px; }
.history { display: flex; gap: 8px; flex-wrap: wrap; min-height: 40px; align-items: flex-start; }
.history .empty { color: var(--muted); font-style: italic; }
.chip { display: inline-flex; align-items: center; gap: 6px; background: var(--chip); border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; font-size: 12px; }
.chip.fresh { animation: pop .3s ease; }
@keyframes pop { from { transform: scale(.82); opacity: .3; } to { transform: scale(1); opacity: 1; } }
.badge { font-weight: 700; text-transform: uppercase; font-size: 10px; padding: 1px 6px; border-radius: 5px; color: #fff; }
.badge.user { background: var(--user); }
.badge.agent { background: var(--agent); }
.badge.system { background: var(--muted); }
.chip .k { color: var(--muted); }
.chip .cid { color: var(--muted); font-variant-numeric: tabular-nums; }
table.ledger, table.gb-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 4px; }
table.ledger th, table.ledger td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
table.ledger tr.discovery { background: rgba(0,179,164,.12); }
table.ledger .verdict { font-weight: 700; }
.ledger-head { color: var(--muted); font-size: 12px; margin: 6px 0; }
.headline { margin-top: 10px; padding: 9px 12px; border-radius: 8px; background: var(--chip); border: 1px solid var(--line); font-weight: 600; font-size: 13px; }
.analyses-list { display: flex; flex-direction: column; gap: 5px; font-size: 12px; }
.analysis-row { display: flex; gap: 8px; align-items: baseline; }
.analysis-row .id { font-weight: 600; }
.analysis-row .ready { color: #00b3a4; }
.analysis-row .blocked { color: var(--muted); }
.gap-row { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 12px; }
.gap-row:last-child { border-bottom: none; }
.gap-row .gap-code { font-weight: 700; text-transform: uppercase; font-size: 10px; padding: 1px 6px; border-radius: 5px; background: rgba(255,92,157,.16); border: 1px solid rgba(255,92,157,.4); }
.gap-row .gap-op { color: var(--muted); }
.muted { color: var(--muted); font-size: 12px; }

/* ── chat ── */
.chatpane .card { display: flex; flex-direction: column; flex: 1 1 auto; }
.transcript { display: flex; flex-direction: column; gap: 10px; min-height: 260px; max-height: 52vh; overflow-y: auto; padding: 4px 2px; }
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
`;

export const PAGE = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>vizfootprint — mixed-principal analyst</title><style>${STYLE}</style></head>
<body>
<header>
  <h1>vizfootprint — mixed-principal analyst</h1>
  <p>One live session, two principals. You brush and click on the left; a real Claude analyst chats and works on the right. Every gesture is one cause-tagged commit — the mixed author log below is the whole point.</p>
  <div class="legend">
    <span><span class="badge user">user</span> your gestures</span>
    <span><span class="badge agent">agent</span> the analyst's tool calls</span>
    <span><span class="badge system">system</span> a declared analysis</span>
  </div>
</header>
<main>
  <section class="pane dashboard" id="dashboard"></section>
  <section class="pane chatpane" id="chat"></section>
</main>
<script src="/bundle/app.js"></script>
</body></html>`;
