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
import { layerAddress, splitLayerAddress } from '../def/layerAddress.js';
import type { LayerDecl, ViewDecl } from '../def/types.js';
import type { ProseSurface } from '../prose/index.js';
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

/**
 * THE DECLARED NAME A PERSON KNOWS THIS PLACE BY, or `undefined` when nothing
 * declared one — the layer's label, else the view's, and no third answer.
 *
 * WHY it is not `metaOf(place).label`: that one falls back to the layerId
 * because the registry refuses a source with no label at all. An ANSWER that
 * names a place has no such duty — a consumer that gets no label falls back to
 * the address it already holds, which is honest, where a layerId dressed as a
 * label is a name nobody declared. And WHY the view's label answers for an
 * unlabelled layer rather than being concatenated with the layerId: the view is
 * the thing the person was looking at; `view.label + layerId` would manufacture
 * a name that appears in no declaration.
 *
 * It takes the ADDRESS rather than a resolved `Place` (the shape `tableOf` and
 * `metaOf` take) because its callers hold an address and nothing else — and
 * because "no place here" is one of this question's three answers, where for
 * those two it is the caller's error.
 *
 * A `label: ''` or `label: '   '` is not a name — nothing in `../def/validate.ts`
 * refuses one, so the door leaves it declarable, and this is the one place that
 * has to decide what it MEANS. A blank string answered as the name would put
 * `"the selection from  filtered nothing here"` (a double space, no name at all)
 * in front of a reader, which is worse than the address it replaced — so a blank
 * layer label falls through to the view's, exactly as an absent one does, and a
 * blank view label falls through to nothing, exactly as an absent one does.
 *
 * First customer: `ReachingClause.fromLabel` (see its own WHY — the answer names
 * the view, so the answer carries the name).
 */
export function labelAt(views: ReadonlyMap<string, ViewDecl>, address: string): string | undefined {
  const place = placeOf(views, address);
  if (place === undefined) return undefined; // an address nothing on the map answers (an unknown view, a layer this def does not declare) has NO name — and no throw
  const named = (label: string | undefined): string | undefined => (label !== undefined && label.trim().length > 0 ? label : undefined);
  return named(place.layer?.label) ?? named(place.view.meta.label);
}

/**
 * The encoding surface at this place, under the address that names it: a
 * layer's OWN (`chartKind`, `channels` — a layer declares the same surface a
 * view does), or the view's when the address named no layer. Undefined where
 * there is no surface at all — a view that declares no encoding.
 *
 * WHY the prose plane asks: a `derived` slot is the library's own construction
 * line, written from the surface it describes. Reading the frame's surface for
 * a layer would say "a network with nothing bound" over a drawn layer.
 */
export function surfaceOf(place: Place, address: string): ProseSurface | undefined {
  if (place.layer === undefined) return place.view.encoding;
  return { viewId: address, chartKind: place.layer.chartKind, channels: place.layer.channels };
}

/**
 * The bindings shown at this place. A layer's are its declared `initial` and
 * stay so: `reencode` refuses a layer (its fold is the view's), so the
 * declaration IS what is on screen — there is no later commit to read.
 */
export function layerBindingsOf(layer: LayerDecl): Readonly<Record<string, string>> {
  return layer.initial ?? {};
}

/**
 * Every address on the map that declares an encoding surface — a view with an
 * `encoding`, and EVERY layer of every view (a layer always declares one).
 * The set a `derived` author is judged against: prose the library wrote itself
 * needs something to derive from, and a layer has exactly as much as a view.
 */
export function surfacedAddressesOf(views: Iterable<ViewDecl>): Set<string> {
  const out = new Set<string>();
  for (const view of views) {
    if (view.encoding !== undefined) out.add(view.viewId);
    for (const layer of view.layers ?? []) out.add(layerAddress(view.viewId, layer.layerId));
  }
  return out;
}

/**
 * EVERY address on the map — each view, then each of its layers under its
 * address — in map order. The set of CONSUMERS a clause can reach: a layer is
 * a link view of its own (`../links/materialize.ts`), gated on its own table,
 * so a walk over "where did this clause filter nothing" must stand at every
 * one of these and ask its table (`Session.tableFor` answers both shapes).
 * The twin of `surfacedAddressesOf`, minus the surface test — a sheet-like
 * view with no encoding is still a consumer.
 */
export function addressesOf(views: Iterable<ViewDecl>): string[] {
  const out: string[] = [];
  for (const view of views) {
    out.push(view.viewId);
    for (const layer of view.layers ?? []) out.push(layerAddress(view.viewId, layer.layerId));
  }
  return out;
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
