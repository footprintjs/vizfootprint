/**
 * DERIVED columns — the trace's columns, kept apart from the map's — and the
 * ONE slot grammar a derived TABLE shares with them.
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
 * physical name — `./derivedTables.ts` names its slots through
 * {@link slotNameOf} here, so a derived table's slot and a derived column's
 * are one spelling under one marker — and, this is the part that matters,
 * nothing may ever PARSE one. A column literally named `risk@s7` could arrive in a CSV tomorrow;
 * whether a name is derived is answered by this registry, which knows what it
 * wrote, never by looking for the marker in the string.
 */

import { isPairClause } from './types.js';
import type { PredicateClause, Row } from './types.js';

/**
 * The marker between a derived column's logical name and the act that made it.
 * RESERVED in a physical name and nowhere else — a declared column may contain
 * it freely, because nothing reads a name to decide what it is.
 */
const ACT_MARKER = '@';

/**
 * Can this act's id name a slot? False when it carries the reserved marker — the
 * one reader of that rule outside {@link slotNameOf}, which BOTH doors
 * ({@link derivedColumnName}, `derivedTableName` in `./derivedTables.ts`) throw
 * from, so a caller judges here and files a gap instead of catching a throw.
 */
export function canNameSlot(commitId: string): boolean {
  return !commitId.includes(ACT_MARKER);
}

/**
 * The store slot one act's output lives in — a column's or a table's. Never
 * parsed back — see the file header — and unique per act BY CONSTRUCTION,
 * which is what the refusal here keeps true: `(name, commitId)` maps to one
 * slot only while no commit id carries the marker. A replayed log is free to
 * bring ids this session never minted (`parseCommitLog` judges shape and
 * lineage, never the character set), and `x@a` at commit `b` would otherwise
 * land in the same slot as `x` at commit `a@b` — two acts' outputs as one.
 *
 * The ONE speller. Its two doors say what kind of thing was slotted
 * ({@link derivedColumnName}, `derivedTableName` in `./derivedTables.ts`);
 * nothing outside this folder spells a slot, which is why the barrel exports
 * the doors and not this.
 */
export function slotNameOf(name: string, commitId: string): string {
  if (!canNameSlot(commitId)) {
    throw new Error(`vizfootprint: commit id "${commitId}" contains the reserved marker "${ACT_MARKER}" — the slot for "${name}" could not be told apart from another act's`);
  }
  return `${name}${ACT_MARKER}${commitId}`;
}

/** The slot one act's COLUMN lives in. */
export function derivedColumnName(name: string, commitId: string): string {
  return slotNameOf(name, commitId);
}

/** One derived column: what it is called, where it is stored, and the act that made it. */
export interface DerivedColumn {
  /**
   * The table SLOT the values were written into — a declared table's own name,
   * or a derived table's PHYSICAL one. Never a logical table name: that is
   * re-minted per act, so a column keyed by it would outlive the rows it was
   * computed from and resolve on top of a table it never saw.
   */
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
 * Which derived thing each logical name means at one position on the trace —
 * a column ({@link DerivedColumn}) or a table (`DerivedTable`,
 * `./derivedTables.ts`), which is why it is generic over the slot record: the
 * resolution rule is ONE rule, and a table resolves at the cursor exactly as a
 * column does.
 *
 * `pathIds` is the branch path root→cursor. An entry counts only when its
 * commit is on that path, so a column computed on a branch the cursor is not
 * on simply has no answer here — that IS the visibility rule, not a second
 * mechanism beside it. When one name was computed twice on the SAME path the
 * later act wins: a re-run supersedes, it does not shadow.
 */
export function resolveDerived<T extends { readonly name: string; readonly commitId: string }>(entries: readonly T[], pathIds: readonly string[]): Map<string, T> {
  const byCommit = new Map<string, T[]>();
  for (const e of entries) {
    const list = byCommit.get(e.commitId);
    if (list) list.push(e);
    else byCommit.set(e.commitId, [e]);
  }
  const out = new Map<string, T>();
  for (const id of pathIds) {
    for (const e of byCommit.get(id) ?? []) out.set(e.name, e);
  }
  return out;
}

/**
 * A clause with its column names rewritten — the ONE renamer a clause's column
 * names go through, for its two customers: logical becomes physical on the way
 * to an engine (`../session/session.ts`'s `ask`), and a link edge's field
 * `mapping` is applied on the way to a CONSUMER view
 * (`../session/clausesReaching.ts`). It takes a rename callback and knows
 * nothing about derived columns, which is why the second customer can share it.
 * Returns the SAME clause when nothing moved,
 * so the overwhelmingly common case (no derived column in the clause) costs no
 * allocation. Both columns of a two-field kind are rewritten — a `cell`'s two
 * axes, a `neighbourhood`'s two edge endpoints; a clause kind that grows a
 * new field must be added here.
 */
export function renameClauseFields(
  clause: PredicateClause,
  rename: (field: string) => string,
): PredicateClause {
  if (isPairClause(clause)) {
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
 * in `back` renamed to its logical name, every OTHER physical slot dropped,
 * everything else untouched.
 *
 * `slots` is the table's whole physical set ({@link DerivedColumnStore.physicalNames});
 * `back` is only the part of it resolved at the cursor. WHY the difference is
 * dropped and not passed through: a derived column landed on a SIBLING branch
 * still lives in the shared table store, so a row that carried it out of this
 * door would wear a physical name (`risk@s2`) as a column — the grammar this
 * module owns, leaking to a consumer that must then ignore or parse it, with
 * another branch's values inside. It is the law `effectiveColumnsOf` already
 * keeps for the COLUMN list (`../session/session.ts`); rows and columns answer
 * about one cursor or they answer differently.
 *
 * Returns the SAME row when it carries no physical slot at all — a window that
 * projected only declared columns pays nothing, even on a branch where a
 * derived column is visible.
 */
export function renameRowSlots(row: Row, back: ReadonlyMap<string, string>, slots: ReadonlySet<string>): Row {
  // WHY the SLOTS are probed and not the row's keys: a table has a handful of derived columns and a
  // row has every projected one, so scanning the row costs an array of its keys and a lookup per
  // COLUMN, per row, to learn there is nothing to rename. Own-key, so a row's own `__proto__` counts.
  let touched = false;
  for (const slot of slots) {
    if (Object.prototype.hasOwnProperty.call(row, slot)) {
      touched = true;
      break;
    }
  }
  if (!touched) return row;
  // WHY built through `fromEntries` and not assignment: assigning to the key `__proto__` runs
  // Object.prototype's own setter instead of creating an own property — a column named that
  // would vanish, or (with an object value) become the row's prototype
  const kept: (readonly [string, unknown])[] = [];
  for (const [key, value] of Object.entries(row)) {
    const logical = back.get(key);
    if (logical !== undefined) kept.push([logical, value] as const);
    else if (!slots.has(key)) kept.push([key, value] as const);
  }
  return Object.fromEntries(kept);
}
