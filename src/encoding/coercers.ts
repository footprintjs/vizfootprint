/**
 * Built-in coercers — the optional adapters behind `onInvalid`. Each is
 * honest about what it can turn into what: a continuous column CAN be read as
 * discrete (its values become categories); a category can never become a
 * magnitude, so no adapter offers that.
 */
import type { Coercer } from './types.js';

/** Reads a continuous column as discrete when the channel needs discrete — and nothing else. */
export const discreteCoercer: Coercer = {
  name: 'discrete',
  coerce(facet, requirement) {
    if (requirement.scale !== 'discrete' || facet.scale !== 'continuous') return null;
    return { ...facet, scale: 'discrete' };
  },
};

export const BUILTIN_COERCERS: readonly Coercer[] = [discreteCoercer];
