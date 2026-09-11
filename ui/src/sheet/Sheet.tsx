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
 *
 * AND SO IS THE REST OF THE ARRANGEMENT. `hidden`, `order` and `frozen` are
 * the same law with the same shape: the sheet renders what it is handed, asks
 * through ONE door (`onArrange(prop, value)` — one prop per gesture, so one
 * commit per gesture), and remembers nothing. Two of them earn the act as
 * plainly as the sort does — HIDING a column changes what the next window is
 * even asked for, and ORDER changes what "the first column" means to every
 * later reader. Three rules are this file's own, because only a grid can keep
 * them: the key column is never hidden and never moved out of first place (it
 * is the row's identity, and a row click selects on it); the ASK carries the
 * arranged VISIBLE projection, so the engine never ships a column nobody is
 * looking at and an export handed the same projection walks the same columns;
 * and a name the trace holds that this table does not have is ignored for that
 * column and SAID ONCE, never a broken grid and never a silent rewrite of the
 * trace. The one read the arrangement does NOT narrow is `find`: which columns
 * are "text" is the library's judgment (`findInView` searches a number column
 * only when it is named), and naming the visible ones here would put a second
 * judge of that question in the grid — see `./README.md`, R4.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, UIEvent as ReactUIEvent } from 'react';
import type { Row, SortSpec } from 'vizfootprint/data';
// what LEAVES is formatted by the library, one cell or a whole window (see `copyFocusedCell`) —
// and it is the DATA layer's function, the same text a FIND matches against
import { cellString } from 'vizfootprint/data';
import { arrangeColumns, arrangeItems, arrangementSaid, frozenCount, sortArrow, sortedByWords } from './arrangement.js';
import type { SheetArrangeItem, SheetArrangementProp, SheetArrangementValues } from './arrangement.js';
import { createBlockCache, type BlockCache } from './blockCache.js';
// the clipboard door and the one sentence for a browser that refuses it — a module of
// its own, so the grid never reaches through the export FORM to put text on a clipboard
import { clipboardRefusal, writeClipboard } from './clipboard.js';
import type { SheetColumn, SheetData, SheetFindAnswer, SheetFindRequest, SheetWindow } from './types.js';

/** One row's height in pixels — fixed, so a scroll position IS a row index. */
export const SHEET_ROW_HEIGHT = 28;
/** The tallest scroll canvas we will build: 1M rows × 28px is past what a browser lays out. */
export const SHEET_CANVAS_MAX = 10_000_000;
/** The status strip's height, reserved out of the sheet's own height so the readout never overlaps the rows. */
export const SHEET_STATUS_HEIGHT = 24;
/**
 * ONE column's width in pixels — what the frozen columns' sticky offsets are
 * measured in.
 *
 * A COPY of the stylesheet's `.vzf-sheet-cell { width }`, because `position:
 * sticky` needs a `left` in pixels and only the layout knows one. It is pinned
 * against `styles.css` in `Sheet.test.tsx`: drift would leave the second frozen
 * column overlapping the first, or floating away from it.
 */
export const SHEET_COLUMN_WIDTH = 148;
/** The arrange strip's height, paid for out of the body's — exactly as the find strip is. */
export const SHEET_ARRANGE_HEIGHT = 30;
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

/**
 * The readout: which rows, of how many, at what version, in what order, and
 * how many columns are OFF the screen. Never a range past the count.
 *
 * WHY the hidden columns are counted here: a grid missing a column looks
 * exactly like a table that never had one, and a person who cannot see that
 * something is hidden cannot ask for it back. The count is the one fact that
 * makes the "show all" control beside it make sense.
 */
export function statusWords(win: SheetWindow | null, sort: readonly SortSpec[] | undefined, hiddenCount = 0): string {
  if (win === null) return 'reading the first window…';
  const last = win.rows.length === 0 ? 0 : Math.min(win.start + win.rows.length, win.count);
  const first = last === 0 ? 0 : Math.min(win.start + 1, last);
  const parts = [`rows ${first.toLocaleString()}–${last.toLocaleString()} of ${win.count.toLocaleString()}`, win.version === null ? 'no data version' : `version ${win.version}`];
  if (sort !== undefined && sort.length > 0) parts.push(sortedByWords(sort)); // the rail's own words, so one arrangement never reads two ways
  if (hiddenCount > 0) parts.push(`${hiddenCount} hidden`);
  return parts.join(' · ');
}

/**
 * WHAT THE WINDOW SAYS ABOUT A CLAUSE THAT FILTERED NOTHING — one sentence per
 * narrowed clause, and nothing at all when none was.
 *
 * A selection somewhere else on the dashboard can REACH this sheet and name a
 * column this table does not have. The rows come back unfiltered and correct,
 * which is exactly the problem: a person who brushed another view is looking at
 * a sheet that ignored them, with nothing on screen saying so. The engine
 * already states the fact (`ReachingClause.narrowed`) — this is the one place
 * it is read out.
 *
 * The library's `reason` is QUOTED, never re-worded: it is the same sentence the
 * export receipt and `why()` carry, and a grid that paraphrased it would make
 * one fact read two ways. This adds only what the library could not know — WHICH
 * view's selection it was, which is a fact about the window, not about the table.
 *
 * WHY a sentence EACH and not one summary line (the `arrangementSaid`
 * precedent): two views can both reach a sheet and both be unjudgeable, on
 * different columns. Collapsing them would name one and hide the other, and the
 * hidden one is exactly the brush whose reader is already confused.
 */
export function narrowedSaid(win: SheetWindow | null): readonly string[] {
  return (win?.clauses ?? []).flatMap((c) => (c.narrowed === undefined ? [] : [`the selection from ${c.from} filtered nothing here \u00b7 ${c.narrowed.reason}`]));
}

/** The find strip's height, reserved out of the body's so the rows never sit under it. */
export const SHEET_FIND_HEIGHT = 30;

/** What a data layer that cannot find, and offers no sentence of its own, is saying. */
export const SHEET_CANNOT_FIND = 'this data layer cannot find';

/**
 * Where a find starts, given where the person is standing — and whether that
 * start is already a WRAP.
 *
 * "Next" means the row AFTER the one you are on, and "previous" the one before
 * it, so pressing next twice never lands on the same row twice. Both ends are
 * pre-empted here rather than left to the door: `from: -1` is a MALFORMED ask
 * (the port refuses it in words), and a person pressing "previous" on row 0
 * means "wrap to the bottom", not "show me a refusal".
 */
export function findFrom(row: number, direction: 'forward' | 'backward', count: number): { readonly from: number; readonly wrapped: boolean } {
  if (direction === 'forward') return row + 1 >= count ? { from: 0, wrapped: true } : { from: row + 1, wrapped: false };
  return row - 1 < 0 ? { from: Math.max(0, count - 1), wrapped: true } : { from: row - 1, wrapped: false };
}

/**
 * What a find answer says, in the words the readout already counts rows in.
 *
 * Three honest sentences and no fourth: nothing in the view holds the text; a
 * match, with its place among them and the row it is on; or — the race — no
 * match from here after all, with the count still stated. A wrap SAYS it
 * wrapped, because a jump backwards through the table is otherwise a surprise.
 */
export function findWords(text: string, answer: SheetFindAnswer, wrapped: 'top' | 'bottom' | null): string {
  if (answer.matches === 0) return `no cell contains \u201c${text}\u201d`;
  if (answer.position === null) return `no match from here \u00b7 ${answer.matches.toLocaleString()} in this view`;
  // WHICH match, when the door said (it always does on a hit) — and honestly
  // vague when it did not, rather than a confident "match 0"
  const place = answer.ordinal === undefined ? `a match of ${answer.matches.toLocaleString()}` : `match ${answer.ordinal.toLocaleString()} of ${answer.matches.toLocaleString()}`;
  // 1-based, the way the readout counts rows — one grid never numbers a row two ways
  const said = `${place} \u00b7 row ${(answer.position + 1).toLocaleString()}`;
  // WHICH END is the caller's fact, not a guess from the position: a forward wrap
  // restarts at the top and may still land in the middle of the table.
  return wrapped === null ? said : `${said} \u00b7 wrapped to the ${wrapped}`;
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
  /** The columns the TRACE hides at this cursor (`sheetHiddenOf(state.layouts, viewId)`). The key column is never one of them. */
  readonly hidden?: readonly string[];
  /** The LEADING column order the trace holds (`sheetOrderOf`); columns it does not name follow in the engine's order. */
  readonly order?: readonly string[];
  /** How many leading columns stay put under horizontal scroll (`sheetFrozenOf`). Absent = one: the key alone. */
  readonly frozen?: number;
  /**
   * ONE DOOR for the other three props: a header menu item asks for one prop's
   * new value and the host LANDS it (`view.setSheetArrangement(viewId, prop,
   * value)`), handing the answer back through `hidden` / `order` / `frozen`.
   *
   * Leave it out and there are no menus and no "show all" — Present mode, and
   * any host that has not wired the act, read the arrangement the trace holds
   * and are told nothing about a door that is not there. The sort's law, applied
   * to the other three.
   */
  readonly onArrange?: (prop: SheetArrangementProp, value: SheetArrangementValues[SheetArrangementProp]) => void;
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
  const { data, viewId, table, columns, readOnly = false, onSelect, selectedRowId, sort, onSort, hidden, order, frozen, onArrange, version, cursor, className } = props;
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
  // the find strip: open or not, and what is typed in it. A find is a READ, so
  // none of this is state about the DATA — it is state about where a person is
  // standing and what they are looking for.
  const [finding, setFinding] = useState(false);
  const [findText, setFindText] = useState('');
  // which header's arrange menu is open (by column name), or none. State about
  // where a person is standing — never about the arrangement, which is the trace's.
  const [menuFor, setMenuFor] = useState<string | null>(null);

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
  const findRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  /** Which find is the current one: an answer from an older press is dropped rather than painted over a newer one (the window effect's `seq`, for the other read). */
  const findSeq = useRef(0);
  const cacheRef = useRef<BlockCache | null>(null);
  cacheRef.current ??= createBlockCache({ ...(props.blockRows !== undefined ? { blockRows: props.blockRows } : {}), ...(props.maxBlocks !== undefined ? { maxBlocks: props.maxBlocks } : {}) });
  const cache = cacheRef.current;

  // ── the arrangement: the host's act, never this component's memory ──
  // `askSort` is undefined exactly when the host wired no door, which is what
  // closes the toggle — the rule `canSelect` already follows one field over.
  const askSort = onSort === undefined ? undefined : (field: string): void => onSort(nextSort(sort, field));
  /**
   * ONE arrangement act, asked of the host. Typed per prop, so a menu item can
   * never hand `frozen` a list of names even though the PROP itself is two plain
   * arguments to the host — the pairing is checked where the values are built.
   */
  const ask = <P extends SheetArrangementProp>(prop: P, value: SheetArrangementValues[P]): void => onArrange?.(prop, value);
  // the three menus need a door and a person who is not merely READING: Present
  // mode closes them exactly as it closes the sort toggle and the row click
  const canArrange = !readOnly && onArrange !== undefined;
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
  // the strip is paid for out of the BODY, like the status strip and the header's
  // refusal line: a sheet given a height keeps it, whatever is open inside it
  const bodyHeight = Math.max(rowHeight, outerHeight - SHEET_BORDERS - headHeight - SHEET_STATUS_HEIGHT - (finding ? SHEET_FIND_HEIGHT : 0) - (menuFor !== null ? SHEET_ARRANGE_HEIGHT : 0));
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

  // ── the arranged projection: what is asked for, and what is drawn ──
  //
  // The key the WINDOW names (else the column the facets declared) is the one
  // the arrangement is measured from: never hidden, always first, and the first
  // of the frozen ones.
  const keyField = win?.key ?? facets.find((f) => f.key === true)?.name;
  // the columns this sheet KNOWS the table has: the host's projection when it
  // named one, else the schema the port answered. Empty until one of them lands.
  const baseKey = JSON.stringify(columns ?? facets.map((f) => f.name));
  const namesKey = JSON.stringify(win?.columns ?? []);
  const hiddenKey = JSON.stringify(hidden ?? []);
  const orderKey = JSON.stringify(order ?? []);
  // ONE owner of the whole rule (`arrangeColumns`), spent twice: over the columns
  // the sheet knows about (what the next window ASKS for) and over the columns the
  // engine ANSWERED (what the grid draws). The JSON keys stand in for the arrays'
  // identity — a new array with the same names is the same arrangement.
  const arrange = useCallback(
    (namesJson: string) => arrangeColumns(JSON.parse(namesJson) as string[], keyField, { order: JSON.parse(orderKey) as string[], hidden: JSON.parse(hiddenKey) as string[] }),
    [keyField, orderKey, hiddenKey],
  );
  // `asked` is arranged over every column the table HAS — which is why the readout's
  // hidden COUNT is read from it and never from `drawn`, where a hidden column is
  // already gone and the count would always answer zero
  const asked = useMemo(() => arrange(baseKey), [arrange, baseKey]);
  const drawn = useMemo(() => arrange(namesKey), [arrange, namesKey]);
  const ordered = drawn.columns;
  // A HIDDEN COLUMN IS NOT READ: the ask carries the arranged VISIBLE projection,
  // so the engine never ships a hidden column and `<ExportRows>` handed the same
  // projection walks the same ones. With no arrangement the ask is exactly what it
  // always was — the host's projection, or none at all.
  const arranges = (hidden?.length ?? 0) > 0 || (order?.length ?? 0) > 0;
  const knowsColumns = (columns ?? facets).length > 0; // the host's projection, or the schema — one of them has landed
  const projection = arranges && knowsColumns ? asked.columns : columns;
  // an arrangement CAN hide every column (no menu will do it, but a trace may hold
  // one): asking with an empty projection would show the whole table back, which is
  // the opposite of what the trace says, so nothing is asked and the status line says so
  const nothingLeft = projection !== undefined && projection.length === 0;
  // R6: a name the arrangement holds that this table does not have — reported only
  // once the sheet KNOWS the table's columns, or every name would look missing on
  // the first paint, before the schema has landed
  const missing = knowsColumns ? asked.missing : [];

  // ── one window per scroll stop: the block cache turns overlapping asks into one fetch ──
  const columnsKey = projection === undefined ? '' : JSON.stringify(projection);
  const sortKey = sort === undefined ? '' : JSON.stringify(sort);
  useEffect(() => {
    if (nothingLeft) return; // nothing to ask for — see `nothingLeft`
    let live = true;
    const controller = new AbortController();
    const mine = ++seq.current;
    const waiting = focusPending.current;
    if (waiting !== null) {
      // the first ask after a keyboard move is the one that will bring the row; ANY later ask supersedes the intent
      if (waiting.forAsk === null) waiting.forAsk = mine;
      else focusPending.current = null;
    }
    const parts = { ...(table !== undefined ? { table } : {}), ...(viewId !== undefined ? { viewId } : {}), ...(projection !== undefined ? { columns: projection } : {}), ...(sort !== undefined ? { sort } : {}), ...(version !== undefined ? { version } : {}), ...(cursor !== undefined ? { cursor } : {}) };
    void cache
      .window(parts, firstIndex, limit, (offset, size) =>
        data.rows({ ...(projection !== undefined ? { columns: projection } : {}), ...(sort !== undefined ? { sort } : {}), ...(viewId !== undefined ? { viewId } : {}), offset, limit: size }, { signal: controller.signal }),
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
  }, [cache, data, table, viewId, columnsKey, sortKey, version, cursor, firstIndex, limit, nothingLeft]);

  const facetOf = useCallback((name: string): SheetColumn | undefined => facets.find((f) => f.name === name), [facets]);
  const numeric = useMemo(() => ordered.map((name) => facetOf(name)?.type === 'number'), [ordered, facetOf]);

  // ── the frozen columns: the key, plus however many the trace says ──
  //
  // ONE mechanism for all of them (the key was already sticky, on its own CSS
  // rule): each frozen cell is `position: sticky` at the CUMULATIVE offset of the
  // columns before it. The count starts at the key, so there is no zero — a grid
  // whose identity column scrolled away would be a grid nobody can read.
  const frozenAt = Math.min(frozenCount(frozen), ordered.length);

  /** What this header's menu offers, and nothing when the host wired no door (R5). */
  const itemsFor = (name: string): readonly SheetArrangeItem[] => (canArrange ? arrangeItems(name, { drawn: ordered, key: keyField, hidden, order, frozen }) : []);
  const menuItems = menuFor === null ? [] : itemsFor(menuFor);

  /**
   * The menu closes and the FOCUS GOES BACK to the header it came from — a menu
   * that closed into nowhere would drop a keyboard person out of the grid.
   *
   * The button is found by walking the header's own buttons rather than by a
   * selector built from the name: a column may be called `a"b`, which no
   * attribute selector could carry (the same hazard this folder's JSON values
   * exist for).
   */
  const closeMenu = (): void => {
    setMenuFor(null);
    /* v8 ignore next -- the header is mounted whenever a menu inside it can be closed; the guard keeps the ref's type honest */
    const buttons = headRef.current?.querySelectorAll<HTMLElement>('[data-vzf-menu]') ?? [];
    for (const button of buttons) if (button.dataset.vzfMenu === menuFor) button.focus();
  };

  /** One item: ONE act, then the menu closes — the arrangement it was built from is now the old one. */
  const runItem = (item: SheetArrangeItem): void => {
    ask(item.prop, item.value);
    closeMenu();
  };

  /** Esc closes and hands the focus back; the arrows walk the items, either axis, wrapping at both ends. */
  const onMenuKeys = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault(); // an arrow inside the menu is a move between items, never a scroll
    /* v8 ignore next -- the strip is mounted whenever a key event can reach it; the guard keeps the ref's type honest */
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    // the strip always holds at least the "close" item, so a step always lands on one
    items[(at + step + items.length) % items.length]!.focus();
  };

  // the first item takes the focus when a menu opens — never on first paint (no
  // menu is open then), so the page's own focus is never stolen
  useEffect(() => {
    if (menuFor === null) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menuFor]);

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

  /** The focused cell, or null when this window does not hold it (a scroll still in flight). */
  const focusedCell = (): { readonly column: string; readonly value: unknown } | null => {
    const column = ordered[focus.col];
    const row = rows[focus.row - start];
    return column === undefined || row === undefined ? null : { column, value: row[column] };
  };

  /**
   * Ctrl/Cmd+C puts the FOCUSED CELL on the clipboard.
   *
   * A copy is a READ, so `readOnly` does not close this door — Present mode is
   * reading, and this is reading. (The same law `./ExportRows.tsx` states for a
   * whole window: `src/session/README.md`, "Export is a read that carries its
   * address".) One cell needs no receipt file; its address is the note, which
   * says WHICH column of WHICH row went.
   *
   * The value is written with the LIBRARY's `cellString`, not this file's
   * `cellText`: what leaves the system reads one way whether it leaves a cell at
   * a time or a window at a time, so a copied date is the ISO instant the CSV
   * would carry and a copied object is its JSON — never `[object Object]`.
   * `cellText` stays what it was, the DISPLAY's formatter.
   */
  const copyFocusedCell = async (cell: { readonly column: string; readonly value: unknown }): Promise<void> => {
    try {
      await writeClipboard(cellString(cell.value));
      // 1-based, the way the readout counts rows — one grid never numbers the same row two ways
      setNote(`copied ${cell.column} of row ${(focus.row + 1).toLocaleString()}`);
    } catch (error: unknown) {
      setNote(clipboardRefusal(error));
    }
  };

  // ── the find strip: a READ that moves where you stand ──
  //
  // The door and the capability are read together: the capability is the CLAIM
  // and the method is the door, so a port that claims without wiring is treated
  // as refusing rather than as a page that silently does nothing.
  const findDoor = data.find;
  const canFind = data.capabilities.find && findDoor !== undefined;
  const findRefusal = data.capabilities.findRefusal ?? SHEET_CANNOT_FIND;

  /** One ask, in the SAME order and through the same eyes the window was read with — or the position would not be this window's offset. */
  const findAsk = (from: number, direction: 'forward' | 'backward'): SheetFindRequest => ({
    text: findText,
    from,
    direction,
    ...(shownSort !== undefined ? { sort: shownSort } : {}),
    ...(viewId !== undefined ? { viewId } : {}),
  });

  /**
   * Where a found row is: MARKED (the sheet's focused cell moves to it) and
   * scrolled into view — but the DOM focus stays in the input, because a person
   * mid-search is going to press Enter again. Esc is what hands the focus over.
   *
   * The mark survives a row this window does not hold yet: `focus` is state, and
   * the cell renders as focused the moment the window that holds it arrives.
   */
  const landFind = (answer: SheetFindAnswer, wrapped: 'top' | 'bottom' | null): void => {
    if (answer.position !== null) {
      setFocus({ row: answer.position, col: focus.col });
      scrollToRow(answer.position);
    }
    setNote(findWords(findText, answer, wrapped));
  };

  /**
   * Press "next" or "previous".
   *
   * WHY the empty ask is not judged here: the port already judges it (`bad-find`,
   * "a find needs something to look for — the text was empty") and one library
   * says that once. A second judge in the grid could disagree with it.
   *
   * WHY it may ask TWICE: neither direction wraps at the door — a walk that ran
   * out says so honestly (`position: null` with `matches > 0`) — so the WRAP is
   * this grid's decision, made once, and said out loud in the note.
   */
  const runFind = async (direction: 'forward' | 'backward'): Promise<void> => {
    /* v8 ignore next -- the strip renders no buttons at all when there is no door (see `canFind`), so this arm is unreachable from the DOM; it keeps the optional method honest for a host calling in */
    if (findDoor === undefined) return;
    const mine = ++findSeq.current;
    const { from, wrapped } = findFrom(focus.row, direction, count);
    const answer = await findDoor(findAsk(from, direction));
    if (mine !== findSeq.current) return; // a newer press already answered
    if (!answer.ok) {
      setNote(answer.rejected);
      return;
    }
    const end = direction === 'forward' ? 'top' : 'bottom';
    if (answer.position === null && answer.matches > 0 && !wrapped) {
      // nothing that way, but the view holds matches: come back round, once
      const again = await findDoor(findAsk(direction === 'forward' ? 0 : Math.max(0, count - 1), direction));
      if (mine !== findSeq.current) return;
      if (!again.ok) {
        setNote(again.rejected);
        return;
      }
      landFind(again, end);
      return;
    }
    landFind(answer, wrapped ? end : null);
  };

  /** Esc: the strip closes and the FOUND ROW takes the focus — through the same keep-until-it-arrives intent a keyboard move uses. */
  const closeFind = (): void => {
    setFinding(false);
    focusPending.current = { forAsk: null };
  };

  /**
   * The caret goes into the input, with what is there selected to type over.
   *
   * ONE owner, because two things ask for it: the effect below, when the strip
   * has just opened (the input does not exist until that render), and Ctrl+F
   * pressed while the strip is ALREADY open with the focus back in the rows —
   * where the effect cannot fire, because `finding` did not change. A no-op
   * before that first render, which is exactly what the effect is for.
   */
  const takeFindInput = (): void => {
    findRef.current?.select();
    findRef.current?.focus();
  };

  // the input takes the focus when the strip opens — never on first paint (the
  // strip is not open then), so the page's own focus is never stolen
  useEffect(() => {
    if (!finding) return;
    takeFindInput();
    // `takeFindInput` reads a ref and is re-made every render; the OPENING is the event
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finding]);

  const onFindKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFind();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault(); // a form around the grid must not submit on a search
      void runFind(event.shiftKey ? 'backward' : 'forward');
      return;
    }
    // Ctrl+F while the strip is already open: the browser's own find stays shut,
    // and the person gets their text selected to type over
    if ((event.ctrlKey || event.metaKey) && (event.key === 'f' || event.key === 'F')) {
      event.preventDefault();
      event.currentTarget.select();
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Ctrl/Cmd+F opens the strip — a READ, so Present mode does not close this
    // door (the same law the copy key follows one block down)
    if ((event.ctrlKey || event.metaKey) && (event.key === 'f' || event.key === 'F')) {
      // The browser's own find searches the WINDOW and this searches the TABLE,
      // so the key is taken out of the way — but ONLY when this port can answer
      // instead. A strip that can only refuse must not also cost a person the
      // find their browser already gave them (the copy key's law one block down:
      // prevented only because something IS going to happen). The strip still
      // opens either way, because a person who asked is owed the sentence.
      if (canFind) event.preventDefault();
      setFinding(true);
      // …and a key that WAS swallowed always does something: pressed with the
      // strip already open and the focus back in the rows, `finding` does not
      // change, so no effect fires and only this puts the caret back.
      takeFindInput();
      return;
    }
    // the copy key is not a MOVE, so it is judged before the movement switch and
    // leaves `focus` exactly where it was
    if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
      const cell = focusedCell();
      // nothing to copy: the browser's OWN copy is left alone rather than swallowed
      // for a copy that cannot happen, and the note says why the cell did not go
      if (cell === null) {
        setNote('the focused cell is not in this window yet — nothing was copied');
        return;
      }
      event.preventDefault(); // prevented only because a cell IS going to the clipboard
      void copyFocusedCell(cell);
      return;
    }
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
                frozen={ci < frozenAt ? ci * SHEET_COLUMN_WIDTH : undefined}
                menu={itemsFor(name).length > 0}
                menuOpen={menuFor === name}
                onMenu={() => setMenuFor(menuFor === name ? null : name)}
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
                frozenAt={frozenAt}
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
      {menuFor !== null && (
        // the arrange strip: paid for out of the BODY, exactly as the find strip and
        // the header's refusal line are — a sheet given a height keeps it, whatever is
        // open inside it. It sits OUTSIDE `role="grid"` (a menu is not a gridcell) and
        // names the column it is about, because it is not drawn under its own header.
        <div className="vzf-sheet-arrange" style={{ height: SHEET_ARRANGE_HEIGHT }} data-vzf="sheet-arrange" role="menu" aria-label={`arrange ${menuFor}`} ref={menuRef} onKeyDown={onMenuKeys}>
          <span className="vzf-sheet-arrangename" role="presentation">
            {menuFor}
          </span>
          {menuItems.map((item) => (
            <button key={item.label} type="button" role="menuitem" className="vzf-sheet-arrangeitem" onClick={() => runItem(item)}>
              {item.label}
            </button>
          ))}
          {/* a pointer's way out, said in words — Esc is the keyboard's */}
          <button type="button" role="menuitem" className="vzf-sheet-arrangeclose" onClick={closeMenu}>
            close
          </button>
        </div>
      )}
      {finding && (
        // the strip sits BETWEEN the grid and the readout: outside `role="grid"`
        // (an input is not a gridcell), and above the sentence it writes into
        <div className="vzf-sheet-find" style={{ height: SHEET_FIND_HEIGHT }} data-vzf="sheet-find" role="search">
          {canFind ? (
            <>
              <input
                ref={findRef}
                className="vzf-sheet-findinput"
                type="text"
                value={findText}
                onChange={(event) => setFindText(event.currentTarget.value)}
                onKeyDown={onFindKeyDown}
                aria-label="find in this table"
                placeholder="find in this table"
              />
              <button type="button" className="vzf-sheet-findnext" onClick={() => void runFind('forward')} aria-label="next match">
                next
              </button>
              <button type="button" className="vzf-sheet-findprev" onClick={() => void runFind('backward')} aria-label="previous match">
                previous
              </button>
              <button type="button" className="vzf-sheet-findclose" onClick={closeFind} aria-label="close find">
                ✕
              </button>
            </>
          ) : (
            // no input at all: one that cannot answer is worse than none, and the
            // sentence says whose refusal it is
            <span className="vzf-sheet-cannot">{findRefusal}</span>
          )}
        </div>
      )}
      <div className="vzf-sheet-status" style={{ height: SHEET_STATUS_HEIGHT }}>
        {/* the readout changes on every scroll: announcing it would talk over everything else */}
        <span className="vzf-sheet-readout" aria-live="off">
          {statusWords(win, shownSort, asked.hidden.length)}
        </span>
        {/* the way back from a hidden column — an ACT, so a sheet with no door has none of it */}
        {canArrange && asked.hidden.length > 0 && (
          <button type="button" className="vzf-sheet-showall" onClick={() => ask('hidden', undefined)}>
            show all
          </button>
        )}
        <span className="vzf-sheet-said" role="status" aria-live="polite">
          {schemaError !== null && <span className="vzf-sheet-refused"> · {schemaError}</span>}
          {refused !== null && <span className="vzf-sheet-refused"> · {refused}</span>}
          {/* what the ARRANGEMENT itself says: the key that cannot be hidden, a name this
              table does not have, an arrangement that left nothing. Said whether or not this
              sheet can arrange anything — a reader of a story page is owed them too. */}
          {arrangementSaid({ key: keyField, hidden, missing, empty: nothingLeft }).map((words) => (
            <span key={words} className="vzf-sheet-refused"> · {words}</span>
          ))}
          {/* a gesture elsewhere that reached this sheet and could judge nothing here — the
              library's own sentence, quoted (`narrowedSaid`). Said in the polite region beside
              the refusals: it is the same register (a fact the rows themselves cannot show) and
              it wears the same word colour, so no new token invents a fourth kind of status. */}
          {narrowedSaid(win).map((words) => (
            <span key={words} className="vzf-sheet-refused"> · {words}</span>
          ))}
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
  /** The sticky offset in pixels when this column is one of the frozen ones, else absent. */
  readonly frozen: number | undefined;
  /** Whether this header has an arrange menu to open at all — false in Present mode, and wherever the host wired no door. */
  readonly menu: boolean;
  readonly menuOpen: boolean;
  readonly onMenu: () => void;
}

/** One column header: the name, the type the facets settled on, a role badge when the role is worth one, and a sort toggle — or the sentence saying why there is none. */
function HeaderCell({ name, facet, index, sort, canSort, refusal, onToggle, frozen, menu, menuOpen, onMenu }: HeaderCellProps): JSX.Element {
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
    <div
      className={`vzf-sheet-cell vzf-sheet-colhead${frozen === undefined ? '' : ' vzf-sheet-frozen'}`}
      role="columnheader"
      aria-colindex={index + 1}
      aria-sort={dir === null ? 'none' : dir === 'asc' ? 'ascending' : 'descending'}
      data-column={name}
      style={frozen === undefined ? undefined : { left: frozen }}
    >
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
      {/* the arrangement's own door: hide, move, freeze — one gesture, one act. `Enter`
          opens it because a button is a button; the strip below takes the focus. */}
      {menu && (
        <button type="button" className="vzf-sheet-menubtn" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`arrange ${name}`} data-vzf-menu={name} onClick={onMenu}>
          ⋯
        </button>
      )}
    </div>
  );
}

interface SheetRowProps {
  readonly row: Row;
  readonly index: number;
  readonly columns: readonly string[];
  readonly numeric: readonly boolean[];
  /** How many LEADING columns stay put under horizontal scroll — at least the key. */
  readonly frozenAt: number;
  readonly rowHeight: number;
  readonly focusedRow: boolean;
  readonly focusedCol: number;
  readonly selected: boolean;
  readonly clickable: boolean;
  readonly onPick: (row: Row) => void;
  readonly onRefuseEdit: (column: string) => void;
}

/** One row: plain text nodes, memoized — a scroll re-renders the rows that moved, never the ones that did not. */
const SheetRow = memo(function SheetRow({ row, index, columns, numeric, frozenAt, rowHeight, focusedRow, focusedCol, selected, clickable, onPick, onRefuseEdit }: SheetRowProps): JSX.Element {
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
          className={`vzf-sheet-cell${numeric[ci] === true ? ' vzf-sheet-num' : ''}${ci < frozenAt ? ' vzf-sheet-frozen' : ''}`}
          role="gridcell"
          aria-colindex={ci + 1}
          tabIndex={focusedRow && focusedCol === ci ? 0 : -1}
          data-vzf-focused={focusedRow && focusedCol === ci ? 'true' : 'false'}
          data-column={name}
          // the cumulative offset the frozen columns stack at — the stylesheet gives every
          // cell ONE width (`SHEET_COLUMN_WIDTH`), which is the only reason it can be computed
          style={ci < frozenAt ? { left: ci * SHEET_COLUMN_WIDTH } : undefined}
          onDoubleClick={() => onRefuseEdit(name)}
        >
          {cellText(row[name])}
        </div>
      ))}
    </div>
  );
});
