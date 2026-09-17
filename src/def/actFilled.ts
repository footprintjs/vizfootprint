/**
 * A TABLE MAY BE DECLARED WITH NO CARRIER AND FILLED BY AN ACT.
 *
 * `data[name]` is where a table is declared: its `columns`, its `key`, its
 * `absence` vocabulary, its `grain`. Until this file, it also had to say where
 * the ROWS come from — `rows`, `csv` or `source` — and a table with none of the
 * three was refused. That is exactly right for a table that will never have
 * rows, and exactly wrong for a table whose rows come from a computation: an
 * edge table cut from a node table by a declared act could not be declared at
 * all, which is why the one act that lands a table today had to invent a
 * private door and MINT a table from its own record.
 *
 * `filledBy` closes it. The law:
 *
 * > **A table may be declared with no carrier and filled by an act. Its
 * > columns, its key, its absence vocabulary, its grain and its relations are
 * > declared exactly like any other table's; the only thing it gets from the
 * > computation is rows. Until the act lands them it is unlanded, and a read of
 * > it is refused in the words the library already has. Nothing about it is
 * > inferred from the rows that arrive.**
 *
 * Which answers the objection the aggregate's own record states — *a record
 * that could name its own relation could name one nobody declared* — without
 * weakening it: the relation is not on the record. It is in the DEF, beside
 * every other relation, judged at the same door by the same validator
 * (`./relations.ts`). What arrives from the act is rows and nothing else.
 *
 * TWO DOORS, TWO QUESTIONS (`./README.md`, "Two doors for a computed table"):
 * an aggregate's table is MINTED (the library derives its name, its key and its
 * edge from the grouping, so nobody can name a relation nobody declared); an
 * act-filled table is DECLARED (the author names all of them, where every
 * declaration is judged). This file is the second door's whole judgement, and
 * the aggregate is untouched by it.
 *
 * Customers: `./validate.ts` (the def door calls {@link validateActFilled}),
 * `./buildDashboard.ts` (installs the refusing provider at the declared name,
 * quoting {@link unfilledTableRefusal}), the session (lands the rows in a slot
 * per act, `../data/filledTables.ts`) and the overview's Sources rows
 * (`../session/tablesInfo.ts`).
 */
import { OUTPUT_CHANNELS, type OutputChannel } from '../analysis/index.js';
import { builtinChannel, isBuiltinRecord, mintedTables } from './builtinAnalyses.js';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Every table this definition declares WITH NO CARRIER, and the act that fills
 * each — by table name, `data[name].filledBy`.
 *
 * THE ONE OWNER of "which declared table an act fills", so the def door, the
 * build door, the session's landing and the overview can never disagree about
 * what the same definition says. The twin of {@link mintedTables}, which
 * answers the other door's version of the question (which table an act MINTS).
 *
 * Total over `unknown`, like every reader on this boundary: a malformed entry
 * is refused on its own line by {@link validateActFilled}, and is read here for
 * whatever it does state.
 *
 * ```ts
 * actFilledTables({ data: { nodes: { rows: [] }, edges: { filledBy: 'buildEdges', columns: { id: {} } } } });
 * // Map { 'edges' => 'buildEdges' }
 * ```
 */
export function actFilledTables(def: unknown): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (!isObject(def) || !isObject(def['data'])) return out;
  for (const [table, decl] of Object.entries(def['data'])) {
    if (isObject(decl) && isNonEmpty(decl['filledBy'])) out.set(table, decl['filledBy']);
  }
  return out;
}

/**
 * The declared table one ACT fills, by analysis id — the reverse reading, for
 * the session: a commit names the act, and what the act lands is a fact about
 * the def.
 *
 * A scan and not a second index, for {@link mintedTables}' reason: two maps of
 * the same declaration are two things that can disagree, and an analysis fills
 * at most one table (judged at the door), so the first hit is the answer.
 */
export function tableFilledBy(def: unknown, analysisId: string): string | undefined {
  for (const [table, act] of actFilledTables(def)) if (act === analysisId) return table;
  return undefined;
}

/**
 * THE READ REFUSAL of a table whose act has not run — said once, quoted
 * wherever a read of it is refused (`./buildDashboard.ts` hands it to
 * `./declaredTable.ts` · `unlandedProvider`, which is the ONE provider for a
 * table that did not land; there is no second one).
 *
 * It NAMES THE ACT, because the act is the repair: "no rows yet" without "and
 * here is what will bring them" is the silence this library exists to remove.
 * And it says what is NOT waiting — the columns, the key, the relations are
 * declared and judged already — so a reader does not go looking for a
 * declaration that is right there.
 *
 * "on this path" is the minted table's own wording (`../session/session.ts` ·
 * `tableNotHere`) and is chosen deliberately: the same sentence answers a read
 * before any act AND a read at a cursor the act's commit is not on, because
 * both resolve the name to this provider.
 */
export const unfilledTableRefusal = (table: string, act: string): string =>
  `"${table}" declares no carrier — the act "${act}" fills it, and it has not landed on this path: every read of "${table}" is refused in these words. ` +
  `Perform "${act}" to fill it — it takes the act's rows only if they carry the columns this table declares; its columns, its key and its relations are declared, and do not wait for it.`;

/**
 * …AND THE SENTENCE AFTER A WITHDRAWAL, which is a different history and a
 * different repair. The rows DID land, and a refresh of the data the act read
 * took them away (`./buildDashboard.ts` · `dropComputedFrom`): "it has not
 * landed" would be true of this instant and would let a reader take it for the
 * whole answer, so the event is said out loud and the act is named as something
 * to perform AGAIN.
 *
 * It names the table whose refresh withdrew them — which is the ORIGIN of the
 * drop and not necessarily this table's own parent, because a fill computed
 * from a fill dies with its grandparent's bytes.
 */
export const withdrawnTableRefusal = (table: string, act: string, refreshed: string): string =>
  `"${table}" declares no carrier — the act "${act}" filled it, and the rows it landed were withdrawn when "${refreshed}" was refreshed: every read of "${table}" is refused in these words. ` +
  `They were computed from data that no longer exists, so nothing serves them; perform "${act}" again to fill it from the data as it stands.`;

/**
 * The CHANNEL a declared analysis slot produces, or `undefined` when nothing
 * here can say — the three slot forms, read as data:
 *
 *  - a builtin RECORD names a factory, and the factory's channel is fixed
 *    (`./builtinAnalyses.ts` · `builtinChannel`, off the one spec table);
 *  - a built MODULE carries its own def, so the channel is `slot.def.produces`;
 *  - a raw `AnalysisDef` IS that def, so it is `slot.produces`.
 *
 * `undefined` is the answer for a slot this door cannot read, and it is
 * DELIBERATE that nothing is said about it here: such a slot is already refused
 * on its own line by the analyses pass (`./validate.ts`), and a second sentence
 * about the same slot would be noise (the `formula.expression` precedent).
 */
function channelOf(slot: unknown): OutputChannel | undefined {
  if (!isObject(slot)) return undefined;
  if (isBuiltinRecord(slot)) return builtinChannel(slot.builtin);
  // a module carries its def; a raw def is one — one line, so this file never becomes a third copy of the module predicate
  const def = isObject(slot['def']) ? slot['def'] : slot;
  const produces = def['produces'];
  return typeof produces === 'string' && (OUTPUT_CHANNELS as readonly string[]).includes(produces) ? (produces as OutputChannel) : undefined;
}

/** Is this slot an aggregate record — the act that mints its own table, and therefore never fills a declared one? */
const isAggregate = (slot: unknown): boolean => isObject(slot) && isBuiltinRecord(slot) && slot.builtin === 'aggregate';

/**
 * Push problems for every `data[t].filledBy` onto `problems`; `def` is the raw
 * definition, whose `data` and `analyses` maps have each been judged on their
 * own lines (mirrors `validateRelations`).
 *
 * What is judged here, and why each is judgeable at THIS door — declaration
 * against declaration, with no row and no backend:
 *
 *  1. the act is NAMED (a non-empty string), and a value that is not one is
 *     quoted back;
 *  2. the table DECLARES ITS COLUMNS — required here and optional everywhere
 *     else, because a table with no carrier has nothing else that says what it
 *     is, and three questions are deferred to a post-build door exactly when a
 *     table declares none (the key, a relation's source column, a binding on
 *     it) — a door that can never answer for this one;
 *  3. it is a DECLARED analysis — a name nothing declares can never fill
 *     anything, and the table would wait forever;
 *  4. it is not an AGGREGATE — that act mints its own table, with its own key
 *     and its own relation to its parent, so naming it here asks for both
 *     doors at once and the loser would be decided by which ran first;
 *  5. its channel is `table` — a columns / scalar / geometry act lands no rows,
 *     so nothing would ever arrive;
 *  6. ONE act fills at most ONE table — two tables naming one act is two
 *     tables' rows decided by a race;
 *  7. its name is not also MINTED by an aggregate — one name, one owner;
 *  8. its `engine`, if it declares one, can receive the act's rows.
 *
 * Every sentence names BOTH SIDES (the table and the act), because either one
 * may be the mistake.
 */
export function validateActFilled(def: unknown, problems: string[]): void {
  if (!isObject(def) || !isObject(def['data'])) return;
  const analyses = isObject(def['analyses']) ? def['analyses'] : {};
  const ids = Object.keys(analyses);
  const minted = mintedTables(def);
  /** act → the first table that named it, for law 5. */
  const claimed = new Map<string, string>();
  for (const [table, decl] of Object.entries(def['data'])) {
    if (!isObject(decl) || decl['filledBy'] === undefined) continue;
    const act = decl['filledBy'];
    if (!isNonEmpty(act)) {
      // quoted, the way the engine refusal below quotes what it saw: a reader
      // who mistyped a key needs to see the value the def actually carries
      problems.push(`data["${table}"].filledBy must be the id of a declared analysis — it is "${String(act)}"`);
      continue;
    }
    // THE DECLARATION IS THE ONLY THING THAT SAYS WHAT THIS TABLE IS, so it is
    // REQUIRED here and optional everywhere else. A carrier-less table has no
    // bytes for `lintData` to judge a key against, no engine for a relation's
    // source column, and nothing for the encoding plane to judge a binding
    // against — all three questions are deferred to a post-build door precisely
    // WHEN a table declares no columns, and for this table that door can never
    // answer. Requiring them here is what makes the def door their one owner,
    // and what makes the arrived-columns guard real evidence at the landing.
    // Pushed WITHOUT a `continue`: it is a different question from the act
    // rules below, and a def that gets both wrong should hear both.
    const columns = decl['columns'];
    if (columns === undefined || (isObject(columns) && Object.keys(columns).length === 0)) {
      problems.push(
        `data["${table}"].filledBy "${act}" — declare data["${table}"].columns first; a table with no carrier has nothing but its declaration, and its columns are what its key, its relations and every binding on it are judged against`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(analyses, act)) {
      problems.push(
        ids.length === 0
          ? `data["${table}"].filledBy "${act}" is not a declared analysis — this def declares none`
          : `data["${table}"].filledBy "${act}" is not a declared analysis — the analyses are ${ids.join(', ')}`,
      );
      continue;
    }
    const slot = analyses[act];
    if (isAggregate(slot)) {
      problems.push(`data["${table}"].filledBy "${act}" is an aggregate — an aggregate mints the table it lands, with its own key and its own relation to its parent, so it never fills a declared one`);
      continue;
    }
    const channel = channelOf(slot);
    if (channel !== undefined && channel !== 'table') {
      problems.push(`data["${table}"].filledBy "${act}" produces the ${channel} channel, not a table — only a table-channel act can fill a table`);
      continue;
    }
    const first = claimed.get(act);
    if (first !== undefined) {
      problems.push(`data["${table}"].filledBy "${act}" already fills data["${first}"] — an analysis fills at most one table`);
      continue;
    }
    claimed.set(act, table);
    const mintedBy = minted.get(table)?.analysisId;
    if (mintedBy !== undefined) {
      problems.push(`data["${table}"] is filled by the act "${act}", and the aggregate "${mintedBy}" mints a table of the same name — one name, one owner`);
      continue;
    }
    // THE RULING behind the one engine word: the act's answer is rows in this
    // process, landed in a memory provider under the act's own slot
    // (`../data/filledTables.ts`) — there is nothing to hand a SQL backend and
    // nothing to fetch. A def that declared another engine would be quietly
    // ignored, so it is refused here in the sentence a source table's engine
    // gets (`./validate.ts`).
    const engine = decl['engine'];
    if (engine !== undefined && engine !== 'memory') {
      problems.push(`data["${table}"] sets engine "${String(engine)}" with filledBy; an act's rows are computed in this process, so an act-filled table declares "memory" — or no engine at all`);
    }
  }
}
