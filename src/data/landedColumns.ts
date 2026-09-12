/**
 * LANDED COLUMNS — what the engine landed for a table, learned ONCE and read by
 * every judge that must answer synchronously.
 *
 * THE LAW: **what the engine landed for a table is learned once — at build, and
 * again at each re-land — kept beside the table's data version, and read by
 * every judge that must answer synchronously.** The engine is still asked LIVE
 * by the reads that must see its current state: a dropped connection is a fact
 * of the READ, not of the landing.
 *
 * Three judges of "does this table have this column" used to exist and did not
 * share what they knew. The read door asks the engine, async, on every read
 * (`../session/session.ts` · `effectiveColumnsOf`); the overview asked it again
 * for every table on every poll and handed the answer to its own narrowing walk;
 * `why()` is synchronous and could ask only the DEFINITION — so for a table
 * declared as bare `rows`, where the definition lists no columns, `why()` stayed
 * silent where the other two spoke. The knowledge existed; it was asked for
 * three times and kept nowhere. This is where it is kept.
 *
 * WHY it is NOT a cache. A cache is a guess about staleness: something read
 * THROUGH on the way to the engine, invalidated by a rule, and wrong exactly
 * when the rule is. This is written only by the two acts that LAND rows — the
 * build (`../def/buildDashboard.ts` · `learnLanded`) and a refresh's re-land
 * (its `replaceRows` branch, which already holds the new schema in the engine's
 * own answer) — so it is never stale by construction; and it is never consulted
 * by a read that must see the engine live, so it never stands in for one. It is
 * a RECORD of a landing, the way `sources[table].version` is a record of a
 * fetch, and it sits beside that version because the two are facts about the
 * same act.
 *
 * ABSENT, NEVER INVENTED. A provider that refuses to list its columns (a stub
 * engine; a landing that failed) writes nothing, and neither does a table the
 * sync door could not land AT THE DOOR (a lazy wasm table — the door cannot
 * await, so it does not ASK there; asking would open the connection the
 * build's own note says it does not open). But a lazy landing is still a
 * landing: the door WAITS to be told of it instead of asking
 * (`../def/wasmBackend.ts` · `WasmBackend.whenLanded`, a deferred that never
 * forces the landing it reports), and learns it exactly as an eager table the
 * moment something else — the first read, or a later `settle()` — pays for it
 * (`../def/buildDashboard.ts` · `buildDashboard`). Until then the entry is
 * absent and a judge reading it answers as the definition alone allows
 * (`../links/reach.ts` · `columnStanding`, `undeclared`) — exactly the answer
 * it gave before this registry existed. The version is absent for a table
 * nothing versions (inline rows never move —
 * `../session/session.ts` · `dataVersionOf` says the same), never a
 * placeholder.
 *
 * DETACHED on the way in and FROZEN on the way out (`../detach/README.md`):
 * the engine's own column objects are copied, not held, so a host provider's
 * answer is never frozen behind its back; and a judge holds a frozen record,
 * so a reader cannot edit what a later judge will read.
 *
 * ```ts
 * const landed = new LandedColumns();
 * landed.set('sheet', undefined, [{ name: 'planet', type: 'string' }]); // a bare `rows` table: no version
 * landed.get('sheet');                                                   // { columns: [{ name: 'planet', type: 'string' }] } — frozen
 * landed.set('cases', 'v2', cols);                                       // a re-land: the NEW version and what arrived
 * landed.get('nowhere');                                                 // undefined — nothing landed, nothing claimed
 * ```
 *
 * The customers: the dashboard build writes it (both doors, and the refresh
 * door), and the session reads it in `tableReachAt()` — the ONE reach reading
 * `why()` and the overview's `narrowedFor` both judge from — where a landed list
 * stands in for a table the definition declares no columns for. See
 * `./README.md`, "What the engine landed is learned once".
 *
 * Not to be confused with `./landing.ts` · `LandedColumn` / `landedColumnsOf`:
 * those are the DuckDB type words a table's bytes are declared under on the
 * way IN to the SQL backend. This holds what any engine answers on the way OUT
 * (`ColumnInfo`, the five words every engine speaks).
 */
import { deepFreeze } from '../detach/deepFreeze.js';
import type { ColumnInfo } from './types.js';

/** One landing: the data version the rows were true of (absent for a table nothing versions) and the columns that arrived. */
export interface LandedEntry {
  /** What the table's source vouched for at this landing. Absent for inline rows, which never move — omit, never invent. */
  readonly version?: string;
  /** The engine's own description of the table as it landed — names and types, in the engine's order. */
  readonly columns: readonly ColumnInfo[];
}

/**
 * The registry: one entry per table, written by a landing, read by a judge.
 * Dashboard-scoped, like the derived-column and derived-table stores beside it
 * and for their reason — the providers are, and two sessions on one dashboard
 * read one set of landings.
 */
export class LandedColumns {
  readonly #byTable = new Map<string, LandedEntry>();

  /** Record a landing. A second call for the same table is a RE-LAND and replaces the entry whole — the old list is not merged, because the old rows are gone. */
  set(table: string, version: string | undefined, columns: readonly ColumnInfo[]): void {
    // copied column by column: the entry never aliases the engine's objects, and the freeze below is ours to apply
    const own = columns.map((c): ColumnInfo => ({ name: c.name, type: c.type }));
    this.#byTable.set(table, deepFreeze({ ...(version === undefined ? {} : { version }), columns: own }));
  }

  /** What landed for one table, or `undefined` when nothing did — the judge then answers from the definition alone. */
  get(table: string): LandedEntry | undefined {
    return this.#byTable.get(table);
  }
}
