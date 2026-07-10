import type { CommitView } from '../adapter/types.js';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A compact, safe rendering of a commit's DATA value (never a raw dump). */
export function formatCommitValue(c: Pick<CommitView, 'kind' | 'value'>): string {
  if (c.kind === 'interval') {
    const v = c.value as [number, number] | null;
    return v === null ? '(cleared)' : `${round2(v[0])} – ${round2(v[1])}`;
  }
  if (c.value === null || c.value === undefined) return '∅';
  if (typeof c.value === 'number') return Number.isInteger(c.value) ? String(c.value) : String(round2(c.value));
  return String(c.value);
}
