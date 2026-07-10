/**
 * The combined browser page — left DASHBOARD (the human's input surface + the
 * shared, mixed-principal render), right CHAT (a real Claude analyst).
 *
 * There is NO browser-side session: the ONE `InteractionSession` lives on the
 * server. Both principals drive it over http —
 *   - a human brush/click → POST /api/dispatch  (a `user`-badged commit);
 *   - the analyst's tool calls → POST /api/chat  (`agent`-badged commits).
 * The page polls GET /api/state and renders the SAME log, ledger, gaps, and
 * selection both authors write to. The two-string discipline holds: every
 * runtime/data string is written via textContent (reusing the demo's DOM
 * builders + hand-rolled SVG charts — no chart-library dependency).
 */
import {
  BarChart,
  CATEGORIES,
  Scatter,
  el,
  fmtInterval,
  loadRows,
  replaceChildren,
  type DemoRow,
} from '../../demo/src/common.js';
import { matchesClause } from '../../src/data/predicate.js';
import type { PredicateClause } from '../../src/data/types.js';

// ── server-state shapes (mirror core.ts AnalystState; structural only) ─────────
interface CommitCause {
  requestedBy: 'user' | 'agent' | 'system';
  computedBy: string;
  intent?: string;
}
interface CommitRec {
  id: string;
  parent: string | null;
  viewId: string;
  kind: 'point' | 'interval';
  field: string;
  value: unknown;
  cause: CommitCause;
}
interface FdrStep {
  step: number;
  hypothesisId: string;
  pValue: number;
  alphaThreshold: number;
  reject: boolean;
  wealthAfter: number;
}
interface Fdr {
  procedure: string;
  alpha: number;
  tests: number;
  discoveries: number;
  wealth: number;
  ledger: FdrStep[];
}
interface SelectionInfo {
  viewId: string;
  field: string;
  kind: 'point' | 'interval';
  value: unknown;
}
interface AnalysisReadiness {
  id: string;
  kind: string;
  produces: string;
  ready: boolean;
  blockedBy?: string;
  missingColumns?: string[];
  selectedRows?: number;
}
interface GapRow {
  code: string;
  op: string;
  detail: string;
  target?: string;
}
interface ActivityStep {
  tool: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
}
interface BranchDot {
  tip: string;
  length: number;
  actor: string;
  active: boolean;
}
interface CheckpointInfo {
  label: string;
  commitId: string | null;
  ts: number;
}
interface AnalystState {
  records: CommitRec[];
  fdr: Fdr;
  analyses: AnalysisReadiness[];
  activeSelections: SelectionInfo[];
  gaps: GapRow[];
  selectedCount: number;
  totalRows: number;
  activity: ActivityStep[];
  turnActive: boolean;
  mode: 'mock' | 'live';
  // ── time-travel (Phase B) ──
  cursor: string | null;
  head: string | null;
  branches: BranchDot[];
  checkpoints: CheckpointInfo[];
  cursorTests: number;
  viewingPast: boolean;
}

const SVGNS = 'http://www.w3.org/2000/svg';
/** A local namespaced SVG element builder (the demo's `el` is HTML-only). */
function svgEl(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** The root→`id` ancestor chain (a branch path), cycle-guarded. */
function pathToRoot(records: CommitRec[], id: string | null): CommitRec[] {
  if (!id) return [];
  const byId = new Map(records.map((r) => [r.id, r]));
  const chain: CommitRec[] = [];
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const rec = byId.get(cur);
    if (!rec) break;
    chain.push(rec);
    cur = rec.parent;
  }
  return chain.reverse();
}

/** A short human label for a commit dot/chip (never a raw value dump). */
function commitLabel(rec: CommitRec): string {
  if (rec.field === '__analysis__') return 'analysis';
  if (rec.field === 'pValue') return 'test';
  if (rec.field === '__annotation__') return 'note';
  return rec.field;
}

// ── tiny http helpers (all failures swallowed → zero uncaught console errors) ──
async function getState(): Promise<AnalystState | null> {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return null;
    return (await res.json()) as AnalystState;
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

// ── predicate helpers (real self-exclusion, reusing src/data matchesClause) ────
function clauseOf(sel: SelectionInfo): PredicateClause | null {
  if (sel.kind === 'interval') {
    const v = sel.value as [number, number] | null;
    return v === null ? null : { kind: 'interval', field: sel.field, value: v };
  }
  return { kind: 'point', field: sel.field, value: sel.value };
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
    return bits.join(' ');
  }
  if ('tiers' in result || 'slice' in result) return 'why → cross-tier slice';
  return 'ok=true';
}

const SUGGESTIONS = [
  'Is price correlated with rating? Declare it and read the ledger honestly.',
  'Filter the scatter to dresses over $150, then give me the group-by of price per category.',
  'Cluster the dresses by price, then tell me why the cluster_id column has the values it does.',
];

async function main(): Promise<void> {
  const dashRoot = document.getElementById('dashboard') as HTMLElement;
  const chatRoot = document.getElementById('chatbody') as HTMLElement;
  const rows = (await loadRows()) as DemoRow[];
  const knownFields = new Set(Object.keys(rows[0] ?? {}));

  // ── charts (reused from the demo) ────────────────────────────────────────────
  const scatter = new Scatter(rows, {
    brushField: 'price',
    onBrushCommit: (iv) => {
      void post('/api/dispatch', {
        verb: 'filter',
        viewId: 'scatter',
        field: 'price',
        range: iv,
        intent: iv ? `brush price ${fmtInterval(iv)}` : 'clear price brush',
      }).then(refresh);
    },
  });
  const bar = new BarChart(CATEGORIES, {
    onBarClick: (cat) => {
      void post('/api/dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: cat, intent: `select category ${cat}` }).then(refresh);
    },
  });

  // ── dashboard DOM ────────────────────────────────────────────────────────────
  const selReadout = el('div', { class: 'sel-readout', text: 'loading…' });
  const historyStrip = el('div', { class: 'history' });
  const ledgerHead = el('div', { class: 'ledger-head' });
  const ledgerBody = el('tbody', {});
  const ledgerTable = el('table', { class: 'ledger' });
  ledgerTable.append(
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: '#' }),
        el('th', { text: 'hypothesis' }),
        el('th', { text: 'p-value' }),
        el('th', { text: 'threshold αt' }),
        el('th', { text: 'discovery?' }),
      ]),
    ]),
    ledgerBody,
  );
  const headline = el('div', { class: 'headline', dataset: { headline: '1' }, text: 'No test declared yet — brushing never adds a ledger row; only a declared analysis does.' });
  const twoTruths = el('div', { class: 'two-truths' });
  const analysesList = el('div', { class: 'analyses-list' });
  const gapsPanel = el('div', {});

  // ── time-travel bar (Phase B): timeline + branch map + cursor + checkpoint ──
  const pastBanner = el('div', { class: 'past-banner' });
  pastBanner.hidden = true;
  const timelineTrack = el('div', { class: 'timeline', dataset: { timeline: '1' } });
  const branchMapWrap = el('div', { class: 'branchmap-wrap', dataset: { branchmap: '1' } });
  const ckptInput = el('input', { class: 'ckpt-input' }) as HTMLInputElement;
  ckptInput.type = 'text';
  ckptInput.placeholder = 'name this point';
  const ckptBtn = el('button', { class: 'btn ckpt-btn', text: '⚑ Checkpoint' }) as HTMLButtonElement;
  const nowBtn = el('button', { class: 'btn now-btn', text: '⏭ Return to now' }) as HTMLButtonElement;
  nowBtn.hidden = true;
  const branchCount = el('span', { class: 'muted bm-count' });

  replaceChildren(
    dashRoot,
    el('div', { class: 'card timecard', dataset: { timecard: '1' } }, [
      el('div', { class: 'section-head', text: 'Time travel — drag the cursor or click a commit to seek; act from the past to branch' }),
      pastBanner,
      timelineTrack,
      el('div', { class: 'time-controls' }, [ckptInput, ckptBtn, nowBtn, branchCount]),
      el('div', { class: 'section-head bm-head', text: 'Branch map — siblings fork downward; the active lineage is the top lane' }),
      branchMapWrap,
    ]),
    el('div', { class: 'card' }, [
      selReadout,
      el('div', { class: 'charts' }, [
        el('figure', { class: 'chartbox' }, [scatter.root, el('figcaption', { text: 'Scatter — brush price (you drive this)' })]),
        el('figure', { class: 'chartbox' }, [bar.root, el('figcaption', { text: 'Bar — click a category (you drive this)' })]),
      ]),
    ]),
    el('div', { class: 'card' }, [el('div', { class: 'section-head', text: 'Commit log — one cause-tagged record per gesture, two authors (click a chip to seek)' }), historyStrip]),
    el('div', { class: 'card' }, [
      el('div', { class: 'section-head', text: 'Online-FDR ledger (LORD++) — two truths: cursor-local vs global' }),
      twoTruths,
      ledgerHead,
      ledgerTable,
      headline,
    ]),
    el('div', { class: 'card' }, [el('div', { class: 'section-head', text: 'Declared analyses — readiness at the current cursor' }), analysesList]),
    el('div', { class: 'card' }, [gapsPanel]),
  );

  // ── chat DOM ─────────────────────────────────────────────────────────────────
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

  // ── floating popup + 🐛 debugger wiring (chrome lives in page.mjs) ────────────
  const fab = document.getElementById('fab') as HTMLButtonElement;
  const chatpanel = document.getElementById('chatpanel') as HTMLElement;
  const chatclose = document.getElementById('chatclose') as HTMLButtonElement;
  const chatreset = document.getElementById('chatreset') as HTMLButtonElement;
  const dbgmodal = document.getElementById('dbgmodal') as HTMLElement;
  const dbgframe = document.getElementById('dbgframe') as HTMLIFrameElement;
  const dbgx = document.getElementById('dbgx') as HTMLButtonElement;

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
      await refresh();
    })();
  });

  // The 🐛 debugger is a CENTRAL MODAL iframing the ISOLATED /debug?embed page.
  // atui scopes its CSS with zero-specificity :where(.atui …) so a host can theme
  // it; the flip side is the dashboard's naked global classes (.card, .chart…)
  // would leak IN and break atui's layout. An iframe is a clean document boundary
  // — the consumer's job — so none of the dashboard's CSS can reach atui.
  function openDebugger(): void {
    dbgframe.src = '/debug?embed=1&t=' + Date.now();
    dbgmodal.hidden = false;
  }
  function closeDebugger(): void {
    dbgmodal.hidden = true;
    dbgframe.src = 'about:blank';
  }
  dbgx.addEventListener('click', closeDebugger);
  dbgmodal.addEventListener('click', (e) => {
    if (e.target === dbgmodal) closeDebugger();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dbgmodal.hidden) closeDebugger();
  });

  // ── time-travel wiring ────────────────────────────────────────────────────────
  let lastState: AnalystState | null = null;

  async function seekTo(commitId: string): Promise<void> {
    await post('/api/seek', { commitId });
    await refresh();
  }
  async function addCheckpoint(): Promise<void> {
    const label = ckptInput.value.trim() || `cp-${(lastState?.checkpoints.length ?? 0) + 1}`;
    ckptInput.value = '';
    await post('/api/checkpoint', { label });
    await refresh();
  }
  ckptBtn.addEventListener('click', () => void addCheckpoint());
  ckptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void addCheckpoint();
  });
  nowBtn.addEventListener('click', () => {
    if (lastState?.head) void seekTo(lastState.head);
  });

  // Drag the cursor along the timeline: on release, snap to the nearest commit
  // and seek there. A pure click (no drag) is handled by the dot's own listener.
  let dragStartX: number | null = null;
  let dragMoved = false;
  function nearestCommitId(clientX: number): string | null {
    const dots = Array.from(timelineTrack.querySelectorAll('[data-commit]')) as HTMLElement[];
    let best: string | null = null;
    let bestDist = Infinity;
    for (const d of dots) {
      const r = d.getBoundingClientRect();
      const dist = Math.abs(r.left + r.width / 2 - clientX);
      if (dist < bestDist) {
        bestDist = dist;
        best = d.dataset['commit'] ?? null;
      }
    }
    return best;
  }
  timelineTrack.addEventListener('pointerdown', (e) => {
    dragStartX = (e as PointerEvent).clientX;
    dragMoved = false;
  });
  timelineTrack.addEventListener('pointermove', (e) => {
    if (dragStartX !== null && Math.abs((e as PointerEvent).clientX - dragStartX) > 6) dragMoved = true;
  });
  window.addEventListener('pointerup', (e) => {
    if (dragStartX === null) return;
    const moved = dragMoved;
    const x = (e as PointerEvent).clientX;
    dragStartX = null;
    dragMoved = false;
    if (moved) {
      const id = nearestCommitId(x);
      if (id) void seekTo(id);
    }
  });

  // ── rendering ────────────────────────────────────────────────────────────────
  let prevIds = new Set<string>();

  function renderTimeline(state: AnalystState): void {
    const active = pathToRoot(state.records, state.head);
    const ckptAt = new Map(state.checkpoints.filter((c) => c.commitId).map((c) => [c.commitId!, c.label]));
    if (active.length === 0) {
      replaceChildren(timelineTrack, el('div', { class: 'tl-empty', text: 'no commits yet — brush, click a bar, or ask the analyst to start the timeline' }));
      return;
    }
    const dots = active.map((rec) => {
      const actor = rec.cause.requestedBy;
      const isCursor = rec.id === state.cursor;
      const intent = rec.cause.intent ? `: ${rec.cause.intent}` : '';
      const dot = el(
        'button',
        { class: `tl-dot${isCursor ? ' cursor' : ''}`, dataset: { actor, commit: rec.id }, title: `#${rec.id} ${commitLabel(rec)} (${actor})${intent}` },
        [
          ckptAt.has(rec.id) ? el('span', { class: 'tl-flag', text: '⚑', title: ckptAt.get(rec.id) }) : el('span', { class: 'tl-flag', text: ' ' }),
          el('span', { class: 'tl-node' }),
          el('span', { class: 'tl-cid', text: `#${rec.id}` }),
        ],
      );
      dot.addEventListener('click', () => void seekTo(rec.id));
      return dot;
    });
    replaceChildren(timelineTrack, ...dots);
  }

  function renderBranchMap(state: AnalystState): void {
    const records = state.records;
    if (records.length === 0) {
      replaceChildren(branchMapWrap, el('div', { class: 'bm-empty', text: 'the branch map sprouts a fork once you seek back and act (or the analyst does)' }));
      return;
    }
    const byId = new Map(records.map((r) => [r.id, r]));
    const childCount = new Map<string, number>();
    for (const r of records) if (r.parent) childCount.set(r.parent, (childCount.get(r.parent) ?? 0) + 1);
    const activeSet = new Set(pathToRoot(records, state.head).map((r) => r.id));
    // leaves; the ACTIVE branch's tip first (top lane), then by arrival order
    const leaves = records
      .filter((r) => !childCount.get(r.id))
      .sort((a, b) => (activeSet.has(b.id) ? 1 : 0) - (activeSet.has(a.id) ? 1 : 0) || records.indexOf(a) - records.indexOf(b));
    const lane = new Map<string, number>();
    let nextLane = 0;
    for (const leaf of leaves) {
      let laneForThis: number | null = null;
      for (const r of pathToRoot(records, leaf.id)) {
        if (lane.has(r.id)) continue;
        if (laneForThis === null) laneForThis = nextLane++;
        lane.set(r.id, laneForThis);
      }
    }
    const depthOf = (id: string): number => pathToRoot(records, id).length - 1;
    const DX = 56;
    const DY = 36;
    const PADX = 26;
    const PADY = 24;
    const R = 8;
    const maxDepth = Math.max(0, ...records.map((r) => depthOf(r.id)));
    const maxLane = Math.max(0, ...lane.values());
    const W = PADX * 2 + maxDepth * DX + 70;
    const H = PADY * 2 + maxLane * DY + 16;
    const xOf = (id: string): number => PADX + depthOf(id) * DX;
    const yOf = (id: string): number => PADY + (lane.get(id) ?? 0) * DY;
    const root = svgEl('svg', { class: 'branchmap', viewBox: `0 0 ${W} ${H}`, width: String(W), height: String(H) });
    // edges (parent → child); a lane change forks downward as a smooth curve
    for (const r of records) {
      const p = r.parent ? byId.get(r.parent) : undefined;
      if (!p) continue;
      root.appendChild(
        svgEl('path', {
          class: 'bm-edge',
          d: `M ${xOf(p.id)} ${yOf(p.id)} C ${xOf(p.id) + DX * 0.5} ${yOf(p.id)}, ${xOf(r.id) - DX * 0.5} ${yOf(r.id)}, ${xOf(r.id)} ${yOf(r.id)}`,
        }),
      );
    }
    // nodes
    const ckptAt = new Map(state.checkpoints.filter((c) => c.commitId).map((c) => [c.commitId!, c.label]));
    for (const r of records) {
      const isCursor = r.id === state.cursor;
      const isHead = r.id === state.head;
      const g = svgEl('g', { class: 'bm-node' });
      g.setAttribute('data-commit', r.id);
      g.appendChild(
        svgEl('circle', {
          class: `bm-dot ${r.cause.requestedBy}${isCursor ? ' cursor' : ''}${isHead ? ' head' : ''}`,
          cx: xOf(r.id),
          cy: yOf(r.id),
          r: isCursor ? R + 2 : R,
        }),
      );
      if (ckptAt.has(r.id)) {
        const flag = svgEl('text', { class: 'bm-flag', x: xOf(r.id), y: yOf(r.id) - R - 5, 'text-anchor': 'middle' });
        flag.textContent = '⚑';
        g.appendChild(flag);
      }
      const title = svgEl('title');
      title.textContent = `#${r.id} ${commitLabel(r)} (${r.cause.requestedBy})${r.cause.intent ? ': ' + r.cause.intent : ''}`;
      g.appendChild(title);
      g.addEventListener('click', () => void seekTo(r.id));
      root.appendChild(g);
    }
    replaceChildren(branchMapWrap, root);
  }

  function renderTwoTruths(state: AnalystState): void {
    const n = state.cursorTests;
    const m = state.fdr.tests;
    replaceChildren(
      twoTruths,
      el('div', { class: 'tt-line' }, [
        el('span', { class: 'tt-k', text: 'at cursor' }),
        el('span', { class: 'tt-v', text: `${n} test${n === 1 ? '' : 's'} visible on this branch` }),
      ]),
      el('div', { class: 'tt-line' }, [
        el('span', { class: 'tt-k', text: 'global' }),
        el('span', { class: 'tt-v', text: `W(t)=${state.fdr.wealth.toFixed(4)} wealth · ${m} test${m === 1 ? '' : 's'} across all branches` }),
      ]),
      el('div', { class: 'tt-honest', text: 'alpha spent on abandoned branches is never refunded' }),
    );
  }

  function updateTimeControls(state: AnalystState): void {
    if (state.viewingPast) {
      pastBanner.hidden = false;
      nowBtn.hidden = false;
      replaceChildren(pastBanner, el('span', { text: '⏱ Viewing the past — the cursor is behind the live head. Act now (brush, click a bar, or ask the analyst) to branch here.' }));
    } else {
      pastBanner.hidden = true;
      nowBtn.hidden = true;
    }
    const b = state.branches.length;
    branchCount.textContent = `${b} branch${b === 1 ? '' : 'es'} · cursor ${state.cursor ? '#' + state.cursor : '—'}`;
  }

  function renderCharts(state: AnalystState): void {
    const clauses = state.activeSelections.map((s) => ({ viewId: s.viewId, clause: clauseOf(s) })).filter((c) => c.clause !== null) as { viewId: string; clause: PredicateClause }[];
    const forClient = (self: string) => clauses.filter((c) => c.viewId !== self && knownFields.has(c.clause.field)).map((c) => c.clause);
    // bar counts under every clause EXCEPT the bar's own (crossfilter self-exclusion)
    const barClauses = forClient('bar');
    const counts = new Map<string, number>();
    for (const c of CATEGORIES) counts.set(c, 0);
    for (const r of rows) if (barClauses.every((cl) => matchesClause(r, cl))) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    bar.setCounts(counts);
    const barSel = state.activeSelections.find((s) => s.viewId === 'bar' && s.field === 'category');
    bar.highlight(barSel ? String(barSel.value) : null);
    // scatter dims points outside every clause EXCEPT its own
    const scatterClauses = forClient('scatter');
    scatter.setHighlight((r) => scatterClauses.every((cl) => matchesClause(r, cl)));
  }

  function renderHistory(state: AnalystState): void {
    const ids = new Set(state.records.map((r) => r.id));
    const activeSet = new Set(pathToRoot(state.records, state.head).map((r) => r.id));
    const chips = state.records.map((rec) => {
      const actor = rec.cause.requestedBy;
      const valText = rec.kind === 'interval' ? fmtInterval(rec.value as [number, number] | null) : String(rec.value);
      const onBranch = activeSet.has(rec.id);
      const isCursor = rec.id === state.cursor;
      const cls =
        `chip${prevIds.size > 0 && !prevIds.has(rec.id) ? ' fresh' : ''}` +
        `${onBranch ? '' : ' offbranch'}${isCursor ? ' cursor' : ''}`;
      const chip = el('div', { class: cls, title: rec.cause.intent ?? '', dataset: { chip: rec.id, actor } }, [
        el('span', { class: `badge ${actor}`, text: actor, dataset: { actor } }),
        el('span', { class: 'k', text: rec.kind }),
        el('span', { class: 'body', text: `${rec.field} = ${valText}` }),
        el('span', { class: 'cid', text: `#${rec.id}` }),
      ]);
      chip.addEventListener('click', () => void seekTo(rec.id));
      return chip;
    });
    replaceChildren(historyStrip, chips.length ? null : el('div', { class: 'empty', text: 'no commits yet — brush the scatter, click a bar, or ask the analyst' }), ...chips);
    prevIds = ids;
  }

  function renderLedger(fdr: Fdr): void {
    replaceChildren(ledgerHead, el('span', { text: `${fdr.procedure}  ·  α=${fdr.alpha}  ·  tests=${fdr.tests}  ·  W(t)=${fdr.wealth.toFixed(4)}  ·  discoveries=${fdr.discoveries}` }));
    replaceChildren(
      ledgerBody,
      ...fdr.ledger.map((s) =>
        el('tr', { class: s.reject ? 'discovery' : '' }, [
          el('td', { text: String(s.step) }),
          el('td', { text: s.hypothesisId }),
          el('td', { text: s.pValue.toFixed(4) }),
          el('td', { text: s.alphaThreshold.toFixed(5) }),
          el('td', { class: 'verdict', text: s.reject ? 'DISCOVERY' : 'no' }),
        ]),
      ),
    );
    const last = fdr.ledger[fdr.ledger.length - 1];
    if (last) {
      let msg: string;
      if (last.reject) msg = `Test #${last.step}: p=${last.pValue.toFixed(4)} — DISCOVERY (p ≤ threshold ${last.alphaThreshold.toFixed(5)}).`;
      else if (last.pValue <= fdr.alpha) msg = `Test #${last.step}: p=${last.pValue.toFixed(4)} — significant alone, NOT a discovery at your current test count (threshold ${last.alphaThreshold.toFixed(5)}).`;
      else msg = `Test #${last.step}: p=${last.pValue.toFixed(4)} — not significant (threshold ${last.alphaThreshold.toFixed(5)}).`;
      replaceChildren(headline, el('span', { text: msg }));
    }
  }

  function renderAnalyses(state: AnalystState): void {
    replaceChildren(
      analysesList,
      ...state.analyses.map((a) =>
        el('div', { class: 'analysis-row' }, [
          el('span', { class: 'id', text: a.id }),
          el('span', { class: 'muted', text: `${a.kind}/${a.produces}` }),
          a.ready
            ? el('span', { class: 'ready', text: 'ready' })
            : el('span', { class: 'blocked', text: `blocked: ${a.blockedBy ?? ''}${a.missingColumns?.length ? ` (${a.missingColumns.join(',')})` : ''}` }),
        ]),
      ),
    );
  }

  function renderGaps(state: AnalystState): void {
    replaceChildren(
      gapsPanel,
      el('div', { class: 'section-head', text: `Gaps — unmet requests (${state.gaps.length})` }),
      ...(state.gaps.length === 0
        ? [el('div', { class: 'muted', text: 'no gaps filed — every request has been served' })]
        : state.gaps.map((g) =>
            el('div', { class: 'gap-row', dataset: { gap: g.code } }, [
              el('span', { class: 'gap-code', text: g.code }),
              el('span', { class: 'gap-op', text: g.op }),
              el('span', { class: 'gap-detail', text: g.detail }),
            ]),
          )),
    );
  }

  function renderActivity(state: AnalystState): void {
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

  function render(state: AnalystState): void {
    lastState = state;
    const past = state.viewingPast ? '  ·  ⏱ viewing the past (cursor behind head)' : '';
    selReadout.textContent = `current selection: ${state.selectedCount} of ${state.totalRows} rows  ·  provider: ${state.mode === 'mock' ? 'scripted mock' : 'live Claude'}${past}`;
    renderTimeline(state);
    renderBranchMap(state);
    renderTwoTruths(state);
    updateTimeControls(state);
    renderCharts(state);
    renderHistory(state);
    renderLedger(state.fdr);
    renderAnalyses(state);
    renderGaps(state);
    renderActivity(state);
  }

  async function refresh(): Promise<void> {
    const state = await getState();
    if (state) render(state);
  }

  // ── chat send ────────────────────────────────────────────────────────────────
  async function sendMessage(text: string): Promise<void> {
    const message = text.trim();
    if (!message || sendBtn.disabled) return;
    input.value = '';
    sendBtn.disabled = true;
    input.disabled = true;
    transcript.appendChild(el('div', { class: 'bubble you', text: message }));
    transcript.scrollTop = transcript.scrollHeight;
    working.textContent = 'analyst is thinking…';
    // Faster polling during the turn so the agent's commits + activity land live.
    const live = window.setInterval(() => void refresh(), 400);
    try {
      const reply = (await post('/api/chat', { message })) as { text?: string; error?: string } | null;
      const answer = reply?.text ?? reply?.error ?? 'The analyst did not reply.';
      transcript.appendChild(el('div', { class: 'bubble analyst', text: answer }));
      // Offer the 🐛 debugger for THIS turn — opens the central modal iframing
      // the isolated /debug?embed page, which replays the reasoning via atui.
      const dbg = el('button', { class: 'dbgbtn', text: '🐛 See the thinking' }) as HTMLButtonElement;
      dbg.addEventListener('click', openDebugger);
      transcript.appendChild(dbg);
    } finally {
      window.clearInterval(live);
      sendBtn.disabled = false;
      input.disabled = false;
      working.textContent = '';
      transcript.scrollTop = transcript.scrollHeight;
      await refresh();
      input.focus();
    }
  }

  sendBtn.addEventListener('click', () => void sendMessage(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void sendMessage(input.value);
  });

  // ── boot ─────────────────────────────────────────────────────────────────────
  await refresh();
  window.setInterval(() => void refresh(), 900);
  (window as unknown as { __vizAgent?: unknown }).__vizAgent = { refresh, state: getState };
}

void main();
