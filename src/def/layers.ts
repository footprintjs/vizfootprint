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
import type { MintedTable } from './builtinAnalyses.js';
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

/** No declared analysis mints a table — the shared empty answer, so a caller with no def to read passes nothing. */
const NOTHING_MINTED: ReadonlyMap<string, MintedTable> = new Map();

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
export function validateLayers(raw: unknown, where: string, viewId: string, data: unknown, problems: string[], minted: ReadonlyMap<string, MintedTable> = NOTHING_MINTED): void {
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
    judgeTable(at, layer.table, data, minted, problems);
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

/**
 * Law 2: the table is the point of a layer — required, and either DECLARED
 * under `data` or MINTED by a declared act.
 *
 * WHY both sets: a definition that declares an aggregate has already declared
 * the table it lands, under the act that owns it (`mintedTables`,
 * ./builtinAnalyses.ts). A layer drawing that table names something the
 * definition says exists; refusing it would be the door failing to read what
 * the definition already states. There is deliberately no `{computed: … }`
 * source in `data`: `DataSourceDef` is the CARRIERS, a minted table has no
 * carrier, and a table declared twice — once as a promise, once as the act
 * that keeps it — would have two owners. The act is the owner.
 *
 * WHEN it exists is a different question, and not one a definition can answer:
 * a minted table appears where its act landed, which is why the PROBE door
 * refuses per cursor and names the act (`../session/session.ts`).
 */
function judgeTable(at: string, table: unknown, data: unknown, minted: ReadonlyMap<string, MintedTable>, problems: string[]): void {
  if (!nonEmpty(table)) {
    problems.push(`${at}.table must be a non-empty string — a layer exists to name its table`);
    return;
  }
  // WHY: a malformed or empty `data` was refused on its own line; naming no tables here would only repeat it
  if (!isObject(data) || Object.keys(data).length === 0) return;
  if (hasOwn(data, table) || minted.has(table)) return;
  problems.push(`${at}.table "${table}" ${notATable(data, minted)}`);
}

/**
 * The tail of law 2's refusal: it names BOTH sets, because either one would
 * have satisfied the law and a reader shown one of them cannot tell whether
 * the name was a typo or the wrong kind of table. The minted half spells the
 * empty set in words — "the acts mint" with nothing after it is noise, not
 * honesty.
 */
function notATable(data: Record<string, unknown>, minted: ReadonlyMap<string, MintedTable>): string {
  const tables = Object.keys(data).join(', ');
  const acts = [...minted.keys()].join(', ');
  return `is not a declared data table, and no declared analysis mints it — the tables are ${tables}; ${acts.length === 0 ? 'no act mints one' : `the acts mint ${acts}`}`;
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

/** The keys a resolution may carry, per mode — anything else is refused by name (R12). An independent channel has no domain, no basis and no zero policy: there is nothing folded to apply them to; it keeps `transform` because its own scale is still an AXIS. */
const SHARED_KEYS: readonly string[] = ['mode', 'domain', 'basis', 'guide', 'zero', 'transform'];
const INDEPENDENT_KEYS: readonly string[] = ['mode', 'guide', 'transform'];
/** …and on a view with no LAYERS: the axis keys, without the one that resolves layers (`mode`, refused by name below). */
const AXIS_KEYS: readonly string[] = SHARED_KEYS.filter((key) => key !== 'mode');

/** The two shapes a resolution entry may be, spelled once each — the layered one names the mode it requires, the layerless one the axis it is. */
const RESOLUTION_SHAPE = '{ mode: "shared" | "independent", domain?, basis?, guide?, zero?, transform? }';
const AXIS_SHAPE = '{ transform?: "linear" | "log", domain?, basis?, guide?, zero? }';

/** The one word a `transform` may be beyond the default — a logarithmic axis, base 10. */
const LOG = 'log';

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
export function validateFrame(raw: unknown, where: string, viewId: string, layersRaw: unknown, data: unknown, view: FrameView, problems: string[], minted: ReadonlyMap<string, MintedTable> = NOTHING_MINTED): void {
  if (raw === undefined) return;
  // a view that declared layers is judged against THEM (even if every one was refused on its own line); a view
  // with none is judged against ITSELF — one implicit layer, which is what makes `transform` legal on a plain chart
  const declared = Array.isArray(layersRaw) && layersRaw.length > 0;
  const binders = declared ? layersRaw.map(wellFormedLayer).filter((layer): layer is LayerDecl => layer !== undefined).map(binderOfLayer) : [binderOfView(viewId, view)];
  const layerless = !declared;
  if (!isObject(raw)) {
    problems.push(`${where}.frame, if present, must be an object mapping channel -> ${layerless ? '{ transform?: "linear" | "log" }' : '{ mode: "shared" | "independent" }'}`);
    return;
  }
  const channels = channelsOfBinders(binders);
  for (const [channel, decl] of Object.entries(raw)) {
    const at = `${where}.frame.${channel}`;
    // a resolution for a channel nothing can bind resolves nothing — and naming the channels is how a typo gets found.
    // Skipped where NOTHING names a channel: every declared layer was malformed, or the binder's own `channels`
    // was refused on its own line. An empty list names nobody, so the sentence would end mid-air.
    if (channels.length > 0 && !channels.includes(channel)) problems.push(`${at}: unknown channel — the ${layerless ? 'view binds' : 'layers bind'} ${channels.join(', ')}`);
    judgeResolution(at, decl, layerless, viewId, problems);
  }
  // the laws hold for every channel the frame RESOLVES — the ones it names AND the ones it defaults
  for (const channel of channels) {
    const resolution = resolutionOf(raw, channel, layerless);
    if (resolution === undefined) continue; // refused on its own line above; not refused again through its laws
    judgeChannelLaws(`${where}.frame.${channel}`, channel, resolution, binders, data, minted, problems);
  }
}

/**
 * THE VIEW ITSELF, for a frame declared on a view with no layers — its mark,
 * its channels, its bindings and the table its columns are declared under
 * (the def's `defaultTable`, resolved by the caller so the rule lives in one
 * expression). Every field is `unknown`: a malformed one was refused on its own
 * line, and the frame's laws simply find nothing to judge.
 */
export interface FrameView {
  readonly chartKind: unknown;
  readonly channels: unknown;
  readonly initial: unknown;
  readonly table: string | undefined;
}

/**
 * WHAT ONE FRAME LAW IS JUDGED AGAINST: a layer, or — on a view with no layers
 * — the view as its own one implicit layer. The two differ only in how a
 * refusal NAMES them, which is why every sentence below reads the same for
 * both and no law is written twice.
 */
interface FrameBinder {
  /** How a sentence names it: `layer "edges"`, or `view "mass-radius"`. */
  readonly subject: string;
  /** Its bare id, for a sentence that quotes it beside another. */
  readonly name: string;
  readonly chartKind: string;
  readonly channels: readonly string[];
  readonly initial?: Readonly<Record<string, string>>;
  /** The table whose DECLARED columns judge its bindings — the layer's own, or the def's default table. */
  readonly table: string | undefined;
}

function binderOfLayer(layer: LayerDecl): FrameBinder {
  return { subject: `layer "${layer.layerId}"`, name: layer.layerId, chartKind: layer.chartKind, channels: layer.channels, ...(layer.initial !== undefined ? { initial: layer.initial } : {}), table: layer.table };
}

function binderOfView(viewId: string, view: FrameView): FrameBinder {
  return {
    subject: `view "${viewId}"`,
    name: viewId,
    chartKind: nonEmpty(view.chartKind) ? view.chartKind : '',
    channels: Array.isArray(view.channels) ? view.channels.filter(nonEmpty) : [],
    ...(isObject(view.initial) ? { initial: view.initial as Record<string, string> } : {}),
    table: view.table,
  };
}

/**
 * Law 7: the shape — a mode from the two words, and only the keys that mode
 * has. On a view with NO LAYERS the mode is the one key that is refused
 * instead: `shared` versus `independent` is a question about layers, and there
 * are none, while every AXIS key (`transform`, `zero`, and the fold words) is
 * legal there. One type, two judgements.
 */
function judgeResolution(at: string, decl: unknown, layerless: boolean, viewId: string, problems: string[]): void {
  if (!isObject(decl)) {
    problems.push(`${at} must be an object ${layerless ? AXIS_SHAPE : RESOLUTION_SHAPE}`);
    return;
  }
  if (layerless) {
    if (hasOwn(decl, 'mode')) problems.push(`${at}.mode: view "${viewId}" has no layers, so there is nothing to resolve — drop "mode" and keep the axis keys`);
    for (const key of Object.keys(decl)) if (key !== 'mode' && !AXIS_KEYS.includes(key)) problems.push(`${at}: unknown key "${key}" on an axis`);
    judgeAxisKeys(at, decl, problems);
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
    judgeTransform(at, decl, problems);
    return;
  }
  judgeAxisKeys(at, decl, problems);
}

/** The keys that describe the AXIS rather than the layers — judged identically whether or not the view has any. */
function judgeAxisKeys(at: string, decl: Record<string, unknown>, problems: string[]): void {
  // WHY a word and not numbers: the fold owns every domain, so an axis can never disagree with the rows under it (R1)
  if (decl.domain !== undefined && decl.domain !== 'union') problems.push(`${at}.domain, if present, must be "union" — a frame declares a fold, never numbers`);
  if (decl.basis !== undefined && decl.basis !== 'table' && decl.basis !== 'rows') problems.push(`${at}.basis, if present, must be "table" or "rows"`);
  if (decl.guide !== undefined && decl.guide !== 'merged' && decl.guide !== 'per-layer') problems.push(`${at}.guide, if present, must be "merged" or "per-layer"`);
  if (decl.zero !== undefined && typeof decl.zero !== 'boolean') problems.push(`${at}.zero, if present, must be a boolean`);
  judgeTransform(at, decl, problems);
}

/** Law 11a: the transform is one of two words. An unknown one is a typo, and a typo that defaulted silently would draw a linear axis the author believes is logarithmic. */
function judgeTransform(at: string, decl: Record<string, unknown>, problems: string[]): void {
  if (decl.transform !== undefined && decl.transform !== 'linear' && decl.transform !== LOG) problems.push(`${at}.transform, if present, must be "linear" or "log"`);
}

/**
 * The resolution a channel is judged under: the declared one, the Wickham
 * default where none was declared, or `undefined` for one already refused as
 * malformed. On a LAYERLESS view every entry is read as shared — the mode was
 * refused by name, and judging its channel laws twice for one mistake would
 * say the same thing in two sentences.
 */
function resolutionOf(raw: Record<string, unknown>, channel: string, layerless: boolean): Record<string, unknown> | undefined {
  const decl = raw[channel];
  if (decl === undefined) return SHARED_BY_DEFAULT as unknown as Record<string, unknown>;
  if (!isObject(decl)) return undefined;
  if (layerless) return { ...decl, mode: 'shared' };
  if (decl.mode !== 'shared' && decl.mode !== 'independent') return undefined;
  return decl;
}

/** Laws 8–11 for one channel: who may go independent, who keeps one zero, which columns may share, and what a logarithm may be asked to place. */
function judgeChannelLaws(at: string, channel: string, resolution: Record<string, unknown>, binders: readonly FrameBinder[], data: unknown, minted: ReadonlyMap<string, MintedTable>, problems: string[]): void {
  // the marks whose extent IS the quantity — read against a second axis, or off a cut baseline, a bar overstates by whatever was cut
  if (MAGNITUDE_CHANNELS.has(channel)) {
    for (const binder of binders.filter((b) => b.channels.includes(channel) && ZERO_ANCHORED_KINDS.includes(b.chartKind))) {
      if (resolution.mode === 'independent') problems.push(`${at}: ${binder.subject} is a ${binder.chartKind} — a ${binder.chartKind} cannot take an independent ${channel}, its extent is read against one baseline`);
      // …and the SAME reason under `shared`, when the guide is `per-layer` and there is a second layer to
      // stand beside: a shared channel with a per-layer guide is what a two-axis figure declares (`VizFrame`'s
      // OWN refusal, `contract/renderers.tsx` · `twoScalesRefusal`, law 2), and a bar-like layer takes neither
      // of its sides for the identical reason `independent` is refused above — one baseline, not a choice of
      // scales. Gated on more than one layer: a LONE bar under `guide: 'per-layer'` draws its own ordinary
      // axes (`VizFrame` · `layerGuides` special-cases a single layer), so there is no second axis to refuse.
      else if (resolution.mode === 'shared' && resolution.guide === 'per-layer' && binders.length > 1)
        problems.push(`${at}: ${binder.subject} is a ${binder.chartKind} — a ${binder.chartKind} cannot take a per-layer ${channel} on a frame of more than one layer either, its extent is read against one baseline`);
      // …and the ZERO half only where the extent is read on a channel the layer BINDS: a histogram's bound
      // channel is the axis its bins sit on, and its count axis is counted, never bound (`zeroAnchorsChannel`,
      // the one owner — it is what the FOLD asks too, so a refusal here and a domain there cannot disagree)
      else if (resolution.zero === false && zeroAnchorsChannel(binder.chartKind, channel)) problems.push(`${at}.zero is false but ${binder.subject} is a ${binder.chartKind} — its ${channel} is read from zero`);
    }
  }
  if (resolution.transform === LOG) judgeLogarithm(at, channel, resolution, binders, data, minted, problems);
  if (resolution.mode === 'shared') judgeSharedColumns(at, channel, binders, data, minted, problems);
}

/**
 * LAW 11: WHAT A LOGARITHM MAY BE ASKED TO PLACE. Three refusals, all about
 * meaning rather than data — the CELLS a logarithm cannot place are data, and
 * the fold excludes and counts those (`../encoding/frame.ts`).
 *
 *   a. `zero: true` — a logarithmic axis has no zero to reach for.
 *   b. a bound column that is not a number — a logarithm of a date or a
 *      category is nothing at all. Judged only where the def DECLARES the
 *      column's type (the `unit` precedent: refused on evidence, never on
 *      ignorance).
 *   c. the MAGNITUDE channel of a bar, a histogram or a box — the interesting
 *      one: a bar's length IS its quantity. Read through `zeroAnchorsChannel`,
 *      the one owner of "is this mark's extent read on this channel", so this
 *      law and the zero law cannot drift — and so a histogram's BIN axis, which
 *      is a position and not an extent, stays legitimately logarithmic.
 */
function judgeLogarithm(at: string, channel: string, resolution: Record<string, unknown>, binders: readonly FrameBinder[], data: unknown, minted: ReadonlyMap<string, MintedTable>, problems: string[]): void {
  if (resolution.zero === true) problems.push(`${at}: a logarithmic axis has no zero — drop "zero", or draw this channel linearly`);
  for (const binder of binders.filter((b) => b.channels.includes(channel))) {
    if (zeroAnchorsChannel(binder.chartKind, channel)) {
      problems.push(`${at}: ${binder.subject} is a ${binder.chartKind} — its ${channel} extent IS the quantity, and on a logarithmic axis a bar four times as long is not four times the value; a POSITION channel of a bar, histogram or boxplot may still be logarithmic`);
    }
    const field = binder.initial?.[channel];
    if (field === undefined) continue;
    const type = declaredFacet(data, binder.table, field, minted).type;
    if (type !== 'unknown' && type !== 'number') problems.push(`${at}: transform "log" needs a number — ${binder.subject} binds ${channel} to "${field}", a ${type}`);
  }
}

/** Law 10: a shared channel means ONE scale, so every layer binding it must bind a column that agrees on {@link FRAME_FACTS}. */
function judgeSharedColumns(at: string, channel: string, binders: readonly FrameBinder[], data: unknown, minted: ReadonlyMap<string, MintedTable>, problems: string[]): void {
  const binding = binders.filter((binder) => binder.initial?.[channel] !== undefined);
  if (binding.length < 2) return; // one layer (or none) cannot disagree with anybody
  const first = binding[0]!;
  const reference = declaredFacet(data, first.table, first.initial![channel]!, minted);
  for (const binder of binding.slice(1)) {
    const facet = declaredFacet(data, binder.table, binder.initial![channel]!, minted);
    for (const fact of FRAME_FACTS) {
      const mine = fact.of(reference);
      const theirs = fact.of(facet);
      if (mine === undefined || theirs === undefined || mine === theirs) continue;
      problems.push(`${at}: ${binder.subject} shares ${channel} with ${first.subject} but ${channel} is ${fact.say(mine)} on "${first.name}" and ${fact.say(theirs)} on "${binder.name}"`);
    }
  }
}

/** Every channel anything on this frame can bind, in declaration order, first-seen wins — what a frame may name, and the list its refusal spells. */
function channelsOfBinders(binders: readonly FrameBinder[]): readonly string[] {
  const seen: string[] = [];
  for (const binder of binders) for (const channel of binder.channels) if (!seen.includes(channel)) seen.push(channel);
  return seen;
}

/**
 * One column as the DEF ALONE knows it. A DECLARED table's types are the
 * provider's, so a column the def says nothing about answers `unknown` for
 * every fact and is therefore never held to one — `dashboard.lint()` judges it
 * with the data. The absence vocabulary is left out on purpose: an absence
 * column on a magnitude channel is already refused by the absence law, and
 * repeating it here would say the same thing twice in different words.
 *
 * A MINTED table is the one place the def knows more than the provider has
 * said: its columns and their types are its act's declaration
 * (`./builtinAnalyses.ts` · `mintedTables`), so a logarithm asked to place a
 * minted string is refused HERE rather than when the act runs. It carries no
 * `ColumnDecl` — no role, no scale, no unit — because there is none to carry,
 * and a column the parent never typed still answers `unknown`.
 */
function declaredFacet(data: unknown, table: string | undefined, field: string, minted: ReadonlyMap<string, MintedTable> = NOTHING_MINTED): ColumnFacet {
  const src = table !== undefined && isObject(data) && isObject(data[table]) ? (data[table] as Record<string, unknown>) : undefined;
  // a declared table wins the name, the same law `layerSurfacesOf` keeps below and for the same reason
  if (src === undefined && table !== undefined) {
    const lands = minted.get(table)?.columns.find((column) => column.name === field);
    if (lands !== undefined) return resolveFacet(lands, {});
  }
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
  // the layer's own TABLE rides the node: it is the rows every edge into this
  // address lands on, and the reach law (`../links/reach.ts`) asks for it first
  return { viewId: layerAddress(viewId, layer.layerId), voice: voice.filter((k) => k !== ENCODING_KIND), table: layer.table };
}

/**
 * THE FRAME IS ITS LAYERS — does this view read rows at its OWN address?
 *
 * The ONE owner of the question, asked by both twins that write a view's node
 * of the link graph (`./buildDashboard.ts` · `linkViews` and `./validate.ts`'s
 * `linkViews`, through `ownRowsOf`). A node of the link graph is a place that
 * reads rows. A view with no layers reads the default table at its own address
 * — byte-identical to a view built before layers existed. A layered view reads
 * it there ONLY when it binds something at its own level: a non-empty
 * view-level `initial` (law 5, ./README.md "Layers": "the view-level `initial`
 * is judged against the default table exactly as before"). Otherwise the frame
 * is its layers — each reads its own table under its own address, and the
 * view's own address draws nothing (the accepted ruling: "the frame is NOT a
 * layer — no voice of its own, only the domain commit"). Law 6a there.
 *
 * WHY it is judged from the declaration and never at read time: the map says
 * what a view is, once; `clausesFor`, `why()` and `narrowedFor` follow the map
 * and infer nothing. Both inputs are `unknown` so the raw door and the built
 * def ask in the same words: an absent or EMPTY layer list declares no layers
 * (`validateFrame`'s own reading of "declared"), and an absent or empty
 * `initial` binds nothing.
 */
export function readsOwnTable(view: { readonly layers?: unknown; readonly initial?: unknown }): boolean {
  const layered = Array.isArray(view.layers) && view.layers.length > 0;
  const binds = isObject(view.initial) && Object.keys(view.initial).length > 0;
  return !layered || binds;
}

/**
 * The ROWS half of a VIEW's own node of the link graph — `{ table }` when the
 * view reads the default table at its own address, `{ frame }` (the addresses
 * of its well-formed layers, in declaration order) when it reads only through
 * them, and never both. The default table is `undefined` only at the raw door
 * over a malformed table map, where a node's table was always left unstated.
 * ONE spelling for both twins, so the door and the build can never write a
 * different node for the same view.
 */
export function ownRowsOf(viewId: string, view: { readonly layers?: unknown; readonly initial?: unknown }, defaultTable: string | undefined): Pick<LinkView, 'table' | 'frame'> {
  if (readsOwnTable(view)) return defaultTable !== undefined ? { table: defaultTable } : {};
  // `readsOwnTable` is false only when `layers` is a non-empty array; a malformed layer was refused on its own line and is nobody's reader
  const readers = (view.layers as readonly unknown[]).flatMap((raw) => {
    const layer = wellFormedLayer(raw);
    return layer === undefined ? [] : [layerAddress(viewId, layer.layerId)];
  });
  return { frame: readers };
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
  /**
   * Present when the table is one an ACT lands rather than a declared source:
   * the caller judges this layer's fields against `minted.columns` and nothing
   * else. Those columns are TYPED off the declaration (`./builtinAnalyses.ts` ·
   * `mintedTables`), so a channel that needs a number is judged here and not
   * when the act runs. What a minted column still has no way to declare is
   * FACETS — no role, no scale, no unit — because it has no `ColumnDecl`.
   */
  readonly minted?: MintedTable;
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
 * Every well-formed layer of every well-formed encoding entry whose table law 2
 * accepted — the list the build door lints, one layer at a time against its own
 * table. A layer on a table neither declared nor minted was refused by name and
 * is skipped; a layer on a MINTED table carries the act's column list, which is
 * all the def can judge it against.
 *
 * WHY a declared table wins a name collision: the session never lets an act land
 * OVER a declared table's name (`../session/session.ts`, the landing door's own
 * refusal) — a declared `cells` and a minted `cells` can both be named in one def,
 * but only the declared one is ever the real `cells` at any cursor. Judging such a
 * layer against the ACT's column list instead of the table's own would silently
 * trade a sound field check for a check of a different table's columns, purely
 * because an unrelated analysis happens to share the name — so `minted` is read
 * only when the table is NOT also declared.
 */
export function layerSurfacesOf(encodings: readonly unknown[], data: Record<string, unknown>, minted: ReadonlyMap<string, MintedTable> = NOTHING_MINTED): LayerSurface[] {
  const out: LayerSurface[] = [];
  encodings.forEach((enc, index) => {
    if (!isObject(enc) || !nonEmpty(enc.viewId) || !Array.isArray(enc.layers)) return;
    enc.layers.forEach((raw, at) => {
      const layer = wellFormedLayer(raw);
      if (layer === undefined) return;
      const declared = hasOwn(data, layer.table);
      const lands = declared ? undefined : minted.get(layer.table);
      if (!declared && lands === undefined) return;
      out.push({ index, at, table: layer.table, surface: layerSurfaceOf(enc.viewId as string, layer), ...(lands !== undefined ? { minted: lands } : {}) });
    });
  });
  return out;
}
