/**
 * DERIVED columns — the trace's columns, kept apart from the map's.
 *
 * A declared SOURCE column is MAP: it was there before anyone looked, it is
 * still, and it is not the trace's to edit. A DERIVED column (an analysis's
 * `as: 'columns'` output) is TRACE: it exists only because an act created it,
 * at a position, on a branch.
 *
 * Storing a trace-derived thing in the map's slot — one array per column NAME
 * in the shared table store — is what made two branches' `risk` the same
 * bytes, and what let a computed `price` destroy the real one. So a derived
 * column gets a slot per ACT, never a slot per name: it is written into the
 * store under a PHYSICAL name that carries the commit that made it, and the
 * logical name is resolved back at the cursor. See `src/data/README.md`.
 *
 * This module is the ONE owner of that grammar. Nothing else may spell a
 * physical name, and — this is the part that matters — nothing may ever PARSE
 * one. A column literally named `risk@s7` could arrive in a CSV tomorrow;
 * whether a name is derived is answered by this registry, which knows what it
 * wrote, never by looking for the marker in the string.
 */

import type { PredicateClause, Row } from './types.js';

/**
 * The marker between a derived column's logical name and the act that made it.
 * RESERVED in a physical name and nowhere else — a declared column may contain
 * it freely, because nothing reads a name to decide what it is.
 */
const ACT_MARKER = '@';

/** The store slot one act's output lives in. Never parsed back — see the file header. */
export function derivedColumnName(name: string, commitId: string): string {
  return `${name}${ACT_MARKER}${commitId}`;
}

/** One derived column: what it is called, where it is stored, and the act that made it. */
export interface DerivedColumn {
  readonly table: string;
  /** The name a person, a chart and a commit use. */
  readonly name: string;
  /** The slot in the table store. Unique per act. */
  readonly physical: string;
  /** The commit that created it — the whole reason the two names differ. */
  readonly commitId: string;
}

/**
 * Which physical slots in a dashboard's table stores are derived, and what act
 * each belongs to.
 *
 * Dashboard-scoped, beside the other shared stores (bookmarks, saved pictures,
 * the commit-id counter), because the table STORE is dashboard-scoped: two
 * sessions on one `buildDashboard` write into the same provider. Were this
 * per-session, session B would read session A's `risk@s7` as an ordinary
 * declared column — the same leak one level along.
 */
export class DerivedColumnStore {
  readonly #byTable = new Map<string, DerivedColumn[]>();

  /** Register a column that has just landed in the store. Append-only, like the trace it mirrors. */
  record(column: DerivedColumn): void {
    const list = this.#byTable.get(column.table);
    if (list) list.push(column);
    else this.#byTable.set(column.table, [column]);
  }

  /** Every derived column ever landed on one table, oldest first. */
  forTable(table: string): readonly DerivedColumn[] {
    return this.#byTable.get(table) ?? [];
  }

  /** The physical slots on one table that are derived — i.e. every store column NOT in this set is declared. */
  physicalNames(table: string): ReadonlySet<string> {
    return new Set(this.forTable(table).map((c) => c.physical));
  }

  /** physical → logical for one table, ignoring position: the spelling map a report uses. */
  logicalByPhysical(table: string): ReadonlyMap<string, string> {
    return new Map(this.forTable(table).map((c) => [c.physical, c.name] as const));
  }

  /**
   * Forget one table's derived columns. A refresh replaces the whole provider,
   * so the slots those columns lived in are gone; keeping the registry would
   * leave the session resolving a name the store no longer has. Read
   * {@link logicalByPhysical} BEFORE clearing to report what was dropped.
   */
  clear(table: string): void {
    this.#byTable.delete(table);
  }
}

/**
 * Which derived column each logical name means at one position on the trace.
 *
 * `pathIds` is the branch path root→cursor. An entry counts only when its
 * commit is on that path, so a column computed on a branch the cursor is not
 * on simply has no answer here — that IS the visibility rule, not a second
 * mechanism beside it. When one name was computed twice on the SAME path the
 * later act wins: a re-run supersedes, it does not shadow.
 */
export function resolveDerived(
  entries: readonly DerivedColumn[],
  pathIds: readonly string[],
): Map<string, DerivedColumn> {
  const byCommit = new Map<string, DerivedColumn[]>();
  for (const e of entries) {
    const list = byCommit.get(e.commitId);
    if (list) list.push(e);
    else byCommit.set(e.commitId, [e]);
  }
  const out = new Map<string, DerivedColumn>();
  for (const id of pathIds) {
    for (const e of byCommit.get(id) ?? []) out.set(e.name, e);
  }
  return out;
}

/**
 * A clause with its column names rewritten — the one place logical becomes
 * physical on the way to an engine. Returns the SAME clause when nothing moved,
 * so the overwhelmingly common case (no derived column in the clause) costs no
 * allocation. Both sides of a `cell` are rewritten; a clause kind that grows a
 * new field must be added here.
 */
export function renameClauseFields(
  clause: PredicateClause,
  rename: (field: string) => string,
): PredicateClause {
  if (clause.kind === 'cell') {
    const [x, y] = clause.fields;
    const nx = rename(x);
    const ny = rename(y);
    return nx === x && ny === y ? clause : { ...clause, fields: [nx, ny] };
  }
  const field = rename(clause.field);
  return field === clause.field ? clause : { ...clause, field };
}

/**
 * One answered row wearing the names the caller asked for: every physical slot
 * in `back` renamed to its logical name, everything else untouched.
 *
 * Returns the SAME row when it carries no derived slot at all — a window that
 * projected only declared columns pays nothing, even on a branch where a
 * derived column is visible.
 */
export function renameRowSlots(row: Row, back: ReadonlyMap<string, string>): Row {
  let touched = false;
  for (const key of Object.keys(row)) {
    if (back.has(key)) {
      touched = true;
      break;
    }
  }
  if (!touched) return row;
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) out[back.get(key) ?? key] = value;
  return out;
}
