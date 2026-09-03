/**
 * THE POLLED ADAPTER — a `SheetData` over an HTTP door that answers the
 * session's `ViewQueryResult` JSON verbatim:
 *
 *   GET <endpoint>?table=&viewId=&columns=&sort=&offset=&limit=
 *
 * `columns` and `sort` ride as JSON (never comma-joined: a column may be
 * called `a,b`), `offset` and `limit` as integers. The door answers the
 * library's own shape, so nothing is re-derived on this side.
 *
 * NOTHING IS TAKEN ON TRUST. A door that cannot be reached, one that answers a
 * status, and one that answers 200 with something that is not a window are all
 * honest REFUSALS with a sentence — and a refusing door's OWN sentence is the
 * one shown when it sent one. An empty grid must never stand in for an answer
 * nobody gave.
 *
 * The SCHEMA does not come down this wire: a cockpit already polls the column
 * facets (`state.columns[table]`), so the host hands them in for types and
 * roles. The KEY column is not asked of the host at all — every window names
 * it.
 */
import type { ViewQueryResult } from 'vizfootprint/session';
import type { SheetColumn, SheetData, SheetRefusal, SheetWindow, SheetWindowRequest } from './types.js';

/** Just the part of `fetch` this adapter uses — so a test passes a function, not a global. */
export type FetchLike = (url: string, init?: { readonly signal?: AbortSignal }) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export interface HttpSheetOptions {
  /** The window door, e.g. `/api/window`. */
  readonly endpoint: string;
  /** Default: the dashboard's default table (the door decides). */
  readonly table?: string;
  /** The schema the host already polls — names, types and roles. The key column rides on the window itself. */
  readonly columns?: readonly SheetColumn[];
  /** False when the engine behind the door cannot sort. */
  readonly sort?: boolean;
  readonly sortRefusal?: string;
  /** Default: the page's `fetch`. */
  readonly fetch?: FetchLike;
}

/** The query string for one window — every part the door parses, and nothing it does not. */
export function windowQuery(window: SheetWindowRequest, table?: string): string {
  const params = new URLSearchParams();
  if (table !== undefined) params.set('table', table);
  if (window.viewId !== undefined) params.set('viewId', window.viewId);
  if (window.columns !== undefined) params.set('columns', JSON.stringify(window.columns));
  if (window.sort !== undefined) params.set('sort', JSON.stringify(window.sort));
  params.set('offset', String(window.offset));
  params.set('limit', String(window.limit));
  return params.toString();
}

/** Is this 200 body actually a window (or a typed refusal)? A door that answers something else is refused, never rendered. */
export function isViewQueryResult(body: unknown): body is ViewQueryResult {
  if (typeof body !== 'object' || body === null) return false;
  const shape = body as { ok?: unknown; columns?: unknown; rows?: unknown; rowIds?: unknown; count?: unknown; start?: unknown; reason?: unknown; rejected?: unknown };
  if (shape.ok === false) return typeof shape.reason === 'string' && typeof shape.rejected === 'string';
  if (shape.ok !== true) return false;
  return Array.isArray(shape.columns) && Array.isArray(shape.rows) && Array.isArray(shape.rowIds) && typeof shape.count === 'number' && typeof shape.start === 'number';
}

/** The door's own sentence when it sent one (`{ error }`), else the status said in words. */
function doorSentence(status: number, body: unknown): string {
  const said = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  return typeof said === 'string' && said !== '' ? said : `the window door answered ${String(status)} — no rows were read`;
}

export function httpSheetData(options: HttpSheetOptions): SheetData {
  const canSort = options.sort ?? true;
  const call: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    capabilities: {
      sort: canSort,
      countKnown: true,
      edit: false,
      ...(canSort ? {} : { refusal: options.sortRefusal ?? 'the engine behind this door cannot sort — ask for the window in the table\'s own order' }),
    },
    columns(): Promise<readonly SheetColumn[]> {
      return Promise.resolve(options.columns ?? []);
    },
    async rows(window: SheetWindowRequest, opts?: { readonly signal?: AbortSignal }): Promise<SheetWindow | SheetRefusal> {
      const url = `${options.endpoint}?${windowQuery(window, options.table)}`;
      try {
        const res = await call(url, opts?.signal !== undefined ? { signal: opts.signal } : {});
        const body: unknown = await res.json().catch(() => undefined); // a body that is not JSON is no sentence at all
        if (!res.ok) return { ok: false, reason: 'unreachable', rejected: doorSentence(res.status, body) };
        if (!isViewQueryResult(body)) return { ok: false, reason: 'unreachable', rejected: 'the window door answered 200 with something that is not a window — no rows were read' };
        if (!body.ok) return { ok: false, reason: body.reason, rejected: body.rejected };
        return { ok: true, columns: body.columns, rows: body.rows, rowIds: body.rowIds, positional: body.positional, ...(body.key !== undefined ? { key: body.key } : {}), count: body.count, start: body.start, version: body.version, cursor: body.cursor };
      } catch (error: unknown) {
        return { ok: false, reason: 'unreachable', rejected: `the window door could not be reached: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  };
}
