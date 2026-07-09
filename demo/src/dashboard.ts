/**
 * URL 1 — /dashboard: the coordination + provenance story.
 *
 * Two hand-rolled SVG charts (scatter + bar) linked through a REAL
 * @uwdata/mosaic-core `Selection.crossfilter()`, now driven through the L5
 * agent surface (`buildDashboard(def).createSession()`, `src/agent`) rather
 * than a hand-rolled `CauseSelectionSession`:
 *   - Every COMMIT-WORTHY gesture (a scatter brush release, a bar click, the
 *     agent's probe) rides `session.dispatch(...)` — R4's single semantic
 *     entry point. The scatter's live drag PREVIEW deliberately stays a
 *     transient `session.log.selection.update(...)` push (no log entry) —
 *     `dispatch` always lands a commit, and turning every pointermove into a
 *     log row would flood the history strip and violate the demo's own
 *     "commit-on-intent" story. `session.log` is itself part of the L5
 *     session (InteractionSession wires L1's CauseSelectionSession, not a
 *     replacement for it), so this is still "driven by buildDashboard +
 *     session," just at the sub-layer L5 exposes for exactly this composition.
 *   - src/mosaic  — charts emit inert `{rawValue, encoding}`; only
 *     `causeClauseFromEmission` turns an emission + cause + registered source
 *     into a real cross-filter clause (self-exclusion visible: brushing the
 *     scatter filters the bar but NOT itself — via the Selection's own skip()).
 *   - src/data    — predicate evaluation (matchesClause) over the in-memory
 *     rows for the chart highlight/self-exclusion story (L5's own
 *     `selectedRows()` has no self-exclusion variant, so this reads the
 *     underlying `session.log.selection` directly — see the file-level note
 *     above).
 *
 * "Simulate agent brush" now drives the REAL Mode-B tool surface
 * (`vizAsTools(session, {as:'agent'}).call('viz.dispatch', {...})`) instead of
 * a hand-rolled commit — the agent badge chip is produced by `viz.dispatch`
 * itself, the same tool an LLM agent would call.
 *
 * "Replay" and "Fork here" stay log-level operations against `session.log`
 * (H4/R8 are L1 mechanics, not L5 dispatch verbs — `dispatch`'s own `fork`
 * verb only moves the head pointer for the NEXT commit, it doesn't atomically
 * branch a sibling of an already-landed one the way this one-click UI wants).
 * Replay rebuilds a FRESH log purely to prove the replay story (chip sequence
 * + `replayed` markers); it does not replace the live session `dispatch`
 * keeps writing to — the next gesture always continues the real, canonical
 * log, dropping the replay overlay.
 */

import {
  BarChart,
  CATEGORIES,
  Scatter,
  actionButton,
  el,
  fmtInterval,
  loadRows,
  replaceChildren,
  specFromRecord,
  type DemoRow,
} from './common.js';
import { replayLog, serializeLog, type CommitRecord } from '../../src/log/index.js';
import { causeClauseFromEmission, type ActorMeta, type RegisteredSource } from '../../src/mosaic/index.js';
import type { Cause } from '../../src/cause/index.js';
import { matchesClause } from '../../src/data/predicate.js';
import type { PredicateClause } from '../../src/data/types.js';
import { buildDashboard, vizAsTools } from '../../src/agent/index.js';
import type { DashboardDef } from '../../src/agent/index.js';

const SCATTER: ActorMeta = { actor: 'user', label: 'Price brush' };
const BAR: ActorMeta = { actor: 'user', label: 'Category' };
const AGENT: ActorMeta = { actor: 'agent', label: 'Agent' };

export async function mountDashboard(root: HTMLElement): Promise<void> {
  const rows = await loadRows();

  // ── L5: declare -> connect -> serve ───────────────────────────────────────
  const def: DashboardDef = {
    meta: { title: 'vizfootprint dashboard demo' },
    data: { data: { rows } },
    actors: { scatter: SCATTER, bar: BAR, agent: AGENT },
    defaultTable: 'data',
  };
  const dashboard = buildDashboard(def); // declare (offline, no API key)
  const session = dashboard.createSession(); // connect (one live session)
  const agentPort = vizAsTools(session, { as: 'agent' }); // serve (fixed Mode B tools)

  // ── live rendering state (crossfilter self-exclusion; see file header) ────
  /** Authoritative per-source predicate, keyed by the LIVE source object. */
  const specBySource = new Map<object, PredicateClause>();
  let selected: string | null = null; // the chip chosen for "Fork here"
  /** A one-shot proof overlay: set by "Replay", cleared by the next real commit. */
  let replayedRecords: readonly CommitRecord[] | null = null;
  let forkSeq = 0;

  const src = (viewId: string, meta: ActorMeta) => session.log.registry.register(viewId, meta);

  /** Build the predicate closure a given client sees (REAL crossfilter self-exclusion). */
  function predicateFor(client: RegisteredSource): (row: DemoRow) => boolean {
    const specs = session.log.selection.clauses
      .filter((clause) => !session.log.selection.skip(client, clause)) // Mosaic's own skip()
      .map((clause) => specBySource.get(clause.source as object))
      .filter((s): s is PredicateClause => s !== undefined);
    return (row) => specs.every((s) => matchesClause(row, s));
  }

  function currentCategory(): string | null {
    const spec = specBySource.get(src('bar', BAR));
    return spec && spec.kind === 'point' ? String(spec.value) : null;
  }

  // ── charts ─────────────────────────────────────────────────────────────────
  const scatter = new Scatter(rows, {
    brushField: 'price',
    onBrushMove: (iv) => applyTransient('scatter', SCATTER, iv),
    onBrushCommit: (iv) => {
      if (iv === null) return; // a click, not a brush intent — no log entry
      void commitDispatch({
        verb: 'filter',
        viewId: 'scatter',
        field: 'price',
        range: iv,
        cause: causeUser(`brush price ${fmtInterval(iv)}`),
      });
    },
  });
  const bar = new BarChart(CATEGORIES, {
    onBarClick: (cat) =>
      void commitDispatch({
        verb: 'select',
        viewId: 'bar',
        field: 'category',
        value: cat,
        cause: causeUser(`select category ${cat}`),
      }),
  });

  // ── clause plumbing ──────────────────────────────────────────────────────────
  function causeUser(intent: string): Cause {
    return { requestedBy: 'user', computedBy: 'user', intent };
  }

  /** Push a TRANSIENT clause (lives on the Selection, never logged). */
  function applyTransient(viewId: string, meta: ActorMeta, iv: [number, number] | null): void {
    const source = src(viewId, meta);
    const clause = causeClauseFromEmission(Scatter.brushEmission('price', iv), {
      source,
      cause: causeUser('transient brush'),
    });
    session.log.selection.update(clause);
    if (iv === null) specBySource.delete(source);
    else specBySource.set(source, { kind: 'interval', field: 'price', value: iv });
    render();
  }

  /** Land ONE cause-tagged commit through `session.dispatch` (R4) and re-render. */
  async function commitDispatch(action: Parameters<typeof session.dispatch>[0]): Promise<void> {
    const result = await session.dispatch(action);
    replayedRecords = null; // a real commit invalidates any replay proof overlay
    if (result.ok) applyRecord(result.commit);
    else render(); // a rejection still deserves a re-render (no-op here, but honest)
  }

  /** `record.viewId` is already registered by the dispatch that produced it. */
  function applyRecord(record: CommitRecord | undefined): void {
    if (!record) return;
    const source = session.log.registry.require(record.viewId);
    const spec = specFromRecord(record);
    if (spec === null) specBySource.delete(source);
    else specBySource.set(source, spec);
    render();
  }

  // ── render ───────────────────────────────────────────────────────────────────
  const historyStrip = el('div', { class: 'history' });

  function render(): void {
    const keepBar = predicateFor(src('bar', BAR));
    const counts = new Map<string, number>();
    for (const c of CATEGORIES) counts.set(c, 0);
    for (const r of rows) if (keepBar(r)) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    bar.setCounts(counts);
    bar.highlight(currentCategory());

    const keepScatter = predicateFor(src('scatter', SCATTER));
    scatter.setHighlight(keepScatter);

    renderHistory();
  }

  function buildChip(rec: CommitRecord, childCount: Map<string, number>): Node {
    const isFork = rec.parent !== null && (childCount.get(rec.parent) ?? 0) > 1;
    const actor = rec.cause.requestedBy;
    const badge = el('span', { class: `badge ${actor}`, text: actor, dataset: { actor } });
    const kind = el('span', { class: 'k', text: rec.kind });
    const valText = rec.kind === 'interval' ? fmtInterval(rec.value as [number, number] | null) : String(rec.value);
    const body = el('span', { class: 'body', text: `${rec.field} = ${valText}` });
    const idTag = el('span', { class: 'cid', text: `#${rec.id}` });
    const kids: (Node | null)[] = [badge, kind, body, idTag];
    if (rec.cause.replayed) kids.push(el('span', { class: 'replay', text: '↺ replay', dataset: { replayed: '1' } }));
    if (isFork) kids.push(el('span', { class: 'fork', text: '⑂ fork' }));
    const chip = el('div', { class: 'chip', title: rec.cause.intent ?? '', dataset: { chip: rec.id } }, kids);
    if (rec.id === selected) chip.classList.add('sel');
    chip.addEventListener('click', () => {
      selected = rec.id;
      renderChips(replayedRecords ?? session.log.records);
    });
    return chip;
  }

  function renderChips(list: readonly CommitRecord[]): void {
    const childCount = new Map<string, number>();
    for (const r of list) if (r.parent) childCount.set(r.parent, (childCount.get(r.parent) ?? 0) + 1);
    const chips = list.map((rec) => buildChip(rec, childCount));
    replaceChildren(
      historyStrip,
      chips.length ? null : el('div', { class: 'empty', text: 'no commits yet — brush the scatter or click a bar' }),
      ...chips,
    );
  }

  function renderHistory(): void {
    renderChips(replayedRecords ?? session.log.records);
  }

  // ── toolbar actions ──────────────────────────────────────────────────────────
  async function simulateAgentBrush(): Promise<void> {
    // A deterministic-ish agent band (mid-range prices), through the REAL
    // Mode-B tool surface — `viz.dispatch`, the same tool an LLM agent calls.
    const lo = 90 + (session.log.records.length % 3) * 12;
    const iv: [number, number] = [lo, lo + 45];
    const res = await agentPort.call('viz.dispatch', {
      verb: 'filter',
      viewId: 'agent',
      field: 'price',
      range: iv,
      intent: `agent explores price ${fmtInterval(iv)}`,
    });
    replayedRecords = null;
    const commit = (res as { commit?: CommitRecord }).commit;
    applyRecord(commit);
  }

  function forkHere(): void {
    if (selected === null) return;
    const rec = session.log.records.find((r) => r.id === selected);
    if (!rec) return;
    // Append a SIBLING of `rec` (same parent) — an immediate branch off the
    // selected commit, so the fork is visible without a follow-up gesture.
    // `session.dispatch`'s own `fork` verb only moves the head pointer for
    // the NEXT commit (R8's two-step form); this one-click UI wants an
    // atomic sibling-append, so it stays a direct `session.log.commit` (an
    // L1 mechanic, same as before — just called on the L5 session's `log`).
    const { record } = session.log.commit({
      id: `fork${++forkSeq}`,
      parent: rec.parent, // same parent → rec.parent now has 2 children
      viewId: rec.viewId,
      actorMeta: rec.actorMeta,
      kind: rec.kind,
      field: rec.field,
      value: rec.value,
      cause: { requestedBy: 'user', computedBy: 'user', intent: `fork from #${rec.id}` },
    });
    replayedRecords = null;
    applyRecord(record);
  }

  function replaySession(): void {
    if (session.log.records.length === 0) return;
    const json = serializeLog(session.log.records);
    const replayed = replayLog(json); // H4: rebuild into a FRESH selection + registry (proof-only)
    replayedRecords = replayed.records;
    selected = null;
    animateReplay();
  }

  function animateReplay(): void {
    const list = replayedRecords ?? [];
    const total = list.length;
    replaceChildren(historyStrip);
    let i = 0;
    const step = (): void => {
      i += 1;
      renderChips(list.slice(0, i));
      if (i < total) window.setTimeout(step, 90);
    };
    if (total) step();
  }

  // ── layout (static chrome; all DATA text via textContent above) ──────────────
  const toolbar = el('div', { class: 'toolbar' }, [
    actionButton('replay', 'Replay session', replaySession),
    actionButton('fork', 'Fork here', forkHere),
    actionButton('agent', 'Simulate agent brush', () => void simulateAgentBrush()),
    actionButton('reset', 'Reset view', () => {
      // Transient clear of every active source (a view reset — not a logged intent).
      for (const clause of [...session.log.selection.clauses]) {
        const source = clause.source as unknown as RegisteredSource;
        session.log.selection.update(
          causeClauseFromEmission({ rawValue: null, encoding: { kind: 'interval', field: 'price' } }, {
            source,
            cause: causeUser('reset'),
          }),
        );
      }
      specBySource.clear();
      render();
    }),
  ]);

  const charts = el('div', { class: 'charts' }, [
    wrapChart('Scatter — price × rating (brush the x-axis)', scatter.root),
    wrapChart('Bar — count by category (click to select)', bar.root),
  ]);

  replaceChildren(
    root,
    toolbar,
    charts,
    el('div', { class: 'strip-head', text: 'Commit log (live) — each gesture is one cause-tagged record' }),
    historyStrip,
  );

  render();

  // Expose a tiny hook for the headless smoke test (agent button parity check).
  (window as unknown as { __viz?: unknown }).__viz = {
    records: () => session.log.records,
    simulateAgentBrush,
    replaySession,
  };
}

function wrapChart(caption: string, node: SVGElement): HTMLElement {
  return el('figure', { class: 'chartbox' }, [node, el('figcaption', { text: caption })]);
}

void mountDashboard(document.getElementById('app') as HTMLElement);
