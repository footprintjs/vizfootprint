/**
 * The Sources rows — the one part of `overview()` that is a projection of the
 * MAP rather than of the trace.
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
import type { DashboardRuntime } from '../def/types.js';
import type { TableInfo } from './types.js';

/** Every declared table as the def states it — read off the def and the runtime, never inferred from the rows. */
export function tablesInfoOf(runtime: DashboardRuntime): TableInfo[] {
  return runtime.tables.map((name) => {
    const decl = runtime.def.data[name]!; // every runtime table is a def table
    const read = runtime.sources[name];
    const source: TableInfo['source'] =
      decl.source !== undefined && read !== undefined
        ? { format: read.format, via: read.via, ...(read.at !== undefined ? { at: read.at } : {}) }
        : decl.csv !== undefined
          ? { inline: 'csv' }
          : { inline: 'rows', rows: decl.rows!.length }; // the def door admits a table only with rows, csv or a source
    return {
      name,
      source,
      engine: runtime.engines[name]!, // every runtime table resolved an engine at build
      ...(runtime.keys[name] !== undefined ? { key: runtime.keys[name]! } : {}),
      ...(decl.grain !== undefined ? { grain: decl.grain } : {}),
      ...(decl.absence !== undefined ? { absence: { field: decl.absence.field, states: [...decl.absence.states] } } : {}),
      declaredColumns: Object.keys(decl.columns ?? {}).length,
    };
  });
}
