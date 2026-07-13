import type { CommitView } from '../adapter/types.js';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** One interval bound: a number rounds to 2dp, a string (an ISO date) renders verbatim. */
function formatBound(v: number | string): string {
  return typeof v === 'number' ? String(round2(v)) : v;
}

/**
 * A compact, safe rendering of a commit's DATA value (never a raw dump).
 * FILTER-1: an interval bound may itself be `null` (half-open — "150 or
 * more" / "up to 2026-05-31") — rendered in plain words, never a fabricated
 * opposite bound.
 */
export function formatCommitValue(c: Pick<CommitView, 'kind' | 'value'>): string {
  if (c.kind === 'interval') {
    const v = c.value as readonly [number | string | null, number | string | null] | null;
    if (v === null) return '(cleared)';
    const [lo, hi] = v;
    if (lo === null) return `up to ${formatBound(hi as number | string)}`;
    if (hi === null) return `at least ${formatBound(lo)}`;
    return `${formatBound(lo)} – ${formatBound(hi)}`;
  }
  if (c.value === null || c.value === undefined) return '∅';
  if (typeof c.value === 'number') return Number.isInteger(c.value) ? String(c.value) : String(round2(c.value));
  return String(c.value);
}
