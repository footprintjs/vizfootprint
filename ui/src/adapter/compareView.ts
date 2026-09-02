/**
 * Pure normalization of a session `compare()` result (or the identical JSON a
 * compare endpoint returns) into the plain-language {@link CompareView} the
 * CompareModal renders. The raw shape is `src/session` `CompareResult`: the
 * `branches/` foldDiff (changed / onlyA / onlyB over FoldEntry values) plus
 * per-side row counts. Components never read FoldEntry — this module turns
 * each entry into words a non-developer can read:
 *
 *   selection  → "price between 30 and 210" / "category is Formal"
 *              → "price at least 150" / "date up to 2026-05-31" (FILTER-1:
 *                a half-open interval bound)
 *   encoding   → "x axis shows price"
 *   analysis   → "test ran (p = 0.004)" / "ran"
 */

import type { CompareChangeView, CompareEntryView, CompareView } from './types.js';

/** The `src/branches` FoldEntry wire shape (duck-typed — this also arrives as poll JSON). */
interface RawFoldEntry {
  readonly kind: 'selection' | 'encoding' | 'analysis' | 'link';
  readonly viewId?: string;
  readonly clause?: {
    readonly kind: 'point' | 'interval' | 'cell' | 'match';
    readonly field: string;
    readonly value: unknown;
    /** kind:'cell' only (D30) — the two selected fields. */
    readonly fields?: readonly [string, string];
  };
  readonly channel?: string;
  readonly field?: string;
  readonly value?: unknown;
  readonly analysisId?: string;
  /** layer 4: the edited edge (kind:'link'). */
  readonly link?: { readonly source: string; readonly kind: string; readonly target: string; readonly response: string };
  readonly edgeId?: string;
  /** the last writer of the key (rides the wire; informational here). */
  readonly commitId?: string;
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

/** One cell side in plain words ("price between 100 and 150" / "category is Formal") — D30. */
function cellSideWords(field: string, side: unknown): string {
  if (Array.isArray(side)) {
    const lo: unknown = side[0];
    const hi: unknown = side[1];
    if (lo === null || lo === undefined) return `${field} up to ${word(hi)}`;
    if (hi === null || hi === undefined) return `${field} at least ${word(lo)}`;
    return `${field} between ${word(lo)} and ${word(hi)}`;
  }
  return `${field} is ${word(side)}`;
}

/** The entry's value in plain words. */
export function entryDetail(e: RawFoldEntry): string {
  if (e.kind === 'selection') {
    const c = e.clause;
    if (!c) return 'a selection';
    if (c.kind === 'cell') {
      // D30: the compound cell — both sides, joined the way a person says it
      const pair = c.value as readonly [unknown, unknown] | null;
      if (pair === null || c.fields === undefined) return `${c.field} cell cleared`;
      return `${cellSideWords(c.fields[0], pair[0])} and ${cellSideWords(c.fields[1], pair[1])}`;
    }
    if (c.kind === 'point') return `${c.field} is ${word(c.value)}`;
    if (c.kind === 'match') {
      // SET-1: the list in words, its polarity as a word
      const v = c.value as { readonly values?: readonly unknown[]; readonly exclude?: boolean } | null;
      if (v === null || v === undefined) return `${c.field} match cleared`;
      // the same words the chips and the commit log use — one vocabulary for one clause
      return `${c.field} ${v.exclude === true ? 'not in' : 'in'} {${(v.values ?? []).map(word).join(', ')}}`;
    }
    if (c.value === null) return `${c.field} filter cleared`;
    const range = c.value as readonly [unknown, unknown];
    const [lo, hi] = range;
    // FILTER-1: a half-open bound (lo or hi absent) reads as "at least"/"up
    // to", never the generic "between — and X" — both wire-absence spellings
    // (a real bound is `null`; `undefined` guards a stray poll shape).
    const loOpen = lo === null || lo === undefined;
    const hiOpen = hi === null || hi === undefined;
    if (loOpen && !hiOpen) return `${c.field} up to ${word(hi)}`;
    if (hiOpen && !loOpen) return `${c.field} at least ${word(lo)}`;
    return `${c.field} between ${word(lo)} and ${word(hi)}`;
  }
  if (e.kind === 'encoding') return `${e.channel ?? '?'} axis shows ${word(e.value)}`;
  if (e.kind === 'link') {
    // layer 4: an edited edge — the edge as declared, in the matrix's own words
    const l = e.link;
    return l ? `${l.source} ${l.kind} → ${l.target}: ${l.response}` : 'a link edit';
  }
  // analysis: a declared-test entry lands under the pValue analog — surface p when
  // numeric, rounded to 2 significant digits (plain words, not a float dump)
  if (e.field === 'pValue' && typeof e.value === 'number') return `test ran (p = ${Number(e.value.toPrecision(2))})`;
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
