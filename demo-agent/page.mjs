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
main { padding: 18px 24px 40px; }
.pane { background: transparent; }
.dashboard { width: 100%; }
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

/* ── chat (rendered by app.ts into the floating popup body) ── */
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

/* ── floating analyst popup ── */
[hidden] { display: none !important; }
.fab { position: fixed; right: 24px; bottom: 24px; z-index: 40; display: inline-flex; align-items: center; gap: 10px; background: var(--accent); color: #fff; border: 0; border-radius: 999px; padding: 14px 20px; font: 600 15px inherit; cursor: pointer; box-shadow: 0 16px 34px -12px rgba(30,60,120,.5); transition: .2s; }
.fab:hover { transform: translateY(-2px); filter: brightness(1.05); }
.fab .pulse { width: 9px; height: 9px; border-radius: 999px; background: #7CFFB2; animation: beat 1.8s infinite; }
@keyframes beat { 0% { box-shadow: 0 0 0 0 rgba(124,255,178,.6); } 70% { box-shadow: 0 0 0 9px rgba(124,255,178,0); } 100% { box-shadow: 0 0 0 0 rgba(124,255,178,0); } }
.chatpanel { position: fixed; right: 24px; bottom: 24px; z-index: 41; width: 400px; max-width: calc(100vw - 32px); height: 620px; max-height: calc(100vh - 48px); background: var(--card); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 30px 70px -20px rgba(20,30,60,.45); display: flex; flex-direction: column; overflow: hidden; transform-origin: bottom right; animation: pop .2s cubic-bezier(.2,.9,.3,1.2); }
@keyframes pop { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
.cphead { display: flex; align-items: center; gap: 11px; padding: 13px 15px; background: linear-gradient(135deg, var(--accent), #2f6fed); color: #fff; }
.cphead .av { width: 34px; height: 34px; border-radius: 999px; background: rgba(255,255,255,.18); display: grid; place-items: center; font-size: 17px; }
.cphead .ct { font: 600 15px inherit; line-height: 1.15; }
.cphead .ct small { display: block; font-weight: 400; opacity: .82; font-size: 11px; }
.cphead .x { background: rgba(255,255,255,.16); border: 0; color: #fff; width: 30px; height: 30px; border-radius: 999px; font-size: 15px; cursor: pointer; }
.cphead .x:hover { background: rgba(255,255,255,.3); }
.cphead #chatreset { margin-left: auto; }
.chatbody { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 12px 14px; }

/* ── 🐛 debugger: a central modal iframing the ISOLATED /debug?embed page ── */
.dbgbtn { align-self: flex-start; margin: 2px 0 2px; background: transparent; border: 1px solid var(--line); color: var(--muted); border-radius: 999px; padding: 3px 10px; font: 600 11.5px inherit; cursor: pointer; }
.dbgbtn:hover { color: var(--accent); border-color: var(--accent); }
.dbgmodal { position: fixed; inset: 0; z-index: 60; background: rgba(15,20,35,.55); display: flex; align-items: center; justify-content: center; padding: 24px; animation: fade .18s ease; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
.dbgcard { background: var(--card); border-radius: 16px; width: min(1120px, 96vw); height: min(780px, 92vh); display: grid; grid-template-rows: auto 1fr; overflow: hidden; box-shadow: 0 40px 90px -20px rgba(10,20,40,.6); }
.dbghead { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--line); font-size: 14px; }
.dbghead small { color: var(--muted); font-weight: 400; }
.dbghead .dbgopen { margin-left: auto; color: var(--accent); text-decoration: none; font-weight: 600; font-size: 12px; }
.dbghead .x { background: transparent; border: 0; font-size: 17px; cursor: pointer; color: var(--muted); }
.dbgframe { width: 100%; height: 100%; border: 0; display: block; background: var(--card); }

/* ── time-travel bar (timeline + branch map + cursor + two-truths) ── */
.timecard .bm-head { margin-top: 14px; }
.past-banner { background: rgba(230,184,77,.14); border: 1px solid var(--agent); color: var(--fg); border-radius: 8px; padding: 7px 11px; font-size: 12.5px; margin-bottom: 10px; }
.timeline-row { display: flex; align-items: center; gap: 8px; }
.step-btn { flex: 0 0 auto; white-space: nowrap; font-size: 12px; padding: 6px 11px; }
.timeline { display: flex; gap: 3px; align-items: flex-end; overflow-x: auto; padding: 4px 2px; min-height: 48px; flex: 1 1 auto; min-width: 0; }
.tl-empty { color: var(--muted); font-style: italic; font-size: 12px; }
.tl-dot { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; background: transparent; border: 0; cursor: pointer; padding: 2px 4px; border-radius: 7px; }
.tl-dot:hover { background: var(--chip); }
.tl-flag { font-size: 11px; color: var(--agent); line-height: 1; height: 13px; }
.tl-node { width: 13px; height: 13px; border-radius: 999px; background: var(--muted); box-shadow: 0 0 0 1px var(--line); }
.tl-dot[data-actor="user"] .tl-node { background: var(--user); }
.tl-dot[data-actor="agent"] .tl-node { background: var(--agent); }
.tl-dot[data-actor="system"] .tl-node { background: var(--muted); }
.tl-dot.cursor .tl-node { box-shadow: 0 0 0 3px var(--accent); transform: scale(1.18); }
.tl-cid { font-size: 9px; color: var(--muted); font-variant-numeric: tabular-nums; }
.time-controls { display: flex; gap: 8px; align-items: center; margin: 10px 0 2px; flex-wrap: wrap; }
.ckpt-input { font: inherit; font-size: 12px; padding: 5px 9px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: var(--fg); width: 150px; }
.ckpt-input:focus { outline: none; border-color: var(--accent); }
.time-controls .btn { font-size: 12px; padding: 5px 10px; }
.bm-count { margin-left: auto; font-variant-numeric: tabular-nums; }
.branchmap-wrap { overflow-x: auto; padding: 2px 0; }
.bm-empty { color: var(--muted); font-style: italic; font-size: 12px; padding: 6px 0; }
svg.branchmap { display: block; }
svg.branchmap .bm-node { cursor: pointer; }
.bm-edge { fill: none; stroke: var(--line); stroke-width: 2; }
.bm-dot { stroke: var(--card); stroke-width: 2; }
.bm-dot.user { fill: var(--user); }
.bm-dot.agent { fill: var(--agent); }
.bm-dot.system { fill: var(--muted); }
.bm-dot.head { stroke: var(--fg); stroke-width: 2.5; }
.bm-dot.cursor { stroke: var(--accent); stroke-width: 3.5; }
.bm-flag { fill: var(--agent); font-size: 13px; }
.two-truths { display: flex; flex-direction: column; gap: 3px; margin: 4px 0 10px; padding: 9px 12px; background: var(--chip); border: 1px solid var(--line); border-radius: 9px; }
.tt-line { font-size: 12.5px; }
.tt-k { color: var(--muted); font-weight: 700; margin-right: 8px; text-transform: uppercase; font-size: 10.5px; letter-spacing: .03em; }
.tt-v { font-variant-numeric: tabular-nums; }
.tt-honest { font-size: 11.5px; color: var(--agent); font-style: italic; margin-top: 3px; }
.history .chip { cursor: pointer; }
.history .chip.offbranch { opacity: .42; }
.history .chip.cursor { outline: 2px solid var(--accent); outline-offset: 1px; }
`;

export const PAGE = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>vizfootprint — mixed-principal analyst</title><style>${STYLE}</style></head>
<body>
<header>
  <h1>vizfootprint — mixed-principal analyst</h1>
  <p>One live session, two principals. You brush and click the dashboard; a real Claude analyst works alongside you from the popup (bottom-right). Every gesture is one cause-tagged commit — the mixed author log below is the whole point.</p>
  <div class="legend">
    <span><span class="badge user">user</span> your gestures</span>
    <span><span class="badge agent">agent</span> the analyst's tool calls</span>
    <span><span class="badge system">system</span> a declared analysis</span>
  </div>
</header>
<main>
  <section class="pane dashboard" id="dashboard"></section>
</main>

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

<div id="dbgmodal" class="dbgmodal" hidden>
  <div class="dbgcard">
    <div class="dbghead">
      <b>🐛 Analyst reasoning</b><small>this turn — via AgentThinkingUI</small>
      <a href="/debug" target="_blank" rel="noopener" class="dbgopen">open full ↗</a>
      <button id="dbgx" class="x" title="Close">✕</button>
    </div>
    <iframe id="dbgframe" class="dbgframe" title="Analyst reasoning"></iframe>
  </div>
</div>

<script src="/bundle/app.js"></script>
</body></html>`;
