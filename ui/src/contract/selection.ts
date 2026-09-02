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
 *   - point: `undefined` = CLEARED (keep all) — which never reaches this
 *     tier since SET-1 drops a cleared point from the fold; `null` = IS NULL
 *     (`row[field] == null`), exactly the src tier. (Before SET-1 the
 *     overview collapsed a cleared point to null, so null had to mean
 *     "cleared" here and an IS-NULL point was unrepresentable — that
 *     collapse is gone, and so is the divergence.) Anything else = strict
 *     equality.
 *   - interval: `null` value = cleared (keep all); string bounds (ISO-8601
 *     dates, lexicographic == chronological) only ever match string cells;
 *     numeric bounds only numeric non-NaN cells; a `null` bound is half-open
 *     (only the present side is tested). Exact `matchesClause` parity.
 *   - match (SET-1): `null` value = cleared (keep all); otherwise strict
 *     equality against the list — `exclude` keeps everything NOT in it. An
 *     empty keep-list matches nothing, an empty exclude-list keeps all.
 *     Exact `matchesClause` parity.
 */

import type { LinkGraphView, SelectionView } from '../adapter/types.js';
import type { RenderRow, RenderSelection, SelectionClauseView, EmissionKind } from './types.js';

/** An interval clause's wire value — the session's own `FilterRange` shape (see header). */
type IntervalValue =
  | readonly [number | null, number | null]
  | readonly [string | null, string | null]
  | null;

/** One cell side on the wire: a plain value (equality; null = IS NULL) or a [lo, hi] interval. */
type CellSideValue = number | string | boolean | null | IntervalValue;

/** A match clause's wire value — the session's own `MatchValue` shape (values + polarity, or null). */
type MatchWire = { readonly values: readonly unknown[]; readonly exclude?: boolean } | null;

/** The interval evaluator, shared by the plain interval arm and a cell's interval side. */
function intervalPredicate(field: string, iv: Exclude<IntervalValue, null>): (row: RenderRow) => boolean {
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

/**
 * One CELL side's predicate (D30): an array side is an interval (the shared
 * evaluator above, half-open included); anything else is a point with STRICT
 * equality — and here `null` means IS NULL (`row[field] == null`), NOT
 * "cleared": inside a cell tuple the whole-value `null` is the only cleared
 * spelling, so a null side is unambiguous at the adapter tier (unlike the
 * top-level point arm's documented nullish-cleared collapse).
 */
function cellSidePredicate(field: string, side: CellSideValue): (row: RenderRow) => boolean {
  if (Array.isArray(side)) return intervalPredicate(field, side as Exclude<IntervalValue, null>);
  if (side === null) return (row) => row[field] == null;
  return (row) => row[field] === side;
}

/**
 * Build the row predicate for one clause. Mirrors `matchesClause` exactly
 * (see the file header for the parity contract). `fields` rides only with
 * kind:'cell' (the D30 compound) — the AND of both sides.
 */
export function clausePredicate(
  kind: EmissionKind,
  field: string,
  value: unknown,
  fields?: readonly [string, string],
): (row: RenderRow) => boolean {
  if (kind === 'cell') {
    const pair = value as readonly [CellSideValue, CellSideValue] | null;
    // cleared (null) — or a malformed wire row that lost its pair: keep-all is
    // the only honest fallback (never guess a field split from the label)
    if (pair == null || fields === undefined) return () => true;
    const px = cellSidePredicate(fields[0], pair[0]);
    const py = cellSidePredicate(fields[1], pair[1]);
    return (row) => px(row) && py(row);
  }
  if (kind === 'match') {
    // SET-1: cleared (null) keeps all; keep = in the list; exclude = not in it —
    // strict equality per value, exactly `matchesClause`'s match arm
    const body = value as MatchWire;
    if (body == null) return () => true;
    const values = body.values;
    const hit = (row: RenderRow): boolean => values.some((candidate) => candidate === row[field]);
    return body.exclude === true ? (row) => !hit(row) : hit;
  }
  if (kind === 'point') {
    // the three-way point split, exactly `matchesClause`: undefined = cleared (keep all), null = IS NULL, else strict equality
    if (value === undefined) return () => true;
    if (value === null) return (row) => row[field] == null;
    return (row) => row[field] === value;
  }
  // interval — the wire only ever carries the session's FilterRange; this is
  // the same single narrowing both consumers used to make locally, now in ONE place
  const iv = value as IntervalValue;
  if (iv == null) return () => true; // cleared — no filter
  return intervalPredicate(field, iv);
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
  links?: LinkGraphView,
): RenderSelection {
  const clauses = new Map<string, SelectionClauseView>();
  for (const s of selections) {
    // Layer 4: which edge carries this clause INTO the consumer decides what it does here.
    // No graph = the legacy rule (every clause filters). Self, or a whole-dashboard fold
    // (selfViewId null), keeps the clause as-is. A `none` edge or NO edge = the clause never arrives.
    let response: SelectionClauseView['response'] | undefined;
    let field = s.field;
    let fields = s.fields;
    if (links !== undefined && selfViewId !== null && s.viewId !== selfViewId) {
      const edge = links.edges.find((e) => e.source === s.viewId && e.target === selfViewId && e.kind === s.kind);
      if (edge === undefined || edge.response === 'none') continue;
      response = edge.response;
      if (edge.mapping !== undefined) {
        const to = (f: string): string => edge.mapping!.find((m) => m.from === f)?.to ?? f;
        field = to(field);
        if (fields !== undefined) fields = [to(fields[0]), to(fields[1])];
      }
    }
    clauses.set(s.viewId, {
      kind: s.kind,
      field,
      value: s.value,
      ...(fields !== undefined ? { fields } : {}),
      ...(response !== undefined ? { response } : {}),
      predicate: clausePredicate(s.kind, field, s.value, fields),
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
  return foldPredicates(selection, (clause, viewId) => (opts.includeSelf || viewId !== selection.selfClauseId) && (clause.response === undefined || clause.response === 'filter'));
}

/**
 * Layer 4: the BRIGHT predicate a chart dims by — every clause that reaches this
 * view as a `filter` (rows the host already dropped; harmless to re-test) or a
 * `highlight` (rows kept, shown dim when they fail). Never the view's own clause.
 * With no link graph this equals `keepPredicate`, so nothing changes for a
 * consumer that predates links.
 */
export function brightPredicate(selection: RenderSelection): (row: RenderRow) => boolean {
  return foldPredicates(selection, (clause, viewId) => viewId !== selection.selfClauseId && (clause.response === undefined || clause.response === 'filter' || clause.response === 'highlight'));
}

/** The `navigate` clause that reaches this view, if any: the source's interval as the viewport to show. */
export function navigateDomain(selection: RenderSelection): { readonly field: string; readonly range: readonly [unknown, unknown] } | null {
  for (const [viewId, clause] of selection.clauses) {
    if (viewId === selection.selfClauseId || clause.response !== 'navigate') continue;
    if (clause.kind !== 'interval' || clause.value == null) continue;
    const [lo, hi] = clause.value as readonly [unknown, unknown];
    return { field: clause.field, range: [lo, hi] };
  }
  return null;
}

function foldPredicates(selection: RenderSelection, take: (clause: SelectionClauseView, viewId: string) => boolean): (row: RenderRow) => boolean {
  const preds: ((row: RenderRow) => boolean)[] = [];
  for (const [viewId, clause] of selection.clauses) if (take(clause, viewId)) preds.push(clause.predicate);
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

/** The consuming view's own live SET: the values it keeps or excludes. */
export interface SelfSelectedSet {
  /** The values, UNTYPED as they ride the clause (a mark compares via `String(v)` — see `markClass`); a set is never widened to strings. */
  readonly values: readonly unknown[];
  /** True when the set is an EXCLUDE (everything but these). */
  readonly exclude: boolean;
}

/**
 * The consuming view's own live selection as a SET (SET-1): a point is a
 * one-value keep-set, a match is its list and polarity, anything else (no
 * clause, cleared, an interval, a cell) is the empty keep-set. This is how a
 * bar/map/table outlines EVERY selected mark and knows whether shift-click
 * adds to a keep-set or an exclude-set — from the addressable fold, never
 * from local state.
 */
export function selfSelectedSet(selection: RenderSelection): SelfSelectedSet {
  const none: SelfSelectedSet = { values: [], exclude: false };
  if (selection.selfClauseId === null) return none;
  const own = selection.clauses.get(selection.selfClauseId);
  if (own !== undefined && own.value !== undefined) return setOf(own) ?? none;
  // Layer 4 `mirror`: with no clause of its own, the view outlines the values a
  // mirror edge brings in — the union of every mirrored point/match keep-set.
  const mirrored: unknown[] = [];
  for (const [viewId, clause] of selection.clauses) {
    if (viewId === selection.selfClauseId || clause.response !== 'mirror') continue;
    const set = setOf(clause);
    if (set !== null && !set.exclude) mirrored.push(...set.values);
  }
  return mirrored.length > 0 ? { values: mirrored, exclude: false } : none;
}

/** A point's one value or a match's list, as a set; null for any other clause or a cleared one. */
function setOf(clause: SelectionClauseView): SelfSelectedSet | null {
  if (clause.kind === 'point') return { values: [clause.value], exclude: false }; // a null point is a live IS-NULL selection
  if (clause.kind !== 'match' || clause.value === null) return null;
  const body = clause.value as Exclude<MatchWire, null>;
  return { values: body.values, exclude: body.exclude === true };
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

/** The consuming view's own live CELL: its field pair + the two sides. */
export interface SelfSelectedCell {
  readonly fields: readonly [string, string];
  /** `[x side, y side]` — each side a plain value or a `[lo, hi]` interval. */
  readonly values: readonly [unknown, unknown];
}

/**
 * The consuming view's own live CELL selection (D30) — or null when it has
 * none (no clause, a cleared cell, a non-cell clause, or a wire row that
 * lost its pair). The cell sibling of {@link selfSelectedValue} /
 * {@link selfSelectedInterval}: how a heatmap derives its selected-cell
 * outline AND its click-again-clears comparison from the addressable fold,
 * never from local state.
 */
export function selfSelectedCell(selection: RenderSelection): SelfSelectedCell | null {
  if (selection.selfClauseId === null) return null;
  const own = selection.clauses.get(selection.selfClauseId);
  if (!own || own.kind !== 'cell' || own.value == null || own.fields === undefined) return null;
  return { fields: own.fields, values: own.value as readonly [unknown, unknown] };
}
