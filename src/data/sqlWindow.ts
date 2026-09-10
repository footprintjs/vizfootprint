/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WINDOW AROUND THE WHERE — ONE STATEMENT BUILDER, NO ENGINE.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `resolvePredicateSQL` (./predicate.ts) says WHICH ROWS. Nothing until now
 * said which COLUMNS, in WHAT ORDER, and HOW MANY — every caller was going to
 * concatenate that itself, and two concatenations of the same `EvaluateOptions`
 * can disagree about the answer silently (a dropped `NULLS LAST`, a `WHERE
 * null` that quietly returns no rows at all, an `OFFSET` in a count).
 *
 * THE LAW IT FOLLOWS: one statement builder around the one WHERE fragment. It
 * is PURE — no DuckDB, no connection, no async — so the SQL a window will run
 * can be pinned by a test before any engine exists, and the wasm engine and a
 * server engine cannot drift about what the same options MEAN.
 *
 * WHAT IT REFUSES, in a sentence: a malformed window — a negative or fractional
 * `limit`/`offset` → `bad-window`, the same sentence `memoryProvider`'s
 * `badWindowValue` already refuses in. That is the whole list. It throws
 * `WindowRefusal` rather than returning a `DataProviderRejection`, because a
 * builder has no `ResolvedEngine` to name; the provider that catches it
 * converts one field — `reject(engine, 'evaluate', err.reason, err.message)`.
 *
 * WHAT IT NO LONGER REFUSES: a sort key the projection drops. SQL orders by a
 * column it does not return, the memory engine has always answered that window,
 * and two engines answering the same options differently is the one thing this
 * module exists to prevent — so it is LEGAL, said once in src/data/README.md.
 *
 * WHAT IT ADDS TO EVERY ORDER: the source-order column as the last key, for a
 * table this engine loaded (see {@link WindowTableFacts}). An `ORDER BY` over a
 * tied column is not a total order, and two pages of one window are two scans:
 * without a final unique key a paged sorted window serves a row twice and
 * another never.
 *
 * WHAT IT ADDS TO A PAGE THAT ASKED FOR NO ORDER AT ALL: the same column, as
 * the ONLY key. An unsorted window is not a total order either — every row is
 * tied with every other — so `LIMIT 50 OFFSET 50` over a bare scan is exposed
 * exactly as the tied sort was, and the sheet pages unsorted. A full unpaged
 * read stays unordered: order only matters where a page boundary can fall, and
 * a read with no boundary in it pays nothing for one.
 *
 * FIRST CUSTOMERS: the in-browser (wasm/DuckDB) engine being built on top of
 * this — `wasmProvider`'s `evaluate` — and its loader, which owes this module
 * the `__row` column named below.
 */
import { badFindReason, type EvaluateOptions, type FindOptions, type RejectionReason, type SortSpec } from './types.js';
import { isClearedSQL, quoteIdent } from './predicate.js';

// ── The data: the convention, the one reason, the refusal, the table. ────

/**
 * The source-order column. DuckDB does not promise insertion order — a `SELECT`
 * with no `ORDER BY` may come back in any order, and a filter, a hash join or a
 * parallel scan will happily change it between two runs of the SAME query. So
 * "the 4th row of the table" is not a thing DuckDB can be asked for after the
 * fact. WHY the engine will load every table with an explicit row-order column
 * (`__row`, 0-based, assigned once at load): a positional row identity
 * (`<version>#<index>`, the session's id for a table that declares no key) has
 * to be READ from the rows, never inferred from their arrival order.
 * `indices: true` is the request for it.
 */
export const ROW_ORDER_COLUMN = '__row';

/**
 * The ways a statement this module builds can be refused — the data port's own
 * reason codes, narrowed to what a pure builder can see: a malformed WINDOW
 * (`bad-window`) and a malformed FIND (`bad-find`, judged by the port's own
 * `badFindReason` so both engines refuse in one set of words).
 *
 * WHY `unsupported-sort` is not among them: it used to be, for a sort key the
 * projection dropped. That is now legal in BOTH engines (the projection/sort law
 * in src/data/README.md), so no builder can raise it; an engine that cannot sort
 * at all still refuses in that word, from its own door (`serverProvider`).
 */
export type WindowRefusalReason = Extract<RejectionReason, 'bad-window' | 'bad-find'>;

/** A refused window, carrying the reason a provider will re-say as a typed `DataProviderRejection`. */
export class WindowRefusal extends Error {
  readonly reason: WindowRefusalReason;

  constructor(reason: WindowRefusalReason, detail: string) {
    super(detail);
    this.name = 'WindowRefusal';
    this.reason = reason;
  }
}

/**
 * What the builder knows about the table beyond its name: whether it carries
 * {@link ROW_ORDER_COLUMN}, i.e. whether this engine LOADED it.
 *
 * A fact, not an option: the caller reads it off the table's own `DESCRIBE`
 * (`wasmProvider`), never off what a reader asked for — a foreign table a host
 * pointed at has no such column, and ordering by it would be a syntax error
 * instead of a tie-break.
 */
export interface WindowTableFacts {
  readonly hasRowOrder: boolean;
}

// ── The one operation. ───────────────────────────────────────────────────

/**
 * The statement for one `evaluate` call: the rows the fragment keeps, in the
 * window the options ask for.
 *
 * `rows` mode → `SELECT <columns or *> FROM "t" [WHERE …] [ORDER BY …] [LIMIT n] [OFFSET n]`
 * `count` mode → `SELECT COUNT(*) AS n FROM "t" [WHERE …]`
 *
 * @param whereFragment a resolved predicate (`resolvePredicateSQL`); `''` or
 *   the cleared descriptor means no filter and no `WHERE` at all.
 */
export function windowSQL(table: string, whereFragment: string, options?: EvaluateOptions, facts?: WindowTableFacts): string {
  // WHY judged before anything is rendered, and in BOTH modes: a malformed
  // window is malformed whichever mode asks it (`memoryProvider` refuses it in
  // both), so flipping to `count` can never launder a bad number.
  judgeNumbers(options?.limit, options?.offset);

  const from = `FROM ${quoteIdent(table)}`;
  const where = whereClause(whereFragment);

  if (options?.mode === 'count') {
    // WHY no ORDER BY / LIMIT / OFFSET in count mode: a count is ONE row. An
    // order over it orders nothing, and the window would cap the answer rather
    // than the rows it counts — `OFFSET 10` would report no count whatsoever.
    // How many rows match is a property of the predicate, not of the window.
    return joinParts(['SELECT COUNT(*) AS n', from, where]);
  }

  const projection = projectionOf(options);

  return joinParts([
    `SELECT ${selectList(projection)}`,
    from,
    where,
    orderByClause(options?.sort, facts?.hasRowOrder === true, isPaged(options)),
    limitClause(options?.limit),
    offsetClause(options?.offset),
  ]);
}

// ── find(): where is the next match, in THIS order. ──────────────────────

/** The position column a find numbers the view with — 0-based, so it IS the `offset` the next window opens at. */
export const FIND_POSITION_COLUMN = '__pos';
/** The match's 1-based place among the matches, in view order — "match 3 of 12" is this and `matches`. */
export const FIND_ORDINAL_COLUMN = '__ordinal';
/** The CTE names the two statements share. Prefixed like every bookkeeping name this engine adds, so a real column cannot be shadowed by one. */
const VIEW_CTE = '__view';
const FOUND_CTE = '__found';

/**
 * The two statements one `find` call runs.
 *
 * WHY TWO and not one: the hit statement answers at most one row, and a
 * direction with nothing in it answers NONE — which is exactly the case where
 * `matches` still has to be honest ("no match ahead; there are 12 behind you").
 * A count that rode along inside the hit row would vanish with it. This is the
 * same shape `evaluate` already runs (its window plus its count) for the same
 * reason: how many rows match is a property of the view, not of where you stand.
 */
export interface FindStatements {
  /** One row at most: the position, the source-order index, the ordinal, and the row's columns. */
  readonly hit: string;
  /** `SELECT COUNT(*) AS n` over the whole view — the count a reader is told. */
  readonly matches: string;
}

/**
 * The statements for one `find` call: where the next match is, in the order the
 * reader is standing in.
 *
 * ONE OWNER OF THE ORDER: the position is `ROW_NUMBER()` over the SAME keys
 * `windowSQL` renders (`sortKeySQL` + {@link tieBreak}), so position N here is
 * the row `offset: N` serves there. Anything else would send a reader to a row
 * that is not the one they were shown.
 *
 * THE SOURCE-ORDER KEY IS UNCONDITIONAL. `windowSQL` may leave an order off (an
 * unpaged read has no boundary to protect); a POSITION is nothing but a
 * boundary, so a find over a table without {@link ROW_ORDER_COLUMN} cannot be
 * answered at all — the provider refuses that table in its own words BEFORE
 * calling this, exactly as it already refuses `indices: true` on one.
 *
 * @param whereFragment a resolved predicate (`resolvePredicateSQL`); `''` or the
 *   cleared descriptor means no filter and no `WHERE` at all.
 */
export function findSQL(table: string, whereFragment: string, options: FindOptions): FindStatements {
  // WHY judged before anything is rendered: the port's own judgement of the ask,
  // in the words the memory engine refuses in — one vocabulary, both engines.
  const bad = badFindReason(options);
  if (bad !== undefined) throw new WindowRefusal('bad-find', bad);

  const from = String(options.from);
  const forward = options.direction === 'forward';
  const tests = textTests(options.columns, options.text);
  const view = `${VIEW_CTE} AS (SELECT (ROW_NUMBER() OVER (ORDER BY ${findOrderBy(options.sort)})) - 1 AS ${FIND_POSITION_COLUMN}, * ${joinParts([`FROM ${quoteIdent(table)}`, whereClause(whereFragment)])})`;
  const found = `${FOUND_CTE} AS (SELECT (ROW_NUMBER() OVER (ORDER BY ${FIND_POSITION_COLUMN} ASC)) AS ${FIND_ORDINAL_COLUMN}, * FROM ${VIEW_CTE} WHERE ${tests})`;
  return {
    hit: `WITH ${view}, ${found} SELECT * FROM ${FOUND_CTE} WHERE ${FIND_POSITION_COLUMN} ${forward ? '>=' : '<='} ${from} ORDER BY ${FIND_POSITION_COLUMN} ${forward ? 'ASC' : 'DESC'} LIMIT 1`,
    // the count needs no position at all, so it never pays for the window
    // function — it is the same predicate ANDed with the same text tests
    matches: joinParts(['SELECT COUNT(*) AS n', `FROM ${quoteIdent(table)}`, whereClause(bothOf(whereFragment, tests))]),
  };
}

/** The order the positions are counted in: the caller's keys, then the source-order column — always, because a position without a total order is not a position. */
function findOrderBy(sort: readonly SortSpec[] | undefined): string {
  const keys = sort ?? [];
  return [...keys.map(sortKeySQL), ...tieBreak(keys, true)].join(', ');
}

/**
 * The text test over one row: any of the named columns holding the text, as a
 * case-insensitive substring of its VARCHAR form.
 *
 * WHY `CAST(… AS VARCHAR)` on every column including the strings: one rendering,
 * no schema branch — the builder is pure and never asked DuckDB what type the
 * column is. A non-text column's text form is then the ENGINE's own, which is
 * the documented divergence (src/data/README.md, "A find is a text question").
 *
 * WHY `ILIKE` and NOT a rendered `lower(…)` pair: one operator, and DuckDB's own
 * folding. It is not byte-for-byte the memory engine's `toLowerCase()` — that
 * one has folds which CHANGE LENGTH (`İ` → `i` + a combining dot) and this one
 * folds a code point to a code point — which is the one measured divergence over
 * plain strings (src/data/README.md, and pinned in `engineInvariant.test.ts`).
 *
 * WHY `ILIKE` and an explicit `ESCAPE`: `%` and `_` are wildcards in a LIKE
 * pattern, so a person searching for "50%" or "a_b" would otherwise get every
 * row. They are escaped in the needle and the escape character is named, so the
 * pattern means the literal text that was typed.
 */
function textTests(columns: readonly string[], text: string): string {
  const needle = `'%${escapeLikeText(text)}%'`;
  return `(${columns.map((column) => `CAST(${quoteIdent(column)} AS VARCHAR) ILIKE ${needle} ESCAPE '\\'`).join(' OR ')})`;
}

/**
 * The needle as a LIKE pattern body: the escape character first (so it is not
 * escaped twice), then the two wildcards, then the quote doubling every SQL
 * string literal in this package gets (`literalToSQL`'s rule, applied here
 * because the text is spliced into a pattern rather than rendered as a bare
 * literal).
 */
function escapeLikeText(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_').replaceAll(`'`, `''`);
}

/** The predicate and the text tests as one fragment — "no predicate" leaves the tests alone rather than ANDing with nothing. */
function bothOf(whereFragment: string, tests: string): string {
  const kept = whereClause(whereFragment);
  return kept === '' ? tests : `${whereFragment} AND ${tests}`;
}

// ── The judgements. ──────────────────────────────────────────────────────

function judgeNumbers(limit: number | undefined, offset: number | undefined): void {
  const bad = badNumber('limit', limit) ?? badNumber('offset', offset);
  if (bad !== undefined) throw new WindowRefusal('bad-window', bad);
}

/** The one malformed-window sentence, word for word `memoryProvider`'s `badWindowValue` — one refusal, whichever engine says it. */
function badNumber(name: string, value: number | undefined): string | undefined {
  if (value === undefined || (Number.isInteger(value) && value >= 0)) return undefined;
  return `${name} must be a whole number at or above zero (got ${String(value)})`;
}

// ── The clauses. ─────────────────────────────────────────────────────────

/** The columns the answer will carry, or `undefined` for `*`. */
function projectionOf(options: EvaluateOptions | undefined): readonly string[] | undefined {
  const asked = options?.columns;
  if (asked === undefined) return undefined; // `*` — and `__row` rides along inside it
  if (options?.indices !== true || asked.includes(ROW_ORDER_COLUMN)) return asked;
  return [...asked, ROW_ORDER_COLUMN]; // WHY appended, not prepended: the caller's own columns keep their asked-for order
}

function selectList(projection: readonly string[] | undefined): string {
  // WHY `*` is left alone when `indices` is asked: a table loaded by this
  // engine HAS `__row`, so `*` already carries it — naming it again would
  // return two columns called `__row`.
  return projection === undefined ? '*' : projection.map(quoteIdent).join(', ');
}

function whereClause(fragment: string): string {
  // WHY the cleared descriptor gets no WHERE: it means "no predicate", but
  // `WHERE null` is not true in SQL — DuckDB would answer ZERO rows and invert
  // the meaning of an empty selection.
  if (fragment.trim() === '' || isClearedSQL(fragment)) return '';
  return `WHERE ${fragment}`;
}

function orderByClause(sort: readonly SortSpec[] | undefined, hasRowOrder: boolean, paged: boolean): string {
  if (sort === undefined || sort.length === 0) return sourceOrder(hasRowOrder, paged); // an empty sort is no sort — but a page still needs an order
  return `ORDER BY ${[...sort.map(sortKeySQL), ...tieBreak(sort, hasRowOrder)].join(', ')}`;
}

/** Whether a page boundary can fall inside this window: a `LIMIT` or an `OFFSET` puts one there. */
function isPaged(options: EvaluateOptions | undefined): boolean {
  return options?.limit !== undefined || options?.offset !== undefined;
}

/**
 * The whole order of a window that asked for none, on a table this engine
 * loaded: the source-order column, ascending — and only when the window is
 * PAGED.
 *
 * WHY an unsorted page needs one at all: {@link tieBreak}'s reason with the
 * sort taken away. `SELECT … LIMIT 50 OFFSET 50` is a second scan of the same
 * table, and DuckDB promises no scan order — not between two runs of one
 * statement, and least of all across a filter, a hash join or a parallel scan.
 * So page 2 of an unsorted window can serve a row page 1 already served and
 * skip one nobody ever sees, exactly as the tied sort did. The sheet pages
 * unsorted, which makes this the DEFAULT window, not an exotic one.
 *
 * WHY a full read may stay unordered: with no `LIMIT` and no `OFFSET` there is
 * no boundary for a row to fall on the wrong side of — every matching row comes
 * back exactly once whatever order the scan chose, and the reader that cares
 * about position reads `__row` off the rows (`indices: true`). Sorting 300,000
 * rows to hand back all 300,000 of them would buy that reader nothing.
 *
 * WHY source order and not some other total order: it is the order the memory
 * engine's unsorted window serves (src/data/README.md), so one
 * `EvaluateOptions` still means one row order in both engines.
 */
function sourceOrder(hasRowOrder: boolean, paged: boolean): string {
  if (!hasRowOrder || !paged) return ''; // no column to name, or no boundary to protect
  return `ORDER BY ${quoteIdent(ROW_ORDER_COLUMN)} ASC`;
}

/**
 * The last key of every rendered order, on a table this engine loaded: the
 * source-order column, ascending.
 *
 * WHY an order needs it: `ORDER BY "cases" DESC` over 300,000 rows with ties
 * leaves the tied rows in whatever order the scan produced, and DuckDB promises
 * nothing about that order between two runs of the same statement. A paged
 * window asks the statement once per page, so page 2 can repeat a row page 1
 * already served and skip one nobody ever sees (measured: ids 6 and 9 twice,
 * 12, 15 and 18 never). `__row` is unique per table, which makes the order
 * TOTAL — and SQL orders by a column the projection does not carry, so the
 * answer gains no column from it.
 *
 * WHY ties then land in source order: that is what the memory engine's own
 * total order does with them (src/data/README.md), so one `EvaluateOptions`
 * means one row order in both engines.
 */
function tieBreak(sort: readonly SortSpec[], hasRowOrder: boolean): readonly string[] {
  if (!hasRowOrder) return []; // a table this engine did not load has no such column to name
  if (sort.some((key) => key.field === ROW_ORDER_COLUMN)) return []; // the caller ordered by it: one key, not two
  return [`${quoteIdent(ROW_ORDER_COLUMN)} ASC`];
}

/**
 * WHY the null order is always spelled out: `SortSpec` documents absent values
 * as last unless asked otherwise, but DuckDB's own default is the session
 * setting `default_null_order` — leaving it implicit would let a config change
 * reorder a sheet, and would put absent values at OPPOSITE ends from the memory
 * engine's total order for the same spec.
 *
 * WHY `NULLS LAST` is not the whole story: the memory engine counts NaN as
 * ABSENT (it sorts with null and undefined, last unless asked otherwise) while
 * DuckDB counts NaN as a number — and the largest one, above every finite value
 * and above Infinity. A column with NaN in it therefore sorts differently in
 * the two engines, and no `NULLS` clause can close that gap: the fix would be a
 * rendered `isnan(...)` key, which is a cost every sorted window would pay for
 * a value a chart cannot draw anyway. Named here so it is a known exception and
 * not a surprise.
 */
function sortKeySQL(key: SortSpec): string {
  const direction = key.dir === 'desc' ? 'DESC' : 'ASC';
  const nulls = key.absent === 'first' ? 'NULLS FIRST' : 'NULLS LAST';
  return `${quoteIdent(key.field)} ${direction} ${nulls}`;
}

function limitClause(limit: number | undefined): string {
  return limit === undefined ? '' : `LIMIT ${String(limit)}`;
}

function offsetClause(offset: number | undefined): string {
  return offset === undefined ? '' : `OFFSET ${String(offset)}`;
}

/** One space between the parts that exist — an absent clause leaves no double space behind. */
function joinParts(parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join(' ');
}
