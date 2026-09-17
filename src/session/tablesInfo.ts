/**
 * The Sources rows — one of the two parts of `overview()` that are a projection
 * of the MAP rather than of the trace (the other is `overview().relations`, the
 * map's edges between tables, echoed from the runtime by reference).
 *
 * Everything else `whats_here` answers is derived from where the walker is
 * standing: the live selections, the words on screen, the columns visible on
 * this branch. This is not. A table's format, its carrier, its engine, its key,
 * its grain, its absence vocabulary and how many columns the author declared
 * are all facts about the DECLARATION, and they do not move when the cursor
 * does. Holding it apart is a way of saying so out loud, because a projection
 * that quietly starts reading the fold is a fact that will begin disagreeing
 * with itself between two positions.
 *
 * **The one thing to know before changing it**: every value here is read off
 * the def or off what the source layer VOUCHED FOR when it was read — never
 * inferred from the rows. A column count taken from the first row would be a
 * confident answer about a table nobody declared that way, and the shape of it
 * would look exactly like the declared one.
 */
import type { DerivedTable, FilledTable } from '../data/index.js';
import type { DashboardRuntime } from '../def/types.js';
import type { TableInfo } from './types.js';

/**
 * One table an ACT cut, as the act states it — the twin of the declared row
 * below, and the one row here that is a projection of the TRACE.
 *
 * WHY it is still not a fact about the fold: an aggregate is computed once, at
 * its cursor, and the record never moves again. Which tables are visible moves
 * with the walker (the caller decides that, by handing in only the ones
 * resolved at its cursor); what THIS table is does not.
 *
 * Its engine is stated, not looked up: the act minted a memory provider for
 * its own slot ({@link DashboardRuntime.landDerivedTable}), so there is one
 * possible answer and a second map holding it could only ever disagree.
 */
function derivedInfoOf(table: DerivedTable): TableInfo {
  return {
    name: table.name,
    source: { computed: 'aggregate' },
    engine: 'memory',
    ...(table.key !== undefined ? { key: table.key } : {}),
    derived: { of: table.of, groupBy: [...table.groupBy], measures: table.measures.map((measure) => measure.as), at: table.commitId },
    // WHY the ACT's own count: nobody declared facets for a table nobody declared —
    // the columns it lands are the group columns and the measures, and that is the
    // whole schema the act promised.
    declaredColumns: table.groupBy.length + table.measures.length,
  };
}

/**
 * Every declared table as the def states it, then every DERIVED table the
 * caller says is visible — read off the def, the runtime and the act, never
 * inferred from the rows.
 *
 * `filled` names the act-filled tables that have LANDED at the caller's cursor
 * (`../data/filledTables.ts`). They are not rows of their own: an act-filled
 * table is a DECLARED table, so it is one of the declared rows below and only
 * its carrier differs — which is the law itself, said in the shape of the
 * projection (`../def/actFilled.ts`).
 */
export function tablesInfoOf(runtime: DashboardRuntime, derived: readonly DerivedTable[] = [], filled: readonly FilledTable[] = []): TableInfo[] {
  /** name → the fill visible at the caller's cursor, for `landed` and for the commit that made it. */
  const landedFills = new Map(filled.map((table) => [table.name, table] as const));
  const declared = runtime.tables.map((name) => {
    const decl = runtime.def.data[name]!; // every runtime table is a def table
    const read = runtime.sources[name];
    const source: TableInfo['source'] =
      // A TABLE WITH NO CARRIER, and the row says exactly that: no `format`, no
      // `via`, no `at` and no `version`, because nothing carried these rows and
      // an entry claiming one would be the only untrue field on this tab. What
      // it DOES say is the two things that are true — which act fills it, and
      // whether that act has landed at this cursor — so a reader who finds no
      // rows is never left guessing what would bring them. `landed` moves with
      // the walker for the reason a derived row appears and disappears: a fill
      // belongs to the branch whose act made it — and when it has landed, the
      // COMMIT that filled it, which is this row's only way to say which run
      // the rows a reader is looking at came from (the minted row's `derived.at`,
      // said in the arm that has no carrier to date itself by).
      decl.filledBy !== undefined
        ? { computed: 'act', by: decl.filledBy, landed: landedFills.has(name), ...(landedFills.has(name) ? { at: landedFills.get(name)!.commitId } : {}) }
        : decl.source !== undefined && read !== undefined
          ? { format: read.format, via: read.via, ...(read.at !== undefined ? { at: read.at } : {}) }
          : decl.csv !== undefined
            ? { inline: 'csv' }
            : { inline: 'rows', rows: decl.rows!.length }; // the def door admits a table only with rows, csv, a source or an act
    return {
      name,
      source,
      engine: runtime.engines[name]!, // every runtime table resolved an engine at build
      ...(runtime.keys[name] !== undefined ? { key: runtime.keys[name]! } : {}),
      ...(decl.grain !== undefined ? { grain: decl.grain } : {}),
      // Every entry, never the first: the tab reports what the def declared, and a table may declare one state column per measured quantity.
      ...(decl.absence !== undefined ? { absence: (Array.isArray(decl.absence) ? decl.absence : [decl.absence]).map((entry) => ({ field: entry.field, states: [...entry.states] })) } : {}),
      declaredColumns: Object.keys(decl.columns ?? {}).length,
    };
  });
  return [...declared, ...derived.map(derivedInfoOf)];
}
