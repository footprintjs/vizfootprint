/**
 * THE POLLED ADAPTER — a `SheetData` over an HTTP door that answers the
 * session's `ViewQueryResult` JSON verbatim:
 *
 *   GET  <endpoint>?table=&viewId=&columns=&sort=&offset=&limit=
 *   POST <findEndpoint>  { table?, viewId?, columns?, sort?, text, from, direction }
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
import type { FindInViewResult, ViewQueryResult } from 'vizfootprint/session';
import type { SheetColumn, SheetData, SheetFindAnswer, SheetFindRequest, SheetRefusal, SheetWindow, SheetWindowRequest } from './types.js';

/**
 * Just the part of `fetch` this adapter uses — so a test passes a function, not
 * a global. The find door is a POST, so the init carries a method, a header and
 * a body; a window is still a bare GET.
 */
export type FetchLike = (url: string, init?: { readonly signal?: AbortSignal; readonly method?: string; readonly headers?: Readonly<Record<string, string>>; readonly body?: string }) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

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
  /**
   * The FIND door, e.g. `/api/find` — a POST whose body is the `FindQuery` and
   * whose answer is the library's `FindInViewResult` JSON, verbatim.
   *
   * WHY a POST for a read: the ask carries a person's typing and a sort spec,
   * which do not belong in a URL a proxy logs — and a GET with a query string
   * that changes on every keystroke is a cache key per keystroke. It is still a
   * READ: nothing lands, and the door is not asked to change anything.
   *
   * Absent is the honest default: this adapter answers WINDOWS, and a host that
   * has not put a find door up gets a sentence saying so rather than an input
   * that cannot answer.
   */
  readonly findEndpoint?: string;
  /** Why find is refused, when the host wants its own words for it. */
  readonly findRefusal?: string;
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

/** Preserve endpoint filters and fragments; supplied window fields override endpoint defaults. */
function windowUrl(endpoint: string, window: SheetWindowRequest, table?: string): string {
  const hashAt = endpoint.indexOf('#');
  const fragment = hashAt < 0 ? '' : endpoint.slice(hashAt);
  const address = hashAt < 0 ? endpoint : endpoint.slice(0, hashAt);
  const queryAt = address.indexOf('?');
  const path = queryAt < 0 ? address : address.slice(0, queryAt);
  const params = new URLSearchParams(queryAt < 0 ? '' : address.slice(queryAt + 1));
  for (const [key, value] of new URLSearchParams(windowQuery(window, table))) params.set(key, value);
  return `${path}?${params.toString()}${fragment}`;
}

/** The one sentence a door with no find door says — the grid shows it where the input would have been. */
export const NO_FIND_DOOR = 'this door answers windows only — no find door was given';

/** The `FindQuery` a find door is POSTed — every part the library's own door parses, and nothing it does not. */
export function findQueryBody(ask: SheetFindRequest, table?: string): Readonly<Record<string, unknown>> {
  return {
    ...(table !== undefined ? { table } : {}),
    ...(ask.viewId !== undefined ? { viewId: ask.viewId } : {}),
    ...(ask.columns !== undefined ? { columns: ask.columns } : {}),
    ...(ask.sort !== undefined ? { sort: ask.sort } : {}),
    text: ask.text,
    from: ask.from,
    direction: ask.direction,
  };
}

/** Is this 200 body actually a find answer (or a typed refusal)? A door that answers something else is refused, never rendered. */
export function isFindInViewResult(body: unknown): body is FindInViewResult {
  if (typeof body !== 'object' || body === null) return false;
  const shape = body as { ok?: unknown; position?: unknown; matches?: unknown; reason?: unknown; rejected?: unknown };
  if (shape.ok === false) return typeof shape.reason === 'string' && typeof shape.rejected === 'string';
  if (shape.ok !== true) return false;
  // `position: null` is the honest miss, so null is as valid an answer as a number
  return (shape.position === null || typeof shape.position === 'number') && typeof shape.matches === 'number';
}

/** Is this 200 body actually a window (or a typed refusal)? A door that answers something else is refused, never rendered. */
export function isViewQueryResult(body: unknown): body is ViewQueryResult {
  if (typeof body !== 'object' || body === null) return false;
  const shape = body as { ok?: unknown; columns?: unknown; rows?: unknown; rowIds?: unknown; count?: unknown; start?: unknown; reason?: unknown; rejected?: unknown };
  if (shape.ok === false) return typeof shape.reason === 'string' && typeof shape.rejected === 'string';
  if (shape.ok !== true) return false;
  return Array.isArray(shape.columns) && Array.isArray(shape.rows) && Array.isArray(shape.rowIds) && typeof shape.count === 'number' && typeof shape.start === 'number';
}

/**
 * The door's own sentence when it sent one (`{ error }`), else the status said
 * in words. WHY the door NAMES itself: two doors answer this adapter now, and
 * "the door answered 500" leaves a reader guessing which read failed.
 */
function doorSentence(door: 'window' | 'find', status: number, body: unknown): string {
  const said = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  if (typeof said === 'string' && said !== '') return said;
  return door === 'window' ? `the window door answered ${String(status)} — no rows were read` : `the find door answered ${String(status)} — nothing was looked for`;
}

export function httpSheetData(options: HttpSheetOptions): SheetData {
  const canSort = options.sort ?? true;
  const findDoor = options.findEndpoint;
  const call: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    capabilities: {
      sort: canSort,
      countKnown: true,
      edit: false,
      find: findDoor !== undefined,
      ...(canSort ? {} : { refusal: options.sortRefusal ?? 'the engine behind this door cannot sort — ask for the window in the table\'s own order' }),
      ...(findDoor !== undefined ? {} : { findRefusal: options.findRefusal ?? NO_FIND_DOOR }),
    },
    columns(): Promise<readonly SheetColumn[]> {
      return Promise.resolve(options.columns ?? []);
    },
    async rows(window: SheetWindowRequest, opts?: { readonly signal?: AbortSignal }): Promise<SheetWindow | SheetRefusal> {
      const url = windowUrl(options.endpoint, window, options.table);
      try {
        const res = await call(url, opts?.signal !== undefined ? { signal: opts.signal } : {});
        const body: unknown = await res.json().catch(() => undefined); // a body that is not JSON is no sentence at all
        if (!res.ok) return { ok: false, reason: 'unreachable', rejected: doorSentence('window', res.status, body) };
        if (!isViewQueryResult(body)) return { ok: false, reason: 'unreachable', rejected: 'the window door answered 200 with something that is not a window — no rows were read' };
        if (!body.ok) return { ok: false, reason: body.reason, rejected: body.rejected };
        // the clauses ride through for the export receipt, and ONLY when the door
        // actually sent a list: an absent `clauses` is a door that did not say, which
        // this port spells as absent rather than as an empty filter story
        return { ok: true, columns: body.columns, rows: body.rows, rowIds: body.rowIds, positional: body.positional, ...(body.key !== undefined ? { key: body.key } : {}), count: body.count, start: body.start, version: body.version, cursor: body.cursor, ...(Array.isArray(body.clauses) ? { clauses: body.clauses } : {}) };
      } catch (error: unknown) {
        return { ok: false, reason: 'unreachable', rejected: `the window door could not be reached: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
    async find(ask: SheetFindRequest, opts?: { readonly signal?: AbortSignal }): Promise<SheetFindAnswer | SheetRefusal> {
      // WHY the capability is not enough to skip this arm: a host may hold this
      // port past a config change, and a find with no door must say so rather
      // than POST to `undefined`.
      if (findDoor === undefined) return { ok: false, reason: 'unsupported-find', rejected: options.findRefusal ?? NO_FIND_DOOR };
      try {
        const res = await call(findDoor, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(findQueryBody(ask, options.table)),
          ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
        });
        const body: unknown = await res.json().catch(() => undefined); // a body that is not JSON is no sentence at all
        if (!res.ok) return { ok: false, reason: 'unreachable', rejected: doorSentence('find', res.status, body) };
        if (!isFindInViewResult(body)) return { ok: false, reason: 'unreachable', rejected: 'the find door answered 200 with something that is not a find answer — nothing was looked for' };
        if (!body.ok) return { ok: false, reason: body.reason, rejected: body.rejected };
        return { ok: true, position: body.position, ...(body.rowId !== undefined ? { rowId: body.rowId } : {}), ...(body.ordinal !== undefined ? { ordinal: body.ordinal } : {}), matches: body.matches, version: body.version, cursor: body.cursor };
      } catch (error: unknown) {
        return { ok: false, reason: 'unreachable', rejected: `the find door could not be reached: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  };
}
