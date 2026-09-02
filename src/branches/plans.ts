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
import type { FoldEntry, LinkValue, PlanRecipe, PlanResult } from './types.js';
import {
  LINK_VIEW_PREFIX,
  ANALYSIS_VIEW_PREFIX,
  ANNOTATION_VIEW_PREFIX,
  BEAT_VIEW_PREFIX,
  ENCODING_VIEW_PREFIX,
  LAYOUT_VIEW_PREFIX,
  encodingSetOf,
  foldStateAt,
  isEncodingSet,
  keyOf,
  keysOf,
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
  keys: readonly string[],
  sourceCommitId: string,
  targetTip: string | null,
): string[] {
  if (keys.length === 0 || targetTip === null) return [];
  const lca = lcaOf(byId, sourceCommitId, targetTip);
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = targetTip;
  while (cur !== null && cur !== lca && !seen.has(cur)) {
    seen.add(cur);
    const rec = byId.get(cur);
    if (!rec) break;
    if (keysOf(rec).some((k) => keys.includes(k))) out.push(rec.id); // a binding set touches one key per channel
    cur = rec.parent;
  }
  return out.reverse();
}

/** Map a source commit onto the dispatch-shaped recipe that re-lands it. */
function bringOverRecipe(rec: CommitRecord): PlanRecipe {
  if (rec.viewId.startsWith(LINK_VIEW_PREFIX)) {
    // Layer 4: an edited edge re-lands as the same edit (or the same un-declare) on the target path
    const link = rec.value as LinkValue | null;
    return link === null ? { apply: 'clear-link', link: linkOfId(rec.viewId.slice(LINK_VIEW_PREFIX.length)) } : { apply: 'link', link };
  }
  if (isEncodingSet(rec)) {
    // encoding plane: a binding set re-lands as the same set (one act, one commit)
    return { apply: 'encoding-set', viewId: rec.viewId.slice(ENCODING_VIEW_PREFIX.length), bindings: encodingSetOf(rec) };
  }
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
  if (rec.viewId.startsWith(BEAT_VIEW_PREFIX)) {
    // A beat names a position. Bringing it over names the TARGET position with
    // the same label — the recipe re-lands a checkpoint there; nothing about the
    // source lineage is copied (a name is never state, so it carries no conflicts).
    return { apply: 'beat', label: String(rec.value) };
  }
  if (rec.viewId.startsWith(LAYOUT_VIEW_PREFIX)) {
    // LY-1: bringing a layout note over RE-LANDS the same arrangement prop here
    // (through the `navigate` verb) — like an annotation, it replays; unlike a
    // selection, it never filters, so it carries no conflicts (keyOf is null).
    return {
      apply: 'layout',
      scope: rec.viewId.slice(LAYOUT_VIEW_PREFIX.length),
      prop: rec.field,
      value: String(rec.value),
    };
  }
  return {
    apply: 'selection',
    viewId: rec.viewId,
    kind: rec.kind,
    field: rec.field,
    value: rec.value,
    // D30: a cell commit's authoritative field pair rides the recipe so the
    // executor re-lands the compound (never a flattened single-field probe).
    ...(rec.fields !== undefined ? { fields: rec.fields } : {}),
  };
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
  return { ok: true, recipe: bringOverRecipe(rec), conflicts: conflictsFor(byId, keysOf(rec), commitId, targetTip) };
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
    return { ok: false, reason: 'not-undoable', detail: 'this commit is inert (an annotation, a chart registration, a layout note, or a story beat) — there is no prior state to restore; set the layout again to change it, or name a new beat' };
  }
  if (rec.viewId.startsWith(ANALYSIS_VIEW_PREFIX)) {
    return {
      ok: false,
      reason: 'not-undoable',
      detail: 'a declared analysis cannot be un-run — the FDR ledger never refunds alpha; declare a new analysis instead',
    };
  }

  // The state at the commit's PARENT, on the commit's own path (folded once; a set reads several keys of it).
  const parentState = foldStateAt(records, rec.parent);
  const prior = parentState.get(key);
  let recipe: PlanRecipe;
  if (rec.viewId.startsWith(LINK_VIEW_PREFIX)) {
    // Layer 4: restore the PRIOR edit on this path, or un-declare (the def's rule shows through)
    const priorLink = prior as Extract<FoldEntry, { kind: 'link' }> | undefined;
    const link = (rec.value as LinkValue | null) ?? linkOfId(rec.viewId.slice(LINK_VIEW_PREFIX.length));
    recipe = priorLink !== undefined ? { apply: 'link', link: priorLink.link } : { apply: 'clear-link', link };
  } else if (isEncodingSet(rec)) {
    // encoding plane: restore EVERY channel the set touched to its value at the parent — a prior binding, or null (= the declared initial)
    const viewId = rec.viewId.slice(ENCODING_VIEW_PREFIX.length);
    const bindings: Record<string, string | null> = {};
    for (const channel of Object.keys(encodingSetOf(rec))) {
      const priorEntry = parentState.get(`encoding:${viewId}:${channel}`) as Extract<FoldEntry, { kind: 'encoding' }> | undefined;
      bindings[channel] = priorEntry?.field ?? null;
    }
    recipe = { apply: 'encoding-set', viewId, bindings };
  } else if (rec.viewId.startsWith(ENCODING_VIEW_PREFIX)) {
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
            // D30: restoring a prior CELL restores the compound, pair and all.
            ...(priorSelection.clause.fields !== undefined ? { fields: priorSelection.clause.fields } : {}),
          }
        : {
            apply: 'clear-selection',
            viewId: rec.viewId,
            field: rec.field,
            kind: rec.kind, // the executor clears kind-faithfully (a cleared match is not a cleared interval)
            // D30: undoing a cell with nothing prior clears KIND-FAITHFULLY (a
            // cleared cell commit) — rec.field is the joint label, not a column,
            // so a flattened interval-clear would trip the executor's column guard.
            ...(rec.fields !== undefined ? { fields: rec.fields } : {}),
          }; // absent at parent → clear
  }
  return { ok: true, recipe, conflicts: conflictsFor(byId, keysOf(rec), commitId, tip) };
}

/**
 * The (source, kind, target) an edge id names — the shape a `clear-link` needs
 * when the un-declaring commit itself carried null. Ids are minted by
 * `edgeId` as `${source}:${kind}→${target}`; view ids never contain `→`, and
 * the kind is the segment after the LAST `:` before it.
 */
function linkOfId(id: string): LinkValue {
  const arrow = id.indexOf('→');
  const left = arrow >= 0 ? id.slice(0, arrow) : id;
  const target = arrow >= 0 ? id.slice(arrow + 1) : '';
  const colon = left.lastIndexOf(':');
  // a malformed id (no colon) has no source to name — an empty source, never a letter sliced off the kind
  return { source: colon >= 0 ? left.slice(0, colon) : '', kind: colon >= 0 ? left.slice(colon + 1) : left, target, response: 'none' };
}

