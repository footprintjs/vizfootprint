import { isPairKind, neighbourhoodValueFromWire } from 'vizfootprint/data';
import type { NeighbourhoodValueBody } from 'vizfootprint/data';
import type { CommitView } from '../adapter/types.js';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Do this kind's plain words already NAME the columns they speak about?
 *
 * True for the two-column kinds: a cell reads "price 100 – 150 and category =
 * Formal" and a neighbourhood reads "Salmonellosis and its 12 neighbours", so
 * a chip that prefixed the joint label ("price × category", "source ↔ target")
 * would say everything twice — or, worse, imply the label is a column. Every
 * other kind needs its field said first.
 *
 * Exported because BOTH panels that render a value ask it — the commit log and
 * the selection chips — and a rule with two spellings is a rule with two
 * answers.
 */
export function isSelfDescribing(kind: CommitView['kind']): boolean {
  return isPairKind(kind); // the library's own array of the two-column kinds, never a second spelling of it
}

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

/** One scalar in plain words: `∅` for an absent value, 2dp for a fractional number, the value itself otherwise. */
function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(round2(v));
  return String(v);
}

/**
 * A neighbourhood's plain words: the SEED, how many nodes the walk found
 * beside it, and the question that found them — "Salmonellosis and its 12
 * neighbours (ego, 1 hop)".
 *
 * WHY the count is counted and not read off `hops`: `hops` is the question and
 * `ids` is the answer, and this line reports the answer. The seed itself rides
 * in the recorded set, so it is dropped from the count — a reader asked about
 * one node and wants to hear how many OTHERS came with it.
 *
 * TWO honest elses for the walks protocol 1.4 added. `hops: null` is a path
 * that found NO PATH, so it reads "no path" rather than a hop count nobody
 * walked. And "its N neighbours" is a claim only an EGO walk earns: the far
 * end of a path and the rim of a component are not the seed's neighbours, so
 * every other derivation reports "N more nodes" — the same count, without the
 * adjacency it cannot promise.
 */
function formatNeighbourhoodWords(body: NeighbourhoodValueBody): string {
  const others = body.ids.filter((id) => id !== body.seed).length;
  const far = body.hops === null ? 'no path' : `${body.hops} hop${body.hops === 1 ? '' : 's'}`;
  const found = body.derivation === 'ego' ? (others === 1 ? 'its 1 neighbour' : `its ${others} neighbours`) : others === 1 ? '1 more node' : `${others} more nodes`;
  return `${formatScalar(body.seed)} and ${found} (${body.derivation}, ${far})`;
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
 * opposite bound. D30: a CELL commit reads as its two sides joined with
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
  if (c.kind === 'match') {
    // SET-1: the list in braces, its polarity as a word — "in {A, B}" / "not in {A, B}"
    const v = c.value as { readonly values?: readonly unknown[]; readonly exclude?: boolean } | null | undefined;
    if (v === null || v === undefined) return '(cleared)';
    return `${v.exclude === true ? 'not in' : 'in'} {${(v.values ?? []).map(formatScalar).join(', ')}}`;
  }
  if (c.kind === 'neighbourhood') {
    // protocol 1.3: the walk reads as its SEED and what came with it, read through the
    // library's own door — a body carrying no id list is not a walk to report, so it reads
    // cleared (the library's fallback for a wire value it cannot narrow on), and the seed,
    // derivation and hop count of a body that came from another build are answered there.
    const walk = neighbourhoodValueFromWire(c.value);
    return walk === null ? '(cleared)' : formatNeighbourhoodWords(walk);
  }
  if (isLinkValue(c.value)) return `${c.value.source} ${c.value.kind} → ${c.value.target}: ${c.value.response}`; // layer 4: an edited edge
  return formatScalar(c.value);
}

/** A `link` commit's value: the edge as a LinkDecl (null = un-declared, rendered as ∅ upstream). */
function isLinkValue(v: unknown): v is { source: string; kind: string; target: string; response: string } {
  return typeof v === 'object' && v !== null && typeof (v as { source?: unknown }).source === 'string' && typeof (v as { target?: unknown }).target === 'string' && typeof (v as { response?: unknown }).response === 'string';
}

