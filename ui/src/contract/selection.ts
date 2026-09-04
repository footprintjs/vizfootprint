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
 * (`selection.test.ts`) that runs BOTH over a value matrix.
 *
 * This block used to justify the mirror with a package rule — *"import src
 * TYPES, never src values"* — attributed to `adapter/types.ts`. That rule never
 * existed, and the note that said so then pointed at the next suspect: the
 * clause shape, "which is packaging work". **The packaging is now done, and it
 * was not the obstacle.** The library has an exports map (../../../PACKAGING.md)
 * and this package imports it by name; `vizfootprint/data` has exported
 * `matchesClause` all along, and the parity test below imports it through that
 * very door. Nothing about the seam was ever in the way.
 *
 * TWO things actually were, and only the first was ever named:
 *
 * 1. THE SHAPE — **now settled, and in the library.** `matchesClause` reads a
 *    `PredicateClause` — a typed union where a match carries `values`/`exclude`
 *    as SIBLING fields and a cell carries only `fields`. This tier reads the
 *    WIRE triple a commit carries: `{kind, field, value}` (+ `fields`), where a
 *    match's list rides INSIDE `value` as a `MatchValueBody` and a cell's
 *    `field` is the display label. That gap is one total function, and by
 *    `adapter/README.md`'s Law 3 it belonged in the LIBRARY, beside the shape
 *    it converts: the rule for reading a commit's value is the library's rule,
 *    and a copy of it in a consumer is the helper in the wrong repository. It
 *    is `clauseFromWire` in `src/data`, it comes through the
 *    `vizfootprint/data` door, and {@link clausePredicate} below CALLS it.
 *    There is one reading of a wire triple now, and it is not this file's.
 *
 * 2. THE STRATEGY, which is why this file still exists. These are not the same
 *    algorithm with two spellings. `clausePredicate` COMPILES a clause once —
 *    `selectionForView` calls it per clause, and `intervalPredicate` picks its
 *    string/number arm and closes over `lo`/`hi` before a single row is seen.
 *    `matchesClause` INTERPRETS, re-branching on kind and re-sniffing the
 *    bounds for every row. The folded predicate runs per row per frame over a
 *    90k-row table, so swapping the compiler for the interpreter would put a
 *    switch in the hottest loop the cockpit has. Two evaluators over ONE agreed
 *    clause can differ only in SPEED — which is the safe half, and is the half
 *    deliberately left as two. The dangerous half was two translations, and
 *    that one is closed.
 *
 * So what is left here is a compiler over the library's own clause, and the
 * test below is a DELEGATION check rather than a parity pin: it asserts that
 * `clausePredicate(...)` agrees with `matchesClause(row, clauseFromWire(...))`
 * — the same translation, evaluated the other way. The semantics it compiles
 * are therefore the clause's, stated once in `src/data`:
 *   - point: `undefined` = CLEARED (keep all) — which never reaches this
 *     tier since SET-1 drops a cleared point from the fold; `null` = IS NULL
 *     (`row[field] == null`). (Before SET-1 the overview collapsed a cleared
 *     point to null, so null had to mean "cleared" here and an IS-NULL point
 *     was unrepresentable — that collapse is gone, and so is the divergence.)
 *     Anything else = strict equality.
 *   - interval: `null` value = cleared (keep all); string bounds (ISO-8601
 *     dates, lexicographic == chronological) only ever match string cells;
 *     numeric bounds only numeric non-NaN cells; a `null` bound is half-open
 *     (only the present side is tested).
 *   - match (SET-1): `null` value = cleared (keep all); otherwise strict
 *     equality against the list — `exclude` keeps everything NOT in it. An
 *     empty keep-list matches nothing, an empty exclude-list keeps all.
 *   - cell (D30): the AND of both sides, each side lifted by the library's own
 *     `cellSideClause` — an array side is an interval, anything else a point.
 *     A cell whose `fields` never arrived, and any value the wire's declared
 *     shape does not cover, is CLEARED — `clauseFromWire`'s one fallback, so
 *     "keep-all is the only honest fallback" is now stated in one place too.
 */

import { cellSideClause, clauseFromWire } from 'vizfootprint/data';
import type { IntervalBounds, PredicateClause } from 'vizfootprint/data';
import type { ClearedSelectionView, LinkGraphView, SelectionView } from '../adapter/types.js';
import type { RenderRow, RenderSelection, SelectionClauseView, EmissionKind } from './types.js';

/** An interval clause's bounds as the clause carries them (the session's own `FilterRange` shape). */
type IntervalValue = IntervalBounds<number> | IntervalBounds<string>;

/** Keeps every row — the compiled form of "no filter", the one thing a cleared clause means. */
const KEEP_ALL = (): boolean => true;

/** The interval evaluator, shared by the plain interval arm and a cell's interval side. */
function intervalPredicate(field: string, iv: IntervalValue): (row: RenderRow) => boolean {
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
 * COMPILE one clause into a row predicate — the whole of this tier's own work.
 * Every branch here is a shape of `PredicateClause`, never a shape of the wire:
 * what a triple MEANT was decided by `clauseFromWire` before this ran, and a
 * cell's two sides are lifted by the library's own `cellSideClause`, so the
 * compiler cannot form an opinion about a value the interpreter would read
 * differently. What it does instead is decide once — the string-or-number arm,
 * the bounds, the values list — and close over the answer, so the hot loop
 * carries no switch.
 */
function compileClause(clause: PredicateClause | null): (row: RenderRow) => boolean {
  if (clause === null) return KEEP_ALL; // no filter
  switch (clause.kind) {
    case 'point': {
      const { field, value } = clause;
      if (value === undefined) return KEEP_ALL; // cleared
      if (value === null) return (row) => row[field] == null; // IS NULL
      return (row) => row[field] === value;
    }
    case 'interval': {
      const iv = clause.value;
      return iv === null ? KEEP_ALL : intervalPredicate(clause.field, iv);
    }
    case 'match': {
      const { field, values } = clause;
      const hit = (row: RenderRow): boolean => values.some((candidate) => candidate === row[field]);
      return clause.exclude === true ? (row) => !hit(row) : hit;
    }
    case 'cell': {
      const pair = clause.value;
      if (pair === null) return KEEP_ALL; // the whole cell cleared
      const px = compileClause(cellSideClause(clause.fields[0], pair[0]));
      const py = compileClause(cellSideClause(clause.fields[1], pair[1]));
      return (row) => px(row) && py(row);
    }
  }
}

/**
 * Build the row predicate for one clause on the wire. The reading is the
 * library's (`clauseFromWire`); only the COMPILATION is this tier's. `fields`
 * rides with kind:'cell' (the D30 compound) and is what makes its pair
 * authoritative — `field` there is a display label, never a column.
 */
export function clausePredicate(
  kind: EmissionKind,
  field: string,
  value: unknown,
  fields?: readonly [string, string],
): (row: RenderRow) => boolean {
  return compileClause(clauseFromWire(kind, field, value, fields));
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
  cleared: readonly ClearedSelectionView[] = [],
): RenderSelection {
  const clauses = new Map<string, SelectionClauseView>();
  // one lookup per (source, kind) into THIS consumer — built once per call, not once per clause
  const into = new Map<string, LinkGraphView['edges'][number]>();
  if (links !== undefined && selfViewId !== null) for (const e of links.edges) if (e.target === selfViewId) into.set(`${e.source}|${e.kind}`, e);
  // Layer 4, `onClear`: a source that CLEARED its selection still reaches a consumer whose edge says so.
  // `leave` keeps the last emission in force; `excludeAll` keeps nothing; `showAll` (the default) = the
  // clause is gone, exactly as before. Only a consumer with a graph and an edge from that source hears it.
  if (links !== undefined && selfViewId !== null) {
    const selecting = new Set(selections.map((s) => s.viewId));
    for (const c of cleared) {
      if (c.viewId === selfViewId || selecting.has(c.viewId)) continue;
      const edge = into.get(`${c.viewId}|${c.kind}`);
      if (edge === undefined || edge.response === 'none' || edge.response === 'follow') continue;
      const policy = edge.onClear ?? 'showAll';
      if (policy === 'showAll') continue;
      const to = (f: string): string => edge.mapping?.find((m) => m.from === f)?.to ?? f;
      const field = to(c.field);
      const fields = c.fields !== undefined ? ([to(c.fields[0]), to(c.fields[1])] as const) : undefined;
      clauses.set(
        c.viewId,
        policy === 'leave'
          ? { kind: c.kind, field, value: c.value, ...(fields !== undefined ? { fields } : {}), response: edge.response, predicate: clausePredicate(c.kind, field, c.value, fields) }
          : { kind: 'match', field, value: { values: [] }, response: edge.response, predicate: () => false },
      );
    }
  }
  for (const s of selections) {
    // Layer 4: which edge carries this clause INTO the consumer decides what it does here.
    // No graph = the legacy rule (every clause filters). Self, or a whole-dashboard fold
    // (selfViewId null), keeps the clause as-is. A `none` edge or NO edge = the clause never arrives.
    let response: SelectionClauseView['response'] | undefined;
    let field = s.field;
    let fields = s.fields;
    if (links !== undefined && selfViewId !== null && s.viewId !== selfViewId) {
      const edge = into.get(`${s.viewId}|${s.kind}`);
      // an `encoding` edge never matches a clause's kind, so `follow` cannot reach here; the guard keeps the type honest
      if (edge === undefined || edge.response === 'none' || edge.response === 'follow') continue;
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
 * Does this clause NARROW the view it reached, or only colour it?
 *
 * The link graph has already decided whether the clause arrives at all
 * (`selectionForView` drops a `none` edge and an absent one). This is the
 * remaining half: `filter` (and a graph-less wire's `undefined`, the legacy
 * rule where every clause filters) narrows the rows; `highlight`, `navigate`
 * and `mirror` do not.
 *
 * It is exported because it is the rule {@link keepPredicate} folds by, and a
 * host that reads one clause's value BY HAND must narrow by exactly the same
 * rule or the dashboard says a link is off while the view moves anyway. The
 * demo restated this line for that purpose; a rule with two spellings is a
 * rule with two answers.
 */
export function filtersHere(clause: SelectionClauseView | undefined): clause is SelectionClauseView {
  return clause !== undefined && (clause.response === undefined || clause.response === 'filter');
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
  return foldPredicates(selection, (clause, viewId) => (opts.includeSelf || viewId !== selection.selfClauseId) && filtersHere(clause));
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
  const body = clause.value as { readonly values: readonly unknown[]; readonly exclude?: boolean };
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
