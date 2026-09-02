/**
 * GRAIN — what a view's marks stand for, as the group keys they aggregate over
 * (`[]` = one mark per row). An edge CROSSES grains when its source emits over
 * an aggregate (a non-empty grain) and its target shows another grain: the
 * emission names a group, not the target's rows, so the edge must state its
 * `fold`. A view with no declared grain is never judged (refuse on evidence,
 * never on ignorance).
 */
import type { LinkView } from './types.js';

/** The fold a default (crossfilter) edge carries when it crosses grains: filter the target's rows by the emitted field, then re-aggregate. */
export const DEFAULT_FOLD = 'crossfilter';

export function sameGrain(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((k) => sb.has(k));
}

export function crossesGrain(source: LinkView | undefined, target: LinkView | undefined): boolean {
  if (source?.grain === undefined || target?.grain === undefined) return false;
  return source.grain.length > 0 && !sameGrain(source.grain, target.grain);
}

/** A grain in words: `rows`, or its keys. */
export function grainWords(grain: readonly string[]): string {
  return grain.length === 0 ? 'rows' : grain.join(' × ');
}
