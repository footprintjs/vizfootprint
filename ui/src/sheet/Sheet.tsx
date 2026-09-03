/**
 * THE SHEET — a read-only grid over a data session, virtualized in the DOM.
 *
 * The rows on screen are one window the engine answered (`SheetData.rows`),
 * never a copy of the table: the sheet asks for the rows it can show and the
 * engine says how many there are in all. Rows the incoming clauses drop are
 * already absent — the engine filtered them, the sheet did not hide them —
 * and the sheet's OWN clause is excluded by the engine, so selecting a row
 * never makes the sheet's other rows disappear.
 *
 * THE CAPPED SCROLL CANVAS. At 1M rows a true canvas would be 28M pixels tall
 * and no browser will lay that out, so the canvas is capped (`canvasMax`) and
 * the scrollbar becomes a shorter ruler over the same rows. The map is between
 * what can actually be scrolled and what can actually be shown:
 *
 *     scrollTop ∈ [0, canvasHeight − bodyHeight]  ↔  first row ∈ [0, count − visibleRows]
 *
 * Both ends are exact, so the LAST row is always reachable and a row → scroll →
 * row round trip returns the row it started from. The rows layer is drawn from
 * the viewport's top edge (scrolling is row-quantized by construction) and is
 * never allowed to reach past the canvas, which would inflate the scroll height
 * and invent space below the last row.
 *
 * WHAT IT REFUSES, IN WORDS (never silently): a cell edit — the unit is the
 * column, and the next action is an annotation; a row click on a POSITIONAL
 * table — there is no addressable row; a window the engine would not answer,
 * or a data layer that threw — the sentence, beside the rows already on screen,
 * which keep the version they were read at.
 *
 * Sort is LOCAL state in this version — see `./README.md`.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, UIEvent as ReactUIEvent } from 'react';
import type { ColumnRole, Row, SortSpec } from '../../../src/data/index.js';
import { createBlockCache, type BlockCache } from './blockCache.js';
import type { SheetColumn, SheetData, SheetWindow } from './types.js';

/** One row's height in pixels — fixed, so a scroll position IS a row index. */
export const SHEET_ROW_HEIGHT = 28;
/** The tallest scroll canvas we will build: 1M rows × 28px is past what a browser lays out. */
export const SHEET_CANVAS_MAX = 10_000_000;
/** The status strip's height, reserved out of the sheet's own height so the readout never overlaps the rows. */
export const SHEET_STATUS_HEIGHT = 24;
/** The sheet's own 1px frame, top and bottom — the height a host gives is the OUTER one. */
export const SHEET_BORDERS = 2;
/** Rows fetched beyond the visible ones, so a small scroll is served from the block already held. */
const OVERSCAN = 8;
/** The roles worth a badge: the ones that change what a column IS. A plain dimension is the unremarkable case. */
const BADGED_ROLES: readonly ColumnRole[] = ['identifier', 'measure', 'absence'];

/** The refusal a click on a positional table's row earns — said, never swallowed. */
export const POSITIONAL_REFUSAL = 'this table declares no row key — a row cannot be selected; declare `key` on the table';

/** What the scrollbar can do, and what it maps onto. */
export interface SheetMetrics {
  /** The scroll canvas's height — the true one, or the cap. */
  readonly canvasHeight: number;
  /** The largest `scrollTop` a browser will give: the canvas minus the box it scrolls in. */
  readonly scrollMax: number;
  /** How many whole rows the body shows. */
  readonly visibleRows: number;
  /** The last row that can be the FIRST one shown — at the bottom of the scroll. */
  readonly maxFirst: number;
}

/** The two ranges a virtualized grid lives between, from the count and the box it has. */
export function canvasMetrics(count: number, rowHeight: number, bodyHeight: number, canvasMax: number): SheetMetrics {
  const canvasHeight = Math.min(count * rowHeight, canvasMax);
  const visibleRows = Math.max(1, Math.floor(bodyHeight / rowHeight));
  return { canvasHeight, scrollMax: Math.max(0, canvasHeight - bodyHeight), visibleRows, maxFirst: Math.max(0, count - visibleRows) };
}

/** The first row a scroll position shows. Exact at both ends: 0 ↦ 0 and scrollMax ↦ maxFirst. */
export function rowAtScroll(scrollTop: number, metrics: SheetMetrics): number {
  if (metrics.scrollMax <= 0 || metrics.maxFirst <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, scrollTop / metrics.scrollMax));
  return Math.round(ratio * metrics.maxFirst);
}

/** Where the scrollbar must sit for a row to be the first one shown — the exact inverse of `rowAtScroll`. */
export function scrollForRow(index: number, metrics: SheetMetrics): number {
  if (metrics.maxFirst <= 0) return 0;
  return (Math.min(metrics.maxFirst, Math.max(0, index)) / metrics.maxFirst) * metrics.scrollMax;
}

/** The header's toggle: none → ascending → descending → none. One column at a time. */
export function nextSort(current: readonly SortSpec[] | undefined, field: string): readonly SortSpec[] | undefined {
  const now = current?.[0];
  if (now === undefined || now.field !== field) return [{ field, dir: 'asc' }];
  if (now.dir === 'asc') return [{ field, dir: 'desc' }];
  return undefined;
}

/** A cell as text. An absent value is blank — never the word "null", never a zero. */
export function cellText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** The readout: which rows, of how many, at what version, in what order. Never a range past the count. */
export function statusWords(win: SheetWindow | null, sort: readonly SortSpec[] | undefined): string {
  if (win === null) return 'reading the first window…';
  const last = win.rows.length === 0 ? 0 : Math.min(win.start + win.rows.length, win.count);
  const first = last === 0 ? 0 : Math.min(win.start + 1, last);
  const parts = [`rows ${first.toLocaleString()}–${last.toLocaleString()} of ${win.count.toLocaleString()}`, win.version === null ? 'no data version' : `version ${win.version}`];
  const key = sort?.[0];
  if (key !== undefined) parts.push(`sorted by ${key.field} ${key.dir === 'asc' ? '↑' : '↓'}`);
  return parts.join(' · ');
}

export interface SheetProps {
  /** The grid port — `sessionSheetData` in process, `httpSheetData` over a door. Memoize it: a new one is a new question. */
  readonly data: SheetData;
  /** Whose eyes: the declared view the window is read through (its own clause excluded, link responses applied). */
  readonly viewId?: string;
  /** The table the window is over — part of the cache's question and the grid's accessible name. */
  readonly table?: string;
  /** Default: every column the cursor sees. */
  readonly columns?: readonly string[];
  /** Present mode: the rows stay, the row-click door closes. */
  readonly readOnly?: boolean;
  /** A row click emits a point on the declared key column — wire it to the session's select. */
  readonly onSelect?: (field: string, value: unknown) => void;
  /** The row the session's own clause holds, by its row id — marked, so a person sees which row they picked. */
  readonly selectedRowId?: string;
  readonly rowHeight?: number;
  /** The OUTER height in pixels, frame included. Leave it out and the sheet measures the box it was given. */
  readonly height?: number;
  /** The table's data version at the cursor — part of the ask, so a refresh asks again. */
  readonly version?: string | null;
  /** The cursor commit — part of the ask, so time travel asks again. */
  readonly cursor?: string | null;
  readonly blockRows?: number;
  readonly maxBlocks?: number;
  readonly canvasMax?: number;
  readonly className?: string;
}

export function Sheet(props: SheetProps): JSX.Element {
  const { data, viewId, table, columns, readOnly = false, onSelect, selectedRowId, version, cursor, className } = props;
  const rowHeight = props.rowHeight ?? SHEET_ROW_HEIGHT;
  const canvasMax = props.canvasMax ?? SHEET_CANVAS_MAX;

  const [facets, setFacets] = useState<readonly SheetColumn[]>([]);
  const [win, setWin] = useState<SheetWindow | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [cannotSort, setCannotSort] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sort, setSort] = useState<readonly SortSpec[] | undefined>(undefined);
  const [scrollTop, setScrollTop] = useState(0);
  const [measured, setMeasured] = useState(0);
  const [focus, setFocus] = useState<{ readonly row: number; readonly col: number }>({ row: 0, col: 0 });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const seq = useRef(0);
  /**
   * A keyboard move's intent to take the DOM focus, and the ASK that will bring
   * the row it names (null until one is issued). It never outlives that ask: a
   * newer ask, a refusal, focus leaving the grid, or any pointer press drops
   * it — so a window that arrives minutes later can never reach across the page
   * and steal focus from whatever a person is typing in.
   */
  const focusPending = useRef<{ forAsk: number | null } | null>(null);
  const cannotSortRef = useRef<string | null>(null);
  const cacheRef = useRef<BlockCache | null>(null);
  cacheRef.current ??= createBlockCache({ ...(props.blockRows !== undefined ? { blockRows: props.blockRows } : {}), ...(props.maxBlocks !== undefined ? { maxBlocks: props.maxBlocks } : {}) });
  const cache = cacheRef.current;

  // ── the box: the host's height, or the one the sheet was actually given ──
  const givenHeight = props.height;
  useEffect(() => {
    if (givenHeight !== undefined) return; // the host owns the height
    const el = rootRef.current;
    /* v8 ignore next -- the root is mounted before any effect runs */
    if (el === null) return;
    const read = (): void => setMeasured(el.getBoundingClientRect().height);
    read();
    if (typeof ResizeObserver === 'undefined') return; // a host without one keeps the first measurement
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [givenHeight]);

  const outerHeight = givenHeight ?? measured;
  const count = win?.count ?? 0;
  // an engine that cannot sort says so IN the header, so the header takes a second line for the sentence
  const canSort = data.capabilities.sort && cannotSort === null;
  const headHeight = canSort ? rowHeight : rowHeight * 2;
  const bodyHeight = Math.max(rowHeight, outerHeight - SHEET_BORDERS - headHeight - SHEET_STATUS_HEIGHT);
  const metrics = canvasMetrics(count, rowHeight, bodyHeight, canvasMax);
  const { canvasHeight, scrollMax, visibleRows } = metrics;
  const firstIndex = rowAtScroll(scrollTop, metrics);
  const limit = visibleRows + OVERSCAN;

  // ── the schema: names, types and roles ──
  useEffect(() => {
    let live = true;
    void data
      .columns()
      .then((cols) => {
        if (!live) return;
        setFacets(cols);
        setSchemaError(null);
      })
      .catch((error: unknown) => {
        // the schema's failure is its own: a window that lands afterwards must not clear it
        if (live) setSchemaError(`the columns could not be read: ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      live = false;
    };
  }, [data]);

  // ── one window per scroll stop: the block cache turns overlapping asks into one fetch ──
  const columnsKey = columns === undefined ? '' : JSON.stringify(columns);
  const sortKey = sort === undefined ? '' : JSON.stringify(sort);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const mine = ++seq.current;
    const waiting = focusPending.current;
    if (waiting !== null) {
      // the first ask after a keyboard move is the one that will bring the row; ANY later ask supersedes the intent
      if (waiting.forAsk === null) waiting.forAsk = mine;
      else focusPending.current = null;
    }
    const parts = { ...(table !== undefined ? { table } : {}), ...(viewId !== undefined ? { viewId } : {}), ...(columns !== undefined ? { columns } : {}), ...(sort !== undefined ? { sort } : {}), ...(version !== undefined ? { version } : {}), ...(cursor !== undefined ? { cursor } : {}) };
    void cache
      .window(parts, firstIndex, limit, (offset, size) =>
        data.rows({ ...(columns !== undefined ? { columns } : {}), ...(sort !== undefined ? { sort } : {}), ...(viewId !== undefined ? { viewId } : {}), offset, limit: size }, { signal: controller.signal }),
      )
      .then((answer) => {
        if (!live || mine !== seq.current) return; // a window the scroll already left behind
        /* v8 ignore next -- the cache supersedes only an answer a newer ASK overtook, and this sheet's own guard above has already dropped that one; the arm keeps the contract honest for another host */
        if (answer === null) return; // superseded inside the cache: a fresher answer is already on screen
        if (answer.ok) {
          setWin(answer);
          setRefused(cannotSortRef.current); // a remembered sort refusal is not cleared by the next good window
          return;
        }
        focusPending.current = null; // the rows a keyboard move was waiting for did not come
        // an engine that cannot sort keeps the rows in the table's order — and it is remembered, so the
        // explanation stays in the header instead of flashing once and vanishing
        if (answer.reason === 'unsupported-sort') {
          cannotSortRef.current = answer.rejected;
          setCannotSort(answer.rejected);
          setSort(undefined);
        }
        setRefused(answer.rejected);
      })
      .catch((error: unknown) => {
        focusPending.current = null;
        if (live) setRefused(`the data layer threw: ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      live = false;
      controller.abort();
    };
    // `columnsKey`/`sortKey` stand in for the arrays' identity — a new array with the same names is the same question
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, data, table, viewId, columnsKey, sortKey, version, cursor, firstIndex, limit]);

  // ── the frozen column: the key the WINDOW names, else the column the engine put first ──
  const keyField = win?.key ?? facets.find((f) => f.key === true)?.name;
  const namesKey = JSON.stringify(win?.columns ?? []);
  const ordered = useMemo(() => {
    const names = JSON.parse(namesKey) as string[];
    return keyField !== undefined && names.includes(keyField) ? [keyField, ...names.filter((n) => n !== keyField)] : names;
  }, [namesKey, keyField]);
  const facetOf = useCallback((name: string): SheetColumn | undefined => facets.find((f) => f.name === name), [facets]);
  const numeric = useMemo(() => ordered.map((name) => facetOf(name)?.type === 'number'), [ordered, facetOf]);

  const positional = win?.positional ?? false;
  const canSelect = !readOnly && onSelect !== undefined;

  const scrollToRow = useCallback(
    (index: number): void => {
      const next = index < firstIndex ? scrollForRow(index, metrics) : index >= firstIndex + visibleRows ? scrollForRow(index - visibleRows + 1, metrics) : null;
      if (next === null) return;
      const clamped = Math.min(next, metrics.scrollMax);
      setScrollTop(clamped);
      const el = bodyRef.current;
      /* v8 ignore next -- the body is mounted whenever a key event can reach the grid; the guard keeps the type honest */
      if (el !== null) el.scrollTop = clamped;
    },
    [firstIndex, metrics, visibleRows],
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const lastRow = Math.max(0, count - 1);
    const lastCol = Math.max(0, ordered.length - 1);
    const page = Math.max(1, visibleRows - 1);
    let row = focus.row;
    let col = focus.col;
    switch (event.key) {
      case 'ArrowDown':
        row = Math.min(lastRow, row + 1);
        break;
      case 'ArrowUp':
        row = Math.max(0, row - 1);
        break;
      case 'ArrowRight':
        col = Math.min(lastCol, col + 1);
        break;
      case 'ArrowLeft':
        col = Math.max(0, col - 1);
        break;
      case 'Home':
        col = 0;
        break;
      case 'End':
        col = lastCol;
        break;
      case 'PageDown':
        row = Math.min(lastRow, row + page);
        break;
      case 'PageUp':
        row = Math.max(0, row - page);
        break;
      default:
        return;
    }
    event.preventDefault();
    focusPending.current = { forAsk: null };
    setFocus({ row, col });
    scrollToRow(row);
  };

  // The focused cell takes the DOM focus after a keyboard move — never on first
  // paint, which would steal it from the page. The move may land on a row this
  // window does not hold yet, so the intent is KEPT until a render contains it.
  useEffect(() => {
    if (focusPending.current === null) return;
    /* v8 ignore next -- the body is mounted whenever a keyboard move can happen */
    const cell = bodyRef.current?.querySelector<HTMLElement>('[data-vzf-focused="true"]');
    if (cell === null || cell === undefined) return; // the row is still being read: wait for the render that holds it
    focusPending.current = null;
    cell.focus();
  });

  // a pointer press anywhere — in the grid or outside it — is a person choosing where they are: an
  // unhonoured keyboard move must not reach across the page afterwards
  useEffect(() => {
    const drop = (): void => {
      focusPending.current = null;
    };
    document.addEventListener('pointerdown', drop, true);
    return () => document.removeEventListener('pointerdown', drop, true);
  }, []);

  const selectRow = useCallback(
    (row: Row): void => {
      if (positional) {
        setNote(POSITIONAL_REFUSAL);
        return;
      }
      if (keyField === undefined) {
        setNote('the key column was not stated to the sheet — the window names it, so a data layer that omits it cannot be selected in');
        return;
      }
      setNote(null);
      /* v8 ignore next -- a row is only clickable when `onSelect` was given (see `canSelect`), so the empty arm is unreachable */
      onSelect?.(keyField, row[keyField]);
    },
    [keyField, onSelect, positional],
  );

  const refuseEdit = useCallback((column: string): void => {
    setNote(`${column} is a source column — the sheet is read-only in this version; annotate the row instead`);
  }, []);

  // the header is outside the scroll box (it must not scroll away vertically), so it is carried
  // sideways by hand — a wide table's names stay over their own columns
  // focus that LEFT the grid (never focus lost because a row scrolled out of the DOM, which names no new element)
  const onFocusOut = (event: ReactFocusEvent<HTMLDivElement>): void => {
    const to = event.relatedTarget;
    if (to !== null && !event.currentTarget.contains(to)) focusPending.current = null;
  };

  const onScroll = (event: ReactUIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget;
    setScrollTop(Math.min(el.scrollTop, scrollMax));
    /* v8 ignore next -- the header is mounted whenever the body can scroll */
    if (headRef.current !== null) headRef.current.scrollLeft = el.scrollLeft;
  };

  // the rows layer may never reach past the canvas: that would inflate the scroll
  // height and invent empty space below the last row
  const room = Math.floor((canvasHeight - scrollTop) / rowHeight);
  const rows = win?.rows ?? [];
  const rowIds = win?.rowIds ?? [];
  const start = win?.start ?? 0;
  const shown = Math.min(rows.length, room);

  return (
    <div ref={rootRef} className={`vzf vzf-sheet${className !== undefined ? ' ' + className : ''}`} style={givenHeight !== undefined ? { height: givenHeight } : undefined} data-vzf="sheet">
      <div className="vzf-sheet-grid" role="grid" aria-label={`the rows of ${table ?? 'the table'}`} aria-rowcount={count + 1} aria-colcount={ordered.length} onKeyDown={onKeyDown} onBlur={onFocusOut}>
        <div className="vzf-sheet-head" role="rowgroup" ref={headRef}>
          <div className="vzf-sheet-row vzf-sheet-header" role="row" aria-rowindex={1} style={{ height: headHeight }}>
            {ordered.map((name, ci) => (
              <HeaderCell key={name} name={name} facet={facetOf(name)} index={ci} sort={sort} canSort={canSort} refusal={data.capabilities.refusal ?? cannotSort ?? undefined} onToggle={() => setSort((s) => nextSort(s, name))} />
            ))}
          </div>
        </div>
        <div className="vzf-sheet-body" role="rowgroup" ref={bodyRef} style={{ height: bodyHeight }} onScroll={onScroll} data-vzf="sheet-body">
          <div className="vzf-sheet-canvas" role="presentation" style={{ height: canvasHeight }} />
          <div className="vzf-sheet-rows" role="presentation" style={{ top: scrollTop }}>
            {rows.slice(0, shown).map((row, i) => (
              <SheetRow
                key={rowIds[i] ?? String(start + i)}
                row={row}
                index={start + i}
                columns={ordered}
                numeric={numeric}
                rowHeight={rowHeight}
                focusedRow={focus.row === start + i}
                focusedCol={focus.col}
                selected={selectedRowId !== undefined && rowIds[i] === selectedRowId}
                clickable={canSelect}
                onPick={selectRow}
                onRefuseEdit={refuseEdit}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="vzf-sheet-status" style={{ height: SHEET_STATUS_HEIGHT }}>
        {/* the readout changes on every scroll: announcing it would talk over everything else */}
        <span className="vzf-sheet-readout" aria-live="off">
          {statusWords(win, sort)}
        </span>
        <span className="vzf-sheet-said" role="status" aria-live="polite">
          {schemaError !== null && <span className="vzf-sheet-refused"> · {schemaError}</span>}
          {refused !== null && <span className="vzf-sheet-refused"> · {refused}</span>}
          {note !== null && <span className="vzf-sheet-refused"> · {note}</span>}
        </span>
      </div>
    </div>
  );
}

interface HeaderCellProps {
  readonly name: string;
  readonly facet: SheetColumn | undefined;
  readonly index: number;
  readonly sort: readonly SortSpec[] | undefined;
  readonly canSort: boolean;
  readonly refusal: string | undefined;
  readonly onToggle: () => void;
}

/** One column header: the name, the type the facets settled on, a role badge when the role is worth one, and a sort toggle — or the sentence saying why there is none. */
function HeaderCell({ name, facet, index, sort, canSort, refusal, onToggle }: HeaderCellProps): JSX.Element {
  const key = sort?.[0];
  const dir = key !== undefined && key.field === name ? key.dir : null;
  const arrow = dir === null ? '' : dir === 'asc' ? ' ↑' : ' ↓';
  const role = facet?.role;
  const words = (
    <>
      <span className="vzf-sheet-colname">{name}</span>
      <span className="vzf-sheet-type">{facet?.type ?? 'unknown'}</span>
      {role !== undefined && BADGED_ROLES.includes(role) && <span className="vzf-sheet-role">{role}</span>}
    </>
  );
  return (
    <div className="vzf-sheet-cell vzf-sheet-colhead" role="columnheader" aria-colindex={index + 1} aria-sort={dir === null ? 'none' : dir === 'asc' ? 'ascending' : 'descending'} data-column={name}>
      {canSort ? (
        <button type="button" className="vzf-sheet-sort" onClick={onToggle} aria-label={`sort by ${name}`}>
          {words}
          <span className="vzf-sheet-arrow">{arrow}</span>
        </button>
      ) : (
        <span className="vzf-sheet-sort vzf-sheet-nosort">
          {words}
          {/* the refusal is READ, not hovered for: a tooltip is not an answer */}
          <span className="vzf-sheet-cannot">{refusal ?? 'this engine cannot sort'}</span>
        </span>
      )}
    </div>
  );
}

interface SheetRowProps {
  readonly row: Row;
  readonly index: number;
  readonly columns: readonly string[];
  readonly numeric: readonly boolean[];
  readonly rowHeight: number;
  readonly focusedRow: boolean;
  readonly focusedCol: number;
  readonly selected: boolean;
  readonly clickable: boolean;
  readonly onPick: (row: Row) => void;
  readonly onRefuseEdit: (column: string) => void;
}

/** One row: plain text nodes, memoized — a scroll re-renders the rows that moved, never the ones that did not. */
const SheetRow = memo(function SheetRow({ row, index, columns, numeric, rowHeight, focusedRow, focusedCol, selected, clickable, onPick, onRefuseEdit }: SheetRowProps): JSX.Element {
  // the SECOND click of a double-click never selects — the first one already did, exactly as a spreadsheet behaves
  const pick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.detail <= 1) onPick(row);
  };
  return (
    <div
      className={`vzf-sheet-row${clickable ? ' vzf-sheet-pickable' : ''}${selected ? ' vzf-sheet-picked' : ''}`}
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      style={{ height: rowHeight }}
      data-row={index}
      onClick={clickable ? pick : undefined}
    >
      {columns.map((name, ci) => (
        <div
          key={name}
          className={`vzf-sheet-cell${numeric[ci] === true ? ' vzf-sheet-num' : ''}`}
          role="gridcell"
          aria-colindex={ci + 1}
          tabIndex={focusedRow && focusedCol === ci ? 0 : -1}
          data-vzf-focused={focusedRow && focusedCol === ci ? 'true' : 'false'}
          data-column={name}
          onDoubleClick={() => onRefuseEdit(name)}
        >
          {cellText(row[name])}
        </div>
      ))}
    </div>
  );
});
