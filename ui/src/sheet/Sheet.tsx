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
 * SORT IS AN ACT, AND THIS SHEET DOES NOT HOLD ONE. The scroll is a read —
 * `offset` moves where you stand in one fixed order — but a sort REPLACES the
 * order, so it changes what row 1 is for every window afterwards. It is
 * therefore the host's, landed on the trace through the verb it already had
 * (`navigate` on `layout:sheet:<viewId>`, the library's LY-1 door) and read
 * back at the cursor, so a reload and a seek both return the order a person
 * left. The sheet asks (`onSort`) and renders what it is given (`sort`); it
 * never remembers one. A sheet given no `onSort` — and a sheet in Present mode,
 * where reading never rearranges — has no toggle at all, the same rule
 * `onSelect` already follows: a door the host did not wire is a door that is
 * closed, never one that half-works. See `./arrangement.ts` for the ruling and
 * `./README.md` for the law.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, UIEvent as ReactUIEvent } from 'react';
import type { Row, SortSpec } from 'vizfootprint/data';
import { sortArrow, sortedByWords } from './arrangement.js';
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
  // the KEY is carried over, not rebuilt: the toggle turns the DIRECTION, and rebuilding it
  // would silently move where absent values land — a second change nothing in the words says
  if (now.dir === 'asc') return [{ ...now, dir: 'desc' }];
  return undefined;
}

/** What an engine that declares it cannot sort, and offers no sentence of its own, is saying. */
export const SHEET_ENGINE_CANNOT_SORT = 'this engine cannot sort';

/**
 * The sentence under a header with no sort toggle — or NOTHING, when there is
 * nothing to say.
 *
 * The ENGINE is the one reason a reader is owed words for: it refuses
 * something a person would reasonably try, and the refusal is a fact about the
 * data layer they cannot otherwise learn. A sheet whose host wired no sort
 * DOOR is a different case entirely — it claims nothing and hides nothing (no
 * toggle and no arrow to offer, and, when the host holds no order either,
 * nothing about one in the readout), so there is no lie to correct, and
 * printing "nobody wired this" over every column would be scolding a developer
 * in a reader's face while stealing a row of their table.
 * That fact belongs in `./README.md`. WHY it matters that this stays the
 * engine's alone: the header's second line is paid for out of the body's
 * height, so a sentence here costs a row of data.
 */
export function noSortWords(engineCanSort: boolean, engineSaid: string | null | undefined): string | undefined {
  return engineCanSort ? undefined : (engineSaid ?? SHEET_ENGINE_CANNOT_SORT);
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
  if (sort !== undefined && sort.length > 0) parts.push(sortedByWords(sort)); // the rail's own words, so one arrangement never reads two ways
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
  /**
   * The order the rows are in — the arrangement the TRACE holds at this cursor
   * (`sheetSortOf(state.layouts, viewId)`). The sheet renders it and never
   * remembers one of its own.
   */
  readonly sort?: readonly SortSpec[];
  /**
   * A header toggle asks for a new order; the host LANDS it
   * (`view.setSheetSort(viewId, next)`) and hands the answer back through
   * `sort`. Leave it out and there is no toggle — Present mode, and any host
   * that has not wired the act, read the order the trace holds.
   */
  readonly onSort?: (next: readonly SortSpec[] | undefined) => void;
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
  const { data, viewId, table, columns, readOnly = false, onSelect, selectedRowId, sort, onSort, version, cursor, className } = props;
  const rowHeight = props.rowHeight ?? SHEET_ROW_HEIGHT;
  const canvasMax = props.canvasMax ?? SHEET_CANVAS_MAX;

  const [facets, setFacets] = useState<readonly SheetColumn[]>([]);
  const [win, setWin] = useState<SheetWindow | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [cannotSort, setCannotSort] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
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

  // ── the arrangement: the host's act, never this component's memory ──
  // `askSort` is undefined exactly when the host wired no door, which is what
  // closes the toggle — the rule `canSelect` already follows one field over.
  const askSort = onSort === undefined ? undefined : (field: string): void => onSort(nextSort(sort, field));
  // WHY: the window effect must be able to hand a refused sort BACK to the host
  // without re-asking for a window every time the host re-renders its callback.
  // It carries the ACT DOOR, not the raw callback: Present mode closes that door
  // exactly as it closes the toggle, because handing a sort back LANDS a commit —
  // a person who only opened a story must not write to the trace they are reading.
  const onSortRef = useRef<SheetProps['onSort']>(onSort);
  onSortRef.current = readOnly ? undefined : onSort;
  /**
   * The arrangement already handed back as refused. WHY it is remembered: the
   * refusal grows the header by a line, which shrinks `limit` — a dep of the
   * window effect — so the effect re-runs and is refused again BEFORE an
   * asynchronous host has landed the clear. Without this, one refused order
   * lands two "sort cleared" commits and asks the engine twice.
   */
  const handedBack = useRef<string | null>(null);

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
  const engineCanSort = data.capabilities.sort && cannotSort === null;
  // the TOGGLE needs three things: an engine that can answer, a door the act can
  // land through, and a person who is not merely READING — present mode closes
  // this door exactly as it closes the row-click one, because rearranging is an act
  const canSort = engineCanSort && !readOnly && askSort !== undefined;
  // WHY the height follows the ENGINE and not the toggle: only the engine has a
  // sentence to print, so only the engine costs a row of the table
  const headHeight = engineCanSort ? rowHeight : rowHeight * 2;
  const bodyHeight = Math.max(rowHeight, outerHeight - SHEET_BORDERS - headHeight - SHEET_STATUS_HEIGHT);
  const metrics = canvasMetrics(count, rowHeight, bodyHeight, canvasMax);
  const { canvasHeight, scrollMax, visibleRows } = metrics;
  const firstIndex = rowAtScroll(scrollTop, metrics);
  const limit = visibleRows + OVERSCAN;

  // ── the schema: names, types and roles ──
  useEffect(() => {
    let live = true;
    // a sort refusal is a fact about ONE engine, so a NEW port has not refused
    // anything yet — the block cache forgets on a new question for the same reason
    cannotSortRef.current = null;
    handedBack.current = null;
    setCannotSort(null);
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
          handedBack.current = null; // an order that WAS served is not one already handed back: the next refusal is a new one
          return;
        }
        focusPending.current = null; // the rows a keyboard move was waiting for did not come
        // an engine that cannot sort keeps the rows in the table's order — and it is remembered, so the
        // explanation stays in the header instead of flashing once and vanishing
        if (answer.reason === 'unsupported-sort') {
          cannotSortRef.current = answer.rejected;
          setCannotSort(answer.rejected);
          // The trace must not be left claiming an order the rows are not in, so
          // the sort is handed BACK to the host to clear — one honest act, not a
          // quiet local undo the record never hears about. A sheet with no door
          // (and a sheet in Present mode) has nobody to hand it to and says so in
          // the header instead. ONCE per refused order: see `handedBack`.
          if (handedBack.current !== sortKey) {
            handedBack.current = sortKey;
            onSortRef.current?.(undefined);
          }
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

  // the readout and `aria-sort` speak for the ROWS, never for the ask: an engine
  // that refused this order left them in the table's own, and saying otherwise
  // tells a screen reader a column is sorted when it is not
  const shownSort = engineCanSort ? sort : undefined;

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
              <HeaderCell
                key={name}
                name={name}
                facet={facetOf(name)}
                index={ci}
                sort={shownSort}
                canSort={canSort}
                refusal={noSortWords(engineCanSort, data.capabilities.refusal ?? cannotSort)}
                onToggle={askSort === undefined ? undefined : () => askSort(name)}
              />
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
          {statusWords(win, shownSort)}
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
  /** The engine's sentence when the ENGINE is why there is no toggle, already resolved by `noSortWords`; absent when there is nothing to say. */
  readonly refusal: string | undefined;
  /** Absent exactly when the host wired no sort door, which is one of the reasons there is no toggle. */
  readonly onToggle: (() => void) | undefined;
}

/** One column header: the name, the type the facets settled on, a role badge when the role is worth one, and a sort toggle — or the sentence saying why there is none. */
function HeaderCell({ name, facet, index, sort, canSort, refusal, onToggle }: HeaderCellProps): JSX.Element {
  const key = sort?.[0];
  const dir = key !== undefined && key.field === name ? key.dir : null;
  const arrow = dir === null ? '' : ` ${sortArrow(dir)}`;
  const role = facet?.role;
  const words = (
    <>
      <span className="vzf-sheet-colname">{name}</span>
      <span className="vzf-sheet-type">{facet?.type ?? 'unknown'}</span>
      {/* the badge marks a role that changes what a column IS — stated as the one EXCEPTION, so a role added to the port's vocabulary cannot silently go unbadged */}
      {role !== undefined && role !== 'dimension' && <span className="vzf-sheet-role">{role}</span>}
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
          {/* the mark follows the ORDER, not the door: a header with no toggle is still in whatever order the rows are in */}
          <span className="vzf-sheet-arrow">{arrow}</span>
          {/* the refusal is READ, not hovered for: a tooltip is not an answer */}
          {refusal !== undefined && <span className="vzf-sheet-cannot">{refusal}</span>}
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
