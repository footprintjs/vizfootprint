/**
 * URL 1 — /dashboard: the coordination + provenance story.
 *
 * Two hand-rolled SVG charts (scatter + bar) linked through a REAL
 * @uwdata/mosaic-core `Selection.crossfilter()`, driven entirely by the landed
 * layers:
 *   - src/mosaic  — charts emit inert `{rawValue, encoding}`; only
 *     `causeClauseFromEmission` turns an emission + cause + registered source
 *     into a real cross-filter clause (self-exclusion visible: brushing the
 *     scatter filters the bar but NOT itself — via the Selection's own skip()).
 *   - src/log     — every gesture commits ONE cause-tagged CommitRecord into a
 *     CauseSelectionSession (commit-on-intent: transients live during the drag,
 *     the log records one entry on mouseup). Replay rebuilds a FRESH selection
 *     from the serialized log; "Fork here" branches an append-only timeline.
 *   - src/data    — predicate evaluation (matchesClause) over the in-memory
 *     rows; the Selection owns coordination, the memory engine owns matching.
 *
 * No LLM: "Simulate agent brush" dispatches a programmatic commit tagged
 * requestedBy:'agent' — the second principal in the two-principal log.
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
} from './common.js';
import {
  CauseSelectionSession,
  replayLog,
  serializeLog,
  type CommitRecord,
} from '../../src/log/index.js';
import { causeClauseFromEmission, type ActorMeta, type RegisteredSource } from '../../src/mosaic/index.js';
import type { Cause } from '../../src/cause/index.js';
import { matchesClause } from '../../src/data/predicate.js';
import type { PredicateClause } from '../../src/data/types.js';

const SCATTER: ActorMeta = { actor: 'user', label: 'Price brush' };
const BAR: ActorMeta = { actor: 'user', label: 'Category' };
const AGENT: ActorMeta = { actor: 'agent', label: 'Agent' };

export async function mountDashboard(root: HTMLElement): Promise<void> {
  const rows = await loadRows();

  // ── live state ─────────────────────────────────────────────────────────────
  let session = new CauseSelectionSession(); // real crossfilter Selection + registry
  /** Authoritative per-source predicate, keyed by the LIVE source object. */
  let specBySource = new Map<object, PredicateClause>();
  let head: string | null = null; // parent pointer for the next commit
  let selected: string | null = null; // the chip chosen for "Fork here"
  let seq = 0;

  const nextId = (): string => `c${++seq}`;
  const src = (viewId: string, meta: ActorMeta) => session.registry.register(viewId, meta);

  /** Build the predicate closure a given client sees (REAL crossfilter self-exclusion). */
  function predicateFor(client: RegisteredSource): (row: DemoRow) => boolean {
    const specs = session.selection.clauses
      .filter((clause) => !session.selection.skip(client, clause)) // Mosaic's own skip()
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
      commit('scatter', SCATTER, { kind: 'interval', field: 'price', value: iv }, causeUser(`brush price ${fmtInterval(iv)}`));
    },
  });
  const bar = new BarChart(CATEGORIES, {
    onBarClick: (cat) =>
      commit('bar', BAR, { kind: 'point', field: 'category', value: cat }, causeUser(`select category ${cat}`)),
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
    session.selection.update(clause);
    if (iv === null) specBySource.delete(source);
    else specBySource.set(source, { kind: 'interval', field: 'price', value: iv });
    render();
  }

  /** Commit ONE cause-tagged record (commit-on-intent) and re-render. */
  function commit(viewId: string, meta: ActorMeta, spec: PredicateClause, cause: Cause): void {
    const { record } = session.commit({
      id: nextId(),
      parent: head,
      viewId,
      actorMeta: meta,
      kind: spec.kind === 'interval' ? 'interval' : 'point',
      field: spec.field,
      value: 'value' in spec ? spec.value : null,
      cause,
    });
    specBySource.set(src(viewId, meta), spec);
    head = record.id;
    render();
  }

  // ── rebuild derived state (used after a replay swaps the session) ────────────
  function specFromRecord(rec: CommitRecord): PredicateClause | null {
    if (rec.kind === 'interval') {
      const v = rec.value as [number, number] | null;
      return v === null ? null : { kind: 'interval', field: rec.field, value: v };
    }
    return { kind: 'point', field: rec.field, value: rec.value };
  }
  function rebuildSpecs(sess: CauseSelectionSession): void {
    specBySource = new Map();
    for (const rec of sess.records) {
      const source = sess.registry.require(rec.viewId);
      const spec = specFromRecord(rec);
      if (spec === null) specBySource.delete(source);
      else specBySource.set(source, spec); // last-write-wins per source (crossfilter)
    }
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

  function renderHistory(): void {
    const childCount = new Map<string, number>();
    for (const r of session.records) if (r.parent) childCount.set(r.parent, (childCount.get(r.parent) ?? 0) + 1);

    const chips: Node[] = session.records.map((rec) => {
      const isFork = rec.parent !== null && (childCount.get(rec.parent) ?? 0) > 1;
      const actor = rec.cause.requestedBy;
      const badge = el('span', { class: `badge ${actor}`, text: actor, dataset: { actor } });
      const kind = el('span', { class: 'k', text: rec.kind });
      const valText =
        rec.kind === 'interval'
          ? fmtInterval(rec.value as [number, number] | null)
          : String(rec.value);
      const body = el('span', { class: 'body', text: `${rec.field} = ${valText}` });
      const idTag = el('span', { class: 'cid', text: `#${rec.id}` });
      const kids: (Node | null)[] = [badge, kind, body, idTag];
      if (rec.cause.replayed) kids.push(el('span', { class: 'replay', text: '↺ replay', dataset: { replayed: '1' } }));
      if (isFork) kids.push(el('span', { class: 'fork', text: '⑂ fork' }));
      const chip = el('div', { class: 'chip', title: rec.cause.intent ?? '', dataset: { chip: rec.id } }, kids);
      if (rec.id === selected) chip.classList.add('sel');
      chip.addEventListener('click', () => {
        selected = rec.id;
        renderHistory();
      });
      return chip;
    });
    replaceChildren(
      historyStrip,
      chips.length ? null : el('div', { class: 'empty', text: 'no commits yet — brush the scatter or click a bar' }),
      ...chips,
    );
  }

  // ── toolbar actions ──────────────────────────────────────────────────────────
  function simulateAgentBrush(): void {
    // A deterministic-ish agent band (mid-range prices), tagged as the agent.
    const lo = 90 + (session.records.length % 3) * 12;
    const iv: [number, number] = [lo, lo + 45];
    commit('agent', AGENT, { kind: 'interval', field: 'price', value: iv }, {
      requestedBy: 'agent',
      computedBy: 'agent',
      intent: `agent explores price ${fmtInterval(iv)}`,
    });
  }

  function forkHere(): void {
    if (selected === null) return;
    const rec = session.records.find((r) => r.id === selected);
    if (!rec) return;
    // Append a SIBLING of `rec` (same parent) — an immediate branch off the
    // selected commit, so the fork is visible without a follow-up gesture.
    session.commit({
      id: nextId(),
      parent: rec.parent, // same parent → rec.parent now has 2 children
      viewId: rec.viewId,
      actorMeta: rec.actorMeta,
      kind: rec.kind,
      field: rec.field,
      value: rec.value,
      cause: { requestedBy: 'user', computedBy: 'user', intent: `fork from #${rec.id}` },
    });
    head = `c${seq}`;
    render();
  }

  function replaySession(): void {
    if (session.records.length === 0) return;
    const json = serializeLog(session.records);
    const replayed = replayLog(json); // H4: rebuild into a FRESH selection + registry
    session = replayed;
    rebuildSpecs(session);
    head = session.records.length ? (session.records[session.records.length - 1]?.id ?? null) : null;
    selected = null;
    seq = Math.max(seq, session.records.length);
    render();
    // Animate the chips back in (charts already reflect the final replayed state).
    animateReplay();
  }

  function animateReplay(): void {
    const total = session.records.length;
    replaceChildren(historyStrip);
    let i = 0;
    const step = (): void => {
      i += 1;
      renderReplayProgress(i);
      if (i < total) window.setTimeout(step, 90);
    };
    if (total) step();
  }
  function renderReplayProgress(upTo: number): void {
    const slice = session.records.slice(0, upTo);
    const chips = slice.map((rec) => {
      const actor = rec.cause.requestedBy;
      const kids: (Node | null)[] = [
        el('span', { class: `badge ${actor}`, text: actor, dataset: { actor } }),
        el('span', { class: 'k', text: rec.kind }),
        el('span', {
          class: 'body',
          text: `${rec.field} = ${rec.kind === 'interval' ? fmtInterval(rec.value as [number, number] | null) : String(rec.value)}`,
        }),
        el('span', { class: 'cid', text: `#${rec.id}` }),
        rec.cause.replayed ? el('span', { class: 'replay', text: '↺ replay', dataset: { replayed: '1' } }) : null,
      ];
      return el('div', { class: 'chip replayed', dataset: { chip: rec.id } }, kids);
    });
    replaceChildren(historyStrip, ...chips);
  }

  // ── layout (static chrome; all DATA text via textContent above) ──────────────
  const toolbar = el('div', { class: 'toolbar' }, [
    actionButton('replay', 'Replay session', replaySession),
    actionButton('fork', 'Fork here', forkHere),
    actionButton('agent', 'Simulate agent brush', simulateAgentBrush),
    actionButton('reset', 'Reset view', () => {
      // Transient clear of every active source (a view reset — not a logged intent).
      for (const clause of [...session.selection.clauses]) {
        const source = clause.source as unknown as RegisteredSource;
        session.selection.update(
          causeClauseFromEmission({ rawValue: null, encoding: { kind: 'interval', field: 'price' } }, {
            source,
            cause: causeUser('reset'),
          }),
        );
      }
      specBySource = new Map();
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
    records: () => session.records,
    simulateAgentBrush,
    replaySession,
  };
}

function actionButton(id: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { class: 'btn', text: label, dataset: { action: id } });
  b.addEventListener('click', onClick);
  return b;
}
function wrapChart(caption: string, node: SVGElement): HTMLElement {
  return el('figure', { class: 'chartbox' }, [node, el('figcaption', { text: caption })]);
}

void mountDashboard(document.getElementById('app') as HTMLElement);
