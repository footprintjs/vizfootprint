import type { CommitView } from '../adapter/types.js';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** One interval bound: a number rounds to 2dp, a string (an ISO date) renders verbatim. */
function formatBound(v: number | string): string {
  return typeof v === 'number' ? String(round2(v)) : v;
}

/** An interval's plain words, shared by the interval arm and a cell's interval side. */
function formatIntervalWords(lo: number | string | null, hi: number | string | null): string {
  if (lo === null) return `up to ${formatBound(hi as number | string)}`;
  if (hi === null) return `at least ${formatBound(lo)}`;
  return `${formatBound(lo)} – ${formatBound(hi)}`;
}

/** One cell side in plain words: "price 100 – 150" (interval) / "category = Formal" (point). */
function formatCellSide(field: string, side: unknown): string {
  if (Array.isArray(side)) {
    // an array side is the interval side; its elements are the wire's bounds
    return `${field} ${formatIntervalWords(side[0] as number | string | null, side[1] as number | string | null)}`;
  }
  if (side === null) return `${field} = ∅`;
  if (typeof side === 'number') return `${field} = ${Number.isInteger(side) ? side : round2(side)}`;
  return `${field} = ${String(side)}`;
}

/**
 * A compact, safe rendering of a commit's DATA value (never a raw dump).
 * FILTER-1: an interval bound may itself be `null` (half-open — "150 or
 * more" / "up to 2026-05-31") — rendered in plain words, never a fabricated
 * opposite bound. D29: a CELL commit reads as its two sides joined with
 * "and" — "price 100 – 150 and category = Formal".
 */
export function formatCommitValue(c: Pick<CommitView, 'kind' | 'value' | 'fields'>): string {
  if (c.kind === 'cell') {
    const v = c.value as readonly [unknown, unknown] | null;
    if (v === null || c.fields === undefined) return '(cleared)';
    return `${formatCellSide(c.fields[0], v[0])} and ${formatCellSide(c.fields[1], v[1])}`;
  }
  if (c.kind === 'interval') {
    const v = c.value as readonly [number | string | null, number | string | null] | null;
    if (v === null) return '(cleared)';
    return formatIntervalWords(v[0], v[1]);
  }
  if (c.value === null || c.value === undefined) return '∅';
  if (typeof c.value === 'number') return Number.isInteger(c.value) ? String(c.value) : String(round2(c.value));
  return String(c.value);
}
