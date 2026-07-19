/**
 * The clause-addressable selection derivation — how the HOST builds a
 * {@link RenderSelection} from the session's per-view commit fold.
 *
 * The data already exists: `SessionViewState.selections` is the adapter's
 * projection of the session's `activeSelections` — one live clause per view,
 * itself the fold of that view's select/filter commits at the cursor. This
 * module turns those rows into addressable predicates so a renderer can dim
 * "under everyone's brush but my own" without a side channel, and so an app
 * never re-implements a keep-predicate matcher again (this REPLACES the flat
 * keep-predicate the charts used to receive).
 *
 * PREDICATE SEMANTICS — a deliberate mirror of `src/data`'s `matchesClause`
 * point/interval arms (`src/data/predicate.ts`), pinned by a parity test
 * (`selection.test.ts`) that runs BOTH over a value matrix. The mirror exists
 * (instead of a value import) because vizfootprint-ui ships standalone: the
 * package rule is "import src TYPES, never src values" (see
 * `adapter/types.ts`), so the evaluator is restated here and parity is
 * enforced by test, not by convention:
 *   - point: a nullish value = CLEARED (keep all); anything else = strict
 *     equality. ONE pinned divergence from `matchesClause`: at the src tier
 *     `null` means IS NULL — but this module evaluates ADAPTER-tier values,
 *     and at that tier a cleared point selection ARRIVES as `null`
 *     (`session.overview()` projects the kept-but-cleared `undefined` clause
 *     as `value ?? null`, and the JSON poll wire cannot carry `undefined` at
 *     all), so `null` can only mean "cleared" here. A genuine IS-NULL point
 *     selection is not representable at the adapter tier.
 *   - interval: `null` value = cleared (keep all); string bounds (ISO-8601
 *     dates, lexicographic == chronological) only ever match string cells;
 *     numeric bounds only numeric non-NaN cells; a `null` bound is half-open
 *     (only the present side is tested). Exact `matchesClause` parity.
 */

import type { SelectionView } from '../adapter/types.js';
import type { RenderRow, RenderSelection, SelectionClauseView, EmissionKind } from './types.js';

/** An interval clause's wire value — the session's own `FilterRange` shape (see header). */
type IntervalValue =
  | readonly [number | null, number | null]
  | readonly [string | null, string | null]
  | null;

/**
 * Build the row predicate for one clause. Mirrors `matchesClause` exactly
 * (see the file header for the parity contract).
 */
export function clausePredicate(kind: EmissionKind, field: string, value: unknown): (row: RenderRow) => boolean {
  if (kind === 'point') {
    // nullish = CLEARED at the adapter tier (see the file header: overview()
    // collapses the cleared `undefined` to null; JSON cannot carry undefined)
    if (value == null) return () => true;
    return (row) => row[field] === value;
  }
  // interval — the wire only ever carries the session's FilterRange; this is
  // the same single narrowing both consumers used to make locally, now in ONE place
  const iv = value as IntervalValue;
  if (iv == null) return () => true; // cleared — no filter
  const [lo, hi] = iv;
  if (typeof lo === 'string' || typeof hi === 'string') {
    return (row) => {
      const v = row[field];
      if (typeof v !== 'string') return false; // no cross-type coercion
      if (lo !== null && v < (lo as string)) return false;
      if (hi !== null && v > (hi as string)) return false;
      return true;
    };
  }
  return (row) => {
    const v = row[field];
    if (typeof v !== 'number' || Number.isNaN(v)) return false;
    if (lo !== null && v < lo) return false;
    if (hi !== null && v > hi) return false;
    return true;
  };
}

/** An empty, render-safe selection (before any clause lands). */
export function emptySelection(selfViewId: string | null = null): RenderSelection {
  return { clauses: new Map(), resolve: 'intersect', selfClauseId: selfViewId };
}

/**
 * Derive one view's clause-addressable selection from the adapter state's
 * `selections` (the per-view commit fold). `selfViewId` names the consuming
 * view so its own clause is addressable for self-exclusion; pass `null` for
 * a whole-dashboard fold (e.g. the "N of M rows selected" readout).
 */
export function selectionForView(
  selections: readonly SelectionView[],
  selfViewId: string | null,
  resolve: 'union' | 'intersect' = 'intersect',
): RenderSelection {
  const clauses = new Map<string, SelectionClauseView>();
  for (const s of selections) {
    clauses.set(s.viewId, {
      kind: s.kind,
      field: s.field,
      value: s.value,
      predicate: clausePredicate(s.kind, s.field, s.value),
    });
  }
  return { clauses, resolve, selfClauseId: selfViewId };
}

/**
 * Fold a selection into ONE keep-predicate. By default the self clause is
 * excluded (crossfilter self-exclusion — "dim under everyone's brush but my
 * own"); pass `includeSelf: true` for the whole-dashboard truth.
 */
export function keepPredicate(
  selection: RenderSelection,
  opts: { readonly includeSelf?: boolean } = {},
): (row: RenderRow) => boolean {
  const preds: ((row: RenderRow) => boolean)[] = [];
  for (const [viewId, clause] of selection.clauses) {
    if (!opts.includeSelf && viewId === selection.selfClauseId) continue;
    preds.push(clause.predicate);
  }
  if (preds.length === 0) return () => true;
  if (selection.resolve === 'union') return (row) => preds.some((p) => p(row));
  return (row) => preds.every((p) => p(row));
}

/**
 * The consuming view's own live POINT value, as the string the `selected`
 * chart props expect — or null when it has none (no clause, a cleared clause,
 * or an interval). This is how a bar/map/table derives its selection outline
 * from the same addressable fold.
 */
export function selfSelectedValue(selection: RenderSelection): string | null {
  if (selection.selfClauseId === null) return null;
  const own = selection.clauses.get(selection.selfClauseId);
  if (!own || own.kind !== 'point' || own.value == null) return null;
  return String(own.value);
}

/**
 * The consuming view's own live INTERVAL value (`[lo, hi]`, numeric or ISO
 * strings) — or null when it has none (no clause, a cleared clause, or a
 * point). {@link selfSelectedValue}'s interval sibling: how a histogram
 * derives its brushed range (and its click-again-clears comparison) from the
 * same addressable fold. The single narrowing mirrors `clausePredicate`'s —
 * the wire only ever carries the session's `FilterRange` shape (file header).
 */
export function selfSelectedInterval(
  selection: RenderSelection,
): readonly [number | string | null, number | string | null] | null {
  if (selection.selfClauseId === null) return null;
  const own = selection.clauses.get(selection.selfClauseId);
  if (!own || own.kind !== 'interval' || own.value == null) return null;
  return own.value as readonly [number | string | null, number | string | null];
}
