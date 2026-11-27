import type { scaleKindOf } from 'vizfootprint/def';

/**
 * The line adapter's existing raw-cell discriminator. A declared quantitative
 * scale wins; otherwise an actual number produces a numeric point. Shared by
 * the producer and date-order fallback so a mixed numeric axis is never
 * described from only its date-shaped subset.
 */
export function lineCellIsNumber(value: unknown, scale?: ReturnType<typeof scaleKindOf>): boolean {
  return scale === 'quantitative' || typeof value === 'number';
}
