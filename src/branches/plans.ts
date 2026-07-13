/**
 * BR-1 — plan, don't execute: `planBringOver` (cherry-pick) and `planUndo`
 * (revert). Both are PURE reads over the raw log; they return `{recipe,
 * conflicts}` and never touch state. The SESSION executes a plan through its
 * normal dispatch (commit-on-intent stays in ONE place), stamping the cause
 * with `replayedFrom` / `revertOf` (+ `conflicts` when any) — NO new verbs.
 *
 * A CONFLICT = the same state key was touched on the target path since the
 * LCA, named by the overriding commit id. The plan stays executable; the note
 * is explicit (and rides into the landed commit's cause, audited forever).
 */

import type { CommitRecord } from '../log/index.js';
import type { FoldEntry, PlanRecipe, PlanResult } from './types.js';
import {
  ANALYSIS_VIEW_PREFIX,
  ANNOTATION_VIEW_PREFIX,
  ENCODING_VIEW_PREFIX,
  foldStateAt,
  keyOf,
} from './fold.js';
import { indexById, lcaOf } from './walk.js';

/** Honest miss for ids the records don't contain. */
function unknown(missing: readonly string[]): PlanResult {
  return { ok: false, reason: 'unknown-commit', detail: `unknown commit id(s): ${missing.join(', ')}` };
}

function missingIds(byId: ReadonlyMap<string, CommitRecord>, commitId: string, tip: string | null): string[] {
  const missing: string[] = [];
  if (!byId.has(commitId)) missing.push(commitId);
  if (tip !== null && !byId.has(tip)) missing.push(tip);
  return missing;
}

/**
 * The commits on the target path (tip → LCA, exclusive) that touched `key`,
 * oldest→newest. The walk region excludes the source commit BY CONSTRUCTION:
 * a source on the target path IS the LCA (the walk stops before it), and a
 * source off the path is never visited. Loop-safe + dangling-parent-safe
 * (raw logs).
 */
function conflictsFor(
  byId: ReadonlyMap<string, CommitRecord>,
  key: string | null,
  sourceCommitId: string,
  targetTip: string | null,
): string[] {
  if (key === null || targetTip === null) return [];
  const lca = lcaOf(byId, sourceCommitId, targetTip);
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = targetTip;
  while (cur !== null && cur !== lca && !seen.has(cur)) {
    seen.add(cur);
    const rec = byId.get(cur);
    if (!rec) break;
    if (keyOf(rec) === key) out.push(rec.id);
    cur = rec.parent;
  }
  return out.reverse();
}

/** Map a source commit onto the dispatch-shaped recipe that re-lands it. */
function bringOverRecipe(rec: CommitRecord): PlanRecipe {
  if (rec.viewId.startsWith(ENCODING_VIEW_PREFIX)) {
    return {
      apply: 'encoding',
      viewId: rec.viewId.slice(ENCODING_VIEW_PREFIX.length),
      channel: rec.field,
      field: String(rec.value),
    };
  }
  if (rec.viewId.startsWith(ANALYSIS_VIEW_PREFIX)) {
    // Bringing over an analysis RE-DECLARES it on the target path (it re-runs
    // over that path's state and steps the FDR ledger again — p-values are
    // never copied across branches).
    return { apply: 'analysis', analysisId: rec.viewId.slice(ANALYSIS_VIEW_PREFIX.length) };
  }
  if (rec.viewId.startsWith(ANNOTATION_VIEW_PREFIX)) {
    // The log stores the note under the actor-namespace viewId; the original
    // free-form target never entered the wire — the honest recipe re-notes
    // under that namespace.
    return { apply: 'annotation', target: rec.viewId, note: String(rec.value) };
  }
  return { apply: 'selection', viewId: rec.viewId, kind: rec.kind, field: rec.field, value: rec.value };
}

/**
 * Plan a bring-over (cherry-pick) of `commitId` onto `targetTip`. Returns the
 * dispatch-shaped recipe plus the conflicts (same key touched on the target
 * path since the LCA — the plan stays executable).
 */
export function planBringOver(
  records: readonly CommitRecord[],
  commitId: string,
  targetTip: string | null,
): PlanResult {
  const byId = indexById(records);
  const missing = missingIds(byId, commitId, targetTip);
  if (missing.length > 0) return unknown(missing);
  const rec = byId.get(commitId) as CommitRecord; // present — validated above
  return { ok: true, recipe: bringOverRecipe(rec), conflicts: conflictsFor(byId, keyOf(rec), commitId, targetTip) };
}

/**
 * Plan an undo (revert) of `commitId` as seen from `tip`: the recipe restores
 * the key's value AT THE COMMIT'S PARENT — including "absent at parent →
 * clear recipe". Honest `not-undoable` for an analysis (the FDR ledger never
 * refunds) and an annotation (inert — no prior state).
 */
export function planUndo(records: readonly CommitRecord[], commitId: string, tip: string | null): PlanResult {
  const byId = indexById(records);
  const missing = missingIds(byId, commitId, tip);
  if (missing.length > 0) return unknown(missing);
  const rec = byId.get(commitId) as CommitRecord; // present — validated above

  const key = keyOf(rec);
  if (key === null) {
    return { ok: false, reason: 'not-undoable', detail: 'an annotation is inert data — there is no prior state to restore' };
  }
  if (rec.viewId.startsWith(ANALYSIS_VIEW_PREFIX)) {
    return {
      ok: false,
      reason: 'not-undoable',
      detail: 'a declared analysis cannot be un-run — the FDR ledger never refunds alpha; declare a new analysis instead',
    };
  }

  // The key's value at the commit's PARENT, on the commit's own path.
  const prior = foldStateAt(records, rec.parent).get(key);
  let recipe: PlanRecipe;
  if (rec.viewId.startsWith(ENCODING_VIEW_PREFIX)) {
    const viewId = rec.viewId.slice(ENCODING_VIEW_PREFIX.length);
    const channel = rec.field;
    // The key namespace guarantees an entry under `encoding:…` is an encoding entry.
    const priorEncoding = prior as Extract<FoldEntry, { kind: 'encoding' }> | undefined;
    recipe =
      priorEncoding !== undefined
        ? { apply: 'encoding', viewId, channel, field: priorEncoding.field }
        : { apply: 'clear-encoding', viewId, channel }; // absent at parent → the executor restores the declared initial
  } else {
    // Same namespace guarantee: a `selection:…` entry is a selection entry.
    const priorSelection = prior as Extract<FoldEntry, { kind: 'selection' }> | undefined;
    recipe =
      priorSelection !== undefined
        ? {
            apply: 'selection',
            viewId: rec.viewId,
            kind: priorSelection.clause.kind,
            field: priorSelection.clause.field,
            value: priorSelection.clause.value,
          }
        : { apply: 'clear-selection', viewId: rec.viewId, field: rec.field }; // absent at parent → clear
  }
  return { ok: true, recipe, conflicts: conflictsFor(byId, key, commitId, tip) };
}
