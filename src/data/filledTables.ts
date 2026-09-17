/**
 * ACT-FILLED TABLES — a DECLARED table whose rows arrive from a computation.
 *
 * The other door to a computed table is `./derivedTables.ts`: an aggregate is
 * a table nobody declared, so the library MINTS its name, its key and its
 * relation back to the parent from the act's own record — because a record
 * that could name its own relation could name one nobody declared. This door
 * answers the other question. The table IS declared (`data[name].filledBy`,
 * `../def/types.ts` · `DataSourceDef`), its columns, its key, its absence
 * vocabulary, its grain and its relations are declared and judged at the def
 * door with every other table's, and the ONLY thing it takes from the act is
 * rows. So there is nothing to mint here, and this registry holds exactly one
 * fact the declaration cannot state: WHERE THE ROWS WENT, and at which commit.
 *
 * Which is still a fact worth a slot per ACT, for the derived column's reason
 * (`./derivedColumns.ts`): a table filled on one branch and filled again on
 * another is two sets of rows, and storing them under the declared name would
 * make a walker on either branch read the other's. So the rows land in a slot
 * the act's commit names, the logical name is resolved back at the cursor, and
 * a cursor standing before the act resolves it to the DECLARED name — whose
 * provider refuses every read in a sentence naming the act it is waiting for
 * (`../def/actFilled.ts` · `unfilledTableRefusal`). Unlanded is a state, not an
 * error.
 *
 * ```ts
 * const t = mintFilledTable({ name: 'edges', analysisId: 'buildEdges', commitId: 's7', of: 'nodes' });
 * t.physical; // 'edges@s7'
 * ```
 *
 * The first customers are the session (which lands at `declareAnalysis`,
 * re-lands at `replay`, and resolves at the cursor) and the dashboard build
 * (which installs the refusing provider at the declared name, and drops these
 * slots when the parent's bytes move). See `./README.md`.
 */

import { slotNameOf } from './derivedColumns.js';

/** The slot one act's FILL lives in — the physical name its provider is registered under. One speller with the column's and the derived table's: see {@link slotNameOf}. */
export function filledTableName(name: string, commitId: string): string {
  return slotNameOf(name, commitId);
}

/**
 * What the ACT says about the table it filled, as the STORE keeps it.
 *
 * Deliberately NOT a {@link import('./derivedTables.js').DerivedTableAct}
 * without its grouping: there is no grouping to omit. What an aggregate's
 * record has to carry — the group columns, the measures, the filter — is what
 * its name, its key and its relation are minted FROM. Here all of those are
 * declared, so the act has nothing to say about them and this record does not
 * invite it to.
 */
export interface FilledTableAct {
  /** The DECLARED table name the rows landed under — the name a person, a chart and a commit use. */
  readonly name: string;
  /** The act that filled it: `data[name].filledBy`, and the id under `def.analyses`. */
  readonly analysisId: string;
  /** The commit that filled it. */
  readonly commitId: string;
  /** The table the act READ — a logical name, which may itself be derived or act-filled. */
  readonly of: string;
  /** The data version the rows the act read were true of. Absent for a parent nothing versions (inline rows never move). */
  readonly dataVersion?: string;
}

/** One act-filled table: what the act said, plus the slot the store put it in. */
export interface FilledTable extends FilledTableAct {
  /** The slot — the provider's physical table name. Unique per act. */
  readonly physical: string;
}

/**
 * The record an act mints when it fills a declared table: the slot, and
 * nothing else. Throws only where {@link slotNameOf} does — a commit id
 * carrying the reserved marker — so a caller judges `canNameSlot` first, as
 * both other doors do, and files a gap instead of catching.
 */
export function mintFilledTable(act: FilledTableAct): FilledTable {
  return { ...act, physical: filledTableName(act.name, act.commitId) };
}

/**
 * Which DECLARED tables an act has filled in this dashboard, and at which
 * commit.
 *
 * Dashboard-scoped and keyed by PARENT, for the derived registry's two
 * reasons: the providers map is dashboard-scoped (two sessions on one build
 * write into the same store), and a refresh of the parent is what drops these.
 * Served flat, because a table's name is resolved dashboard-wide.
 */
export class FilledTableStore {
  readonly #byParent = new Map<string, FilledTable[]>();
  readonly #all: FilledTable[] = [];

  /** Register a fill that has just landed. Append-only, like the trace it mirrors. */
  record(table: FilledTable): void {
    const list = this.#byParent.get(table.of);
    if (list) list.push(table);
    else this.#byParent.set(table.of, [table]);
    this.#all.push(table);
  }

  /** Every fill in the dashboard, oldest first — what a cursor resolves its names over (`./derivedColumns.ts`, `resolveDerived`). */
  all(): readonly FilledTable[] {
    return this.#all;
  }

  /**
   * Forget every fill computed from one parent — AND every fill computed from
   * THOSE, because a table whose parent's rows are gone has nothing to be
   * recomputed from. A refresh replaces the parent's whole provider, so the
   * rows these were computed from no longer exist; keeping them would serve
   * yesterday's answer over today's bytes with nothing saying so.
   *
   * GENERATIONAL, exactly like the derived store's `clear` — and this is the
   * defect that made it so: the generations used to be left to the caller,
   * which did one level, and a fill computed from a fill survived the refresh
   * that destroyed its parent and went on answering as `landed`. A registry
   * that answers "what died with this parent" must answer it WHOLE; a caller
   * counting levels is a caller that will count one too few.
   *
   * Unlike an aggregate, the table does not disappear with its rows: it is
   * still declared, and it goes back to being UNLANDED, refusing reads in the
   * words that say the rows were withdrawn (`../def/actFilled.ts` ·
   * `withdrawnTableRefusal`).
   *
   * Answers what was dropped, oldest first, so the caller can report the loss
   * by the names a person knows and drop the providers by the slots it holds.
   * The CROSS-STORE generations — an aggregate cut FROM one of these tables, a
   * fill computed from an aggregate — are the door that holds both registries
   * to close, and it closes them as a FIXPOINT rather than a level
   * (`../def/buildDashboard.ts` · `dropComputedFrom`).
   */
  clear(of: string): readonly FilledTable[] {
    const gone = new Set<FilledTable>();
    // the derived store's own worklist, word for word: each dropped table's NAME is a parent to clear in turn
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
