/**
 * A TABLE THAT CONTRADICTS ITSELF — refused at the data door, once.
 *
 * A declared absence column says, per row, whether the source reported a
 * value. A row whose state is NOT `present` and whose value column holds a
 * number is saying two things at once — "nothing was reported"
 * and "7 was reported" — and no reader can keep both. The walker
 * (`../derive/walk.ts`) already reads such a row as a silence, so the number
 * would never be seen; this check exists so that it is never QUIETLY unseen:
 * the table is refused where it enters, in a sentence naming the row and the
 * two columns, and the fix is the source's to make (carry `null` where the
 * row reports nothing).
 *
 * The law it follows is the def door's: **refuse what cannot be enforced,
 * where it enters, in a sentence** — and refuse it ONCE. Two doors call this:
 * `describeTable` (a file before there is a def) and the build lint
 * (`../def/validate.ts`, inline rows with declared measures). Neither the
 * walker nor an engine holds a second opinion.
 *
 * Only the VALUE columns are judged — the ones the caller hands over — because
 * an identifier that happens to be a number (`week_index`, a FIPS code) is the
 * row's address, not a value the source reported. The def door hands its
 * DECLARED measures; `describeTable` has no declaration to read, so unless
 * `values` is passed it hands every number column but the absence one — name
 * them there when a number is an address rather than a value.
 *
 * The silence test is the WALKER'S, not the declared vocabulary's: a state that
 * is not `present` is a silence, whatever word it is. A vocabulary the row does
 * not use is exactly how this is met in the field — a case slip, a new collector
 * word, an empty cell — and judging only the declared silences left those rows,
 * the ones nothing else judges, unjudged.
 *
 * The ONE thing that moves that line is the declaration itself
 * (`AbsenceDecl.carries`): a state named there CARRIES a number, so it is not a
 * silence and its number is not a contradiction. An estimated figure is a
 * figure; a replaced one is the number the agency published beside the one that
 * was filed. Default none — a declaration that says nothing is judged exactly as
 * it was before the key existed. `carries` moves this check and nothing else:
 * the walker still reads exactly `present`, because "the source put a number
 * here" and "the arithmetic may add it" are two different questions.
 *
 * ```ts
 * absenceContradictionOf(
 *   [{ region: 'north', cases: 7, report_state: 'unavailable' }],
 *   { field: 'report_state', states: ['present', 'unavailable', 'unknown'] },
 *   ['cases'],
 *   'data["cells"]',
 * );
 * // 'data["cells"].rows[0]: report_state says "unavailable" — no value — and cases holds 7; a table
 * //  cannot say both, so carry null in cases where the row reports nothing'
 *
 * absenceContradictionOf(
 *   [{ region: 'north', cases: 7, report_state: 'estimated' }],
 *   { field: 'report_state', states: ['present', 'estimated', 'unavailable', 'unknown'], carries: ['estimated'] },
 *   ['cases'],
 *   'data["cells"]',
 * );
 * // undefined — the declaration says an estimated row carries a figure, so 7 is not two things at once
 * ```
 */

// WHY a runtime import from the def: the one word that means "reported" is the def's to own
// (`ABSENCE_PRESENT`), and the walker reads the same one; a copy here would be a second owner.
import { ABSENCE_PRESENT, type AbsenceDecl } from '../def/types.js';
import type { Row } from './types.js';

/** The first row that says two things at once, and how many more do. */
interface Contradiction {
  readonly row: number;
  /** What the state column held, as the sentence says it. */
  readonly said: string;
  readonly column: string;
  readonly value: number;
  readonly more: number;
}

/** How a refusal says what the state column held: quoted when it is a word, named when it is not. */
function saidAs(state: unknown): string {
  if (typeof state === 'string') return `says "${state}"`;
  if (state === undefined) return 'says nothing';
  const written = JSON.stringify(state);
  /* v8 ignore next -- `JSON.stringify` answers undefined only for undefined (the line above), a function or a symbol, and a row cell holds none of the three */
  return `says ${written ?? String(state)}`;
}

/** Does this cell hold a NUMBER — a value the source reported, by the arithmetic's own edge (finite)? */
const holdsNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The value column of a silent row that holds a number, or undefined when the row keeps its word. */
function numberedColumnOf(row: Row, values: readonly string[]): { readonly column: string; readonly value: number } | undefined {
  for (const column of values) {
    const value = row[column];
    if (holdsNumber(value)) return { column, value };
  }
  return undefined;
}

/**
 * Is this state a SILENCE — a row that says it has no value?
 *
 * The walker's test, with the declaration's one amendment: `present` reports a
 * value, and so does any state the table declared as one that `carries` a
 * number. Everything else is a silence, INCLUDING a word the vocabulary never
 * declared and a cell that holds no word at all — those are the rows nothing
 * else judges, and they are the reason this module exists.
 *
 * EXPORTED because a second reader needs exactly this law and must not restate
 * it: a shared SCALE may not be folded over silent rows either ("unavailable"
 * is not a low number, so a silence on an axis reads as one), and the adapter's
 * frame door drops them with this test before it calls `frameDomains`.
 */
export function silenceTestOf(absence: AbsenceDecl): (state: unknown) => boolean {
  const carries = new Set(absence.carries ?? []);
  return (state) => state !== ABSENCE_PRESENT && !(typeof state === 'string' && carries.has(state));
}

/**
 * The first contradiction in the rows, counted with the rest — or undefined
 * when every silent row is silent in its value columns too. Total: a row that
 * is not an object is not THIS defect and is passed over.
 */
function contradictionOf(rows: readonly unknown[], absence: AbsenceDecl, values: readonly string[]): Contradiction | undefined {
  const judged = values.filter((column) => column !== absence.field);
  const isSilence = silenceTestOf(absence);
  let first: Contradiction | undefined;
  let more = 0;
  for (let at = 0; at < rows.length; at += 1) {
    const row = rows[at];
    if (row === null || typeof row !== 'object') continue;
    const state = (row as Row)[absence.field];
    // WHY the walker's own test and not the declared vocabulary: `../derive/walk.ts` reads a row as a
    // silence whenever its state is not `present` — so a word the vocabulary never declared blanks the
    // row exactly as `unavailable` does. Judged by the declared list, those rows were the ONLY ones
    // whose numbers went quietly unseen, which is the thing this module exists to prevent. The one
    // word the DECLARATION gets is `carries`: a state named there holds a figure, so it is not silent.
    if (!isSilence(state)) continue;
    const numbered = numberedColumnOf(row as Row, judged);
    if (numbered === undefined) continue;
    if (first === undefined) first = { row: at, said: saidAs(state), ...numbered, more: 0 };
    else more += 1;
  }
  return first === undefined ? undefined : { ...first, more };
}

/** The sentence, naming the row, the two columns and the fix — and how many more rows say the same. */
function sentenceOf(where: string, absence: AbsenceDecl, c: Contradiction): string {
  const rest = c.more === 0 ? '' : ` (${String(c.more)} more ${c.more === 1 ? 'row does' : 'rows do'} the same)`;
  return `${where}.rows[${String(c.row)}]: ${absence.field} ${c.said} — no value — and ${c.column} holds ${String(c.value)}; a table cannot say both, so carry null in ${c.column} where the row reports nothing${rest}`;
}

/**
 * The refusal for a table whose absence column and value columns disagree, or
 * undefined when they agree. `where` is how the caller names the table in its
 * own sentences (`data["cells"]` at the def door, `this table` at the
 * description door), so the refusal reads in the voice of the door it came
 * through.
 */
export function absenceContradictionOf(rows: readonly unknown[], absence: AbsenceDecl, values: readonly string[], where: string): string | undefined {
  const found = contradictionOf(rows, absence, values);
  return found === undefined ? undefined : sentenceOf(where, absence, found);
}
