/**
 * THE TEXT FORM OF A CELL — ONE OWNER, BELOW EVERY DOOR THAT READS IT.
 *
 * A cell's text is asked for by three different questions, and they must agree:
 *
 *   - an EXPORT writes it into a CSV/TSV field (`../session/export.ts`),
 *   - a COPY puts it on the clipboard (`ui/src/sheet/Sheet.tsx`, Ctrl+C),
 *   - a FIND matches a person's typing against it (`memoryProvider.find`).
 *
 * All three used to be able to disagree, because the function lived in
 * `../session/export.ts` and `find` is BELOW the session — the memory engine
 * cannot import a door that imports it. So it moved down here, to `data/`,
 * which every one of the three already depends on. The session barrel
 * re-exports it under its old name so nothing public broke.
 *
 * WHY it is not locale-formatted: a receipt is read by another program as often
 * as by a person, and `toLocaleString` would make the same row two different
 * files on two different machines — and the same search two different searches.
 *
 * WHAT IT IS NOT: the engine's own text form. A find over a non-text column
 * matches whatever the ENGINE renders that value as (`CAST(x AS VARCHAR)` in
 * DuckDB, this function in the memory engine), and the two agree on strings and
 * integers and are documented to diverge on floats and timestamps — see
 * src/data/README.md, "A find is a text question". This function is the memory
 * engine's answer and the one the UI shows; it is not a promise about SQL.
 *
 * NOR IS IT A PROMISE ABOUT CASE. A find lowercases both sides of this text with
 * `String.prototype.toLowerCase`, which is full Unicode and has folds that CHANGE
 * LENGTH (`İ` → `i` + U+0307); DuckDB's `ILIKE` folds one code point to one. That
 * is the one measured divergence over plain strings, pinned in
 * `engineInvariant.test.ts` and named in src/data/README.md beside this one.
 */

/**
 * One cell as text. Never locale-formatted, and it throws for nothing: every
 * value shape a row can hold names itself, so no single cell can abort an
 * export, a copy, or a search.
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
