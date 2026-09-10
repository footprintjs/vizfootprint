/**
 * SILENCE BELONGS TO A COLUMN — the port every reader of absence asks.
 *
 * A table does not have one silence. A `measurements` row can carry a radius
 * that was measured, a mass that is a published upper bound and a period that
 * was never taken; three columns, three silences, one row. Every reader in this
 * library — the arithmetic ({@link ../derive/walk.ts}), the group fold
 * ({@link ../derive/groups.ts}), the contradiction check
 * ({@link ./absenceContradiction.ts}), the encoding plane's facets — is really
 * asking ONE question of ONE column:
 *
 *   *for this column, which column carries its state, what vocabulary does that
 *   column speak, which of those states carry a number, and does the arithmetic
 *   read them?*
 *
 * {@link ColumnSilence} is that answer and {@link TableSilence} is the port that
 * gives it per column. The declaration (`../def/types.ts` · `AbsenceDecl`) is
 * the DEF's shape and stays the def's; this is OUR shape, so a reader is written
 * once and a second declaration form never reaches it. Two adapters map onto it:
 * {@link silenceOfDecl} (one decl, or a list of them) and
 * {@link silenceOfNothing} (the null object).
 *
 * ## Why the strategy lives HERE and not beside its first caller
 *
 * {@link silenceTestOf} used to live in `./absenceContradiction.ts`, which was
 * its only reader. It now has three — the contradiction check, the arithmetic,
 * and the adapter's frame door (`ui/src/adapter/frame.ts`, through
 * `vizfootprint/data`) — so it belongs beside the thing it reads, next to the
 * port, with ONE owner. The public path is unchanged: `vizfootprint/data`
 * exports it, as it always did.
 *
 * ## The two tests, and why they are two
 *
 * - {@link silenceTestOf} — *did the source report anything?* This is a fact
 *   about the DATA, and the contradiction check is its enforcer.
 * - {@link readsValueTestOf} — *does the arithmetic read this row's cell?* This
 *   is a choice about the SUM, and the declaration makes it (`arithmetic`).
 *
 * A state that `carries` a number is not a silence under the first test (an
 * estimated figure is a figure) and is still not summed under the second unless
 * the declaration says `arithmetic: 'carried'`. Those are two different
 * questions, and only the source can answer the first.
 *
 * ```ts
 * const silence = silenceOfDecl([
 *   { field: 'radius_state', states: ['present', 'upper-bound', 'not-measured', 'unknown'], carries: ['upper-bound'], governs: ['pl_rade'] },
 *   { field: 'mass_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_masse'] },
 * ]);
 * silence.silenceFor('pl_rade')?.state;   // 'radius_state'
 * silence.silenceFor('pl_masse')?.state;  // 'mass_state'
 * silence.silenceFor('radius_state');     // undefined — a state column speaks for itself
 * silence.stateColumns;                   // ['radius_state', 'mass_state']
 * ```
 */

// WHY a runtime import from the def: the one word that means "reported" is the def's to own
// (`ABSENCE_PRESENT`), and every reader below reads the same one; a copy here would be a second owner.
import { ABSENCE_PRESENT, type AbsenceDecl } from '../def/types.js';

/**
 * What governs ONE column's silence — the whole answer, with no optional keys,
 * so a reader never re-derives a default the adapter already decided.
 */
export interface ColumnSilence {
  /** The column carrying the state word for this column. */
  readonly state: string;
  /** The vocabulary that state column may hold. */
  readonly states: readonly string[];
  /**
   * Which states hold a number besides `present` — never `present` (which is
   * not a silence to begin with) and never `unknown` (a source that could not
   * tell which silence it saw did not carry the value either). The def door
   * refuses both.
   */
  readonly carries: readonly string[];
  /**
   * Whether the ARITHMETIC reads a carried number.
   *
   * `'present-only'` (the default, and every total this library ever computed)
   * reads exactly `present`. `'carried'` opts this one column in: a
   * `carries` state reads as the number the cell holds. See
   * `../derive/README.md` for the law and why it is not a global switch.
   */
  readonly arithmetic: 'present-only' | 'carried';
}

/** The two words `ColumnSilence.arithmetic` may hold — DATA, so the validator and the type cannot drift. */
export const SILENCE_ARITHMETICS: readonly ['present-only', 'carried'] = Object.freeze(['present-only', 'carried'] as const);

/**
 * THE PORT: one reading of a table's silences, answered per column.
 *
 * Total — a column nothing governs answers `undefined`, which every reader
 * treats as "read the cell as it is". A STATE column is one of those: it speaks
 * for itself, so `eq(radius_state, "not-measured")` stays honest on the very row
 * whose radius reads as absent.
 */
export interface TableSilence {
  /** What governs this column's silence, or undefined when nothing does. THE authority — total. */
  silenceFor(column: string): ColumnSilence | undefined;
  /** The columns that ARE state columns — facets give these role `absence`, and the derive act folds them in. */
  readonly stateColumns: readonly string[];
  /**
   * The vocabulary a STATE column speaks, or undefined when the column is not
   * one of them.
   *
   * WHY the port answers this and not only {@link TableSilence.silenceFor}: the
   * encoding plane has to attach a state column's OWN words to it
   * (`../encoding/facets.ts` gives it role `absence` and its vocabulary), and
   * `silenceFor` deliberately answers undefined there — a state column speaks
   * for itself. Without this member that one door would have to read the
   * declaration behind the port's back, which is the second reading path this
   * port exists to remove.
   */
  vocabularyOf(column: string): readonly string[] | undefined;
  /**
   * Every column some entry NAMES in its `governs` — for a door that wants to
   * list what was declared.
   *
   * It is a listing, not the reading: an entry with no `governs` speaks for
   * every OTHER column of the table and names none, so it contributes nothing
   * here. An empty `governed` therefore does not mean "nothing is governed" —
   * {@link TableSilence.silenceFor} is the only thing that answers that.
   */
  readonly governed: readonly string[];
}

/**
 * Is this state a SILENCE — a row that says it has no value?
 *
 * `present` reports a value, and so does any state the table declared as one
 * that `carries` a number. Everything else is a silence, INCLUDING a word the
 * vocabulary never declared and a cell that holds no word at all — those are
 * the rows nothing else judges, and they are why the contradiction check exists.
 * Independent of `arithmetic`, which is about sums and not about the source.
 */
export function silenceTestOf(silence: ColumnSilence): (state: unknown) => boolean {
  const carries = new Set(silence.carries);
  return (state) => state !== ABSENCE_PRESENT && !(typeof state === 'string' && carries.has(state));
}

/**
 * Does the ARITHMETIC read this row's cell in the governed column?
 *
 * `'present-only'` reads exactly `present` — the law every total in this
 * library was computed under. `'carried'` also reads the states the declaration
 * named in `carries`, so a published bound lands in the sum. A carried state
 * whose cell holds no number still reads absent, because the arithmetic edge
 * ({@link ../derive/walk.ts}) judges the CELL and this test only opens the gate.
 */
export function readsValueTestOf(silence: ColumnSilence): (state: unknown) => boolean {
  if (silence.arithmetic === 'present-only') return (state) => state === ABSENCE_PRESENT;
  const carries = new Set(silence.carries);
  return (state) => state === ABSENCE_PRESENT || (typeof state === 'string' && carries.has(state));
}

/** One declaration as the port's per-column answer — the defaults decided ONCE, here. */
function columnSilenceOf(decl: AbsenceDecl): ColumnSilence {
  return { state: decl.field, states: decl.states, carries: decl.carries ?? [], arithmetic: decl.arithmetic ?? 'present-only' };
}

/**
 * THE NULL OBJECT: the reading of a table that declares no silence at all.
 *
 * It exists so that no reader beneath the def door branches on `undefined` — a
 * caller holding an optional declaration converts once, at its own door, and
 * everything downstream asks the port the same question.
 */
export function silenceOfNothing(): TableSilence {
  return { silenceFor: () => undefined, stateColumns: [], governed: [], vocabularyOf: () => undefined };
}

/**
 * THE ADAPTER: a declaration — bare or a list — as the port.
 *
 * A BARE object means what it has always meant: its one state column speaks for
 * every OTHER column of the table. A LIST means each entry speaks for the
 * columns its `governs` names; the def door refuses a list whose entry names
 * none, because two entries each claiming "everything else" are two answers to
 * one question.
 *
 * The resolution order, which exists only so the port is TOTAL and never as a
 * policy: a state column answers `undefined` (it speaks for itself); otherwise
 * the first entry NAMING the column wins; otherwise the first entry that names
 * no columns at all (the bare form's "everything else"). The def door refuses
 * every overlap that would make that order visible.
 */
export function silenceOfDecl(decl: AbsenceDecl | readonly AbsenceDecl[]): TableSilence {
  const entries = (Array.isArray(decl) ? decl : [decl]) as readonly AbsenceDecl[];
  const stateColumns = entries.map((entry) => entry.field);
  const byColumn = new Map<string, ColumnSilence>();
  const governed: string[] = [];
  let everythingElse: ColumnSilence | undefined;
  for (const entry of entries) {
    const silence = columnSilenceOf(entry);
    if (entry.governs === undefined) {
      everythingElse ??= silence;
      continue;
    }
    for (const column of entry.governs) {
      if (byColumn.has(column)) continue; // first namer wins; the def door refuses the overlap
      byColumn.set(column, silence);
      governed.push(column);
    }
  }
  const vocabularies = new Map<string, readonly string[]>();
  for (const entry of entries) if (!vocabularies.has(entry.field)) vocabularies.set(entry.field, entry.states);
  const states = new Set(stateColumns);
  return {
    // WHY the state-column check comes first: a state column is never governed, not even by another
    // entry that names it — blanking it would silence the very cell a reader asks "why is this absent?"
    silenceFor: (column) => (states.has(column) ? undefined : (byColumn.get(column) ?? everythingElse)),
    stateColumns,
    governed,
    vocabularyOf: (column) => vocabularies.get(column),
  };
}
