/**
 * A LAYER ADDRESS RESOLVED AGAINST THE MAP — which view, which layer, which
 * table, whose meta. The session's half of layers (`../def/layers.ts` is the
 * door's half): a view has no table of its own, so every act was gated on the
 * one default table; a layer HAS one, and an act that names a layer by its
 * address `viewId~layerId` is gated on that.
 *
 * The law: an address reads as a viewId everywhere a viewId is accepted (the
 * log, the fold, the branches, the tools never split it); only the session
 * splits it, and only through these readers — `../def/layerAddress.ts` owns
 * the marker, this file owns what the session does with the two halves. A
 * plain viewId resolves to its view and the default table, byte-for-byte what
 * it resolved to before layers existed.
 *
 * First customers: the session's `tableFor` / `metaFor` / `holdsView` (every
 * guard that read `this.defaultTable` or `runtime.views.get(viewId)`), the
 * overview's `views[].layers`.
 */
import { splitLayerAddress } from '../def/layerAddress.js';
import type { LayerDecl, ViewDecl } from '../def/types.js';
import type { ActorMeta } from '../selection/index.js';
import type { LayerInfo } from './types.js';

// ── the place an address names ────────────────────────────────────────────────

/** What an address resolved to: its view, and its layer when the address named one. */
export interface Place {
  readonly view: ViewDecl;
  readonly layer?: LayerDecl;
}

/** The place `address` names on the map, or undefined for an unknown view, an unknown layer, or a layer of a view that declares none. */
export function placeOf(views: ReadonlyMap<string, ViewDecl>, address: string): Place | undefined {
  const { viewId, layerId } = splitLayerAddress(address);
  const view = views.get(viewId);
  if (view === undefined || layerId === undefined) return view === undefined ? undefined : { view };
  const layer = view.layers?.find((l) => l.layerId === layerId);
  return layer === undefined ? undefined : { view, layer };
}

// ── what the place answers ────────────────────────────────────────────────────

/** The table an act at this place is gated on: the layer's own, or the session's default for a view (which declares none). */
export function tableOf(place: Place, defaultTable: string): string {
  return place.layer?.table ?? defaultTable;
}

/**
 * The registry meta a commit at this place lands with. A layer is its OWN
 * source under its address — the view's actor (the layer draws for the view),
 * labelled by the layer.
 *
 * WHY the label falls back to the layerId and `does` never rides: the registry
 * refuses a source whose meta varies between commits, so the meta must be a
 * pure function of the map; and `does` is the VIEW's routing sentence — a
 * layer is not a place a phrase routes to.
 */
export function metaOf(place: Place): ActorMeta {
  if (place.layer === undefined) return place.view.meta;
  return { actor: place.view.meta.actor, label: place.layer.label ?? place.layer.layerId };
}

/** The overview's projection of a view's layers — the declared facts, nothing judged; undefined when the view declares none (the key stays absent). */
export function layerInfosOf(view: ViewDecl): readonly LayerInfo[] | undefined {
  return view.layers?.map((l) => ({
    layerId: l.layerId,
    table: l.table,
    chartKind: l.chartKind,
    channels: l.channels,
    ...(l.label !== undefined ? { label: l.label } : {}),
  }));
}
