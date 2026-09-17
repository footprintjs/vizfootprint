/**
 * declaredTable.ts — GUARD 2 OF "A DOCUMENT IS NEVER A TABLE BY ACCIDENT": THE
 * DOOR JUDGES AGREEMENT WITH THE DECLARATION.
 *
 * The decoder cannot tell a one-column CSV from a text file, and no syntactic
 * rule there would be honest, because a legitimate one-column table exists
 * (`../source/decode.ts`). The carrier can only judge what the SERVER SAID
 * about the bytes (`../source/http.ts` · `documentForATable`), which a server
 * that says nothing settles nothing about. What is left is the DECLARATION —
 * and it is real evidence: a def that names nine columns for a table has said
 * what that table is, so bytes carrying NONE of them are not a missing column,
 * they are not this table.
 *
 * THREE THINGS THIS GUARD DELIBERATELY DOES NOT JUDGE, each for the same
 * reason — refuse a contradiction, never ignorance:
 *
 *  1. A PARTIAL mismatch. One column of nine absent is today's law and stays
 *     byte-identical: the read door narrows a clause over a column the table
 *     lacks (`../session/clausesReaching.ts` · `narrowedByDef`), and the landed
 *     registry records what actually arrived (`../data/landedColumns.ts`).
 *     ZERO overlap is the only verdict here.
 *  2. A table whose def declares NO columns. Nothing was said, so nothing is
 *     contradicted, and the landed registry learns whatever arrived.
 *  3. A landing that brought no columns at all (no rows). A header-only CSV IS
 *     the declared table with nothing in it; "no columns" is this library not
 *     being able to see them, not the bytes disagreeing.
 *
 * AND ONE MORE, the one that decides WHICH DOOR CAN ASK: only a source whose
 * bytes ARRIVED is judged (`via` is not `inline`). An inline payload is the
 * def's own text, written beside the very `columns` it would be judged against,
 * and it is judged with the rest of the def at the grammar door. That also
 * keeps the two builders in agreement: `buildDashboard` refuses every
 * non-inline source outright, so a rule that fired on inline bytes would make
 * the two doors answer the same def differently.
 *
 * Customers: `./buildDashboard.ts` — the async build door (which lands a
 * carrier's rows) and the refresh door (which lands them again). The law a
 * refusal here follows is `./wasmBackend.ts`'s law 3: a landing that failed is a
 * SENTENCE and a REFUSED READ, never a throw that loses the tables that did
 * land.
 */
import { columnNamesOf, reject, type DataProvider, type DataProviderRejection, type ResolvedEngine, type Row } from '../data/index.js';
import type { SourceFormat } from '../source/index.js';
import type { DataSourceDef } from './types.js';

/**
 * What this table SAYS it has: the names under `data[<table>].columns`, own keys
 * only, the way every other door reads a def's map.
 *
 * NOT to be read as `../session/session.ts`'s private `declaredColumnsOf`, which
 * answers a different question in the same words — which of a LANDED table's
 * columns are the map's rather than the trace's.
 */
const declaredNamesOf = (decl: DataSourceDef): readonly string[] => Object.keys(decl.columns ?? {});

/** A list of names as a sentence quotes them — quoted one by one, because a name that came from bytes may hold a comma. */
const quoted = (names: readonly string[]): string => names.map((name) => `"${name}"`).join(', ');

/**
 * The whole refusal: what landed, what was declared, what arrived, and what to
 * do — the order a reader needs them in (`../data/stubEngines.ts` keeps the same
 * shape). Said ONCE and quoted in three places: the build note, the refused
 * read's `detail`, and the refresh outcome's message.
 *
 * Both lists are printed WHOLE and neither is capped: the lists ARE the
 * evidence for a refusal about identity, and an elided one sends a reader to go
 * and diff the bytes by hand. The row count is formatted the way the build's
 * other counted note is (`./buildDashboard.ts` · `resolveEngine`).
 */
export const notTheDeclaredTableRefusal = (table: string, format: SourceFormat, declared: readonly string[], arrived: readonly string[], rows: number): string =>
  `the ${format} source landed ${rows.toLocaleString('en-US')} rows and none of the columns this table declares — declared ${quoted(declared)}, arrived ${quoted(arrived)}. A document is never a table by accident, so nothing vouches for these bytes: every read of "${table}" is refused in these words. Point the source at this table's own data, or declare the columns these bytes carry.`;

/**
 * IS THIS THE DECLARED TABLE? The sentence when it is not, `undefined` when
 * there is nothing to refuse — the whole rule in one place, so the build door
 * and the refresh door cannot drift apart about what "not this table" means.
 *
 * The arrived names are the engine's own rule for them, never a second copy
 * (`../data/memoryProvider.ts` · `columnNamesOf`): a refusal that quoted names
 * the engine disagrees with would be about a table nobody has.
 */
export function notTheDeclaredTable(table: string, decl: DataSourceDef, rows: readonly Row[]): string | undefined {
  const source = decl.source;
  // inline bytes are the def's own text — judged with the def, not against it (see the module doc)
  if (source === undefined || source.via === 'inline') return undefined;
  const declared = declaredNamesOf(decl);
  if (declared.length === 0) return undefined;
  const arrived = columnNamesOf(rows);
  if (arrived.length === 0) return undefined;
  if (arrived.some((name) => declared.includes(name))) return undefined;
  return notTheDeclaredTableRefusal(table, source.format, declared, arrived, rows.length);
}

/**
 * THE PROVIDER FOR A TABLE THAT DID NOT LAND — every read refused in the words
 * the build note already said, so an author hears one sentence at the door and a
 * reader hears the same one at the read (`./wasmBackend.ts`, law 3; the shape is
 * `../data/serverProvider.ts`'s).
 *
 * WHY it lives in this folder and not beside the engines: no engine could ever
 * produce this refusal. It is the DEF door's judgement — a declaration measured
 * against a landing — and the engine named here is only the one the table would
 * have run on, kept so `dashboard.engines` still says where the def routed it.
 *
 * `unknown-table` from the closed vocabulary (`../data/types.ts`): this provider
 * was never given the table, so a read of it is a read of a table it does not
 * know, and `detail` is where the whole sentence rides — which is why it takes no
 * table NAME: the sentence already holds it, and a second copy could disagree.
 * It declares NO optional capability, which has one consequence worth knowing: a
 * SORTED window is refused one door earlier, by the session's own capability
 * gate, in that gate's words — the unsorted read is where this sentence is heard.
 */
export function unlandedProvider(engine: ResolvedEngine, refusal: string): DataProvider {
  const refuse = (operation: DataProviderRejection['operation']): DataProviderRejection => reject(engine, operation, 'unknown-table', refusal);
  return {
    engine,
    capabilities: { canEvaluateSQL: false, canMaterialize: false },
    // the one honest fact it has: it holds no table, which is why every read below is `unknown-table`
    tables: async () => [],
    columns: async () => refuse('columns'),
    evaluate: async () => refuse('evaluate'),
    materializeColumn: async () => refuse('materializeColumn'),
  };
}
