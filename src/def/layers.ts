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
import type { ColumnFacet } from '../data/types.js';
import type { ColumnDecl, EncodingSurface } from '../encoding/index.js';
import { MAGNITUDE_CHANNELS, ZERO_ANCHORED_KINDS, resolveFacet, zeroAnchorsChannel } from '../encoding/index.js';
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

// ── the frame: who may share a scale ──────────────────────────────────────────

/** The keys a resolution may carry, per mode — anything else is refused by name (R12). An independent channel has no domain, no basis and no zero policy: there is nothing folded to apply them to. */
const SHARED_KEYS: readonly string[] = ['mode', 'domain', 'basis', 'guide', 'zero'];
const INDEPENDENT_KEYS: readonly string[] = ['mode', 'guide'];

/** The Wickham default, stated where the validator needs it — the FOLD's copy is `zeroPolicyFor`/`resolutionFor` (`../encoding/frame.ts`), which is the one that produces numbers. */
const SHARED_BY_DEFAULT = { mode: 'shared' } as const;

/**
 * THE COLUMN FACTS TWO LAYERS MUST AGREE ON TO SHARE A SCALE, as data — each
 * with the words it says when they disagree. A pixel means one thing per
 * frame: if x is a number on one layer and a date on another, one axis cannot
 * be read for both, and the picture is a lie however carefully it is drawn.
 *
 * Every fact is skipped where either side did not DECLARE it — the def door
 * refuses on evidence, never on ignorance (which is also why a unit mismatch
 * is refused only when both columns name a unit).
 */
const FRAME_FACTS: readonly { readonly of: (facet: ColumnFacet) => string | undefined; readonly say: (value: string) => string }[] = [
  { of: (facet) => (facet.type === 'unknown' ? undefined : facet.type), say: (value) => `a ${value}` },
  { of: (facet) => facet.role, say: (value) => `a ${value}` },
  { of: (facet) => facet.scale, say: (value) => value },
  { of: (facet) => facet.unit, say: (value) => `in "${value}"` },
];

/**
 * Judge `encodings[i].frame`, when present — the frame's own laws, each one
 * sentence in `problems` (`./README.md`, "The frame", laws 7–10).
 *
 * `layersRaw` is the same declared list `validateLayers` judged (a malformed
 * layer was refused on its own line and is not judged again here); `data` is
 * the def's table map, which is where the COLUMN facts two sharing layers must
 * agree on are declared.
 */
export function validateFrame(raw: unknown, where: string, viewId: string, layersRaw: unknown, data: unknown, problems: string[]): void {
  if (raw === undefined) return;
  const layers = Array.isArray(layersRaw) ? layersRaw.map(wellFormedLayer).filter((layer): layer is LayerDecl => layer !== undefined) : [];
  // WHY first: a frame resolves what the LAYERS would otherwise decide apart, so on a plain view every other sentence would be beside the point
  if (layers.length === 0) {
    problems.push(`${where}.frame declares resolution for layers; view "${viewId}" has none`);
    return;
  }
  if (!isObject(raw)) {
    problems.push(`${where}.frame, if present, must be an object mapping channel -> { mode: "shared" | "independent" }`);
    return;
  }
  const channels = channelsOfLayers(layers);
  for (const [channel, decl] of Object.entries(raw)) {
    const at = `${where}.frame.${channel}`;
    // a resolution for a channel no layer can bind resolves nothing — and naming the channels is how a typo gets found
    if (!channels.includes(channel)) problems.push(`${at}: unknown channel — the layers bind ${channels.join(', ')}`);
    judgeResolution(at, decl, problems);
  }
  // the laws hold for every channel the frame RESOLVES — the ones it names AND the ones it defaults
  for (const channel of channels) {
    const resolution = resolutionOf(raw, channel);
    if (resolution === undefined) continue; // refused on its own line above; not refused again through its laws
    judgeChannelLaws(`${where}.frame.${channel}`, channel, resolution, layers, data, problems);
  }
}

/** Law 7: the shape — a mode from the two words, and only the keys that mode has. */
function judgeResolution(at: string, decl: unknown, problems: string[]): void {
  if (!isObject(decl)) {
    problems.push(`${at} must be an object { mode: "shared" | "independent", domain?, basis?, guide?, zero? }`);
    return;
  }
  if (decl.mode !== 'shared' && decl.mode !== 'independent') {
    problems.push(`${at}.mode must be "shared" or "independent"`);
    return;
  }
  const independent = decl.mode === 'independent';
  for (const key of Object.keys(decl)) {
    if (!(independent ? INDEPENDENT_KEYS : SHARED_KEYS).includes(key)) problems.push(`${at}: unknown key "${key}" on ${independent ? 'an independent' : 'a shared'} channel`);
  }
  if (independent) {
    if (decl.guide !== undefined && decl.guide !== 'per-layer') problems.push(`${at}.guide must be "per-layer" on an independent channel — there is no merged guide for scales that disagree`);
    return;
  }
  // WHY a word and not numbers: the fold owns every domain, so an axis can never disagree with the rows under it (R1)
  if (decl.domain !== undefined && decl.domain !== 'union') problems.push(`${at}.domain, if present, must be "union" — a frame declares a fold, never numbers`);
  if (decl.basis !== undefined && decl.basis !== 'table' && decl.basis !== 'rows') problems.push(`${at}.basis, if present, must be "table" or "rows"`);
  if (decl.guide !== undefined && decl.guide !== 'merged' && decl.guide !== 'per-layer') problems.push(`${at}.guide, if present, must be "merged" or "per-layer"`);
  if (decl.zero !== undefined && typeof decl.zero !== 'boolean') problems.push(`${at}.zero, if present, must be a boolean`);
}

/** The resolution a channel is judged under: the declared one, the Wickham default where none was declared, or `undefined` for one already refused as malformed. */
function resolutionOf(raw: Record<string, unknown>, channel: string): Record<string, unknown> | undefined {
  const decl = raw[channel];
  if (decl === undefined) return SHARED_BY_DEFAULT as unknown as Record<string, unknown>;
  if (!isObject(decl) || (decl.mode !== 'shared' && decl.mode !== 'independent')) return undefined;
  return decl;
}

/** Laws 8–10 for one channel: who may go independent, who keeps one zero, and which columns may share. */
function judgeChannelLaws(at: string, channel: string, resolution: Record<string, unknown>, layers: readonly LayerDecl[], data: unknown, problems: string[]): void {
  // the marks whose extent IS the quantity — read against a second axis, or off a cut baseline, a bar overstates by whatever was cut
  if (MAGNITUDE_CHANNELS.has(channel)) {
    for (const layer of layers.filter((l) => l.channels.includes(channel) && ZERO_ANCHORED_KINDS.includes(l.chartKind))) {
      if (resolution.mode === 'independent') problems.push(`${at}: layer "${layer.layerId}" is a ${layer.chartKind} — a ${layer.chartKind} cannot take an independent ${channel}, its extent is read against one baseline`);
      // …and the ZERO half only where the extent is read on a channel the layer BINDS: a histogram's bound
      // channel is the axis its bins sit on, and its count axis is counted, never bound (`zeroAnchorsChannel`,
      // the one owner — it is what the FOLD asks too, so a refusal here and a domain there cannot disagree)
      else if (resolution.zero === false && zeroAnchorsChannel(layer.chartKind, channel)) problems.push(`${at}.zero is false but layer "${layer.layerId}" is a ${layer.chartKind} — its ${channel} is read from zero`);
    }
  }
  if (resolution.mode === 'shared') judgeSharedColumns(at, channel, layers, data, problems);
}

/** Law 10: a shared channel means ONE scale, so every layer binding it must bind a column that agrees on {@link FRAME_FACTS}. */
function judgeSharedColumns(at: string, channel: string, layers: readonly LayerDecl[], data: unknown, problems: string[]): void {
  const binding = layers.filter((layer) => layer.initial?.[channel] !== undefined);
  if (binding.length < 2) return; // one layer (or none) cannot disagree with anybody
  const first = binding[0]!;
  const reference = declaredFacet(data, first.table, first.initial![channel]!);
  for (const layer of binding.slice(1)) {
    const facet = declaredFacet(data, layer.table, layer.initial![channel]!);
    for (const fact of FRAME_FACTS) {
      const mine = fact.of(reference);
      const theirs = fact.of(facet);
      if (mine === undefined || theirs === undefined || mine === theirs) continue;
      problems.push(`${at}: layer "${layer.layerId}" shares ${channel} with layer "${first.layerId}" but ${channel} is ${fact.say(mine)} on "${first.layerId}" and ${fact.say(theirs)} on "${layer.layerId}"`);
    }
  }
}

/** Every channel any layer can bind, in declaration order, first-seen wins — what a frame may name, and the list its refusal spells. */
function channelsOfLayers(layers: readonly LayerDecl[]): readonly string[] {
  const seen: string[] = [];
  for (const layer of layers) for (const channel of layer.channels) if (!seen.includes(channel)) seen.push(channel);
  return seen;
}

/**
 * One column as the DEF ALONE knows it. Column TYPES are the provider's, so a
 * column the def says nothing about answers `unknown` for every fact and is
 * therefore never held to one — `dashboard.lint()` judges it with the data.
 * The absence vocabulary is left out on purpose: an absence column on a
 * magnitude channel is already refused by the absence law, and repeating it
 * here would say the same thing twice in different words.
 */
function declaredFacet(data: unknown, table: string, field: string): ColumnFacet {
  const src = isObject(data) && isObject(data[table]) ? (data[table] as Record<string, unknown>) : undefined;
  const columns = src !== undefined && isObject(src.columns) && Object.values(src.columns).every(isObject) ? (src.columns as Readonly<Record<string, ColumnDecl>>) : undefined;
  return resolveFacet({ name: field, type: 'unknown' }, columns === undefined ? {} : { columns });
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
