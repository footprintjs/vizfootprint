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
import { keepPredicate, selfSelectedValue } from '../contract/selection.js';
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

/** Dim, never hide — `''` for a kept mark, `' vzf-dim'` (leading space) otherwise. */
export function dimClass(kept: boolean): string {
  return kept ? '' : ' vzf-dim';
}
