/**
 * The demo's static HTML shells. Only PAGE CHROME lives here (headings, layout,
 * legend) — every DATA/runtime string is written by the bundled browser code
 * via textContent (the two-string discipline). Theme-aware (light + dark).
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
header { padding: 18px 24px; border-bottom: 1px solid var(--line); background: var(--card); }
header h1 { margin: 0; font-size: 18px; }
header p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
header nav { margin-top: 10px; display: flex; gap: 10px; }
header nav a { text-decoration: none; color: var(--accent); font-weight: 600; padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; }
header nav a.active { background: var(--accent); color: #fff; border-color: var(--accent); }
main { padding: 20px 24px 60px; max-width: 1120px; margin: 0 auto; }
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.btn { font: inherit; padding: 7px 12px; border: 1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 7px; cursor: pointer; box-shadow: var(--shadow); }
.btn:hover { border-color: var(--accent); }
.btn:disabled { opacity: .5; cursor: default; }
.btn[data-action="agent"] { border-color: var(--agent); }
.charts, .grid { display: flex; gap: 18px; flex-wrap: wrap; }
.grid .left { flex: 1 1 540px; min-width: 380px; }
.grid .right { flex: 1 1 380px; min-width: 320px; }
.chartbox { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px; box-shadow: var(--shadow); }
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
.strip-head, .panel-head, .ledger-head, .cluster-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; margin: 18px 0 8px; }
.history { display: flex; gap: 8px; flex-wrap: wrap; min-height: 40px; align-items: flex-start; }
.history .empty { color: var(--muted); font-style: italic; }
.chip { display: inline-flex; align-items: center; gap: 6px; background: var(--chip); border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
.chip.sel { outline: 2px solid var(--accent); }
.chip.replayed { animation: pop .25s ease; }
@keyframes pop { from { transform: scale(.85); opacity: .3; } to { transform: scale(1); opacity: 1; } }
.badge { font-weight: 700; text-transform: uppercase; font-size: 10px; padding: 1px 6px; border-radius: 5px; color: #fff; }
.badge.user { background: var(--user); }
.badge.agent { background: var(--agent); }
.chip .k { color: var(--muted); }
.chip .cid { color: var(--muted); font-variant-numeric: tabular-nums; }
.chip .replay { color: var(--accent); font-weight: 600; }
.chip .fork { color: #ff5c9d; font-weight: 600; }
.analyses { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; box-shadow: var(--shadow); }
.analyses .declare { display: block; width: 100%; text-align: left; margin: 6px 0; }
.result-card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin-top: 14px; min-height: 48px; box-shadow: var(--shadow); }
.analysis-title { font-weight: 700; margin-bottom: 6px; }
.result-card .muted, .muted { color: var(--muted); font-size: 12px; }
.flag { padding: 8px 10px; border-radius: 8px; background: rgba(255,92,157,.12); border: 1px solid rgba(255,92,157,.4); }
.flag.r14 { background: rgba(245,166,35,.14); border-color: rgba(245,166,35,.5); }
.cluster-list { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
.cluster-chip { font: inherit; font-size: 12px; padding: 4px 10px; border: 2px solid var(--line); background: var(--card); color: var(--fg); border-radius: 999px; cursor: pointer; }
table.ledger, table.gb-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 4px; }
table.ledger th, table.ledger td, table.gb-table th, table.gb-table td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
table.ledger tr.discovery { background: rgba(0,179,164,.12); }
table.ledger .verdict { font-weight: 700; }
.headline { margin-top: 12px; padding: 10px 12px; border-radius: 8px; background: var(--chip); border: 1px solid var(--line); font-weight: 600; }
.sel-readout { color: var(--muted); font-size: 13px; margin-bottom: 10px; }
`;

function shell({ title, subtitle, active, bundle }) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>${STYLE}</style></head>
<body>
<header>
  <h1>${title}</h1>
  <p>${subtitle}</p>
  <nav>
    <a href="/dashboard" class="${active === 'dashboard' ? 'active' : ''}">Dashboard</a>
    <a href="/analyst" class="${active === 'analyst' ? 'active' : ''}">Analyst</a>
  </nav>
</header>
<main id="app"></main>
<script src="${bundle}"></script>
</body></html>`;
}

export const PAGE_DASHBOARD = shell({
  title: 'vizfootprint — Coordination & Provenance',
  subtitle:
    'Two charts linked through a real Mosaic crossfilter. Every gesture commits one cause-tagged record; replay rebuilds a fresh selection; the agent button is the second principal.',
  active: 'dashboard',
  bundle: '/bundle/dashboard.js',
});

export const PAGE_ANALYST = shell({
  title: 'vizfootprint — Declared Analyses & Online FDR',
  subtitle:
    'Declare correlation / clustering / regression / group-by over the current selection. Only tests step the LORD++ ledger; brushing never does; degenerate inputs get an honest flag.',
  active: 'analyst',
  bundle: '/bundle/analyst.js',
});

export const PAGE_INDEX = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>vizfootprint demo</title><style>${STYLE}</style></head>
<body><header><h1>vizfootprint demo</h1><p>Two pages over the landed layers.</p>
<nav><a href="/dashboard">Dashboard — coordination + provenance</a><a href="/analyst">Analyst — declared analyses + FDR</a></nav>
</header></body></html>`;
