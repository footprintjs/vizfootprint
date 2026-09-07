/**
 * THE ONE OWNER OF THE LAYER MARKER — `viewId~layerId` names one layer of a
 * view, and `~` is spelled here and nowhere else.
 *
 * The law: a view over more than one table has layers, each with its own
 * table, and an act names the layer it touched by an ADDRESS that reads as a
 * viewId everywhere a viewId is accepted (the log, the fold, the branches,
 * the tools) — the marker is opaque to all of them. Only the session's table
 * guard and the overview split it, and only through the readers below. A
 * viewId, a layerId and a table name may therefore never carry the marker
 * (`validate.ts` refuses them), which is what keeps the split unambiguous:
 * an address holds at most one.
 *
 * Precedent: footprintjs' `branchSegment.ts` — one owner of a generated
 * segment's grammar, pinned by a grep so the marker never leaks.
 *
 * First customers: `./layers.ts` (the def door), the session's `tableFor`,
 * the renderer contract's per-layer callback bundles.
 */

// ── the marker ──

/** The one character that separates a viewId from a layerId. RESERVED: no viewId, layerId or table name may contain it. */
export const LAYER_MARKER = '~' as const;

/** An address split: a plain viewId has no `layerId`. */
export interface LayerAddressParts {
  readonly viewId: string;
  readonly layerId?: string;
}

// ── join · split · hold ──

/** `layerAddress('v', 'edges')` → `'v~edges'` — the address a layer's commits land under. */
export function layerAddress(viewId: string, layerId: string): string {
  return `${viewId}${LAYER_MARKER}${layerId}`;
}

/**
 * `splitLayerAddress('v~edges')` → `{ viewId: 'v', layerId: 'edges' }`;
 * `splitLayerAddress('v')` → `{ viewId: 'v' }`.
 *
 * WHY split at the FIRST marker: neither half may contain one (the def door's
 * law), so the first is the only one — and an address that somehow holds a
 * second keeps it on the layerId side, where the session's layer lookup
 * refuses it as an unknown layer rather than silently naming another view.
 */
export function splitLayerAddress(address: string): LayerAddressParts {
  const at = address.indexOf(LAYER_MARKER);
  if (at < 0) return { viewId: address };
  return { viewId: address.slice(0, at), layerId: address.slice(at + 1) };
}

/** True iff the id wears the marker — what the def door asks of every viewId, layerId and table name. */
export function holdsLayerMarker(id: string): boolean {
  return id.includes(LAYER_MARKER);
}
