/**
 * DERIVED TABLES — an aggregate belongs to the act that made it, exactly as a
 * derived column does.
 *
 * An aggregate is an ACT and a DERIVED DATASET: computed ONCE, over the rows
 * visible at ITS cursor, recorded as one cause-tagged commit whose record
 * carries the parent, the group columns, the measures and an optional filter.
 * The ROWS live in the store and are recomputed on replay from the record —
 * never serialised. A later selection does not recompute it; a new act does.
 *
 * The law it follows is the derived column's (`./derivedColumns.ts`): **a
 * derived thing gets a slot per ACT, never a slot per name.** A table named
 * `by_disease` cut on one branch and again on another is two tables, two
 * providers, two slots — resolved back to the one logical name at the cursor's
 * branch path by the same {@link resolveDerived} the columns use, and dropped
 * from view outside it. Nothing here spells a slot: the physical name comes
 * from the one speller the column store owns, under the one marker.
 *
 * Three more things ride the record because only the act can say them:
 *
 *   - **its relation back to the parent is MINTED, never typed.** The group
 *     column IS the derived table's key, so `parent.groupCol → derived.groupCol`
 *     (many-to-one) keeps the IDENTITY law of `../def/relations.ts`: the target
 *     column is the target's own key. (That file's `validateRelations` judges
 *     DECLARED edges, and a derived table is never in `def.data` — which is why
 *     this edge is minted here and never validated there. The two other laws
 *     are kept here as well: a table grouped by two columns is keyed by a tuple
 *     no single-column relation can point at, so it has no key and no relation;
 *     and a table cut from a parent of its own NAME mints no edge, because law
 *     3 refuses a table joined to itself.)
 *   - **the parent's data version it was cut from**, so an act performed over
 *     THIS table stamps the version its rows came from on its own commit
 *     (`../session/session.ts`, `dataVersionOf` → `dataStampFor`). The refresh
 *     itself does not compare it: a moved parent drops every table cut from it,
 *     version-blind.
 *   - **it can be a parent in turn** — `of` names a logical table name, which
 *     may itself be derived.
 *
 * ```ts
 * const t = mintDerivedTable({
 *   name: 'by_disease', commitId: 's7', of: 'cells',
 *   groupBy: ['disease'], measures: [{ as: 'total', expr: { op: 'sum', args: [{ col: 'cases' }] } }],
 * });
 * t.physical;   // 'by_disease@s7'
 * t.key;        // 'disease'
 * t.relation;   // { from: { table: 'cells', column: 'disease' }, to: { table: 'by_disease', column: 'disease' }, kind: 'many-to-one' }
 * ```
 *
 * The first customers are the session (which records at `declareAnalysis`,
 * resolves at the cursor, and serves `tablesAt()` / `relationsAt()` from here)
 * and the dashboard build (which clears a parent's tables on refresh and
 * reports the loss). See `./README.md`.
 */

// WHY type-only imports from ABOVE this folder: the record carries the act's own
// words — a measure is the derive grammar's, an edge is the def's — and a second
// spelling of either here would be a second owner. Both are erased at runtime, so
// the folder stays a leaf in the module graph.
import type { RelationEdge } from '../def/types.js';
import type { Expr, Measure } from '../derive/types.js';
import { slotNameOf } from './derivedColumns.js';

/** The slot one act's TABLE lives in — the physical name its provider is registered under. One speller with the column's: see {@link slotNameOf}. */
export function derivedTableName(name: string, commitId: string): string {
  return slotNameOf(name, commitId);
}

/**
 * What the ACT says about the table it cut, as the STORE keeps it — and nothing
 * the store minted from it ({@link DerivedTable} is that half).
 *
 * Not the commit's whole record: that also carries the op version these measures
 * and this filter are written against (`AggregateDecl.ops`) and the analysis id,
 * and a REPLAY reads them from there, never from here.
 */
export interface DerivedTableAct {
  /** The name a person, a chart and a commit use. */
  readonly name: string;
  /** The commit that created it. */
  readonly commitId: string;
  /** The parent table it was cut from — a logical name, which may itself be derived. */
  readonly of: string;
  /** The group columns, in order. `[]` is the whole table as one row. */
  readonly groupBy: readonly string[];
  /** The measures, in the order they land as columns. */
  readonly measures: readonly Measure[];
  /** Which parent rows went in. Absent means every row visible at the cursor. */
  readonly where?: Expr;
  /** The parent's data version the rows were cut from. Absent for a parent declared inline, which never moves. */
  readonly dataVersion?: string;
}

/** One derived table: what the act said, plus what the store minted from it. */
export interface DerivedTable extends DerivedTableAct {
  /** The slot — the provider's physical table name. Unique per act. */
  readonly physical: string;
  /** The row identity: the one group column, when there is exactly one. Absent otherwise (positional rows). */
  readonly key?: string;
  /** The edge back to the parent, minted from the key. Present when `key` is AND the parent is another table. */
  readonly relation?: RelationEdge;
}

/**
 * The relation an act mints: the parent's group column pointing at the derived
 * table's key, which is the same column under the same name. Many-to-one,
 * because many parent rows fold into one group row.
 */
function relationOf(act: DerivedTableAct, key: string): RelationEdge {
  return { from: { table: act.of, column: key }, to: { table: act.name, column: key }, kind: 'many-to-one' };
}

/**
 * The table record an act mints: the slot, the key and the relation, none of
 * them typed by a person. Throws only where {@link slotNameOf} does — a commit
 * id carrying the marker — so a caller judges `canNameSlot` first, as the
 * column door does, and files a gap instead of catching.
 */
export function mintDerivedTable(act: DerivedTableAct): DerivedTable {
  const physical = derivedTableName(act.name, act.commitId);
  // WHY exactly one: the identity law wants ONE column; a tuple key has no relation to point at.
  const key = act.groupBy.length === 1 ? act.groupBy[0] : undefined;
  // WHY the key stays and only the EDGE is withheld: the row identity is true whatever the parent is
  // called, but `../def/relations.ts` law 3 refuses a table joined to itself at the declared door, and a
  // minted edge keeps the laws a declared one is held to. A table re-cut from its own name has no edge.
  const relation = key === undefined || act.of === act.name ? undefined : relationOf(act, key);
  return { ...act, physical, ...(key === undefined ? {} : { key }), ...(relation === undefined ? {} : { relation }) };
}

/**
 * Which tables in a dashboard are derived, and what act each belongs to.
 *
 * Dashboard-scoped, beside the derived-column store and for its reason: the
 * providers map is dashboard-scoped, and two sessions on one dashboard see one
 * set of slots. Keyed by PARENT, because a refresh of the parent is what drops
 * them — and served flat, because a table's name is resolved dashboard-wide.
 */
export class DerivedTableStore {
  readonly #byParent = new Map<string, DerivedTable[]>();
  readonly #all: DerivedTable[] = [];

  /** Register a table that has just been cut. Append-only, like the trace it mirrors. */
  record(table: DerivedTable): void {
    const list = this.#byParent.get(table.of);
    if (list) list.push(table);
    else this.#byParent.set(table.of, [table]);
    this.#all.push(table);
  }

  /** Every derived table in the dashboard, oldest first — what a cursor resolves its names over (`./derivedColumns.ts`, `resolveDerived`). */
  all(): readonly DerivedTable[] {
    return this.#all;
  }

  /**
   * Forget every table cut from one parent — and every table cut from THOSE in
   * turn, because a table whose parent is gone has nothing to be replayed
   * from. A refresh replaces the parent's whole provider, so the rows these
   * were cut from are gone; keeping the registry would leave the session
   * resolving a name whose version no longer exists.
   *
   * Answers what was dropped, oldest first, so the caller can report the loss
   * by the names a person knows and drop the providers by the slots it holds.
   */
  clear(of: string): readonly DerivedTable[] {
    const gone = new Set<DerivedTable>();
    // A worklist over the generations: each dropped table's NAME is a parent to clear in turn.
    // WHY by name: `of` IS a name, so two acts that cut one name share a parent entry and clearing
    // either drops both names' children. Over-dropping is the chosen side — a kept child would
    // resolve `of` to a table whose version is gone — so the loss this answers is a CEILING. A child
    // that must outlive its namesake needs the parent's SLOT on the record, not the parent's name.
    const parents = [of];
    for (let at = 0; at < parents.length; at += 1) {
      const children = this.#byParent.get(parents[at]!);
      if (children === undefined) continue;
      this.#byParent.delete(parents[at]!);
      for (const child of children) {
        gone.add(child);
        parents.push(child.name);
      }
    }
    const dropped = this.#all.filter((t) => gone.has(t));
    this.#all.splice(0, this.#all.length, ...this.#all.filter((t) => !gone.has(t)));
    return dropped;
  }
}
