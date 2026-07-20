/**
 * BR-1 — the state fold + `foldDiff`, computed from the log ALONE.
 *
 * The key-space codifies the session's synthetic-viewId wire convention
 * (the same bytes `src/session/session.ts` lands — the session imports THESE
 * constants so the two layers cannot drift):
 *   - a real view probe        → key `selection:${viewId}`          (last-wins per view)
 *   - `encoding:${viewId}`     → key `encoding:${viewId}:${channel}` (field = channel, value = bound field)
 *   - `analysis:${analysisId}` → key `analysis:${analysisId}`        (last declared run)
 *   - `annotation:${actor}`    → INERT (a note is never state)
 *   - `chart:${chartId}`       → INERT (an agent-authored chart registration
 *                                and its ledgered hypothesis are not crossfilter
 *                                state — RP-3; the chart renders as its own view)
 *   - `layout:${scope}`        → INERT here (a cockpit arrangement is VIEW-state,
 *                                never a data claim — LY-1; the session's OWN fold
 *                                carries it so seek/switchPath restore it)
 * A cleared interval (`kind:'interval', value:null`) — or a cleared CELL
 * (`kind:'cell', value:null`, D29) — DELETES the selection key, exactly as
 * the session's live fold does.
 *
 * `foldDiff` deliberately reports NO row counts — that needs an engine; the
 * session layer enriches per-side row counts on top (`compare()`).
 */

import type { CommitRecord } from '../log/index.js';
import type { DiffChange, DiffOnly, FoldDiffResult, FoldEntry, FoldState } from './types.js';
import { chainToRoot, indexById, lcaOf } from './walk.js';

/** The synthetic-viewId prefixes of the log wire (single source; the session imports these). */
export const ENCODING_VIEW_PREFIX = 'encoding:';
export const ANALYSIS_VIEW_PREFIX = 'analysis:';
export const ANNOTATION_VIEW_PREFIX = 'annotation:';
/** RP-3: an agent-proposed chart's registration + ledgered-hypothesis commits. */
export const CHART_VIEW_PREFIX = 'chart:';
/**
 * LY-1: a cockpit-layout note (`navigate` verb, `layout:${scope}` synthetic
 * identity — e.g. `layout:dashboard`). Recorded and fold-carried by the
 * SESSION (seek/switchPath restore the arrangement), but INERT here: layout is
 * VIEW-state, not a data claim (the same honesty ruling as pan/zoom), so it
 * must never enter crossfilter row counts, foldDiff, or conflict detection.
 */
export const LAYOUT_VIEW_PREFIX = 'layout:';

/** The state key a commit touches, or null for an inert (annotation / chart / layout) commit. */
export function keyOf(record: CommitRecord): string | null {
  if (record.viewId.startsWith(ANNOTATION_VIEW_PREFIX)) return null;
  // RP-3: a chart proposal (its spec-registration + p=1 hypothesis commits) is
  // NOT crossfilter state — it is inert in the fold, exactly like an annotation.
  // The chart renders as its own view; its ledger row lives in the FDR ledger.
  if (record.viewId.startsWith(CHART_VIEW_PREFIX)) return null;
  // LY-1: a layout note is view-state, never data state (see LAYOUT_VIEW_PREFIX).
  if (record.viewId.startsWith(LAYOUT_VIEW_PREFIX)) return null;
  if (record.viewId.startsWith(ENCODING_VIEW_PREFIX)) {
    return `encoding:${record.viewId.slice(ENCODING_VIEW_PREFIX.length)}:${record.field}`;
  }
  if (record.viewId.startsWith(ANALYSIS_VIEW_PREFIX)) {
    return `analysis:${record.viewId.slice(ANALYSIS_VIEW_PREFIX.length)}`;
  }
  return `selection:${record.viewId}`;
}

/**
 * The folded state at `tipId`: the pure last-wins fold of the root→tip path.
 * `null` (or an id the records don't contain) folds the empty path — validate
 * ids upstream where absence must be an honest miss (`foldDiff` does).
 */
export function foldStateAt(records: readonly CommitRecord[], tipId: string | null): FoldState {
  const byId = indexById(records);
  const path = chainToRoot(byId, tipId).reverse(); // root→tip
  const state = new Map<string, FoldEntry>();
  for (const rec of path) {
    const key = keyOf(rec);
    if (key === null) continue; // annotations are inert — never state
    if (rec.viewId.startsWith(ENCODING_VIEW_PREFIX)) {
      state.set(key, {
        kind: 'encoding',
        viewId: rec.viewId.slice(ENCODING_VIEW_PREFIX.length),
        channel: rec.field,
        field: String(rec.value),
        commitId: rec.id,
      });
    } else if (rec.viewId.startsWith(ANALYSIS_VIEW_PREFIX)) {
      state.set(key, {
        kind: 'analysis',
        analysisId: rec.viewId.slice(ANALYSIS_VIEW_PREFIX.length),
        field: rec.field,
        value: rec.value,
        commitId: rec.id,
      });
    } else if ((rec.kind === 'interval' || rec.kind === 'cell') && rec.value === null) {
      state.delete(key); // a cleared interval OR cleared cell drops the view's selection (D29: same rule)
    } else {
      state.set(key, {
        kind: 'selection',
        viewId: rec.viewId,
        clause: {
          kind: rec.kind,
          field: rec.field,
          value: rec.value,
          // D29: a cell record's authoritative field pair rides the fold too
          // (the log's commit() guarantees it on every cell record).
          ...(rec.fields !== undefined ? { fields: rec.fields } : {}),
        },
        commitId: rec.id,
      });
    }
  }
  return state;
}

/** JSON-encode a commit value for comparison (`undefined` gets its own tag — it is a distinct Mosaic clause state). */
function enc(v: unknown): string {
  return v === undefined ? 'undefined' : JSON.stringify(v);
}

/** A VALUE fingerprint (excludes `commitId`: identical state via different commits is NOT a change). */
function fingerprint(e: FoldEntry): string {
  switch (e.kind) {
    case 'selection':
      // The `fields` segment keeps a cell honest even against a real column
      // whose NAME happens to equal the joint label; `null` for plain kinds.
      return `selection|${e.viewId}|${e.clause.kind}|${e.clause.field}|${enc(e.clause.fields ?? null)}|${enc(e.clause.value)}`;
    case 'encoding':
      return `encoding|${e.viewId}|${e.channel}|${e.field}`;
    case 'analysis':
      return `analysis|${e.analysisId}|${e.field}|${enc(e.value)}`;
  }
}

/**
 * The structured state diff between two tips: `{ancestor, changed, onlyA,
 * onlyB}` — deterministic (entries sorted by key), missing-id honest.
 */
export function foldDiff(records: readonly CommitRecord[], tipA: string, tipB: string): FoldDiffResult {
  const byId = indexById(records);
  const missing = [tipA, tipB].filter((id) => !byId.has(id));
  if (missing.length > 0) return { ok: false, reason: 'unknown-commit', missing };

  const a = foldStateAt(records, tipA);
  const b = foldStateAt(records, tipB);
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();

  const changed: DiffChange[] = [];
  const onlyA: DiffOnly[] = [];
  const onlyB: DiffOnly[] = [];
  for (const key of keys) {
    const ea = a.get(key);
    const eb = b.get(key);
    if (ea !== undefined && eb !== undefined) {
      if (fingerprint(ea) !== fingerprint(eb)) changed.push({ key, a: ea, b: eb });
    } else if (ea !== undefined) {
      onlyA.push({ key, value: ea });
    } else {
      // `key` came from the union of both key sets, so absent-from-A means present-in-B.
      onlyB.push({ key, value: eb as FoldEntry });
    }
  }
  return { ok: true, ancestor: lcaOf(byId, tipA, tipB), changed, onlyA, onlyB };
}
