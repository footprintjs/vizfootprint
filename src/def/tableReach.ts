/**
 * THE ONE READER that turns a definition into what `src/links` needs to judge
 * reach: the relations between tables, and the columns of every table whose
 * list is KNOWN.
 *
 * WHY here and not in `src/links`: that package knows nothing about
 * definitions (the dependency runs this way — `src/def` imports it), and TWO
 * doors ask the same question of the same def. The def door judges a declared
 * edge (`validateDashboardDef`) and the build door mints the default ones
 * (`buildDashboard`); if each read the def its own way, one could refuse an
 * edge the other happily minted. So they read it here, once.
 *
 * Total over `unknown`, like every reader on this boundary: the def door calls
 * it on a RAW definition whose relations may not have been judged yet, so a
 * malformed relation is skipped here and refused by name on its own line
 * (`./relations.ts`).
 */
import { mintedColumnNames, mintedTables } from './builtinAnalyses.js';
import type { ReachRelation, TableReach } from '../links/index.js';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** A relation end as this reader accepts it — both names present, or the relation is nobody's evidence. */
function endOf(raw: unknown): { table: string; column: string } | undefined {
  return isObject(raw) && nonEmpty(raw.table) && nonEmpty(raw.column) ? { table: raw.table, column: raw.column } : undefined;
}

/** {@link TableReach} off a definition — see the file's WHY for who asks and when. */
export function tableReachOf(def: unknown): TableReach {
  const relations: ReachRelation[] = [];
  if (isObject(def) && Array.isArray(def.relations)) {
    for (const raw of def.relations) {
      if (!isObject(raw)) continue;
      const from = endOf(raw.from);
      const to = endOf(raw.to);
      if (from !== undefined && to !== undefined) relations.push({ from, to });
    }
  }
  const columns: Record<string, readonly string[]> = {};
  // A table an ACT mints knows its whole column list by declaration (`mintedTables`
  // — the group columns then the measures), which is the one list this reader can
  // trust in full. NAMES only: reach is a question about which columns EXIST and
  // which relation ties two tables, and a type has no bearing on either answer.
  if (isObject(def)) for (const [table, minted] of mintedTables(def)) columns[table] = mintedColumnNames(minted);
  // …and a DECLARED table is judged by its declared `columns` when it has them —
  // the same conditional the relation door already applies (`./relations.ts`, law
  // 2: a table that declares no columns is judged post-build, never here).
  // Declared LAST because a declared name wins over a minted one that collides
  // with it, exactly as the layer door rules.
  if (isObject(def) && isObject(def.data)) {
    for (const [table, src] of Object.entries(def.data)) {
      if (isObject(src) && isObject(src.columns)) columns[table] = Object.keys(src.columns);
      else delete columns[table]; // a declared table that states no columns proves nothing, whatever an act of the same name mints
    }
  }
  return { relations, columns };
}
