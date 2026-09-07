/**
 * THE ARRANGEMENT — a sheet's sort, written down as an ACT.
 *
 * THE LAW IT FOLLOWS: a read asks a question; an ACT changes what the next
 * question is asked of. Scrolling is a read — `offset` moves where you stand
 * in one fixed order, and two people scrolled to different rows have not
 * changed each other's dashboard. A SORT is not that: it replaces the order
 * itself, so it changes what row 1 IS for every window afterwards, including
 * one a story page replays or a colleague opens. The library had already drawn
 * this exact line for the charts — a pan/zoom `navigate` on a declared view
 * lands NO commit (a viewport is never a data claim), while a `layout:${scope}`
 * navigate LANDS one and `rebuildFold` restores it per cursor. The sheet's
 * scroll is the pan/zoom; the sheet's sort is the layout.
 *
 * So the sort lands through the verb it already had. `navigate` on
 * `layout:sheet:<viewId>` (the library's LY-1 door) lands ONE cause-tagged
 * commit that is INERT by construction — it never filters, never enters a row
 * count, never reaches `foldDiff` — and that is why an arrangement can be
 * recorded without becoming a data claim. **No verb was added: the vocabulary
 * stays at ten.**
 *
 * WHY THE VALUE IS JSON, and not a joined string like the cockpit's `order`:
 * this folder already ruled on it one file over. `httpSheetData` sends
 * `columns` and `sort` as JSON because "a column may be called `a,b`; a joined
 * list could not carry it" — the same hazard, already decided, so this follows
 * that ruling rather than inventing a second grammar. JSON also round-trips
 * `absent` and a multi-key spec exactly, so nothing is silently truncated. The
 * plain words a person reads on the rail ride the cause's INTENT, exactly as
 * `setLayout`'s do ("layout order: a, b") — the value is for the machine, the
 * intent is for the reader.
 *
 * FIRST CUSTOMERS: `<Sheet>` (which no longer holds a sort of its own),
 * `SessionView.setSheetSort` (the act), and any host reading the arrangement
 * back out of `SessionViewState.layouts` at the cursor.
 *
 * Everything here is a plain function over its arguments — no React, no
 * session, no engine. Given the same layouts map the answers are the same
 * every time, which is what lets a build script, a test and a browser share
 * them.
 */
import type { SortSpec } from 'vizfootprint/data';

/**
 * The synthetic identity a sheet's arrangement lands under — the library's
 * `layout:` namespace (LY-1). STATED here rather than imported, the same way
 * `LAYOUT_DASHBOARD_VIEW_ID` is one folder over: a host reading a poll's
 * layouts should not need a value import of `vizfootprint/branches` to read a
 * sort back. That makes it a COPY, so it is pinned byte-for-byte against
 * `LAYOUT_VIEW_PREFIX` in `arrangement.test.ts` (a test-only value import) —
 * drift here would land every sort under an identity the session no longer
 * routes as a layout note, and refuse the act on a view nobody declared.
 */
export const SHEET_LAYOUT_PREFIX = 'layout:';

/** The scope segment that says WHICH kind of thing is arranged. `layout:sheet:<viewId>` — one scope per sheet. */
export const SHEET_LAYOUT_KIND = 'sheet';

/** The arrangement prop the sort rides, beside the cockpit's `preset` / `order` / `focus`. */
export const SHEET_SORT_PROP = 'sort';

/** The layout SCOPE for one sheet: `sheet:<viewId>`. Two sheets on one dashboard never share an arrangement. */
export function sheetLayoutScope(viewId: string): string {
  return `${SHEET_LAYOUT_KIND}:${viewId}`;
}

/** The `viewId` a sheet's arrangement commit lands under: `layout:sheet:<viewId>`. */
export function sheetLayoutViewId(viewId: string): string {
  return `${SHEET_LAYOUT_PREFIX}${sheetLayoutScope(viewId)}`;
}

/** The whole vocabulary of a sort key — a wire carrying anything else is a shape this version does not know. */
const SORT_KEY_SLOTS: readonly string[] = ['field', 'dir', 'absent'];

/** Is this a sort key the window port would accept? A foreign or half-written one is not. */
function holdsSortKey(value: unknown): value is SortSpec {
  if (value === null || typeof value !== 'object') return false;
  const key = value as { field?: unknown; dir?: unknown; absent?: unknown };
  if (typeof key.field !== 'string' || key.field.length === 0) return false;
  if (key.dir !== 'asc' && key.dir !== 'desc') return false;
  if (!(key.absent === undefined || key.absent === 'first' || key.absent === 'last')) return false;
  // WHY an unknown KEY is refused, not ignored: the window port drops a prop it
  // does not know, so a newer wire's "cases ascending, some third rule" would
  // render as "cases ascending" — an order nobody asked for, which is the one
  // thing this codec exists to prevent. The table's own order is the honest read.
  return Object.keys(key).every((k) => SORT_KEY_SLOTS.includes(k));
}

/**
 * The arrangement as the commit carries it. No sort is the EMPTY string, which
 * is how a sort is CLEARED: a layout note's value must be a plain string, so
 * "sorted by nothing" is written down rather than left off the trace.
 */
export function sortToLayoutValue(sort: readonly SortSpec[] | undefined): string {
  return sort === undefined || sort.length === 0 ? '' : JSON.stringify(sort);
}

/**
 * The arrangement back out of the commit — total, and defensive in the way
 * `parseLayout` is: a blank value, text that is not JSON, or a shape this
 * version does not know reads as NO sort. A stale or foreign wire renders the
 * table's own order, which is honest, rather than an order nobody asked for.
 */
export function sortFromLayoutValue(value: string | undefined): readonly SortSpec[] | undefined {
  // a TYPE test, not just `=== undefined`: `layouts` reaches this reader straight
  // off a poll's JSON, where the leaf can be `null` and `.length` would throw
  if (typeof value !== 'string' || value.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined; // WHY: an unreadable arrangement is no arrangement — never a guessed one
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  return parsed.every(holdsSortKey) ? (parsed as readonly SortSpec[]) : undefined;
}

/**
 * THE READER a host wires the sheet's `sort` prop from: the arrangement this
 * sheet is in AT THE CURSOR, read off the session's layout fold
 * (`SessionViewState.layouts`). A session standing before any sort landed —
 * or one whose source is older than this door — has none, which reads as the
 * table's own order.
 */
export function sheetSortOf(layouts: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined, viewId: string): readonly SortSpec[] | undefined {
  return sortFromLayoutValue(layouts?.[sheetLayoutScope(viewId)]?.[SHEET_SORT_PROP]);
}

/** Which way a direction runs, as the ONE glyph pair this folder speaks — the rail, the readout and the header all spend it. */
export function sortArrow(dir: SortSpec['dir']): string {
  return dir === 'asc' ? '↑' : '↓';
}

/** One sort key in the words a person reads: the column, and which way it runs. */
export function sortPhraseOf(key: SortSpec): string {
  return `${key.field} ${sortArrow(key.dir)}`;
}

/**
 * The whole arrangement in words — EVERY key, in order. WHY not "and 2 more":
 * two different arrangements of the same length would then read identically, and
 * the words are the only account of the act a person scrolling the rail has.
 * `setLayout`'s `order` note names every member for the same reason.
 */
export function sortedByWords(sort: readonly SortSpec[]): string {
  return `sorted by ${sort.map(sortPhraseOf).join(', ')}`;
}

/**
 * The plain words the commit rail shows for this arrangement — the cause's
 * intent, never the value. A cleared sort says so: a commit whose words were
 * blank would be a step on the trace a reader could not account for.
 */
export function sortWords(viewId: string, sort: readonly SortSpec[] | undefined): string {
  if (sort === undefined || sort.length === 0) return `${viewId}: sort cleared`;
  return `${viewId}: ${sortedByWords(sort)}`;
}
