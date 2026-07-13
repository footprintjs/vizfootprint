/**
 * Pure normalization of a session `compare()` result (or the identical JSON a
 * compare endpoint returns) into the plain-language {@link CompareView} the
 * CompareModal renders. The raw shape is `src/session` `CompareResult`: the
 * `branches/` foldDiff (changed / onlyA / onlyB over FoldEntry values) plus
 * per-side row counts. Components never read FoldEntry — this module turns
 * each entry into words a non-developer can read:
 *
 *   selection  → "price between 30 and 210" / "category is Formal"
 *   encoding   → "x axis shows price"
 *   analysis   → "test ran (p = 0.004)" / "ran"
 */

import type { CompareChangeView, CompareEntryView, CompareView } from './types.js';

/** The `src/branches` FoldEntry wire shape (duck-typed — this also arrives as poll JSON). */
interface RawFoldEntry {
  readonly kind: 'selection' | 'encoding' | 'analysis';
  readonly viewId?: string;
  readonly clause?: { readonly kind: 'point' | 'interval'; readonly field: string; readonly value: unknown };
  readonly channel?: string;
  readonly field?: string;
  readonly value?: unknown;
  readonly analysisId?: string;
}

/** The `src/session` CompareResult wire shape (duck-typed for the poll source). */
export interface RawCompareResult {
  readonly ok: boolean;
  readonly a?: { readonly ref: string; readonly tip: string; readonly rows: number | null };
  readonly b?: { readonly ref: string; readonly tip: string; readonly rows: number | null };
  readonly ancestor?: string | null;
  readonly changed?: readonly { readonly key: string; readonly a: RawFoldEntry; readonly b: RawFoldEntry }[];
  readonly onlyA?: readonly { readonly key: string; readonly value: RawFoldEntry }[];
  readonly onlyB?: readonly { readonly key: string; readonly value: RawFoldEntry }[];
  readonly gap?: { readonly detail?: string };
}

/** A short, safe rendering of a clause value (never a deep dump). */
function word(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return String(v);
  return 'a value';
}

/** What the entry is ABOUT — the view it acts on, or the analysis id. */
export function entryLabel(e: RawFoldEntry): string {
  if (e.kind === 'analysis') return e.analysisId ?? 'analysis';
  return e.viewId ?? 'view';
}

/** The entry's value in plain words. */
export function entryDetail(e: RawFoldEntry): string {
  if (e.kind === 'selection') {
    const c = e.clause;
    if (!c) return 'a selection';
    if (c.kind === 'point') return `${c.field} is ${word(c.value)}`;
    if (c.value === null) return `${c.field} filter cleared`;
    const range = c.value as readonly [unknown, unknown];
    return `${c.field} between ${word(range[0])} and ${word(range[1])}`;
  }
  if (e.kind === 'encoding') return `${e.channel ?? '?'} axis shows ${word(e.value)}`;
  // analysis: a declared-test entry lands under the pValue analog — surface p when numeric
  if (e.field === 'pValue' && typeof e.value === 'number') return `test ran (p = ${e.value})`;
  return 'ran';
}

function toEntry(key: string, e: RawFoldEntry): CompareEntryView {
  return { key, kind: e.kind, label: entryLabel(e), detail: entryDetail(e) };
}

/**
 * Normalize a raw compare result. A rejected compare maps to `{ ok: false }`
 * with the gap's honest detail as the reason (never a silent empty diff).
 */
export function mapCompareResult(raw: RawCompareResult): CompareView {
  if (!raw.ok) {
    return { ok: false, reason: raw.gap?.detail ?? 'compare failed' };
  }
  const changed: CompareChangeView[] = (raw.changed ?? []).map((c) => ({
    key: c.key,
    kind: c.a.kind,
    label: entryLabel(c.a),
    a: entryDetail(c.a),
    b: entryDetail(c.b),
  }));
  return {
    ok: true,
    a: { ref: raw.a!.ref, tip: raw.a!.tip, rows: raw.a!.rows },
    b: { ref: raw.b!.ref, tip: raw.b!.tip, rows: raw.b!.rows },
    ancestor: raw.ancestor ?? null,
    changed,
    onlyA: (raw.onlyA ?? []).map((o) => toEntry(o.key, o.value)),
    onlyB: (raw.onlyB ?? []).map((o) => toEntry(o.key, o.value)),
  };
}
