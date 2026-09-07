/**
 * LAYERS — A VIEW OVER MORE THAN ONE TABLE, REFUSED AT DECLARATION IN SENTENCES.
 *
 * A view has no table of its own: the session gates every act on its single
 * default table. A node-link is two layers on one frame — edges under nodes —
 * and each layer reads a DIFFERENT table. This file is the def door's half of
 * that: a `ViewEncodingDecl` may carry `layers`, each naming its table, and an
 * act on a layer lands under the address `viewId~layerId` (`./layerAddress.ts`
 * is the one owner of the marker). Six laws, each with an example, in
 * ./README.md ("Layers").
 *
 * What the door judges: the shape (unknown keys by name, the R12 way), the
 * layerId (non-empty, marker-free, unique within its view), the table (declared),
 * and the same encoding surface a view declares. A layer's `channels` and
 * `initial` are judged by the EXISTING encoding rules — `validate.ts` runs the
 * build door once per layer against the layer's own table, never the default
 * table; a view with no layers walks the door exactly as before.
 *
 * First customers: `validateDashboardDef` (the door), `buildDashboard` (freezes
 * the resolved layers onto `ViewDecl.layers` and lints each against its table's
 * real columns), the session's `tableFor` (reads the layer's table off the
 * address), the overview (projects them).
 */
import type { EncodingSurface } from '../encoding/index.js';
import { ENCODING_KIND, type LinkView } from '../links/index.js';
import { LAYER_MARKER, holdsLayerMarker, layerAddress } from './layerAddress.js';
import type { LayerDecl } from './types.js';

// ── the vocabulary ────────────────────────────────────────────────────────────

/** The keys a layer may carry — anything else is refused by name (R12). */
const LAYER_KEYS: readonly string[] = ['layerId', 'table', 'chartKind', 'channels', 'initial', 'label'];

/** The shape a layer must be, spelled once for the two shape sentences. */
const LAYER_SHAPE = '{ layerId, table, chartKind, channels, initial?, label? }';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const hasOwn = (record: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

/** The one sentence for a reserved marker in any id — the same voice at a viewId, a table name and a layerId. */
export function markerRefusal(what: string, id: string): string {
  return `${what} "${id}" may not contain "${LAYER_MARKER}" — it is the layer marker`;
}

// ── the door ──────────────────────────────────────────────────────────────────

/**
 * Judge `encodings[i].layers`, when present. `data` is the def's table map as
 * declared (a malformed map was refused on its own line and no table sentence
 * is raised against it); `viewId` is the enclosing view's id, for the repeat
 * sentence. Every problem is one sentence in `problems`.
 */
export function validateLayers(raw: unknown, where: string, viewId: string, data: unknown, problems: string[]): void {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) {
    problems.push(`${where}.layers, if present, must be an array of { layerId, table, chartKind, channels }`);
    return;
  }
  const seen = new Set<string>();
  raw.forEach((layer, j) => {
    const at = `${where}.layers[${j}]`;
    if (!isObject(layer)) {
      problems.push(`${at} must be an object ${LAYER_SHAPE}`);
      return;
    }
    for (const key of Object.keys(layer)) if (!LAYER_KEYS.includes(key)) problems.push(`${at}: unknown key "${key}"`);
    judgeLayerId(at, layer.layerId, viewId, seen, problems);
    judgeTable(at, layer.table, data, problems);
    judgeSurface(at, layer, problems);
  });
}

/** Law 1: a layerId is a non-empty string, wears no marker, and is declared once within its view. */
function judgeLayerId(at: string, layerId: unknown, viewId: string, seen: Set<string>, problems: string[]): void {
  if (!nonEmpty(layerId)) {
    problems.push(`${at}.layerId must be a non-empty string`);
    return;
  }
  // WHY: the address `viewId~layerId` splits at the FIRST marker, so a layerId carrying one would name a different layer than it declares
  if (holdsLayerMarker(layerId)) problems.push(markerRefusal(`${at}.layerId`, layerId));
  if (seen.has(layerId)) problems.push(`${at}.layerId "${layerId}" repeats within view "${viewId}"`);
  seen.add(layerId);
}

/** Law 2: the table is the point of a layer — required, and declared under `data`. */
function judgeTable(at: string, table: unknown, data: unknown, problems: string[]): void {
  if (!nonEmpty(table)) {
    problems.push(`${at}.table must be a non-empty string — a layer exists to name its table`);
    return;
  }
  // WHY: a malformed or empty `data` was refused on its own line; naming no tables here would only repeat it
  if (!isObject(data) || Object.keys(data).length === 0) return;
  if (!hasOwn(data, table)) problems.push(`${at}.table "${table}" is not a declared data table — the tables are ${Object.keys(data).join(', ')}`);
}

/** Law 3: the same encoding surface a view declares, in the same sentences — the meaning is judged by the encoding rules at the build door. */
function judgeSurface(at: string, layer: Record<string, unknown>, problems: string[]): void {
  if (!nonEmpty(layer.chartKind)) problems.push(`${at}.chartKind must be a non-empty string`);
  if (!Array.isArray(layer.channels) || layer.channels.length === 0 || layer.channels.some((c) => !nonEmpty(c))) {
    problems.push(`${at}.channels must be a non-empty array of non-empty strings`);
  }
  if (layer.initial !== undefined && (!isObject(layer.initial) || Object.values(layer.initial).some((v) => typeof v !== 'string'))) {
    problems.push(`${at}.initial, if present, must be an object mapping channel -> field (strings)`);
  }
  if (layer.label !== undefined && typeof layer.label !== 'string') problems.push(`${at}.label, if present, must be a string`);
}

// ── the layers as nodes of the link graph ─────────────────────────────────────

/**
 * A layer as the link graph sees it: its own node under its address, speaking
 * its VIEW's voice (the frame's capability is the layers' capability). WHY no
 * `channels` and no `grain`: an encoding edge follows a binding the `reencode`
 * fold holds per VIEW, and a layer's bindings are declared on the layer in
 * this version — so an encoding edge naming a layer is refused by the existing
 * "declares no encoding surface" sentences; a grain is a view's, judged there.
 */
export function layerLinkViewOf(viewId: string, layer: LayerDecl, voice: LinkView['voice']): LinkView {
  return { viewId: layerAddress(viewId, layer.layerId), voice: voice.filter((k) => k !== ENCODING_KIND) };
}

/** The link-graph nodes of every well-formed layer on `encodings` (the door's twin of `layerSurfacesOf`), each with its view's voice. */
export function layerLinkViewsOf(encodings: readonly unknown[], voiceOfView: (viewId: string) => LinkView['voice'] | undefined): LinkView[] {
  const out: LinkView[] = [];
  for (const enc of encodings) {
    if (!isObject(enc) || !nonEmpty(enc.viewId) || !Array.isArray(enc.layers)) continue;
    const voice = voiceOfView(enc.viewId);
    if (voice === undefined) continue; // an undeclared view was refused by name; its layers are nobody's nodes
    for (const raw of enc.layers) {
      const layer = wellFormedLayer(raw);
      if (layer !== undefined) out.push(layerLinkViewOf(enc.viewId, layer, voice));
    }
  }
  return out;
}

// ── the surfaces the build door judges ────────────────────────────────────────

/** One layer as the encoding validator reads it: its surface under its ADDRESS, and the table whose columns judge it. */
export interface LayerSurface {
  /** Index of the enclosing entry in `def.encodings`. */
  readonly index: number;
  /** Index of the layer in `encodings[index].layers`. */
  readonly at: number;
  readonly table: string;
  readonly surface: EncodingSurface;
}

/** A layer as declared, or undefined unless every required part is well-formed (a malformed layer is already a problem and is not judged). */
function wellFormedLayer(raw: unknown): LayerDecl | undefined {
  if (!isObject(raw) || !nonEmpty(raw.layerId) || !nonEmpty(raw.table) || !nonEmpty(raw.chartKind)) return undefined;
  if (!Array.isArray(raw.channels) || raw.channels.length === 0 || !raw.channels.every(nonEmpty)) return undefined;
  if (raw.initial !== undefined && (!isObject(raw.initial) || Object.values(raw.initial).some((v) => typeof v !== 'string'))) return undefined;
  return {
    layerId: raw.layerId,
    table: raw.table,
    chartKind: raw.chartKind,
    channels: raw.channels as string[],
    ...(raw.initial !== undefined ? { initial: raw.initial as Record<string, string> } : {}),
  };
}

/** The surface one layer presents to the encoding validator — its bindings under the layer address. */
export function layerSurfaceOf(viewId: string, layer: LayerDecl): EncodingSurface {
  return {
    viewId: layerAddress(viewId, layer.layerId),
    chartKind: layer.chartKind,
    channels: layer.channels,
    ...(layer.initial !== undefined ? { initial: layer.initial } : {}),
  };
}

/**
 * Every well-formed layer of every well-formed encoding entry whose table is
 * declared — the list the build door lints, one layer at a time against its
 * own table. A layer on an undeclared table was refused by name and is skipped.
 */
export function layerSurfacesOf(encodings: readonly unknown[], data: Record<string, unknown>): LayerSurface[] {
  const out: LayerSurface[] = [];
  encodings.forEach((enc, index) => {
    if (!isObject(enc) || !nonEmpty(enc.viewId) || !Array.isArray(enc.layers)) return;
    enc.layers.forEach((raw, at) => {
      const layer = wellFormedLayer(raw);
      if (layer === undefined || !hasOwn(data, layer.table)) return;
      out.push({ index, at, table: layer.table, surface: layerSurfaceOf(enc.viewId as string, layer) });
    });
  });
  return out;
}
