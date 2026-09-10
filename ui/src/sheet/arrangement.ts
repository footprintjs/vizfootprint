/**
 * THE ARRANGEMENT — a sheet's sort, what it hides, the order it puts columns
 * in and how many of them stay put, each written down as an ACT.
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
 * FOUR PROPS ON ONE SCOPE, ONE ACT EACH. `sort`, `hidden`, `order` and
 * `frozen` are each one (scope, prop) pair under `layout:sheet:<viewId>`,
 * last-wins, inert, restored per cursor — the same road, not four roads. Two
 * of them earn the act for the same reason the sort does: HIDING a column
 * changes what the next window is even ASKED for (see `arrangeColumns`), and
 * ORDER changes what "the first column" means to every later reader. `frozen`
 * is the softest of the four — it moves no data — but it rides here because a
 * story page that came back with three columns unstuck from the left edge
 * would be showing a different sheet than the one a person left.
 *
 * WHY THE VALUE IS JSON, and not a joined string like the cockpit's `order`:
 * this folder already ruled on it one file over. `httpSheetData` sends
 * `columns` and `sort` as JSON because "a column may be called `a,b`; a joined
 * list could not carry it" — the same hazard, already decided, so this follows
 * that ruling rather than inventing a second grammar. JSON also round-trips
 * `absent` and a multi-key spec exactly, so nothing is silently truncated.
 * ONE grammar helper (`fromJsonValue`) reads all four props, so there are
 * never four parsers to disagree about a blank value or a poll's `null` leaf.
 * The plain words a person reads on the rail ride the cause's INTENT, exactly
 * as `setLayout`'s do ("layout order: a, b") — the value is for the machine,
 * the intent is for the reader.
 *
 * FIRST CUSTOMERS: `<Sheet>` (which no longer holds an arrangement of its
 * own), `SessionView.setSheetArrangement` (the act), and any host reading the
 * arrangement back out of `SessionViewState.layouts` at the cursor.
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

/** The prop the hidden columns ride: a JSON list of column names. */
export const SHEET_HIDDEN_PROP = 'hidden';

/** The prop the leading column order rides: a JSON list of names; columns it does not name follow in the engine's order. */
export const SHEET_ORDER_PROP = 'order';

/** The prop the frozen count rides: a JSON number — how many LEADING columns stay put under horizontal scroll. */
export const SHEET_FROZEN_PROP = 'frozen';

/**
 * The layout fold as a host holds it: scope → prop → value
 * (`SessionViewState.layouts`). Every reader here takes it, so a host never
 * has to restate the shape to read one prop back.
 */
export type SheetLayoutFold = Readonly<Record<string, Readonly<Record<string, string>>>>;

/**
 * WHAT EACH PROP'S VALUE IS — one table, so a door, a codec and a sentence can
 * never disagree about a prop's shape. The four readers, the writer, the words
 * and `SessionView.setSheetArrangement` are all typed off it, and adding a
 * fifth prop here makes the compiler name every place that must learn it.
 */
export interface SheetArrangementValues {
  /** The order the rows come in. `undefined` = the table's own. */
  readonly sort: readonly SortSpec[] | undefined;
  /** The columns a person took off the screen. `undefined` = none. */
  readonly hidden: readonly string[] | undefined;
  /** The LEADING order of the columns; anything unnamed follows in the engine's own order. `undefined` = the engine's. */
  readonly order: readonly string[] | undefined;
  /** How many leading columns stay put under horizontal scroll. `undefined` = one (the key alone). */
  readonly frozen: number | undefined;
}

/** Which of the four arrangement props an act is about. */
export type SheetArrangementProp = keyof SheetArrangementValues;

/** The layout SCOPE for one sheet: `sheet:<viewId>`. Two sheets on one dashboard never share an arrangement. */
export function sheetLayoutScope(viewId: string): string {
  return `${SHEET_LAYOUT_KIND}:${viewId}`;
}

/** The `viewId` a sheet's arrangement commit lands under: `layout:sheet:<viewId>`. */
export function sheetLayoutViewId(viewId: string): string {
  return `${SHEET_LAYOUT_PREFIX}${sheetLayoutScope(viewId)}`;
}

/**
 * NO ARRANGEMENT, as the commit carries it: the EMPTY string. A layout note's
 * value must be a plain string, so "sorted by nothing" and "nothing hidden"
 * are WRITTEN DOWN rather than left off the trace — which is what makes
 * clearing an act a reader can account for.
 */
const CLEARED = '';

/**
 * THE ONE READER all four props share — total, and defensive in the way
 * `parseLayout` is: a blank value, a leaf that is not text at all (`layouts`
 * reaches these readers straight off a poll's JSON, where a leaf can be
 * `null` and `.length` would throw), text that is not JSON, or a shape this
 * version does not know all read as NO arrangement. A stale or foreign wire
 * renders the table's own columns in the table's own order, which is honest,
 * rather than an arrangement nobody asked for.
 */
function fromJsonValue<T>(value: string | undefined, holds: (parsed: unknown) => parsed is T): T | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined; // WHY: an unreadable arrangement is no arrangement — never a guessed one
  }
  return holds(parsed) ? parsed : undefined;
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

/** A whole sort spec: at least one key, every one of them a key this version knows. */
function holdsSortSpec(value: unknown): value is readonly SortSpec[] {
  return Array.isArray(value) && value.length > 0 && value.every(holdsSortKey);
}

/**
 * A LIST OF COLUMN NAMES, as `hidden` and `order` both carry one: at least one
 * name, every name real text, and no name twice.
 *
 * WHY a duplicate is refused rather than deduped: it is the sort's law over
 * again — one bad member makes the whole arrangement one nobody asked for, and
 * a codec that quietly repaired a wire would hide the drift that produced it.
 */
function holdsNameList(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every((name) => typeof name === 'string' && name.length > 0)) return false;
  return new Set(value as string[]).size === value.length;
}

/**
 * HOW MANY COLUMNS STAY PUT, as the wire carries it: a whole number, at least
 * one. There is no zero — the key column is the row's identity and is always
 * frozen first (R3) — so `1` and "no arrangement" are the SAME arrangement,
 * and `frozenToLayoutValue` writes the cleared string for both.
 */
function holdsFrozen(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * THE COUNT AN ARRANGEMENT MEANS, whatever it carries: at least one, whole.
 * ONE owner, spent by the writer, the words and the grid alike — so the value
 * on the trace, the sentence on the rail and the columns that actually stay
 * put can never be three different numbers.
 */
export function frozenCount(frozen: number | undefined): number {
  return frozen === undefined || !Number.isFinite(frozen) ? 1 : Math.max(1, Math.floor(frozen));
}

/** The sort as the commit carries it. No sort is the cleared string, which is how a sort is CLEARED. */
export function sortToLayoutValue(sort: readonly SortSpec[] | undefined): string {
  return sort === undefined || sort.length === 0 ? CLEARED : JSON.stringify(sort);
}

/** The sort back out of the commit — total: see `fromJsonValue`. */
export function sortFromLayoutValue(value: string | undefined): readonly SortSpec[] | undefined {
  return fromJsonValue(value, holdsSortSpec);
}

/** The hidden columns as the commit carries them. Nothing hidden is the cleared string. */
export function hiddenToLayoutValue(hidden: readonly string[] | undefined): string {
  return hidden === undefined || hidden.length === 0 ? CLEARED : JSON.stringify(hidden);
}

/** The hidden columns back out of the commit — total. */
export function hiddenFromLayoutValue(value: string | undefined): readonly string[] | undefined {
  return fromJsonValue(value, holdsNameList);
}

/** The leading column order as the commit carries it. No order is the cleared string. */
export function orderToLayoutValue(order: readonly string[] | undefined): string {
  return order === undefined || order.length === 0 ? CLEARED : JSON.stringify(order);
}

/** The leading column order back out of the commit — total. */
export function orderFromLayoutValue(value: string | undefined): readonly string[] | undefined {
  return fromJsonValue(value, holdsNameList);
}

/** The frozen count as the commit carries it. One column — the key alone, this grid's own law — is the cleared string. */
export function frozenToLayoutValue(frozen: number | undefined): string {
  const count = frozenCount(frozen);
  return count <= 1 ? CLEARED : JSON.stringify(count);
}

/** The frozen count back out of the commit — total. */
export function frozenFromLayoutValue(value: string | undefined): number | undefined {
  return fromJsonValue(value, holdsFrozen);
}

/**
 * THE FOUR CODECS IN ONE TABLE, keyed by the prop each one rides.
 *
 * WHY a record and not a switch: the mapped type makes it TOTAL, so a fifth
 * prop added to `SheetArrangementValues` is a compile error here rather than a
 * prop that silently reads as nothing. The act door and the readers both spend
 * this, which is what keeps one prop's grammar in one place.
 */
const CODECS: { readonly [P in SheetArrangementProp]: { readonly write: (value: SheetArrangementValues[P]) => string; readonly read: (raw: string | undefined) => SheetArrangementValues[P] } } = {
  sort: { write: sortToLayoutValue, read: sortFromLayoutValue },
  hidden: { write: hiddenToLayoutValue, read: hiddenFromLayoutValue },
  order: { write: orderToLayoutValue, read: orderFromLayoutValue },
  frozen: { write: frozenToLayoutValue, read: frozenFromLayoutValue },
};

/** One prop's value, as the commit will carry it. The act door's only writer. */
export function arrangementToLayoutValue<P extends SheetArrangementProp>(prop: P, value: SheetArrangementValues[P]): string {
  // WHY the cast: `CODECS[prop]` is the union of the four entries until `prop` is a
  // single literal, and the mapped type above has already pinned each pair together
  return (CODECS[prop].write as (value: SheetArrangementValues[P]) => string)(value);
}

/**
 * ONE PROP AT THE CURSOR — the arrangement this sheet is in, read off the
 * session's layout fold (`SessionViewState.layouts`). A session standing
 * before any act landed — or one whose source is older than this door — has
 * none, which reads as the table's own columns in the table's own order.
 */
export function sheetArrangementOf<P extends SheetArrangementProp>(layouts: SheetLayoutFold | undefined, viewId: string, prop: P): SheetArrangementValues[P] {
  return (CODECS[prop].read as (raw: string | undefined) => SheetArrangementValues[P])(layouts?.[sheetLayoutScope(viewId)]?.[prop]);
}

/** THE READER a host wires the sheet's `sort` prop from. */
export function sheetSortOf(layouts: SheetLayoutFold | undefined, viewId: string): readonly SortSpec[] | undefined {
  return sheetArrangementOf(layouts, viewId, SHEET_SORT_PROP);
}

/** THE READER a host wires the sheet's `hidden` prop from. */
export function sheetHiddenOf(layouts: SheetLayoutFold | undefined, viewId: string): readonly string[] | undefined {
  return sheetArrangementOf(layouts, viewId, SHEET_HIDDEN_PROP);
}

/** THE READER a host wires the sheet's `order` prop from. */
export function sheetOrderOf(layouts: SheetLayoutFold | undefined, viewId: string): readonly string[] | undefined {
  return sheetArrangementOf(layouts, viewId, SHEET_ORDER_PROP);
}

/** THE READER a host wires the sheet's `frozen` prop from. */
export function sheetFrozenOf(layouts: SheetLayoutFold | undefined, viewId: string): number | undefined {
  return sheetArrangementOf(layouts, viewId, SHEET_FROZEN_PROP);
}

/** The visible projection an arrangement makes of one table's columns, and what it names that the table does not have. */
export interface ArrangedColumns {
  /** The columns to ask for and to draw, in order: the key first, then the names `order` leads with, then the engine's own. */
  readonly columns: readonly string[];
  /** The columns actually hidden — present in this table, and not the key. What the readout counts and "show all" clears. */
  readonly hidden: readonly string[];
  /** Names the arrangement holds that this table does not have — said once, never a silent rewrite of the trace (R6). */
  readonly missing: readonly string[];
}

/**
 * THE ARRANGEMENT APPLIED — the one owner of what a sheet asks for and what it
 * draws.
 *
 * Two laws live here and nowhere else:
 *
 * **The key is never hidden and always first (R3).** It is the row's identity:
 * a row click selects on it, the window names it, and a grid whose identity
 * column had been taken away could still be scrolled but no longer read. So a
 * `hidden` list naming the key does not hide it, and an `order` list that puts
 * it second does not move it. (The refusal a person SEES for trying is the
 * grid's — `Sheet.tsx` — because only the grid has a status line.)
 *
 * **A name the table does not have is IGNORED, not repaired (R6).** A branch
 * without the derived column, or a refreshed schema that dropped one, leaves
 * the trace holding a name that no longer resolves. Rewriting the trace to
 * match would be forging the record of an act; refusing to draw would be a
 * broken grid. So the name is skipped and RETURNED in `missing`, for the grid
 * to say once in words.
 *
 * Called TWICE per render, deliberately: over the columns the sheet knows
 * about (what the next window ASKS for — a hidden column is never read, R4)
 * and over the columns the engine ANSWERED (what the grid draws). Same law
 * both times.
 */
export function arrangeColumns(engineColumns: readonly string[], key: string | undefined, arrangement: { readonly order?: readonly string[]; readonly hidden?: readonly string[] }): ArrangedColumns {
  const has = new Set(engineColumns);
  const named = [...(arrangement.order ?? []), ...(arrangement.hidden ?? [])];
  const hidden = (arrangement.hidden ?? []).filter((name) => has.has(name) && name !== key);
  const away = new Set(hidden);
  // the leading order, minus what is hidden (an arrangement that both hides and
  // leads with a column is not a contradiction: hiding it wins, and the order
  // keeps the name for when it comes back)
  const leading = (arrangement.order ?? []).filter((name) => has.has(name) && !away.has(name) && name !== key);
  const led = new Set(leading);
  const rest = engineColumns.filter((name) => !away.has(name) && !led.has(name) && name !== key);
  const body = [...leading, ...rest];
  return {
    columns: key !== undefined && has.has(key) ? [key, ...body] : body,
    hidden,
    missing: [...new Set(named.filter((name) => !has.has(name)))],
  };
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

/** Do two name lists hold the same names in the same places? The one comparison the "moved X first" sentence rests on. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/**
 * THE FOUR SENTENCES, one per prop — each WITHOUT the sheet's name, which
 * `arrangementWords` puts in front of all four so no prop can spell the
 * heading its own way.
 *
 * Mapped over the same value table as the codecs, so a fifth prop is a compile
 * error here too: an act that landed with no words would be a step on the
 * trace a reader could not account for.
 */
const SENTENCES: { readonly [P in SheetArrangementProp]: (before: SheetArrangementValues[P], after: SheetArrangementValues[P]) => string } = {
  // the sort names EVERY key (see `sortedByWords`) — the before is not needed: an
  // order is stated whole, never as a change to another one
  sort: (_before, after) => (after === undefined || after.length === 0 ? 'sort cleared' : sortedByWords(after)),
  hidden: (before, after) => {
    const was = before ?? [];
    const now = after ?? [];
    if (now.length === 0) return 'showed every column'; // the readout's "show all", said as what it did
    const gained = now.filter((name) => !was.includes(name));
    const lost = was.filter((name) => !now.includes(name));
    // ONE column at a time is what the header menu lands, so that is the sentence a
    // reader sees for a gesture: the name, not a tally
    if (gained.length === 1 && lost.length === 0) return `hid ${gained[0]!}`;
    if (lost.length === 1 && gained.length === 0) return `showed ${lost[0]!}`;
    // a WHOLE list landed at once (a host restoring one, never a menu gesture): the
    // count is the honest summary, and the commit's own value is the account of which
    return `hid ${now.length} ${now.length === 1 ? 'column' : 'columns'}`;
  },
  order: (before, after) => {
    const was = before ?? [];
    const now = after ?? [];
    if (now.length === 0) return 'order cleared';
    const first = now[0]!;
    // "move first" is one name pulled to the front with nothing else disturbed — the
    // sentence for the gesture; anything else states the leading order whole
    if (sameNames(now.slice(1), was.filter((name) => name !== first))) return `moved ${first} first`;
    return `order ${now.join(', ')}`;
  },
  // one frozen column is this grid's own law (the key stays put), so landing it is
  // UNFREEZING — never "froze 1 column", which would claim an act that changed nothing
  frozen: (_before, after) => {
    const count = frozenCount(after);
    return count <= 1 ? 'unfroze' : `froze ${count} columns`;
  },
};

/**
 * THE PLAIN WORDS the commit rail shows for one arrangement act — the cause's
 * intent, never the value.
 *
 * ONE owner of every sentence, for the same reason `sortArrow` owns the glyph
 * pair: the rail is the only account a person scrolling past an act has, and
 * two doors writing their own words would eventually disagree about what the
 * same gesture did.
 */
export function arrangementWords<P extends SheetArrangementProp>(viewId: string, prop: P, before: SheetArrangementValues[P], after: SheetArrangementValues[P]): string {
  // WHY the cast: `SENTENCES[prop]` is the union of the four writers until `prop` is a
  // single literal — the mapped type has already pinned each sentence to its own prop
  const say = SENTENCES[prop] as (before: SheetArrangementValues[P], after: SheetArrangementValues[P]) => string;
  return `${viewId}: ${say(before, after)}`;
}

/**
 * The words a SORT act lands with — kept as its own name because it is the one
 * arrangement whose sentence a caller with no BEFORE can still write, and
 * because `setSheetSort` was public before the other three existed.
 */
export function sortWords(viewId: string, sort: readonly SortSpec[] | undefined): string {
  return arrangementWords(viewId, SHEET_SORT_PROP, undefined, sort);
}

/** One item in a header's arrange menu: the words a person reads, and the ONE (prop, value) act it lands. */
export interface SheetArrangeItem {
  readonly label: string;
  readonly prop: SheetArrangementProp;
  readonly value: SheetArrangementValues[SheetArrangementProp];
}

/** Where a menu is being opened: the columns on screen, which one is the key, and what the trace already holds. */
export interface ArrangeAt {
  /** The columns as the grid DREW them — `arrangeColumns(…).columns`, so an item moves what a person can see. */
  readonly drawn: readonly string[];
  /** The declared row key, when the window named one: never hidden, never moved (R3). */
  readonly key: string | undefined;
  readonly hidden: readonly string[] | undefined;
  readonly order: readonly string[] | undefined;
  readonly frozen: number | undefined;
}

/** Two names swapped, everything else left where it was — what "move left" and "move right" land. */
function swapped(names: readonly string[], a: number, b: number): readonly string[] {
  const next = [...names];
  next[a] = names[b]!;
  next[b] = names[a]!;
  return next;
}

/**
 * WHAT ONE HEADER'S MENU OFFERS — pure, so the grammar of these acts is
 * testable without a DOM, and so the grid never invents a value the codec
 * would refuse.
 *
 * Every item is ONE (prop, value) pair, which is what makes each gesture one
 * commit. Three rules decide what is on the list:
 *
 * - **The key is neither hidden nor moved (R3)**, so its header offers only the
 *   freeze item — and a menu with nothing on it is not offered at all.
 * - **An item that would change nothing is not offered.** "Move left" on the
 *   first movable column, "move right" on the last, and "freeze up to here"
 *   where it already is would each land a commit a reader could not account
 *   for.
 * - **"Move first" lands the LEADING order, not the whole list**, so the rail
 *   reads "moved region first"; "move left"/"move right" name every movable
 *   column, because a swap deeper in the list cannot be said any shorter.
 */
export function arrangeItems(name: string, at: ArrangeAt): readonly SheetArrangeItem[] {
  const items: SheetArrangeItem[] = [];
  const movable = at.drawn.filter((column) => column !== at.key);
  const i = movable.indexOf(name);
  if (i >= 0) {
    items.push({ label: 'hide', prop: 'hidden', value: [...(at.hidden ?? []).filter((column) => column !== name), name] });
    if (i > 0) items.push({ label: 'move left', prop: 'order', value: swapped(movable, i, i - 1) });
    if (i < movable.length - 1) items.push({ label: 'move right', prop: 'order', value: swapped(movable, i, i + 1) });
    if (i > 0) items.push({ label: 'move first', prop: 'order', value: [name, ...(at.order ?? []).filter((column) => column !== name)] });
  }
  // the freeze item counts from the KEY (R3) and is placed by where the column is
  // DRAWN, so "up to here" means what a person's eye means by it
  const upTo = at.drawn.indexOf(name) + 1;
  const now = frozenCount(at.frozen);
  if (upTo > now) items.push({ label: 'freeze up to here', prop: 'frozen', value: upTo });
  else if (now > 1) items.push({ label: 'unfreeze', prop: 'frozen', value: undefined });
  return items;
}

/**
 * WHAT THE STATUS LINE SAYS ABOUT THE ARRANGEMENT ITSELF — the facts a person
 * cannot otherwise learn, and NOTHING when there is nothing to say.
 *
 * All three are about the trace disagreeing with the table, never about a door
 * a host did not wire, which is why they are said whether or not this sheet can
 * arrange anything: a reader of a story page is owed them too.
 *
 * - The KEY cannot be hidden (R3). A trace may hold a list that names it — a
 *   host landing one by hand, an older wire — and the grid keeps drawing it and
 *   says why, rather than obeying and leaving a grid nobody can read.
 * - A name the table does not have is IGNORED (R6): a branch without the derived
 *   column, or a refreshed schema that dropped one. Said once; the trace is never
 *   rewritten to match, because that would forge the record of an act.
 * - An arrangement that hides EVERY column leaves nothing to read. The grid asks
 *   for no window at all rather than quietly showing the whole table back, and
 *   the "show all" control beside this sentence is the way out.
 */
export function arrangementSaid(said: { readonly key: string | undefined; readonly hidden: readonly string[] | undefined; readonly missing: readonly string[]; readonly empty: boolean }): readonly string[] {
  const words: string[] = [];
  if (said.key !== undefined && (said.hidden ?? []).includes(said.key)) words.push(`the key column ${said.key} is the row's identity — it cannot be hidden`);
  if (said.missing.length > 0) words.push(`the arrangement names ${said.missing.join(', ')}, which this table does not have`);
  if (said.empty) words.push('the arrangement hides every column — show one to read the rows');
  return words;
}
