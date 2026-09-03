/**
 * THE IN-PROCESS ADAPTER — a `SheetData` over a live session's view-query
 * port. It adds nothing: the session already owns which clauses reach a view,
 * which columns the cursor sees, which column is the row key, and what a
 * window's identity is, so this is a translation and a refusal pass-through,
 * never a second opinion.
 *
 * Two things it does own. A THROW is turned into a refusal with the thrown
 * message — a grid must never freeze on a rejected promise with nothing said.
 * And an ABORTED window is dropped: the scroll has already moved on, so the
 * rows are answered with a sentence nobody will show rather than painted over
 * a newer window.
 *
 * The session is read STRUCTURALLY (the same rule `ui/src/adapter/sessionView.ts`
 * follows for `SessionLike`): only the two methods a sheet needs are named, so
 * a test double is three lines and no value is imported from `src`.
 */
import type { Overview, ViewQuery, ViewQueryResult } from '../../../src/session/index.js';
import type { SheetColumn, SheetData, SheetRefusal, SheetWindow, SheetWindowRequest } from './types.js';

/** The subset of an `InteractionSession` a sheet reads. */
export interface SheetSessionLike {
  viewQuery(query?: ViewQuery): Promise<ViewQueryResult> | ViewQueryResult;
  overview(): Promise<Overview> | Overview;
}

export interface SessionSheetOptions {
  /** Default: the dashboard's default table. */
  readonly table?: string;
  /** False when this table's engine cannot sort — then `refusal` is the sentence the headers show. */
  readonly sort?: boolean;
  /** Why sort is refused, when it is. */
  readonly sortRefusal?: string;
}

/** The window as the sheet's port states it — the session's `clauses` stay with the session. */
function asWindow(answer: Extract<ViewQueryResult, { ok: true }>): SheetWindow {
  return {
    ok: true,
    columns: answer.columns,
    rows: answer.rows,
    rowIds: answer.rowIds,
    positional: answer.positional,
    ...(answer.key !== undefined ? { key: answer.key } : {}),
    count: answer.count,
    start: answer.start,
    version: answer.version,
    cursor: answer.cursor,
  };
}

/** A thrown thing as a sentence — a data layer that breaks says so, and the grid shows it. */
export function threwSentence(error: unknown): string {
  return `the data layer threw: ${error instanceof Error ? error.message : String(error)}`;
}

export function sessionSheetData(session: SheetSessionLike, options: SessionSheetOptions = {}): SheetData {
  const canSort = options.sort ?? true;
  return {
    capabilities: {
      sort: canSort,
      countKnown: true,
      edit: false,
      ...(canSort ? {} : { refusal: options.sortRefusal ?? 'this table\'s engine cannot sort — ask for the window in the table\'s own order' }),
    },
    async columns(): Promise<readonly SheetColumn[]> {
      const overview = await session.overview();
      const table = options.table ?? overview.defaultTable;
      const key = overview.keys[table];
      return (overview.columns[table] ?? []).map((facet) => ({
        name: facet.field,
        type: facet.type,
        ...(facet.role !== undefined ? { role: facet.role } : {}),
        ...(facet.field === key ? { key: true } : {}),
      }));
    },
    async rows(window: SheetWindowRequest, opts?: { readonly signal?: AbortSignal }): Promise<SheetWindow | SheetRefusal> {
      try {
        const answer = await session.viewQuery({
          ...(options.table !== undefined ? { table: options.table } : {}),
          ...(window.viewId !== undefined ? { viewId: window.viewId } : {}),
          ...(window.columns !== undefined ? { columns: window.columns } : {}),
          ...(window.sort !== undefined ? { sort: window.sort } : {}),
          offset: window.offset,
          limit: window.limit,
        });
        if (opts?.signal?.aborted === true) return { ok: false, reason: 'engine', rejected: 'this window was left behind by a newer one' };
        return answer.ok ? asWindow(answer) : { ok: false, reason: answer.reason, rejected: answer.rejected };
      } catch (error: unknown) {
        return { ok: false, reason: 'engine', rejected: threwSentence(error) };
      }
    },
  };
}
