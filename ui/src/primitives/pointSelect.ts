/**
 * The POINT-SELECT primitive — the click→point-emission semantics VizBar,
 * VizMap, and VizTable share, extracted so a consumer-built chart speaks the
 * same three-way point language the engine evaluates (src/data/types.ts):
 *
 *   - `pointEmission` — the plain R3 point shape `{ rawValue, encoding }`; the
 *     chart never builds a clause;
 *   - `togglePointEmission` — click-again-clears: selecting the already
 *     selected value emits the CLEARED point (`rawValue: undefined` — the
 *     "no filter" arm; `null` would mean "match SQL NULL", a different
 *     filter), releasing it;
 *   - `matchEmission` / `toggleInSetEmission` (SET-1) — the many-values
 *     language: shift-click toggles a value in the view's own SET (a point
 *     promotes to a one-value set; removing the last value emits the CLEARED
 *     match, never an empty list — an empty keep-list would match nothing);
 *   - `keyActivates` — the shared Enter/Space keyboard affordance for
 *     clickable marks (`role="button"` + `tabIndex` stay the chart's job).
 */
import type { KeyboardEvent } from 'react';
import type { ChartEmission } from 'vizfootprint/mosaic';

/** The R3 point emission for a DATA value on a field. */
export function pointEmission(field: string, value: unknown): ChartEmission {
  return { rawValue: value, encoding: { kind: 'point', field } };
}

/**
 * Click-again-clears: emitting the currently selected value yields the
 * CLEARED point (`rawValue: undefined`); anything else selects it.
 */
export function togglePointEmission(field: string, value: string, selected: string | null): ChartEmission {
  return selected === value
    ? { rawValue: undefined, encoding: { kind: 'point', field } }
    : { rawValue: value, encoding: { kind: 'point', field } };
}

/** The R3 match emission (SET-1): many DATA values on a field — or `null` to clear the match. */
export function matchEmission(field: string, values: readonly unknown[] | null, exclude = false): ChartEmission {
  return { rawValue: values === null ? null : exclude ? { values, exclude: true } : { values }, encoding: { kind: 'match', field } };
}

/**
 * Shift-click semantics: toggle `value` in the view's own set (`current` —
 * see `selfSelectedSet`), keeping its polarity. Removing the last value
 * emits the CLEARED match (`rawValue: null`).
 */
export function toggleInSetEmission(field: string, value: string, current: { readonly values: readonly unknown[]; readonly exclude: boolean }): ChartEmission {
  // the set stays TYPED (an agent may have landed numbers): membership is by string, the survivors keep their type
  const has = current.values.some((v) => String(v) === value);
  const next = has ? current.values.filter((v) => String(v) !== value) : [...current.values, value];
  return matchEmission(field, next.length === 0 ? null : next, current.exclude);
}

/**
 * The PLAIN click, read against the view's own set: on a member of an
 * EXCLUDE-set it removes that member (polarity never flips from a gesture
 * that reads as "select" — the chip flips polarity); on the single kept
 * value it clears; anywhere else it selects that one value (a point).
 */
export function clickEmission(field: string, value: string, current: { readonly values: readonly unknown[]; readonly exclude: boolean }): ChartEmission {
  const member = current.values.some((v) => String(v) === value);
  if (current.exclude && member) return toggleInSetEmission(field, value, current);
  const single = current.values.length === 1 && !current.exclude && member ? value : null;
  return togglePointEmission(field, value, single);
}

/** Enter/Space activates — the shared keyboard handler for clickable marks. */
export function keyActivates<E extends Element>(activate: () => void): (e: KeyboardEvent<E>) => void {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  };
}
