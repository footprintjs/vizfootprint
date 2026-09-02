/**
 * Staleness, DERIVED at read, never stored: a slot whose basis no longer
 * matches what is on screen renders as `stale` and names what moved. A
 * derived slot is recomputed from the encoding surface and can never go
 * stale. Shown, never hidden, never rewritten.
 */
import type { ProseRecord, ProseSlot, ProseStatus, ProseSurface } from './types.js';

export interface ProseWorldNow {
  /** The view's bindings on screen (effective under the link graph). */
  readonly encodings: Readonly<Record<string, string>>;
  /** The live selections, viewId → clause value as JSON-safe data. */
  readonly filters: Readonly<Record<string, unknown>>;
  /** The columns visible on the branch. */
  readonly columns: ReadonlySet<string>;
  /** The analyses declared. */
  readonly analyses: ReadonlySet<string>;
  /** The view's surface, for a derived slot. */
  readonly surface?: ProseSurface;
}

/** JSON with object keys sorted at every level, so insertion order never makes an unchanged world read as changed. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  return v;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const isEmptyClause = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v as object).length === 0;
/** A filters map with its empty clauses dropped: `{ map: {} }` says the same thing as `{}` — no selection on the map — so the two must compare equal. */
function liveClauses(filters: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => !isEmptyClause(v)));
}

export function proseStatus(slot: ProseSlot, record: ProseRecord, now: ProseWorldNow): ProseStatus {
  if (record.author.kind === 'derived') {
    return { slot, record, status: 'derived', changed: [], text: constructionLine(now.surface, now.encodings), refs: [] };
  }
  const changed: string[] = [];
  const b = record.basis;
  if (b !== undefined) {
    if (b.encodings !== undefined && !same(b.encodings, now.encodings)) changed.push('encodings');
    // a basis that states `filters` was written under exactly those selections: in a crossfiltered dashboard every
    // selection moves the data under every chart, so the whole live set must match. Omit `filters` for words that
    // do not depend on selections at all.
    if (b.filters !== undefined && !same(liveClauses(b.filters), liveClauses(now.filters))) changed.push('filters');
    if (b.columns !== undefined && b.columns.some((c) => !now.columns.has(c))) changed.push('columns');
    if (b.analysisId !== undefined && !now.analyses.has(b.analysisId)) changed.push('analysis');
  }
  return { slot, record, status: changed.length > 0 ? 'stale' : 'current', changed, text: record.text ?? '', refs: record.refs ?? [] };
}

/** The construction line the library writes itself: what the chart IS, from its surface and bindings — level 1, always fresh. */
export function constructionLine(surface: ProseSurface | undefined, encodings: Readonly<Record<string, string>>): string {
  if (surface === undefined) return '';
  const bound = surface.channels.filter((ch) => encodings[ch] !== undefined);
  const parts = bound.map((ch) => `${encodings[ch]} on ${ch}`);
  const kind = `a ${surface.chartKind}`;
  return parts.length === 0 ? `${kind} with nothing bound` : `${kind} with ${parts.join(', ')}`;
}
