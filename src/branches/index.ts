/**
 * `vizfootprint/branches` (BR-1) — git-style NAMED branching over the
 * append-only commit log, as a pure mini-library.
 *
 * Imports ONLY the log layer (`src/log` types) — no session, no data
 * providers, no engines, no UI — so anyone can use it against a raw
 * `CommitRecord[]`:
 *
 *   - {@link BranchRefs} — refs `{name → tip}` + HEAD, BESIDE the log, never
 *     in it; act-at-tip advances, act-while-detached auto-creates a
 *     cause-slugged ref; every create/advance/switch/rename journaled as a
 *     lightweight ref-event (never a commit). TL-1 adds the LIFECYCLE —
 *     `archive` / `restore` / `discardTo` — which move and hide refs but never
 *     erase a commit: the record is forever, only the VIEW of it changes.
 *   - {@link deriveBranches} — deterministic names for every lane of a
 *     legacy anonymous log.
 *   - {@link commonAncestor} — loop-safe LCA, missing-id honest.
 *   - {@link foldDiff} / {@link foldStateAt} — the structured state diff
 *     from the log alone (last-wins per key; no row counts here — the
 *     session enriches those).
 *   - {@link planBringOver} / {@link planUndo} — plan, don't execute:
 *     `{recipe, conflicts}`; the session executes through normal dispatch
 *     with `replayedFrom` / `revertOf` cause tags (NO new verbs).
 */

export { BranchRefs } from './refs.js';
export type { BranchListOptions, BranchRefsOptions } from './refs.js';
export { deriveBranches } from './derive.js';
export type { DeriveBranchesOptions } from './derive.js';
export { commonAncestor } from './walk.js';
export {
  foldDiff,
  foldStateAt,
  keyOf,
  ENCODING_VIEW_PREFIX,
  ANALYSIS_VIEW_PREFIX,
  ANNOTATION_VIEW_PREFIX,
  CHART_VIEW_PREFIX,
  LAYOUT_VIEW_PREFIX,
  LINK_VIEW_PREFIX, ENCODING_SET_FIELD, isEncodingSet, encodingSetOf, keysOf,
  BEAT_VIEW_PREFIX,
} from './fold.js';
export { planBringOver, planUndo } from './plans.js';
export { slugForCommit, slugify, uniqueSlug } from './slug.js';
export type {
  AncestorResult,
  DiffChange,
  DiffOnly,
  FoldDiffResult,
  FoldEntry,
  FoldState,
  Head,
  PlanRecipe,
  PlanResult,
  RefEvent,
  RefState,
} from './types.js';
