/**
 * THE GRID PORT — what a sheet needs from a data layer, and nothing more.
 *
 * React-free and core-free at the type level: only TYPES are imported from
 * `src` (the package rule `ui/src/adapter/types.ts` states and `ui/src/notes`
 * follows), so a renderer, a test double, or a future AG Grid adapter can all
 * speak this without pulling the engine in.
 *
 * The shapes MIRROR the session's own view-query port (`src/session`
 * `ViewQuery` / `ViewQueryResult`): a window is `{columns, rows, rowIds,
 * positional, count, start, version, cursor}` and a refusal is a code plus the
 * sentence. Nothing is invented here — the port exists so the grid never
 * reaches into a session directly, not to restate the engine's answers.
 *
 * ONE LAW: a window is either the engine's answer or a refusal with a
 * sentence. There is no third arm — never an empty grid standing in for an
 * answer nobody gave.
 */
import type { ColumnRole, ColumnType, Row, SortSpec } from '../../../src/data/index.js';
import type { ViewQueryRefusal } from '../../../src/session/index.js';

export type { SortSpec, ViewQueryRefusal };

/**
 * One column as the facets state it: its name, what the type tally settled on,
 * and the role the def declared. `key` is a hint a host may pass; the WINDOW
 * names the key column itself (`SheetWindow.key`), and that is what the grid
 * trusts.
 */
export interface SheetColumn {
  readonly name: string;
  readonly type: ColumnType;
  /** Present when the def declared (or derived) a role — `identifier | dimension | measure | absence`. */
  readonly role?: ColumnRole;
  /** A host's hint that this is the declared row key. The window's own `key` wins. */
  readonly key?: boolean;
}

/**
 * What this data layer can do, and — for everything it cannot — the sentence
 * it refuses with. `edit` is `false` by construction in this version (the unit
 * is the column; see `./README.md`), `countKnown` is `true` because every
 * window carries the engine's own `count`, and `sort` is the one that varies:
 * an engine whose provider cannot sort says so, and `refusal` says it in words.
 */
export interface SheetCapabilities {
  /** False when the engine behind this port cannot sort — the headers then show `refusal` instead of a toggle. */
  readonly sort: boolean;
  /** Every window carries the engine's row count, so the scrollbar is never a guess. */
  readonly countKnown: true;
  /** The sheet is read-only in this version. A cell edit is refused with a next action, never swallowed. */
  readonly edit: false;
  /** Why `sort` is false, in the words a person reads. Absent when nothing is refused. */
  readonly refusal?: string;
}

/** One window asked for: which columns, in what order, where it starts, how many rows, and through whose eyes. */
export interface SheetWindowRequest {
  /** Default: every column the cursor sees. */
  readonly columns?: readonly string[];
  readonly sort?: readonly SortSpec[];
  readonly offset: number;
  readonly limit: number;
  /** The consumer view — its own clause excluded, link responses applied. Absent = every live clause filters. */
  readonly viewId?: string;
}

/** One window of rows — the engine's answer, mirrored from `ViewQueryResult`'s `ok` arm. */
export interface SheetWindow {
  readonly ok: true;
  /** The columns each row carries, in order — the projection asked for, plus the declared key when it was left out. */
  readonly columns: readonly string[];
  readonly rows: readonly Row[];
  /** Parallel to `rows`: the declared key's value, or `<version>#<source index>` on a positional table. */
  readonly rowIds: readonly string[];
  /** True when the table declares no row key — a row id is then a within-version position, never an identity. */
  readonly positional: boolean;
  /** The declared row key's column, when the table has one: what the grid freezes and a row click selects on. Absent on a positional table. */
  readonly key?: string;
  /** How many rows match, whatever the window shows. */
  readonly count: number;
  readonly start: number;
  /** The table's data version the window was read at (null for an inline table that has none). */
  readonly version: string | null;
  /** The cursor commit the window was read at — a late answer from a moved cursor is dropped, never shown. */
  readonly cursor: string | null;
}

/**
 * Why a window was refused: a code to branch on, and the sentence to show.
 * `unreachable` is this tier's own — a door that did not answer, or answered
 * something that is not a window.
 */
export interface SheetRefusal {
  readonly ok: false;
  readonly reason: ViewQueryRefusal | 'unreachable';
  readonly rejected: string;
}

/** The port itself: what a sheet may ask a data layer. */
export interface SheetData {
  readonly capabilities: SheetCapabilities;
  /** The schema: name, type, role, and which column is the declared key. */
  columns(): Promise<readonly SheetColumn[]>;
  /** One window, or a refusal with a sentence. `signal` aborts a window a scroll has already left behind. */
  rows(window: SheetWindowRequest, opts?: { readonly signal?: AbortSignal }): Promise<SheetWindow | SheetRefusal>;
}
