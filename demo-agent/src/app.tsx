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
  type SessionView,
  type SessionViewState,
  type TimeMode,
} from 'vizfootprint-ui';
import { CATEGORIES, categoryColor, loadRows, el, replaceChildren, type DemoRow } from '../../demo/src/common.js';
import { matchesClause } from '../../src/data/predicate.js';
import type { PredicateClause } from '../../src/data/types.js';

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
  'Compare my two paths — what\'s different?',
];

// ── crossfilter self-exclusion (real src/data predicate matcher — never a
// duplicate reimplementation) ─────────────────────────────────────────────────
function clauseOf(sel: { field: string; kind: 'point' | 'interval'; value: unknown }): PredicateClause | null {
  if (sel.kind === 'interval') {
    const v = sel.value as [number, number] | null;
    return v === null ? null : { kind: 'interval', field: sel.field, value: v };
  }
  return { kind: 'point', field: sel.field, value: sel.value };
}

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

  const clauses = state.selections.map((s) => ({ viewId: s.viewId, clause: clauseOf(s) })).filter((c) => c.clause !== null) as {
    viewId: string;
    clause: PredicateClause;
  }[];
  const notOwn = (self: string): PredicateClause[] => clauses.filter((c) => c.viewId !== self).map((c) => c.clause);

  const scatterData = useMemo(
    () =>
      rows.map((r) => ({
        id: r.id,
        x: typeof r[xField] === 'number' ? (r[xField] as number) : 0,
        y: typeof r[yField] === 'number' ? (r[yField] as number) : 0,
        category: r.category,
      })),
    [rows, xField, yField],
  );
  const scatterClauses = notOwn('scatter');
  const scatterKeep = (d: { id: string }): boolean => {
    const row = rows.find((r) => r.id === d.id);
    /* v8 ignore next -- `row` is always defined in practice: VizScatter only ever calls
       `highlight` with a `d` drawn from ITS OWN `data` prop, which is `scatterData`, computed
       in this SAME render from this SAME `rows` array (`scatterData = rows.map(r => ({id: r.id, ...}))`)
       — so `d.id` is always some `r.id` from `rows`. The `: true` fallback guards a mismatch that
       cannot arise from any real prop composition of this component. */
    return row ? scatterClauses.every((cl) => matchesClause(row, cl)) : true;
  };

  const barClauses = notOwn('bar');
  const barData = CATEGORIES.map((category) => ({
    category,
    count: rows.filter((r) => r.category === category && barClauses.every((cl) => matchesClause(r, cl))).length,
  }));
  const barSelected = state.selections.find((s) => s.viewId === 'bar' && s.kind === 'point');

  const allClauses = clauses.map((c) => c.clause);
  const selectedCount = rows.filter((r) => allClauses.every((cl) => matchesClause(r, cl))).length;

  const provider = state.mode === 'mock' ? 'scripted mock' : 'live Claude';
  const pastSuffix = state.viewingPast ? '  ·  ⏱ viewing the past (cursor behind head)' : '';

  return (
    <VizCockpit
      readOnly={readOnly}
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
                 `DemoRow.category` is `String(...)`-coerced by `loadRows` (common.ts) — even an
                 empty/missing CSV cell sniffs to `null` and stringifies to `"null"`, never JS
                 `undefined`. The `?? ''` fallback guards VizScatter's wider (optional) prop type,
                 not a state this component's own data pipeline can produce. */
              colorOf={(c) => categoryColor(c ?? '')}
              highlight={scatterKeep}
              columns={columns}
              encoding={enc}
              onEmit={(e) => void view.emit('scatter', e, `brush ${xField}`)}
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
              selected={barSelected ? String(barSelected.value) : null}
              columns={columns}
              onEmit={(e) => void view.emit('bar', e, 'select category')}
              onReencode={(v, c, f) => void view.reencode(v, c, f)}
            />
          ),
        },
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

  const transcript = el('div', { class: 'transcript' });
  const working = el('div', { class: 'working' });
  const activityStrip = el('div', { class: 'activity' });
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
      activityStrip,
      working,
      el('div', { class: 'composer' }, [input, sendBtn]),
      suggestRow,
    ]),
  );

  transcript.appendChild(el('div', { class: 'bubble sys', text: 'Brush the scatter or click a bar on the dashboard, then ask me to analyze. Every move we both make lands in the shared commit log.' }));
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
      activityStrip,
      ...state.activity.map((s) =>
        el('div', { class: 'activity-step', dataset: { tool: s.tool } }, [
          el('span', { class: 'tool', text: s.tool }),
          el('span', { class: 'args', text: summarizeArgs(s.args) }),
          el('span', { class: 'result', text: summarizeResult(s.result) }),
        ]),
      ),
    );
  }

  async function sendMessage(text: string): Promise<void> {
    const message = text.trim();
    if (!message || sendBtn.disabled) return;
    input.value = '';
    sendBtn.disabled = true;
    input.disabled = true;
    transcript.appendChild(el('div', { class: 'bubble you', text: message }));
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
