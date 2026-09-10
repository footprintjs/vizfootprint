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
 * ## Per COLUMN, because that is where silence lives
 *
 * The check takes a reading, not a declaration (`./silence.ts` ·
 * {@link TableSilence}), and judges each value column against the entry that
 * governs THAT column. This is the fix the exoplanet demo needed: a
 * `measurements` row whose radius was never taken and whose period is 88 was
 * refused by the old per-TABLE check, which read one state column as speaking
 * for the whole row. It was a correct refusal of a wrong question. Now the
 * radius is judged by `radius_state` and the period by `period_state`, and the
 * sentence names the state column it actually broke.
 *
 * Only the VALUE columns are judged — the ones the caller hands over — because
 * an identifier that happens to be a number (`week_index`, a FIPS code) is the
 * row's address, not a value the source reported. The def door hands its
 * DECLARED measures; `describeTable` has no declaration to read, so unless
 * `values` is passed it hands every number column but the state ones — name
 * them there when a number is an address rather than a value. A column NOTHING
 * governs is passed over, which is how a state column escapes judgement even
 * when a caller lists it: it speaks for itself.
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
 * whether the ARITHMETIC reads that number is a second question, answered by
 * `AbsenceDecl.arithmetic` (`../derive/README.md` states the law).
 *
 * ```ts
 * absenceContradictionOf(
 *   [{ region: 'north', cases: 7, report_state: 'unavailable' }],
 *   silenceOfDecl({ field: 'report_state', states: ['present', 'unavailable', 'unknown'] }),
 *   ['cases'],
 *   'data["cells"]',
 * );
 * // 'data["cells"].rows[0]: report_state says "unavailable" — no value — and cases holds 7; a table
 * //  cannot say both, so carry null in cases where the row reports nothing'
 *
 * absenceContradictionOf(
 *   [{ region: 'north', cases: 7, report_state: 'estimated' }],
 *   silenceOfDecl({ field: 'report_state', states: ['present', 'estimated', 'unavailable', 'unknown'], carries: ['estimated'] }),
 *   ['cases'],
 *   'data["cells"]',
 * );
 * // undefined — the declaration says an estimated row carries a figure, so 7 is not two things at once
 * ```
 */

import { silenceTestOf, type TableSilence } from './silence.js';
import type { Row } from './types.js';

/** The first row that says two things at once, and how many more do. */
interface Contradiction {
  readonly row: number;
  /** The state column that was broken — the one governing the numbered column. */
  readonly field: string;
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

/**
 * One value column, prepared: the state column that governs it and the test
 * that reads that state.
 *
 * Built ONCE per column rather than per row, and it is also how a column
 * nothing governs disappears — it earns no gate, so no row is judged for it.
 */
interface Gate {
  readonly column: string;
  readonly field: string;
  readonly isSilence: (state: unknown) => boolean;
}

function gatesOf(silence: TableSilence, values: readonly string[]): readonly Gate[] {
  const gates: Gate[] = [];
  for (const column of values) {
    const governing = silence.silenceFor(column);
    if (governing === undefined) continue;
    gates.push({ column, field: governing.state, isSilence: silenceTestOf(governing) });
  }
  return gates;
}

/** The first governed column of THIS row that is silent and holds a number anyway. */
function brokenGateOf(row: Row, gates: readonly Gate[]): { readonly field: string; readonly said: string; readonly column: string; readonly value: number } | undefined {
  for (const gate of gates) {
    const state = row[gate.field];
    // WHY the walker's own test and not the declared vocabulary: `../derive/walk.ts` reads a row as a
    // silence whenever its state is not `present` — so a word the vocabulary never declared blanks the
    // cell exactly as `unavailable` does. Judged by the declared list, those rows were the ONLY ones
    // whose numbers went quietly unseen, which is the thing this module exists to prevent. The one
    // word the DECLARATION gets is `carries`: a state named there holds a figure, so it is not silent.
    if (!gate.isSilence(state)) continue;
    const value = row[gate.column];
    if (!holdsNumber(value)) continue;
    return { field: gate.field, said: saidAs(state), column: gate.column, value };
  }
  return undefined;
}

/**
 * The first contradiction in the rows, counted with the rest — or undefined
 * when every silent cell is silent in its own value column too. Total: a row
 * that is not an object is not THIS defect and is passed over.
 *
 * `more` counts ROWS and not cells, so the sentence reads the same as it always
 * did: a row that breaks two of its three state columns is one row saying the
 * same thing twice.
 */
function contradictionOf(rows: readonly unknown[], silence: TableSilence, values: readonly string[]): Contradiction | undefined {
  const gates = gatesOf(silence, values);
  if (gates.length === 0) return undefined;
  let first: Contradiction | undefined;
  let more = 0;
  for (let at = 0; at < rows.length; at += 1) {
    const row = rows[at];
    if (row === null || typeof row !== 'object') continue;
    const broken = brokenGateOf(row as Row, gates);
    if (broken === undefined) continue;
    if (first === undefined) first = { row: at, ...broken, more: 0 };
    else more += 1;
  }
  return first === undefined ? undefined : { ...first, more };
}

/** The sentence, naming the row, the two columns and the fix — and how many more rows say the same. */
function sentenceOf(where: string, c: Contradiction): string {
  const rest = c.more === 0 ? '' : ` (${String(c.more)} more ${c.more === 1 ? 'row does' : 'rows do'} the same)`;
  return `${where}.rows[${String(c.row)}]: ${c.field} ${c.said} — no value — and ${c.column} holds ${String(c.value)}; a table cannot say both, so carry null in ${c.column} where the row reports nothing${rest}`;
}

/**
 * The refusal for a table whose state columns and value columns disagree, or
 * undefined when they agree. `where` is how the caller names the table in its
 * own sentences (`data["cells"]` at the def door, `this table` at the
 * description door), so the refusal reads in the voice of the door it came
 * through.
 */
export function absenceContradictionOf(rows: readonly unknown[], silence: TableSilence, values: readonly string[], where: string): string | undefined {
  const found = contradictionOf(rows, silence, values);
  return found === undefined ? undefined : sentenceOf(where, found);
}
