/**
 * TAKE THESE ROWS WITH YOU — the door beside the grid that is NOT an act.
 *
 * Adding a column lands a commit. Downloading the rows lands nothing: a copy is
 * a READ, so there is no cause to stamp and no record to write, and `readOnly`
 * on the sheet does not close this door — Present mode is reading, and this is
 * reading. What leaves instead carries its ADDRESS: beside the CSV goes a
 * receipt naming the table, the view, the version, the cursor, the sort, the
 * columns, the count, how much actually left and whether it truncated. A person
 * holding those two files can come back to the exact state they were read at.
 *
 * It computes NOTHING. The walk, the paging, the RFC 4180 quoting, the ceiling
 * and the receipt all live in the library (`vizfootprint/session`'s
 * `exportWindows` — see `src/session/README.md`, "Export is a read that carries
 * its address"). What this file owns is: which format is chosen, whether a walk
 * is in flight, where the files go, and the last sentence said.
 *
 * The one number it needs before a click is the COUNT, so the offer can say how
 * many rows a person is about to take. That is one probe window on mount, and
 * the same `ExportAsk` the walk itself uses.
 */
import { useEffect, useId, useState, type JSX } from 'react';
import { EXPORT_ROW_CEILING, exportWindows, type ExportAsk, type ExportFormat, type ExportRefusal, type ExportWindow } from 'vizfootprint/session';
// the clipboard is a door two components share, so it is neither one's to own (`./clipboard.ts`)
import { clipboardRefusal, writeClipboard } from './clipboard.js';
import { threwSentence } from './sessionSheetData.js';
import type { SheetData, SheetWindowRequest, SortSpec } from './types.js';

/** One file handed to the host: what to call it, what it is, and its text. */
export interface ExportFile {
  readonly name: string;
  readonly type: string;
  readonly text: string;
}

export interface ExportRowsProps {
  /** The same port the grid reads. The export walks it — it never reaches past it. */
  readonly data: SheetData;
  /** The table these rows are from. It rides onto the receipt, so a reader knows what they hold. */
  readonly table: string;
  /** Whose eyes: the consumer view, if these rows are one view's window. */
  readonly viewId?: string;
  /** The projection to export. Default: whatever the port shows, key included. */
  readonly columns?: readonly string[];
  /** The order to export in — the same sort the grid is showing. It rides onto the receipt. */
  readonly sort?: readonly SortSpec[];
  /** Default `EXPORT_ROW_CEILING` (200,000) — the library's policy number. */
  readonly rowCeiling?: number;
  /** Where the files go. Default: the browser saves them. A host (or a test) may take them instead. */
  readonly onDeliver?: (files: readonly ExportFile[]) => void;
  readonly className?: string;
}

/** The mime type each format is saved as — what makes a double-click open a spreadsheet. */
const MIME: Record<ExportFormat, string> = { csv: 'text/csv;charset=utf-8', tsv: 'text/tab-separated-values;charset=utf-8' };

/**
 * The smallest window that answers a count.
 *
 * WHY one row and not zero: `limit: 0` is legal in the library (the memory
 * provider pins it), but this probe rides the PORT — and a door on the other
 * side of HTTP may well refuse a window that asks for no rows. One row is the
 * smallest window EVERY door answers, and the count comes back the same.
 */
export const EXPORT_ROWS_PROBE = 1;

export const EXPORT_ROWS_READING = 'reading how many rows there are…';
export const EXPORT_ROWS_HINT = 'A copy is a read: nothing lands on the log. What leaves carries its address instead — the receipt names the table, the version and the cursor these rows were read at.';

/**
 * Grouped digits, pinned to one locale.
 *
 * WHY grouping here and never in a cell: this is a SENTENCE, read by a person,
 * where "1,285,614" is legible and "1285614" is not. A cell is data, read by
 * another program as often as by a person, and `cellString` formats none of it.
 * Pinned to en-US so the sentence a test asserts is the sentence every browser
 * shows.
 */
const grouped = (value: number): string => new Intl.NumberFormat('en-US').format(value);

/** A count and its noun — one owner, so no sentence in this file ever says "1 rows". */
const rowsPhrase = (count: number): string => `${grouped(count)} ${count === 1 ? 'row' : 'rows'}`;

/** What a person is about to take, before they take it — the count, the ceiling if it bites, and where it was read. */
export function exportRowsOffer(count: number, ceiling: number, format: ExportFormat, version: string | null): string {
  // omit, never deny: a truncated export SAYS which rows it is, in the offer and again on the receipt
  const rows = count > ceiling ? `the first ${grouped(ceiling)} of ${rowsPhrase(count)}` : rowsPhrase(count);
  const at = version !== null ? `as they read at version ${version}` : 'as they read at this cursor';
  return `Download ${rows} as ${format.toUpperCase()}, ${at} — with the receipt that names the cursor`;
}

/** What left, by name — both files, because the receipt is half of what was delivered. */
export function exportRowsDelivered(names: { readonly body: string; readonly receipt: string }, rows: number): string {
  return `downloaded ${names.body} and ${names.receipt} (${rowsPhrase(rows)})`;
}

/** What was put on the clipboard. TSV, because that is what a spreadsheet accepts from a paste. */
export function exportRowsCopied(rows: number): string {
  return `copied ${rowsPhrase(rows)} as TSV`;
}

/**
 * The grid's port as the library's walk asks for it.
 *
 * A `SheetWindow` already IS an `ExportWindow` (the port mirrors
 * `ViewQueryResult`, clauses included), so this is a refusal translation and a
 * throw guard, never a second reading of the answer.
 */
export function sheetAsk(data: SheetData, request: Omit<SheetWindowRequest, 'offset' | 'limit'>): ExportAsk {
  return async (offset: number, limit: number): Promise<ExportWindow | ExportRefusal> => {
    try {
      const answer = await data.rows({ ...request, offset, limit });
      return answer.ok ? answer : { ok: false, reason: answer.reason, rejected: answer.rejected };
    } catch (error: unknown) {
      // a port that throws is a refusal with what it threw — never a form frozen on a rejected promise
      return { ok: false, reason: 'unreachable', rejected: threwSentence(error) };
    }
  };
}

/**
 * The default delivery: the browser saves both files.
 *
 * Guarded twice, because neither guard is paranoia — a server render has no
 * anchor to click, and an environment with no object URLs cannot make one. In
 * either case nothing is saved and nothing pretends otherwise; a host that
 * needs another delivery passes `onDeliver`.
 */
export function downloadFiles(files: readonly ExportFile[]): void {
  if (typeof document === 'undefined') return;
  if (typeof URL.createObjectURL !== 'function') return;
  for (const file of files) {
    const href = URL.createObjectURL(new Blob([file.text], { type: file.type }));
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = file.name; // the attribute that turns a click into a save
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  }
}

export function ExportRows({ data, table, viewId, columns, sort, rowCeiling, onDeliver, className }: ExportRowsProps): JSX.Element {
  const formatId = useId();
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [busy, setBusy] = useState<'download' | 'copy' | null>(null);
  /** The probe window: the count and version the offer is spoken from, or the port's refusal. */
  const [probe, setProbe] = useState<ExportWindow | ExportRefusal | null>(null);
  const [said, setSaid] = useState<{ readonly refused: boolean; readonly words: string } | null>(null);

  const request = { ...(viewId !== undefined ? { viewId } : {}), ...(columns !== undefined ? { columns } : {}), ...(sort !== undefined ? { sort } : {}) };
  // WHY a serialized key: `columns` and `sort` are fresh arrays on every render of
  // the host, so depending on them directly would re-probe forever. The key changes
  // when the REQUEST changes, which is the only time the count can differ.
  const requestKey = JSON.stringify(request);

  useEffect(() => {
    let live = true;
    // the offer's count is a COURTESY read; the receipt is the record, and it is
    // written from the walk's own first page — so a count that has since moved
    // makes the sentence stale, never the file wrong
    void sheetAsk(data, request)(0, EXPORT_ROWS_PROBE).then((answer) => {
      if (live) setProbe(answer);
    });
    return (): void => {
      live = false;
    };
    // `request` is captured by value and `requestKey` is exactly its value — a
    // dependency on the object itself would re-probe on every render of the host
  }, [data, requestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const walk = (chosen: ExportFormat): ReturnType<typeof exportWindows> =>
    // `columns` rides on the ASK (it is the port's request); the receipt takes the
    // columns from the window the engine answered, which is the projection that
    // actually left — key included, whether or not it was asked for.
    exportWindows(sheetAsk(data, request), { table, viewId, sort, format: chosen, rowCeiling });

  const download = async (): Promise<void> => {
    setBusy('download');
    setSaid(null); // the last walk's sentence describes the last walk, not this one
    const res = await walk(format);
    if (res.ok) {
      const files: readonly ExportFile[] = [
        { name: res.names.body, type: MIME[format], text: res.body },
        { name: res.names.receipt, type: 'application/json', text: JSON.stringify(res.receipt, null, 2) },
      ];
      (onDeliver ?? downloadFiles)(files);
      setSaid({ refused: false, words: exportRowsDelivered(res.names, res.receipt.exported.rows) });
    } else {
      setSaid({ refused: true, words: res.rejected });
    }
    setBusy(null);
  };

  const copy = async (): Promise<void> => {
    setBusy('copy');
    setSaid(null);
    // TSV whatever the download's format is: a paste into a spreadsheet is read by tabs
    const res = await walk('tsv');
    if (res.ok) {
      try {
        await writeClipboard(res.body);
        setSaid({ refused: false, words: exportRowsCopied(res.receipt.exported.rows) });
      } catch (error: unknown) {
        setSaid({ refused: true, words: clipboardRefusal(error) });
      }
    } else {
      setSaid({ refused: true, words: res.rejected });
    }
    setBusy(null);
  };

  const ceiling = rowCeiling ?? EXPORT_ROW_CEILING;
  const offer = probe === null ? EXPORT_ROWS_READING : probe.ok ? exportRowsOffer(probe.count, ceiling, format, probe.version) : probe.rejected;
  const known = probe?.ok === true;

  return (
    <div className={`vzf vzf-export${className !== undefined ? ' ' + className : ''}`} data-vzf="export-rows">
      <div className="vzf-export-row">
        <label className="vzf-export-field" htmlFor={formatId}>
          <span className="vzf-export-label">as</span>
          <select id={formatId} className="vzf-input vzf-export-format" value={format} aria-label="the file format" onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            <option value="csv">CSV</option>
            <option value="tsv">TSV</option>
          </select>
        </label>
        <button type="button" className="vzf-btn vzf-btn-primary" data-vzf="export-download" disabled={!known || busy !== null} onClick={() => void download()}>
          {busy === 'download' ? 'downloading…' : 'Download'}
        </button>
        <button type="button" className="vzf-btn" data-vzf="export-copy" disabled={!known || busy !== null} onClick={() => void copy()}>
          {busy === 'copy' ? 'copying…' : 'Copy'}
        </button>
      </div>
      {/*
        A LIVE region, unlike the hint below it: this sentence starts as
        `EXPORT_ROWS_READING` and is then replaced — by the count a person is
        about to take, or by the port's refusal. A reader who is not watching the
        strip would otherwise hear "reading how many rows there are…" and never
        the answer. `said` carries what LEFT; this carries what would leave.
      */}
      <p className="vzf-export-offer" data-vzf="export-offer" role="status" aria-live="polite">
        {offer}
      </p>
      <p className="vzf-export-hint">{EXPORT_ROWS_HINT}</p>
      <p className={`vzf-export-said${said?.refused === true ? ' vzf-export-refused' : ''}`} role="status" aria-live="polite">
        {said === null ? '' : said.words}
      </p>
    </div>
  );
}
