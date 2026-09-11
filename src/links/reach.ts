/**
 * REACH ACROSS TABLES — could a clause one view emits ever be JUDGED where the
 * edge lands?
 *
 * An edge carries a sentence about the source's columns to the target's rows.
 * When the two views draw the same table that sentence is always judgeable;
 * when they draw tables a declared RELATION joins, the engine can follow the
 * edge; when the two tables share a column NAME, a gesture on that column
 * speaks both sides. Outside those three, nothing one view can say is a claim
 * about the other's rows — so a `crossfilter` DEFAULT edge between them is a
 * promise nothing can keep, and a DECLARED one is refused at the door.
 *
 * The law is here rather than in `materialize.ts` because two doors ask it and
 * must never word it differently: the default rule minting edges (law 1) and
 * the def validator judging a hand-written edge. `unreachableWords` is the ONE
 * sentence both use, so what the map says about an absent edge and what the
 * door says about a refused one are the same words.
 *
 * **Refuse on evidence, never on ignorance** — the rule this file shares with
 * `grain.ts`. A table whose column list is not KNOWN cannot be proven disjoint
 * from anything, so the edge stands and law 2 (`../session/clausesReaching.ts`
 * · `unjudgeableColumn`) catches at run time whatever the declaration could
 * not see.
 */
import type { FieldMapping, LinkView } from './types.js';

/** One end of a relation: a column of a table. Structural, so `RelationDecl`'s ends fit with no import of `../def`. */
export interface ReachEnd {
  readonly table: string;
  readonly column: string;
}

/** One declared relation, as this law reads it: two ends, and nothing else it needs. */
export interface ReachRelation {
  readonly from: ReachEnd;
  readonly to: ReachEnd;
}

/**
 * What the dashboard's TABLES say about reaching one another.
 *
 * WHY it is handed to the builder rather than reached for on a def: `src/links`
 * knows nothing about definitions (the dependency runs the other way — `src/def`
 * imports this package), and a graph is also materialized in tests and by the
 * validator from raw declarations. So the caller reads its own def once and
 * hands the two facts over.
 */
export interface TableReach {
  /** The declared relations between tables — a permission to read across (`../def/relations.ts`). */
  readonly relations: readonly ReachRelation[];
  /**
   * Table → its columns, for the tables whose list is KNOWN: a table that
   * declares `columns`, or one an act mints (whose column list is complete by
   * construction). A table absent here is never judged — the same conditional
   * the relation door already applies to `data[t].columns`.
   */
  readonly columns: Readonly<Record<string, readonly string[]>>;
}

/** True iff a relation joins these two tables, either way round — a relation is undirected as a PERMISSION to read across. */
function joined(a: string, b: string, relations: readonly ReachRelation[]): boolean {
  return relations.some((r) => (r.from.table === a && r.to.table === b) || (r.from.table === b && r.to.table === a));
}

/**
 * THE law, named once: can a clause emitted over `source`'s rows be judged
 * against `target`'s?
 *
 * Answers `true` on every kind of ignorance — an unstated table on either
 * view, no reach handed in, a table whose columns nothing declares — so this
 * predicate only ever removes an edge it can PROVE is unkeepable.
 */
export function tablesCanReach(source: string | undefined, target: string | undefined, reach: TableReach | undefined): boolean {
  if (reach === undefined || source === undefined || target === undefined) return true; // nothing to judge it with
  if (source === target) return true; // one table judges its own sentences
  if (joined(source, target, reach.relations)) return true; // a declared relation is the permission to read across
  const from = reach.columns[source];
  const to = reach.columns[target];
  if (from === undefined || to === undefined) return true; // a column list nobody declared proves no disjointness
  const there = new Set(to);
  // REVIEWED (packet N): this ground is DELIBERATELY generous, not accidentally so — two
  // tables that both happen to carry `id`, `name` or `date` are not thereby related, and this
  // predicate cannot tell a real join column from a coincidence. It errs toward KEEPING the
  // edge anyway, on the same "refuse on evidence, never on ignorance" law the rest of this
  // function follows: a coincidence is not evidence of disjointness, so it is not grounds to
  // decline. The cost is a possible false "keeps the edge"; the alternative (requiring a
  // declared relation) would cost real edges the current callers rely on — the packet's own
  // headline fixture (a minted table sharing its group-by column with its parent) reaches this
  // ground, not the relation one. A false keep is caught downstream regardless: an edge that
  // reaches nothing real judges nothing when the columns turn out unrelated in VALUE, and a
  // clause that turns out to name a column with the wrong MEANING is still narrowed or refused
  // like any other (law 2/3) — this ground only ever widens which edges get a CHANCE to be judged.
  return from.some((c) => there.has(c)); // one shared column name is one sentence both sides can hear
}

/** {@link tablesCanReach} over the two VIEWS — the form both doors actually hold. */
export function viewsCanReach(source: LinkView | undefined, target: LinkView | undefined, reach: TableReach | undefined): boolean {
  return tablesCanReach(source?.table, target?.table, reach);
}

/**
 * The ONE sentence for an edge whose clause could never be judged — read by
 * the map (a declined default edge says why it is absent) and by the def door
 * (a declared edge is refused in these words, with its remedy appended).
 */
// Only ever called where `viewsCanReach` said NO, which it can only say when
// both tables are stated — so neither name can be `undefined` in the sentence.
export function unreachableWords(source: LinkView, target: LinkView): string {
  return `view "${source.viewId}" draws table "${source.table}" and view "${target.viewId}" draws table "${target.table}" — no relation joins those tables and they share no column, so nothing this edge carries could be judged there`;
}

/**
 * WHAT THE DEFINITION SAYS about one column of one table — the ONE synchronous
 * judge, with three answers and no fourth:
 *
 * - `present` — the table's column list is known and the column is on it;
 * - `absent` — the list is known and the column is NOT on it (the only answer
 *   that is evidence of a miss);
 * - `undeclared` — the definition does not say. A table that declares no
 *   `columns` and that no act mints has no list here, so nothing about it is
 *   claimed either way: **omit, never deny**. The engine may know; the
 *   definition does not, and every caller of this judge answers from the
 *   definition.
 *
 * WHY it lives in `src/links` and not beside the def readers that PRODUCE a
 * {@link TableReach} (`../def/tableReach.ts`, `../def/builtinAnalyses.ts` ·
 * `mintedTables`): `unmappedColumn` below asks exactly this question and must
 * not answer it a second way, and this package knows nothing about definitions
 * (the dependency runs `src/def` → here). So the judge sits on the CONSUMING
 * side of the reading, where the doors that need it already hold one.
 *
 * WHY three answers and not a boolean: the two doors need different halves of
 * it. A door refusing an author's aim acts on `absent` alone (a boolean that
 * folded `undeclared` into "fine" happens to be right for it). A door deciding
 * whether a clause filtered anything must tell `absent` from `undeclared` —
 * crediting a clause it cannot judge is a false claim, and denying one is
 * another. One judge, three answers, and each caller reads the answer it needs.
 */
export type ColumnStanding = 'present' | 'absent' | 'undeclared';

/** {@link ColumnStanding} for one column of one table — see the type's WHY for the three answers and who reads which. */
export function columnStanding(table: string, column: string, reach: TableReach | undefined): ColumnStanding {
  const known = reach?.columns[table];
  if (known === undefined) return 'undeclared'; // no list, no claim
  return known.includes(column) ? 'present' : 'absent';
}

/**
 * A `mapping` entry whose `to` names a column the target table does not have
 * — the FIRST one found, in declaration order, or `undefined` when every
 * landing column named is known to exist, or when the target's column list is
 * not KNOWN (the same ignorance `tablesCanReach` refuses to judge on; law 2
 * catches an unknowable one at the READ instead —
 * `../session/clausesReaching.ts`, `ReachingClause.mappedFields`).
 *
 * WHY this is a SEPARATE ground from `tablesCanReach`, not a widening of it: a
 * mapping is the author NAMING the landing column by hand, which voids the
 * shared-column-name COINCIDENCE as evidence (two tables may share no column
 * at all and still be joined by an aimed mapping) — but the name itself is
 * now evidence of its own, and a wrong one is an error whether or not the two
 * tables happen to share some OTHER column.
 */
export function unmappedColumn(mapping: readonly FieldMapping[], target: string, reach: TableReach | undefined): FieldMapping | undefined {
  // `absent` ONLY — an `undeclared` table is not knowable here and the read door catches it,
  // which is the same three-answer judge the why door reads (`columnStanding`), asked once
  return mapping.find((m) => columnStanding(target, m.to, reach) === 'absent');
}

/**
 * The ONE sentence for a mapping entry whose landing column the target does
 * not have — read by the declared-edge door (with its remedy appended) and by
 * the read door restoring the refusal a mapping's own target could not be
 * checked until now (`../session/session.ts` · `viewClauses`), so an author
 * meets the same words wherever the miss is caught.
 */
export function unmappedColumnWords(source: string, target: string, mapping: FieldMapping): string {
  return `table "${target}" has no column "${mapping.to}" — the link from ${source} maps ${mapping.from} → ${mapping.to}`;
}
