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
 *   - `keyActivates` — the shared Enter/Space keyboard affordance for
 *     clickable marks (`role="button"` + `tabIndex` stay the chart's job).
 */
import type { KeyboardEvent } from 'react';
import type { ChartEmission } from '../../../src/mosaic/index.js';

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

/** Enter/Space activates — the shared keyboard handler for clickable marks. */
export function keyActivates<E extends Element>(activate: () => void): (e: KeyboardEvent<E>) => void {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  };
}
