/**
 * Export is a READ that carries its ADDRESS.
 *
 * Two laws govern this file, and they are the reason it is not a dispatch door:
 *
 * **Law A — copy and export are reads, not acts.** Nothing lands on the log.
 * Downloading the sheet does not change what the dashboard says, so there is no
 * act to record and no commit to cite. What leaves the system carries its
 * address instead: an `ExportReceipt` naming the table, the view, the version,
 * the cursor, the sort, the columns, the count, the range actually exported,
 * whether it truncated, and the clauses that reached the view. A reader holding
 * the receipt can come back to the exact state the file was read at. The cursor
 * is the address; the clauses are the courtesy copy.
 *
 * **Law B — the walk and the receipt live in the LIBRARY.** A consumer that
 * re-derived the pagination, the quoting and the receipt would be a second
 * author of the same law (`../../PACKAGING.md`, Law 3: a subpath is only for a
 * symbol whose PRESENCE changes what the barrel costs — a pure formatter does
 * not, so this rides the `session` barrel). The UI's whole job is to place a
 * form beside the grid and hand the files somewhere.
 *
 * **Two versions never share a file.** A version, a cursor or the PROJECTION
 * that changes between pages refuses the WHOLE export (`reason: 'moved'`) — the
 * same all-or-nothing discipline `README.md`, Law 1 states for acts. Half of one
 * version stapled to half of the next is a file no receipt can address. Two more
 * words refuse it for the same reason (`ExportWalkRefusal`): a page answered at
 * an offset nobody asked for cannot be walked in order (`'misaligned'`), and one
 * answered short of the count it promised cannot be walked to the end
 * (`'short'`).
 *
 * **No cell may abort an export.** `cellString` names every value shape a row can
 * hold and throws for none — an invalid `Date`, a nested `BigInt` and a circular
 * value are each a sentence in a cell, never a rejected promise upstream.
 */
import type { Row, SortSpec } from '../data/index.js';
import type { InteractionSession } from './session.js';
import type { ReachingClause } from './types.js';

/** The two delimited text formats a spreadsheet opens without being asked twice. */
export type ExportFormat = 'csv' | 'tsv';

/** How many rows one page of the walk asks for. Pages exist so a 200k-row export is 20 windows, not one. */
export const EXPORT_PAGE_ROWS = 10_000;

/**
 * The most rows one export may carry.
 *
 * WHY this number: it is a POLICY, not a measurement. A 200k-row × ~10-column
 * file is tens of megabytes of text, which is the practical size for a single
 * in-memory string handed to a browser download. Past that the honest move is
 * not a bigger string, it is a different door (a server-side export). The
 * receipt SAYS when it truncated — omit, never deny.
 */
export const EXPORT_ROW_CEILING = 200_000;

/** The delimiter each format separates fields with. */
const DELIMITER: Record<ExportFormat, string> = { csv: ',', tsv: '\t' };

/**
 * One cell as text. Never locale-formatted: a receipt is read by another
 * program as often as by a person, and `toLocaleString` would make the same
 * number two different files on two different machines.
 */
export function cellString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  // an INVALID date is a value the row holds, so it is named rather than blanked —
  // and `toISOString()` on one throws `Invalid time value`, which would abort the
  // whole export over a single cell. No cell may do that (see below).
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  // an object or array rides as JSON so a cell is never "[object Object]".
  //
  // WHY the guard and not a bare `JSON.stringify`: it THROWS on a circular value
  // and on a nested BigInt, and one throw here escapes `tabularText`,
  // `exportWindows` and the consumer's `await` alike — a form left frozen on a
  // rejected promise over one odd cell. A nested BigInt still becomes data (its
  // digits, as text); anything left names itself.
  //
  // JSON.stringify answers undefined for a function or a symbol; String() names those.
  try {
    return JSON.stringify(value, (_key, held: unknown) => (typeof held === 'bigint' ? String(held) : held)) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Quote one field when it holds something the delimiter cannot survive.
 *
 * CSV: exactly RFC 4180 — quote a field containing the delimiter, a double
 * quote, CR or LF, and double the inner quotes.
 *
 * TSV: the SAME rule against the tab. Excel accepts quoted TSV, so there is no
 * reason to invent a second escaping story for the second format.
 *
 * NOT guarded, and deliberately: a cell that begins `=`, `+`, `-` or `@` rides
 * through exactly as it reads. Some spreadsheets EVALUATE such a cell on open
 * (the "CSV injection" class), and that is the READER's concern — prefixing a
 * quote or a tab would change a person's data to protect their spreadsheet, and
 * a body that no longer matches the rows its receipt addresses is the worse lie.
 * Said out loud in `README.md` so a reader can decide, and pinned by
 * `export.test.ts` so nobody turns this into a mangler later.
 */
function quoteField(text: string, format: ExportFormat): string {
  const delimiter = DELIMITER[format];
  const needs = text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r');
  return needs ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The header line plus one line per row, in the column order given.
 *
 * WHY '\n' and not RFC 4180's CRLF: every spreadsheet and every parser reads LF
 * line ends, and this file is a courtesy copy for a person to open — not a wire
 * protocol whose bytes another implementation must match.
 */
export function tabularText(columns: readonly string[], rows: readonly Row[], format: ExportFormat): string {
  const delimiter = DELIMITER[format];
  const line = (cells: readonly string[]): string => cells.map((c) => quoteField(c, format)).join(delimiter);
  const header = line(columns);
  const body = rows.map((row) => line(columns.map((c) => cellString(row[c]))));
  return [header, ...body].join('\n');
}

/**
 * The structural shape the walk needs from one window — satisfied by
 * `ViewQueryResult`'s `ok: true` arm, and by any mirror of it a host builds.
 *
 * `clauses` is OPTIONAL because a mirror over a door (the `vizfootprint-ui`
 * sheet port speaking to an HTTP endpoint) may not carry them. The receipt then
 * says the clauses were empty — which is the honest reading of "this window did
 * not tell me", since a receipt names what it KNOWS.
 */
export interface ExportWindow {
  readonly ok: true;
  readonly columns: readonly string[];
  readonly rows: readonly Row[];
  readonly rowIds: readonly string[];
  readonly positional: boolean;
  readonly key?: string;
  readonly count: number;
  readonly start: number;
  readonly version: string | null;
  readonly cursor: string | null;
  readonly clauses?: readonly ReachingClause[];
}

/**
 * The three words the WALK itself mints, when the door refused nothing but the
 * pages cannot be made into one file. A door's own code (`ViewQueryRefusal` over
 * a session, `unreachable` over the sheet's HTTP port) rides through unchanged
 * beside them, which is why `reason` stays a `string` — this union names what
 * THIS file can be the author of.
 */
export type ExportWalkRefusal =
  /** A version, a cursor or the projection changed between pages: two shapes never share a file. */
  | 'moved'
  /** A page answered no rows while rows remained: the end the count promised cannot be reached. */
  | 'short'
  /** A page answered a window starting somewhere other than where it was asked: the rows cannot be walked in order. */
  | 'misaligned';

/** A window that was refused: the code to branch on, beside the sentence to show. */
export interface ExportRefusal {
  readonly ok: false;
  /** The door's own code, or an `ExportWalkRefusal` when the walk itself refused. */
  readonly reason: string;
  readonly rejected: string;
}

/** How the walk asks for one page. The consumer adapts whichever door it has. */
export type ExportAsk = (offset: number, limit: number) => Promise<ExportWindow | ExportRefusal>;

/**
 * The address of what left the system. Written beside the body, never instead
 * of it: the body is the data, the receipt is where the data was read.
 */
export interface ExportReceipt {
  readonly kind: 'vizfootprint-export';
  readonly table: string;
  readonly viewId?: string;
  readonly version: string | null;
  readonly cursor: string | null;
  readonly sort: readonly SortSpec[];
  readonly columns: readonly string[];
  readonly key?: string;
  readonly positional: boolean;
  /** How many rows the view holds — not how many were exported. */
  readonly count: number;
  /** The range that actually left: always from the top, however far it reached. */
  readonly exported: { readonly start: 0; readonly rows: number };
  /** True when the count exceeded the ceiling, so the body holds the first `ceiling` rows. */
  readonly truncated: boolean;
  readonly ceiling: number;
  /** The clauses that reached the view — empty when the window carried none. */
  readonly clauses: readonly ReachingClause[];
  /** When the export was taken. Optional so a receipt from a host with no clock is still a receipt. */
  readonly at?: string;
}

export interface ExportOptions {
  readonly table: string;
  readonly viewId?: string;
  readonly sort?: readonly SortSpec[];
  /**
   * The projection to ASK for — read by `exportFromSession` only. `exportWindows`
   * ignores it, because there the `ask` already carries the request it was built
   * with; and no receipt is written from it either way. The receipt's `columns`
   * are the ENGINE's answer, which may hold a declared key this never named.
   */
  readonly columns?: readonly string[];
  readonly format: ExportFormat;
  readonly pageRows?: number;
  readonly rowCeiling?: number;
  /** Injected so a test can pin `receipt.at`. */
  readonly now?: () => Date;
}

export type ExportResult =
  | {
      readonly ok: true;
      readonly body: string;
      readonly receipt: ExportReceipt;
      readonly names: { readonly body: string; readonly receipt: string };
    }
  | { readonly ok: false; readonly reason: string; readonly rejected: string };

/** A missing version or cursor is a real answer ("this table has none"), so it is named, not blanked. */
const label = (value: string | null): string => value ?? 'none';

/**
 * A count is a door's word. The walk needs a whole, non-negative number of rows,
 * and the receipt needs one that survives the trip through JSON — `NaN` would be
 * written as `null`, a receipt claiming no count at all.
 */
const rowCount = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);

/**
 * Did the ground move under the walk? Compared against the FIRST page, because
 * that is the version, cursor and projection the receipt will claim.
 */
function movedSentence(first: ExportWindow, page: ExportWindow): string | null {
  if (page.version !== first.version) {
    return `the table moved while exporting (version ${label(first.version)} → ${label(page.version)}) — export again`;
  }
  if (page.cursor !== first.cursor) {
    return `the table moved while exporting (cursor ${label(first.cursor)} → ${label(page.cursor)}) — export again`;
  }
  // the PROJECTION is part of the ground: every line of the body is written in
  // page 1's columns, so a page answering different ones would ride into the file
  // as blank cells with its own column silently dropped — under a receipt naming
  // the columns of page 1. Same law, same refusal.
  if (page.columns.length !== first.columns.length || page.columns.some((name, at) => name !== first.columns[at])) {
    return `the projection changed while exporting (${first.columns.join(', ')} → ${page.columns.join(', ')}) — export again`;
  }
  return null;
}

/**
 * Did the door answer the window that was ASKED for? `start` is the door's own
 * word for where its rows begin, and every offset the walk computes is true only
 * while the two agree: a door that ignores `offset` would otherwise be walked
 * into a file of one page repeated, under a receipt claiming the whole range.
 */
function misalignedSentence(page: ExportWindow, offset: number): string | null {
  if (page.start === offset) return null;
  return `the table answered a window starting at row ${page.start} where row ${offset} was asked for — the rows cannot be walked in order`;
}

/**
 * Walk pages of rows into one delimited body, and write the receipt that
 * addresses them.
 *
 * A refusal on ANY page refuses the whole export, and so does a version or
 * cursor that changed between pages. There is no partial export.
 */
export async function exportWindows(ask: ExportAsk, opts: ExportOptions): Promise<ExportResult> {
  const pageRows = Math.max(1, Math.trunc(opts.pageRows ?? EXPORT_PAGE_ROWS));
  const ceiling = Math.max(0, Math.trunc(opts.rowCeiling ?? EXPORT_ROW_CEILING));

  const first = await ask(0, pageRows);
  if (!first.ok) return { ok: false, reason: first.reason, rejected: first.rejected };
  const askedElsewhere = misalignedSentence(first, 0);
  if (askedElsewhere !== null) return { ok: false, reason: 'misaligned', rejected: askedElsewhere };

  const count = rowCount(first.count);
  // the ceiling bounds the WALK, never the count: the receipt keeps saying how many rows the view holds
  const target = Math.min(count, ceiling);
  const rows: Row[] = first.rows.slice(0, target);

  while (rows.length < target) {
    const offset = rows.length;
    const page = await ask(offset, Math.min(pageRows, target - offset));
    if (!page.ok) return { ok: false, reason: page.reason, rejected: page.rejected };
    const moved = movedSentence(first, page);
    if (moved !== null) return { ok: false, reason: 'moved', rejected: moved };
    const elsewhere = misalignedSentence(page, offset);
    if (elsewhere !== null) return { ok: false, reason: 'misaligned', rejected: elsewhere };
    if (page.rows.length === 0) {
      // a port that answers no rows where rows were promised cannot be walked to the end;
      // refusing says so, where a short body would look like a complete one
      return { ok: false, reason: 'short', rejected: `the table answered no rows at offset ${offset} while ${target - offset} of ${count} remained — export again` };
    }
    rows.push(...page.rows.slice(0, target - offset));
  }

  // the engine's projection, key included — never the columns ASKED for, which may have left the key out
  const columns = first.columns;
  const receipt: ExportReceipt = {
    kind: 'vizfootprint-export',
    table: opts.table,
    ...(opts.viewId !== undefined ? { viewId: opts.viewId } : {}),
    version: first.version,
    cursor: first.cursor,
    sort: opts.sort ?? [],
    columns,
    ...(first.key !== undefined ? { key: first.key } : {}),
    positional: first.positional,
    count,
    exported: { start: 0, rows: rows.length },
    truncated: count > ceiling,
    ceiling,
    clauses: first.clauses ?? [],
    at: (opts.now ?? (() => new Date()))().toISOString(),
  };

  return {
    ok: true,
    body: tabularText(columns, rows, opts.format),
    receipt,
    names: { body: `${opts.table}.${opts.format}`, receipt: `${opts.table}.receipt.json` },
  };
}

/**
 * The same walk over a live session's `viewQuery` — the one-call door a host
 * reaches for.
 *
 * WHY the undefined fields ride explicitly: on `ViewQuery` an absent field and
 * an `undefined` one mean the same thing (no view / the columns visible at the
 * cursor / no sort), so passing them straight through keeps this a single
 * expression instead of four conditional spreads.
 */
export function exportFromSession(session: Pick<InteractionSession, 'viewQuery'>, opts: ExportOptions): Promise<ExportResult> {
  return exportWindows(
    (offset, limit) =>
      session.viewQuery({
        table: opts.table,
        viewId: opts.viewId,
        columns: opts.columns,
        sort: opts.sort,
        offset,
        limit,
      }),
    opts,
  );
}
