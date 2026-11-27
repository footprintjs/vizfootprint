import type { ResolvedDomain } from './domains.js';

/**
 * `[earliest, latest]` over the dates in the cells, compared as INSTANTS and
 * answered in the cells' own spelling.
 *
 * WHY INSTANTS AND NOT TEXT. The fold used to compare the strings, which is
 * chronological order only while every cell is spelled the same way. A column
 * that mixes spellings is not: `'2026-04-01T23:00-05:00'` sorts before
 * `'2026-04-02T01:00Z'` as text and is three hours AFTER it, and a date with a
 * time and no zone is read in the reader's own zone, which no text order
 * knows. A chart places a date by `Date.parse`, so a span folded by text could
 * leave a row the chart draws outside its own axis. One reading for both: the
 * fold compares what `Date.parse` makes of each cell, the same call the charts
 * place it by (`epochOf`, `vizfootprint-ui/primitives/scales.ts`).
 *
 * THE ANSWER IS STILL THE CELL AS WRITTEN: the earliest and the latest cell,
 * untouched. So a column folds to the pair it always did wherever text order
 * was already chronological. It was not at the edges even in one spelling: a
 * clock time inside a daylight-saving gap, a day that does not exist
 * (`2026-02-30`, which `Date.parse` rolls forward), a month 13 (no date at all),
 * a year before zero. There the fold now agrees with the chart. On equal
 * instants the first one read is kept.
 *
 * THE READING IS `Date.parse`'s, with what that brings: a date-time with no
 * zone is read in the zone of the process that folds (so a fold and a chart
 * agree when they run in one process, which is how a host folds), and text
 * that is not ISO-8601 is read as a date wherever the engine reads it.
 *
 * A `Date` OBJECT counts, as its own ISO spelling. The engines hand ISO strings
 * for a date column, but a def can be written in TypeScript and an adapter can
 * answer with real Dates — and a dropped Date is worse than no domain: mixed
 * with strings it leaves a domain that EXCLUDES rows the frame is drawing. An
 * invalid Date is an absence like any other, and so is a string no date can be
 * read from: it has no instant to compare, and a chart cannot place it either.
 */
export function temporal(cells: readonly unknown[]): ResolvedDomain | undefined {
  let lo: { readonly at: number; readonly as: string } | undefined;
  let hi: { readonly at: number; readonly as: string } | undefined;
  for (const cell of cells) {
    const when = instantOf(cell);
    if (when === undefined) continue;
    if (lo === undefined || when.at < lo.at) lo = when;
    if (hi === undefined || when.at > hi.at) hi = when;
  }
  return lo === undefined || hi === undefined ? undefined : { scale: 'temporal', domain: [lo.as, hi.as] };
}

/** One cell as a date the fold can compare: the instant it is, and the spelling it is answered in. `undefined` for one no date can be read from. */
function instantOf(cell: unknown): { readonly at: number; readonly as: string } | undefined {
  const as = typeof cell === 'string' ? cell : cell instanceof Date && Number.isFinite(cell.getTime()) ? cell.toISOString() : undefined;
  if (as === undefined) return undefined;
  const at = Date.parse(as);
  return Number.isFinite(at) ? { at, as } : undefined;
}
