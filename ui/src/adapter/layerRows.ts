/**
 * THE DOOR FOR A LAYER'S ROWS — `layerRowsFor(session, address)` answers the
 * rows a layer draws, from the session, under the layer's own table.
 *
 * The law (this folder's README, Law 3): a host that would need a helper the
 * library should have given it gets a DOOR. A node-link host has two layers
 * on one frame, each over its own table; the rows of each are one
 * `viewQuery` away — but which table, and how the address names it, is the
 * session's rule (`tableFor`), not the host's to restate. So the host asks
 * by ADDRESS and nothing else, and the session resolves the table.
 *
 * WHY `table` is never passed: `session.viewQuery({ viewId: 'net~edges' })`
 * already defaults the table to the edges layer's (pinned in the library's
 * own suite); spelling it here would be a second resolver of the address,
 * and the second one is the one nobody tests when the rule moves.
 *
 * In-process only, like `sessionSheetData`: a polled host needs its own
 * endpoint for this, and that is the server's door to grow (README, Law 2).
 *
 * First customers: a node-link chart's host (edges under nodes), the
 * conformance kit's layers fixture.
 */

import type { ViewQuery, ViewQueryResult } from 'vizfootprint/session';

/** The one session door this reads — structural, so a wrapper or a fake serves as well as a live session. */
export interface LayerRowsSessionLike {
  viewQuery(query?: ViewQuery): Promise<ViewQueryResult> | ViewQueryResult;
}

/** The window a host may shape: columns, sort, limit, offset — never the table or the consumer, which the address names. */
export type LayerRowsWindow = Omit<ViewQuery, 'viewId' | 'table'>;

/**
 * The rows at `address` (`viewId~layerId`, joined with `layerAddress`), under
 * the layer's table and every clause that reaches the layer. The answer is
 * the session's own `ViewQueryResult` — a refusal (`unknown-view` for a
 * layer the map does not declare) comes back as the session wrote it.
 */
export async function layerRowsFor(session: LayerRowsSessionLike, address: string, window: LayerRowsWindow = {}): Promise<ViewQueryResult> {
  return Promise.resolve(session.viewQuery({ ...window, viewId: address }));
}
