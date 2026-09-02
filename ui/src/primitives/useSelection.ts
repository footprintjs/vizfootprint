/**
 * The SELECTION-CONSUMPTION primitives — how a chart CONSUMES the contract's
 * clause-addressable `RenderSelection` (RP-1), extracted from the five
 * first-party charts so a consumer-built chart inherits the discipline:
 *
 *   - `useKeepPredicate` — the memoized self-excluded crossfilter fold
 *     ("dim under everyone's brush but my own"; the chart's OWN clause never
 *     dims it) the scatter and table both derive;
 *   - `selectedValue` — the controlled-prop rule the bar/map/table share: an
 *     explicit `selected` prop wins; otherwise the outline derives from the
 *     fold's own point clause (`selfSelectedValue`);
 *   - `dimClass` — the dim-not-hide styling hook: a row failing the non-self
 *     clauses wears `.vzf-dim` (theme-token opacity, both palettes), it is
 *     never removed.
 *
 * The predicates themselves live in `../contract/selection.js` (parity-pinned
 * against src/data's `matchesClause`); this module is the React-side
 * consumption layer.
 */
import { useMemo } from 'react';
import { keepPredicate, selfSelectedSet, selfSelectedValue, type SelfSelectedSet } from '../contract/selection.js';
import type { RenderRow, RenderSelection } from '../contract/types.js';

/** The memoized self-excluded crossfilter fold — null when no selection rides the props. */
export function useKeepPredicate(selection: RenderSelection | undefined): ((row: RenderRow) => boolean) | null {
  return useMemo(() => (selection ? keepPredicate(selection) : null), [selection]);
}

/** Explicit `selected` wins; otherwise the outline derives from the fold's own point clause. */
export function selectedValue(
  explicit: string | null | undefined,
  selection: RenderSelection | undefined,
): string | null {
  return explicit !== undefined ? explicit : selection ? selfSelectedValue(selection) : null;
}

/**
 * The view's own selection as a SET (SET-1): an explicit `selected` prop is a
 * one-value keep-set (or empty for null); otherwise the fold's own point or
 * match. A mark whose value is in `values` wears `.vzf-selected` (keep) or
 * `.vzf-excluded` (exclude) — see `markClass`.
 */
export function selectedSet(explicit: string | null | undefined, selection: RenderSelection | undefined): SelfSelectedSet {
  if (explicit !== undefined) return { values: explicit === null ? [] : [explicit], exclude: false };
  return selection ? selfSelectedSet(selection) : { values: [], exclude: false };
}

/** Is a mark's (string) value a member of the set? The set keeps its values typed; the mark compares by their string. */
export function inSet(value: string, set: SelfSelectedSet): boolean {
  return set.values.some((v) => String(v) === value);
}

/** The outline class for a mark whose value is (or is not) in the view's own set — `''` when it is not. */
export function markClass(value: string, set: SelfSelectedSet): string {
  if (!inSet(value, set)) return '';
  return set.exclude ? ' vzf-excluded' : ' vzf-selected';
}

/** Dim, never hide — `''` for a kept mark, `' vzf-dim'` (leading space) otherwise. */
export function dimClass(kept: boolean): string {
  return kept ? '' : ' vzf-dim';
}
