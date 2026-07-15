/**
 * The combined browser page — UX-2: the dashboard is now the FLAGSHIP
 * `<VizCockpit>` (single viewport, zero page scroll), built entirely from
 * `vizfootprint-ui` components driven by ONE `createSessionView` store; the
 * CHAT popup (right/floating) stays hand-rolled DOM — it is a popup, not a
 * page panel, so it is not the migration target. The 🐛 debugger now rides
 * the cockpit's OWN report-chip/modal system (a `<DebugPanel>` iframing the
 * isolated `/debug?embed` page) instead of a hand-rolled modal — there is
 * only ONE modal system now, `VizModal`, same as every other report.
 *
 * There is NO browser-side session: the ONE `InteractionSession` lives on the
 * server. Both principals drive it over http —
 *   - a human brush/click/axis-reencode → `view`'s action methods → POST
 *     /api/dispatch (a `user`-badged commit);
 *   - the analyst's tool calls → POST /api/chat (`agent`-badged commits).
 * `createSessionView(pollingSource())` polls GET /api/state (the package's
 * default endpoints already match this server's routes) and normalizes it
 * into the ONE `SessionViewState` every vizfootprint-ui component reads — the
 * SAME log, ledger, gaps, encodings, and selection both authors write to.
 */
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  VizCockpit,
  VizScatter,
  VizBar,
  VizLine,
  VizMap,
  VizTable,
  TimeTravelBar,
  BranchMap,
  CommitLog,
  FdrLedger,
  GapsPanel,
  ReadinessPanel,
  BranchPill,
  PathsModal,
  CompareModal,
  ForkToast,
  createSessionView,
  pollingSource,
  useSessionView,
  selectionForView,
  keepPredicate,
  type SessionView,
  type SessionViewState,
  type TimeMode,
} from 'vizfootprint-ui';
import { CATEGORIES, categoryColor, el, replaceChildren } from '../../demo/src/common.js';
import { loadRows, type DemoRow } from './rows.js';
import { DEMO_GEO, REGIONS } from './geo.js';
import { ProposedChartCell } from './ProposedChartCell.js';

// ── the chat/activity slice of /api/state — NOT part of vizfootprint-ui's
// adapter contract (agent tool-call activity is this demo's own chrome, not a
// viz-dashboard concern), so the chat popup polls it separately. ─────────────
interface ActivityStep {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
}
interface ChatPollState {
  readonly activity: readonly ActivityStep[];
  readonly turnActive: boolean;
  readonly mode: 'mock' | 'live';
}

async function getChatState(): Promise<ChatPollState | null> {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return null;
    return (await res.json()) as ChatPollState;
  } catch {
    return null;
  }
}
async function post(url: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Compact value/args/result renderers for the activity strip (never a raw dump). */
function summarizeValue(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(summarizeValue).join(',')}]`;
  if (typeof v === 'string') return v.length > 28 ? `"${v.slice(0, 25)}…"` : `"${v}"`;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (v === null) return 'null';
  return String(v);
}
function summarizeArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${summarizeValue(v)}`);
  return parts.length ? parts.join(' ') : '(no args)';
}
function summarizeResult(result: Record<string, unknown> | undefined): string {
  if (!result) return '';
  if (result['ok'] === false) {
    const gap = result['gap'] as { code?: string; detail?: string } | undefined;
    if (gap) return `gap=${gap.code}`;
    return `ok=false${result['reason'] ? ` reason=${String(result['reason'])}` : ''}`;
  }
  if ('views' in result && 'activeSelections' in result) {
    const fdr = result['fdr'] as { tests?: number } | undefined;
    return `views=${(result['views'] as unknown[]).length} selections=${(result['activeSelections'] as unknown[]).length} tests=${fdr?.tests ?? 0} gaps=${String(result['gaps'])}`;
  }
  if ('verb' in result) {
    const bits: string[] = [`verb=${String(result['verb'])}`];
    const commit = result['commit'] as { id?: string; field?: string; value?: unknown } | undefined;
    if (commit) bits.push(`commit=#${commit.id} ${commit.field}=${summarizeValue(commit.value)}`);
    const analysis = result['analysis'] as { analysisId?: string; kind?: string; fdrStep?: { pValue?: number; reject?: boolean } } | undefined;
    if (analysis) {
      bits.push(`analysis=${analysis.analysisId} kind=${analysis.kind}`);
      if (analysis.fdrStep) bits.push(`p=${analysis.fdrStep.pValue?.toFixed(4)} discovery=${String(analysis.fdrStep.reject)}`);
    }
    const reencoded = result['reencoded'] as { viewId?: string; channel?: string; field?: string } | undefined;
    if (reencoded) bits.push(`reencoded=${reencoded.viewId}.${reencoded.channel}→${reencoded.field}`);
    return bits.join(' ');
  }
  if ('tiers' in result || 'slice' in result) return 'why → cross-tier slice';
  return 'ok=true';
}

const SUGGESTIONS = [
  'Is price correlated with rating? Declare it and read the ledger honestly.',
  'Filter the scatter to dresses over $150, then give me the group-by of price per category.',
  'Cluster the dresses by price, then tell me why the cluster_id column has the values it does.',
  'Change the x axis of the scatter to rating.',
  'Propose a chart of price vs rating colored by category.',
  'Compare my two paths — what\'s different?',
  'Filter to May and tell me what changed.',
  'Select the Midlands region on the map and tell me what changed.',
  'Focus the scatter, then present the story so far.',
];

// Crossfilter self-exclusion now rides vizfootprint-ui's OWN contract layer
// (RP-1): `selectionForView` derives the clause-addressable selection from the
// adapter state's per-view fold and `keepPredicate` folds it — one evaluator,
// parity-pinned against src/data's matchesClause, never a page matcher. The
// old local `clauseOf` bridge is gone with the flat keep-predicate it fed.

/**
 * The 🐛 debugger's report content — an iframe onto the isolated `/debug?embed`
 * page (atui replaying the analyst's live reasoning). The cache-busting `t=`
 * query param is computed ONCE per mount via the lazy `useState` initializer:
 * `<VizModal>` unmounts its children while closed, so every chip open/close
 * cycle remounts this component fresh (a new timestamp), exactly mirroring the
 * old hand-rolled modal's `dbgframe.src = '/debug?embed=1&t=' + Date.now()` on
 * every open — but polling stops for free too (no src reset to 'about:blank'
 * needed) since the iframe itself is torn down on close.
 */
function DebugPanel(): JSX.Element {
  const [src] = useState(() => `/debug?embed=1&t=${Date.now()}`);
  return <iframe title="Analyst reasoning" src={src} style={{ width: '100%', height: '100%', border: 0, display: 'block' }} />;
}

// ── the React cockpit — every layer from vizfootprint-ui, ONE store ──────────

function Dashboard(props: { view: SessionView; rows: readonly DemoRow[] }): JSX.Element {
  const { view, rows } = props;
  const state: SessionViewState = useSessionView(view);
  const [mode, setMode] = useState<TimeMode>('explore');
  const readOnly = mode === 'present';

  // BR-3: named paths — the pill opens PathsModal; the branch-map's "Compare
  // with current" context-menu item seeds CompareModal's A side with that
  // commit (B defaults to the current path — CompareModal's own seeding logic).
  const [pathsOpen, setPathsOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareRefs, setCompareRefs] = useState<{ a?: string; b?: string }>({});
  const openCompareWith = (commitId: string): void => {
    setCompareRefs({ a: commitId, b: undefined });
    setCompareOpen(true);
  };

  // step-nav keyboard mirror (ArrowLeft/ArrowRight), but never while an
  // <input>/<textarea> has focus (the checkpoint modal's field, the chat composer).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const focused = document.activeElement;
      const tag = focused instanceof HTMLElement ? focused.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      if (e.key === 'ArrowLeft') void view.stepBack();
      else void view.stepForward();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view]);

  // the scatter's fields ride the ENCODING fold (the reencode verb's state)
  const enc = state.encodings['scatter'] ?? {};
  const xField = enc['x'] ?? 'price';
  const yField = enc['y'] ?? 'rating';
  const columns = state.columns[state.defaultTable] ?? [];

  // one clause-addressable selection per view (self named for exclusion) — RP-1
  const selFor = (self: string | null) => selectionForView(state.selections, self);

  const scatterData = useMemo(
    () =>
      rows.map((r) => ({
        id: r.id,
        x: typeof r[xField] === 'number' ? (r[xField] as number) : 0,
        y: typeof r[yField] === 'number' ? (r[yField] as number) : 0,
        category: r.category,
        row: r, // the source row — VizScatter evaluates the selection clauses against it
      })),
    [rows, xField, yField],
  );

  // aggregated charts recompute their HOST-owned data under the other views'
  // clauses (the transform-ownership rule: the host aggregates, never the chart)
  const keepBar = keepPredicate(selFor('bar'));
  const barData = CATEGORIES.map((category) => ({
    category,
    count: rows.filter((r) => r.category === category && keepBar(r)).length,
  }));

  // the line's fields ride ITS OWN encoding fold; its data recomputes under
  // the OTHER views' selections (crossfilter self-exclusion, the bar pattern)
  const encLine = state.encodings['line'] ?? {};
  const lineX = encLine['x'] ?? 'date';
  const lineY = encLine['y'] ?? 'price';
  const lineData = useMemo(
    () =>
      rows
        .filter((r) => keepPredicate(selectionForView(state.selections, 'line'))(r))
        .map((r) => ({
          date: String(r[lineX]),
          value: typeof r[lineY] === 'number' ? (r[lineY] as number) : 0,
          series: r.category,
        })),
    [rows, lineX, lineY, state.selections],
  );

  // the map's value per region = the crossfiltered row COUNT (the canonical wiring)
  const keepMap = keepPredicate(selFor('map'));
  const mapData = REGIONS.map((region) => ({
    region: region as string,
    value: rows.filter((r) => r.region === region && keepMap(r)).length,
  }));

  const keepAll = keepPredicate(selFor(null)); // the whole-dashboard truth — nothing excluded
  const selectedCount = rows.filter((r) => keepAll(r)).length;

  // RP-3: the agent-authored charts — each a real cockpit cell rendered through
  // the SAME RP-2 vega-lite bridge as the first-party charts, receiving the
  // crossfilter (its marks dim under every other view's selection).
  const agentChartCells = state.charts.map((chart) => ({
    id: chart.viewId,
    weight: 2.5,
    caption: `Agent-authored (ledgered ✓): ${chart.claim}`,
    render: ({ width, height }: { width: number; height: number }) => (
      <ProposedChartCell
        viewId={chart.viewId}
        spec={chart.spec}
        rows={rows}
        selection={selFor(chart.viewId)}
        theme={{}}
        width={width}
        height={height}
      />
    ),
  }));

  const provider = state.mode === 'mock' ? 'scripted mock' : 'live Claude';
  const pastSuffix = state.viewingPast ? '  ·  ⏱ viewing the past (cursor behind head)' : '';

  return (
    <VizCockpit
      readOnly={readOnly}
      // LY-2: the arrangement is SESSION state (state.layout, the fold at the
      // cursor) — every switcher/reorder/focus gesture lands through
      // view.setLayout so it time-travels, forks, and replays in present mode
      // like everything else (same pattern as the gallery — ui/gallery/entry.tsx).
      layout={state.layout}
      onLayoutChange={(change) => void view.setLayout(change)}
      top={
        <TimeTravelBar
          compact
          mode={mode}
          onModeChange={setMode}
          pathPill={<BranchPill paths={state.paths} onClick={() => setPathsOpen(true)} />}
          commits={state.commits}
          cursor={state.cursor}
          head={state.head}
          checkpoints={state.checkpoints}
          branches={state.branches}
          viewingPast={state.viewingPast}
          onSeek={(id) => void view.seek(id)}
          onStepBack={() => void view.stepBack()}
          onStepForward={() => void view.stepForward()}
          onCheckpoint={(label) => void view.checkpoint(label)}
          onReturnToNow={() => void view.returnToNow()}
        />
      }
      toast={
        <>
          <ForkToast events={state.paths.events} onOpenPaths={() => setPathsOpen(true)} />
          {/*
            BR-3 bugfix: PathsModal/CompareModal must render INSIDE this
            `toast` slot, not as siblings of <VizCockpit>. Every rule in
            vizfootprint-ui's stylesheet is scoped `:where(.vzf) …`, and
            `.vzf` only lives on VizCockpit's OWN root div — a modal
            rendered as a sibling gets NONE of that CSS (not even
            `z-index: 50`), so it silently lands BEHIND an open report
            modal and becomes unclickable (real headless-Chromium repro:
            a click at the Compare modal's own ✕ button hit-tested to the
            report-branches backdrop instead). Slotting them here puts
            them in the SAME `.vzf` subtree as every report modal, in the
            correct stacking order (rendered after — on top).
          */}
          <PathsModal
            open={pathsOpen}
            onClose={() => setPathsOpen(false)}
            paths={state.paths}
            cursor={state.cursor}
            readOnly={readOnly}
            onSwitch={(name) => void view.switchPath(name)}
            onRename={(from, to) => void view.renamePath(from, to)}
            onNewPath={(id) => void view.newPathAt(id)}
          />
          <CompareModal
            open={compareOpen}
            onClose={() => setCompareOpen(false)}
            paths={state.paths}
            initialA={compareRefs.a}
            initialB={compareRefs.b}
            onCompare={view.compare}
          />
        </>
      }
      charts={[
        {
          id: 'scatter',
          weight: 3,
          caption: `Scatter — drag to brush ${xField}; click an axis label to re-encode (you drive this)`,
          render: ({ width, height }) => (
            <VizScatter
              viewId="scatter"
              data={scatterData}
              xField={xField}
              yField={yField}
              width={width}
              height={height}
              /* v8 ignore next -- `c` (ScatterDatum.category) is always a defined string here:
                 `scatterData` (above) sets `category: r.category` straight from `rows`, and every
                 `DemoRow.category` is `String(...)`-coerced by `loadRows` (./rows.ts) — even an
                 empty/missing CSV cell sniffs to `null` and stringifies to `"null"`, never JS
                 `undefined`. The `?? ''` fallback guards VizScatter's wider (optional) prop type,
                 not a state this component's own data pipeline can produce. */
              colorOf={(c) => categoryColor(c ?? '')}
              selection={selFor('scatter')}
              columns={columns}
              encoding={enc}
              onEmit={(e) => void view.emit('scatter', e, `brush ${xField}`)}
              onReencode={(v, c, f) => void view.reencode(v, c, f)}
            />
          ),
        },
        {
          id: 'line',
          weight: 2.5,
          caption: `Line — drag to brush ${lineX}; mean ${lineY} per date by category (you drive this)`,
          render: ({ width, height }) => (
            <VizLine
              viewId="line"
              data={lineData}
              dateField={lineX}
              valueField={lineY}
              width={width}
              height={height}
              /* v8 ignore next -- same reasoning as the scatter's colorOf above: `series`
                 (LinePoint.series) is always `r.category` here, a defined string coming straight
                 from `rows` — the `?? ''` fallback guards VizLine's wider (optional) prop type,
                 not a state this component's own data pipeline can produce. */
              colorOf={(c) => categoryColor(c ?? '')}
              columns={columns}
              encoding={encLine}
              onEmit={(e) => void view.emit('line', e, `brush ${lineX}`)}
              onReencode={(v, c, f) => void view.reencode(v, c, f)}
            />
          ),
        },
        {
          id: 'bar',
          weight: 2,
          caption: 'Bar — click a category to select (you drive this)',
          render: ({ width, height }) => (
            <VizBar
              viewId="bar"
              data={barData}
              field="category"
              width={width}
              height={height}
              colorOf={categoryColor}
              selection={selFor('bar')}
              columns={columns}
              onEmit={(e) => void view.emit('bar', e, 'select category')}
              onReencode={(v, c, f) => void view.reencode(v, c, f)}
            />
          ),
        },
        {
          id: 'map',
          weight: 2,
          caption: 'Map — click a region to select; click again to clear (you drive this)',
          render: ({ width, height }) => (
            <VizMap
              viewId="map"
              geo={DEMO_GEO}
              regionField="region"
              data={mapData}
              valueLabel="rows"
              width={width}
              height={height}
              selection={selFor('map')}
              onEmit={(e) => void view.emit('map', e, 'select region')}
            />
          ),
        },
        {
          id: 'table',
          weight: 2.5,
          caption: 'Table — click a header to sort, click a row to select (you drive this)',
          render: ({ width, height }) => (
            <VizTable
              viewId="table"
              data={rows}
              columns={['id', 'category', 'price', 'rating', 'date', 'region']}
              selection={selFor('table')}
              width={width}
              height={height}
              onEmit={(e) => void view.emit('table', e, 'select row')}
            />
          ),
        },
        ...agentChartCells,
      ]}
      reports={[
        {
          id: 'commits',
          title: 'Commit log',
          icon: '🧾',
          badge: state.commits.length,
          content: <CommitLog commits={state.commits} onSeek={(id) => void view.seek(id)} />,
        },
        {
          id: 'branches',
          title: 'Branch map',
          icon: '🌿',
          badge: state.branches.length,
          content: (
            <BranchMap
              commits={state.commits}
              cursor={state.cursor}
              head={state.head}
              checkpoints={state.checkpoints}
              paths={state.paths.list}
              onSeek={(id) => void view.seek(id)}
              onNewPath={(id) => void view.newPathAt(id)}
              onBringOver={(id) => void view.bringOver(id)}
              onUndo={(id) => void view.undo(id)}
              onCompare={openCompareWith}
            />
          ),
        },
        {
          id: 'ledger',
          title: 'FDR ledger',
          icon: '⚖️',
          badge: state.ledger.discoveries,
          content: <FdrLedger ledger={state.ledger} />,
        },
        {
          id: 'analyses',
          title: 'Analyses',
          icon: '🧪',
          badge: state.readiness.filter((r) => r.ready).length,
          content: <ReadinessPanel heading={false} analyses={state.readiness} onAnalyze={(id) => void view.analyze(id)} />,
        },
        {
          id: 'gaps',
          title: 'Gaps',
          icon: '⚠️',
          badge: state.gaps.length,
          content: <GapsPanel heading={false} gaps={state.gaps} />,
        },
        {
          id: 'debug',
          title: 'Analyst debugger',
          icon: '🐛',
          content: <DebugPanel />,
        },
      ]}
      status={`${selectedCount} of ${rows.length} rows selected · provider: ${provider}${pastSuffix}`}
    />
  );
}

// ── chat popup (KEPT — plain DOM, not the migration target; it's a floating
// popup, not a page panel) ────────────────────────────────────────────────────

function wireChatAndDebugger(view: SessionView): void {
  const chatRoot = document.getElementById('chatbody') as HTMLElement;

  // The popup body is an honest flex column with ONE internal scroll region:
  // header (page.mjs chrome, pinned) → transcript (scrollable — replies AND
  // tool-activity rows flow together in turn order) → working line → composer
  // → suggestion chips (pinned, own ≤2-row scroll). The activity strip used to
  // be a pinned SIBLING of the transcript; under flex pressure its box shrank
  // below its rows and they painted over the composer/chips (see page.mjs).
  const transcript = el('div', { class: 'transcript' });
  const working = el('div', { class: 'working' });
  const input = el('input', {}) as HTMLInputElement;
  input.type = 'text';
  input.placeholder = 'Ask the analyst to work alongside you…';
  const sendBtn = el('button', { class: 'btn', text: 'Send' }) as HTMLButtonElement;
  const suggestRow = el('div', { class: 'suggest' });

  replaceChildren(
    chatRoot,
    el('div', { class: 'card' }, [
      el('div', { class: 'section-head', text: 'Analyst chat — a real Claude analyst driving the same session' }),
      transcript,
      working,
      el('div', { class: 'composer' }, [input, sendBtn]),
      suggestRow,
    ]),
  );

  transcript.appendChild(el('div', { class: 'bubble sys', text: 'Brush the scatter or click a bar on the dashboard, then ask me to analyze. Every move we both make lands in the shared commit log.' }));

  // Tool-activity rows live INSIDE the transcript, one `.activity` group per
  // turn: the server's activity buffer is per-turn (core.ts resets it on every
  // /api/chat), so renderActivity always paints the CURRENT group and prior
  // turns' groups stay frozen in place — they scroll with the conversation
  // instead of competing with the pinned composer/chips for the popup's fixed
  // height. Boot starts with one group for whatever the last turn left behind.
  function newActivityGroup(): HTMLElement {
    const group = el('div', { class: 'activity' });
    transcript.appendChild(group);
    return group;
  }
  let activityGroup = newActivityGroup();
  for (const s of SUGGESTIONS) {
    const b = el('button', { text: s }) as HTMLButtonElement;
    b.addEventListener('click', () => {
      if (!sendBtn.disabled) void sendMessage(s);
    });
    suggestRow.appendChild(b);
  }

  // ── floating popup wiring (chrome lives in page.mjs) ──────────────────────
  const fab = document.getElementById('fab') as HTMLButtonElement;
  const chatpanel = document.getElementById('chatpanel') as HTMLElement;
  const chatclose = document.getElementById('chatclose') as HTMLButtonElement;
  const chatreset = document.getElementById('chatreset') as HTMLButtonElement;

  function openChat(): void {
    chatpanel.hidden = false;
    fab.hidden = true;
    window.setTimeout(() => input.focus(), 40);
    transcript.scrollTop = transcript.scrollHeight;
  }
  function closeChat(): void {
    chatpanel.hidden = true;
    fab.hidden = false;
  }
  fab.addEventListener('click', openChat);
  chatclose.addEventListener('click', closeChat);

  // Start fresh: rebuild the session + analyst server-side, clear the transcript.
  chatreset.addEventListener('click', () => {
    void (async () => {
      chatreset.disabled = true;
      await post('/api/reset', {});
      replaceChildren(transcript, el('div', { class: 'bubble sys', text: '✨ Fresh session — chat and shared log cleared. Ask away!' }));
      activityGroup = newActivityGroup(); // never render into the detached old group
      chatreset.disabled = false;
      await view.refresh();
    })();
  });

  // The 🐛 debugger is now the cockpit's OWN "Analyst debugger" report chip —
  // clicking the button under a reply just opens that SAME chip/modal (there
  // is only one debug modal now, not a duplicate hand-rolled one).
  function openDebugger(): void {
    (document.querySelector('[data-report="debug"]') as HTMLButtonElement | null)?.click();
  }

  function renderActivity(state: ChatPollState): void {
    if (state.turnActive) working.textContent = state.activity.length ? 'analyst is working…' : 'analyst is thinking…';
    else working.textContent = '';
    replaceChildren(
      activityGroup,
      ...state.activity.map((s) =>
        el('div', { class: 'activity-step', dataset: { tool: s.tool } }, [
          el('span', { class: 'tool', text: s.tool }),
          el('span', { class: 'args', text: summarizeArgs(s.args) }),
          el('span', { class: 'result', text: summarizeResult(s.result) }),
        ]),
      ),
    );
    // mid-turn the newest tool row is the live signal — keep it in view (the
    // rows now grow INSIDE the transcript's scroll region, not a pinned strip)
    if (state.turnActive) transcript.scrollTop = transcript.scrollHeight;
  }

  async function sendMessage(text: string): Promise<void> {
    const message = text.trim();
    if (!message || sendBtn.disabled) return;
    input.value = '';
    sendBtn.disabled = true;
    input.disabled = true;
    transcript.appendChild(el('div', { class: 'bubble you', text: message }));
    activityGroup = newActivityGroup(); // THIS turn's tool rows flow right under the message, before the reply
    transcript.scrollTop = transcript.scrollHeight;
    working.textContent = 'analyst is thinking…';
    // Faster polling during the turn so the dashboard (commits/ledger) and the
    // activity strip both update live, not just at the end of the turn.
    const live = window.setInterval(() => {
      void view.refresh();
      void getChatState().then((s) => s && renderActivity(s));
    }, 400);
    try {
      const reply = (await post('/api/chat', { message })) as { text?: string; error?: string } | null;
      const answer = reply?.text ?? reply?.error ?? 'The analyst did not reply.';
      transcript.appendChild(el('div', { class: 'bubble analyst', text: answer }));
      // Offer the 🐛 debugger for THIS turn — opens the cockpit's debug chip
      // modal, which replays the reasoning via atui.
      const dbg = el('button', { class: 'dbgbtn', text: '🐛 See the thinking' }) as HTMLButtonElement;
      dbg.addEventListener('click', openDebugger);
      transcript.appendChild(dbg);
    } finally {
      window.clearInterval(live);
      sendBtn.disabled = false;
      input.disabled = false;
      working.textContent = '';
      transcript.scrollTop = transcript.scrollHeight;
      await view.refresh();
      const finalState = await getChatState();
      if (finalState) renderActivity(finalState);
      input.focus();
    }
  }

  sendBtn.addEventListener('click', () => void sendMessage(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void sendMessage(input.value);
  });

  // a slow idle poll so the activity strip / provider status stay honest even
  // outside a turn (e.g. after a human-only dispatch cleared old steps)
  window.setInterval(() => void getChatState().then((s) => s && renderActivity(s)), 2000);
  void getChatState().then((s) => s && renderActivity(s));
}

// ── boot ─────────────────────────────────────────────────────────────────────

// `export` (rather than the void-called-only original) exists SOLELY so a test
// can observe main()'s own failure/lifecycle branches directly (the
// `#dashboard missing` throw, and — via the `root` handed back on
// `window.__vizAgent` below — a real `root.unmount()` to exercise the
// ArrowLeft/ArrowRight `useEffect` cleanup) without resorting to a global
// `unhandledRejection` listener. Purely additive: the module still
// self-mounts via `void main()` at the bottom exactly as before.
export async function main(): Promise<void> {
  const rows = await loadRows();
  const view = createSessionView(pollingSource({ intervalMs: 900 }), { as: 'user' });
  await view.refresh();

  const dashRoot = document.getElementById('dashboard');
  if (!dashRoot) throw new Error('demo-agent: #dashboard missing');
  const root = createRoot(dashRoot);
  root.render(<Dashboard view={view} rows={rows} />);

  wireChatAndDebugger(view);

  (window as unknown as { __vizAgent?: unknown }).__vizAgent = { view, refresh: () => view.refresh(), root };
}

void main();
