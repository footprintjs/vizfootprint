/**
 * THE FRAME — ONE DOMAIN PER SHARED CHANNEL, FOLDED FROM THE LAYERS' OWN VALUES.
 *
 * A view is an ordered stack of LAYERS over ONE FRAME, and the frame owns the
 * scales (Wickham: "scales are common across layers"). The DECLARATION of that
 * lives in the def — `ViewEncodingDecl.frame`, a {@link ChannelResolution} per
 * channel, in which no number can be typed by hand. This file is the FOLD: the
 * one place a resolution becomes an actual domain, so an axis can never
 * disagree with the rows drawn under it.
 *
 * Pure and total. It reads values, never a session, a provider or a clause —
 * WHO chose the rows is the caller's business and the whole meaning of
 * `basis`: the adapter's `frameFor` reads them through the session's row door
 * (a layer's own window for `basis: 'rows'`, the table under nobody's clause
 * for `'table'`) and hands the values here. Two things the caller owes this
 * fold, because it cannot see them:
 *
 *   1. ABSENCE ROWS ARE ALREADY OUT. A table's declared absence column says a
 *      cell is a SILENCE, not a low number ("unavailable" is not zero), so a
 *      row the absence vocabulary excludes must never reach a domain. The
 *      adapter drops those rows before it folds (see `frameFor`).
 *   2. THE BASIS. `'table'` rows and `'rows'` rows are two different reads of
 *      the same door; this fold cannot tell them apart and does not try. It
 *      echoes back the basis it was told, so a renderer knows what it got.
 *
 * An absent cell is skipped one level down, here: `null`, `undefined`, a
 * non-finite number and a value of the wrong shape for the channel's scale
 * contribute nothing. A channel NO layer could fold carries no entry at all —
 * no domain is more honest than an invented `[0, 1]`.
 *
 * First customers: the adapter's frame door (fills `RenderState.frame` at every
 * update), `networkRenderer` (its one px-per-unit frame over nodes + edge
 * endpoints), and the generic frame renderer.
 */
import type { ColumnType } from '../data/types.js';
import type { ChannelResolution } from '../def/types.js';
// the ONE owner of which channels carry a magnitude — the same set the def door's law 9 reads
import { MAGNITUDE_CHANNELS } from './types.js';

// ── what a fold is given ──────────────────────────────────────────────────────

/** One channel's raw material on one layer: what the column IS, and the cells as they came off the rows. */
export interface ChannelValues {
  readonly type: ColumnType;
  /** Borrowed cells — read, never mutated (the repo-wide rows law). */
  readonly values: readonly unknown[];
}

/** One layer as the fold sees it: which channels it binds, with what values, and the mark kind that decides the zero default. */
export interface FrameLayer {
  readonly layerId: string;
  /** The layer's mark (`'bar'`, `'line'`, …). Read for ONE thing: whether its magnitude channel is anchored at zero. */
  readonly chartKind?: string;
  readonly channels: Readonly<Record<string, ChannelValues>>;
}

// ── what a fold answers ───────────────────────────────────────────────────────

/**
 * The domain, with the SCALE KIND it was folded as — a consumer branches on
 * `scale` before it reads `domain`, because the three are three different
 * things: a pair of numbers, a pair of ISO strings, an ordered category list.
 */
export type ResolvedDomain =
  | { readonly scale: 'quantitative'; readonly domain: readonly [number, number] }
  | { readonly scale: 'temporal'; readonly domain: readonly [string, string] }
  | { readonly scale: 'categorical'; readonly domain: readonly string[] };

/**
 * One channel, resolved: the mode, who draws the guide, and — when the channel
 * is shared and something could be folded — the domain with its scale kind.
 * An `independent` channel carries no domain by definition: each layer keeps
 * its own scale, and each draws its own guide.
 */
export type ResolvedChannel =
  | ({
      readonly mode: 'shared';
      /** Which rows the caller folded — echoed from the declaration, never decided here. */
      readonly basis: 'table' | 'rows';
      readonly guide: 'merged' | 'per-layer';
    } & ResolvedDomain)
  | { readonly mode: 'independent'; readonly guide: 'per-layer' };

// ── the defaults, spelled once ────────────────────────────────────────────────

/**
 * THE MARKS WHOSE MAGNITUDE IS READ FROM ZERO. A bar's, a histogram bin's and
 * a box's extent ARE the quantity — cut the baseline and the picture overstates
 * a difference by however much was cut. A line or a point encodes POSITION, and
 * an honest line chart may zoom.
 */
export const ZERO_ANCHORED_KINDS: readonly string[] = Object.freeze(['bar', 'histogram', 'boxplot']);

/**
 * Of those marks, the ones whose extent is read on a channel a layer BINDS —
 * and so the only ones a FOLD can anchor. A bar's and a box's extent is the
 * column on its magnitude channel (x on a horizontal bar, y on a vertical one:
 * which is which is decided by the COLUMN, never declared, and a category axis
 * has no zero to reach for anyway).
 *
 * A HISTOGRAM is the one that is not: its extent is the COUNT axis, which is
 * counted from the rows and is never a bound column. The channel a histogram
 * layer does bind is the axis its BINS sit on, and that is a POSITION —
 * anchoring it would stretch an axis of ages from 30 down to 0 and leave a
 * third of the plot empty. The count baseline stays at zero in the CHART
 * (`VizHistogram`, which draws it), which is where that law can see what it is
 * about. Kept as its own list rather than as a `!== 'histogram'`, and pinned to
 * be a subset of {@link ZERO_ANCHORED_KINDS} so the two cannot drift.
 */
const EXTENT_ON_A_BOUND_CHANNEL: readonly string[] = Object.freeze(['bar', 'boxplot']);

/**
 * IS A MARK'S EXTENT READ ON THIS CHANNEL? The one owner of that question, so
 * the def door's law 9 and this fold can never disagree about which channel the
 * marks decide — the def refuses `zero: false` exactly where this says yes.
 *
 * Only a magnitude channel can carry an extent ({@link MAGNITUDE_CHANNELS}): a
 * colour ramp, a shape or a label is not a length, so there is no baseline to
 * cut and nothing for a zero to make honest.
 */
export function zeroAnchorsChannel(chartKind: string | undefined, channel: string): boolean {
  return chartKind !== undefined && EXTENT_ON_A_BOUND_CHANNEL.includes(chartKind) && MAGNITUDE_CHANNELS.has(channel);
}

/** Past this many layers on one frame a reader cannot tell the marks apart — a LINT, never a refusal (a legitimate small-multiple of five exists). */
export const FRAME_LAYER_LINT = 4;

/**
 * One channel's resolution with every field FILLED IN — the one owner of the
 * defaults, so nothing downstream defaults anything a second time (the
 * adapter's frame door reads its basis from here too).
 *
 * The Wickham default: a channel the frame does not name is `shared / union /
 * table / merged`, because a stack whose scales disagree is not one picture.
 * `zero` is the exception — it stays absent, because the MARKS decide it and
 * only {@link zeroPolicyFor} can see them.
 */
export type EffectiveResolution =
  | { readonly mode: 'shared'; readonly domain: 'union'; readonly basis: 'table' | 'rows'; readonly guide: 'merged' | 'per-layer'; readonly zero?: boolean }
  | { readonly mode: 'independent'; readonly guide: 'per-layer' };

export function resolutionFor(channel: string, frame?: Readonly<Record<string, ChannelResolution>>): EffectiveResolution {
  const declared = frame?.[channel];
  if (declared === undefined) return { mode: 'shared', domain: 'union', basis: 'table', guide: 'merged' };
  // an independent channel has one guide and no domain by definition: each layer keeps its own scale
  if (declared.mode === 'independent') return { mode: 'independent', guide: 'per-layer' };
  return { mode: 'shared', domain: 'union', basis: declared.basis ?? 'table', guide: declared.guide ?? 'merged', ...(declared.zero !== undefined ? { zero: declared.zero } : {}) };
}

/**
 * THE ONE OWNER OF THE ZERO DEFAULT. A declared `zero` is the answer — one
 * policy for the whole channel, because a stack cannot have two baselines.
 * With none declared the MARKS decide: any zero-anchored kind among them
 * anchors the whole frame at zero, and the def validator refuses a declared
 * `zero: false` under exactly that condition, so the two can never disagree.
 *
 * It is handed the kinds whose extent is read on the CHANNEL being folded
 * ({@link zeroAnchorsChannel}) — never every kind in the stack, or a bar would
 * drag the zero onto its own colour ramp and onto a histogram's bin axis.
 */
export function zeroPolicyFor(chartKinds: readonly (string | undefined)[], declared?: boolean): boolean {
  if (declared !== undefined) return declared;
  return chartKinds.some((kind) => kind !== undefined && ZERO_ANCHORED_KINDS.includes(kind));
}

/** The scale kind a column type folds as, or undefined for a type nothing can be folded from (`'unknown'`). */
export function frameScaleOf(type: ColumnType): ResolvedDomain['scale'] | undefined {
  switch (type) {
    case 'number':
      return 'quantitative';
    case 'date':
      return 'temporal';
    case 'string':
    case 'boolean':
      return 'categorical';
    default:
      return undefined;
  }
}

/**
 * ONE NOTE ABOUT ONE FRAME — advice about a whole view's stack, which is why it
 * is not an `EncodingProblem`: that shape names a CHANNEL, a FIELD and a
 * severity of `refused`/`coerced`, and a frame note has none of the three
 * ("five layers on one frame" is about the stack, and nothing is refused).
 * Forcing it into that shape would mean inventing a channel and a severity, so
 * the notes ride on a row of their own kind.
 */
export interface FrameNote {
  readonly viewId: string;
  readonly sentence: string;
}

/**
 * More than {@link FRAME_LAYER_LINT} layers on one frame — the sentence a host
 * shows, or an empty list. ADVICE, never a refusal: a legitimate small-multiple
 * of five exists, so this says what a reader will struggle with and leaves the
 * choice with the author (`Dashboard.lintFrames` is the door it reaches a host
 * through).
 *
 * It asks for the NARROWEST thing it reads — a layer's id — rather than a whole
 * {@link FrameLayer}: counting layers needs no values, so a caller with only
 * the DEF (which is when this lint is useful, before any data is read) can ask
 * without inventing empty channels.
 */
export function frameLint(layers: readonly { readonly layerId: string }[]): readonly string[] {
  if (layers.length <= FRAME_LAYER_LINT) return [];
  return [`${layers.length} layers on one frame — past ${FRAME_LAYER_LINT} a reader cannot tell the marks apart; consider a frame of its own for ${layers.slice(FRAME_LAYER_LINT).map((l) => `"${l.layerId}"`).join(', ')}`];
}

// ── the fold ──────────────────────────────────────────────────────────────────

/**
 * THE DOMAINS OF ONE FRAME: per channel any layer binds, the resolution it was
 * declared under, and — where the channel is shared — the union of the layers'
 * values folded as one domain.
 *
 * - QUANTITATIVE: `[min, max]` over the finite numbers, then the zero policy.
 * - TEMPORAL: `[earliest, latest]` over the ISO-8601 strings (lexicographic ==
 *   chronological, the repo-wide date law); a `Date` object counts, as its own
 *   ISO spelling.
 * - CATEGORICAL: the union of the categories in FIRST-SEEN order, walking the
 *   layers in DECLARATION order — the same order they are painted in, so a
 *   legend reads in the order the eye met the marks.
 *
 * The SCALE KIND is the first binding layer's, in declaration order. A later
 * layer whose cells cannot be READ as that kind contributes nothing rather
 * than bending the scale: a string on a quantitative channel and a number on a
 * temporal one are skipped. A CATEGORICAL fold is the asymmetric one — it names
 * every cell it is given (`String(cell)`), so a number on a category channel
 * becomes the category `"7"` rather than being dropped. Which means the two
 * spellings of one disagreement answer differently: number-first folds a
 * quantitative domain and drops the string layer, string-first folds one
 * category list over both. The def validator refuses that disagreement at
 * declaration (law 10) wherever both columns declare a type; this is what the
 * fold does with one that got past it — a provider whose real types differ from
 * the declared ones, or a def that declared no column facts at all.
 */
export function frameDomains(layers: readonly FrameLayer[], frame?: Readonly<Record<string, ChannelResolution>>): Readonly<Record<string, ResolvedChannel>> {
  const out: Record<string, ResolvedChannel> = {};
  for (const channel of channelsOfLayers(layers)) {
    const resolution = resolutionFor(channel, frame);
    if (resolution.mode === 'independent') {
      out[channel] = { mode: 'independent', guide: 'per-layer' };
      continue;
    }
    const binding = layers.filter((layer) => layer.channels[channel] !== undefined);
    const scale = firstScaleOf(binding, channel);
    if (scale === undefined) continue; // nothing folds from `unknown` — no entry, no claim
    // only the layers whose EXTENT is read on this channel may imply a zero (a histogram's bins are a position)
    const zero = zeroPolicyFor(binding.filter((layer) => zeroAnchorsChannel(layer.chartKind, channel)).map((layer) => layer.chartKind), resolution.zero);
    const domain = foldDomain(binding, channel, scale, zero);
    if (domain === undefined) continue; // every cell was absent or unreadable — an invented domain would be a drawn lie
    out[channel] = { mode: 'shared', basis: resolution.basis, guide: resolution.guide, ...domain };
  }
  return out;
}

/** Every channel any layer binds, in declaration order, first-seen wins — the frame answers about exactly these. */
function channelsOfLayers(layers: readonly FrameLayer[]): readonly string[] {
  const seen: string[] = [];
  for (const layer of layers) {
    for (const channel of Object.keys(layer.channels)) if (!seen.includes(channel)) seen.push(channel);
  }
  return seen;
}

/** The scale kind the frame folds this channel as: the first binding layer's, in declaration order. */
function firstScaleOf(binding: readonly FrameLayer[], channel: string): ResolvedDomain['scale'] | undefined {
  for (const layer of binding) {
    const scale = frameScaleOf(layer.channels[channel]!.type);
    if (scale !== undefined) return scale;
  }
  return undefined;
}

/** The union, per scale kind. `undefined` = not one readable cell across the layers. */
function foldDomain(binding: readonly FrameLayer[], channel: string, scale: ResolvedDomain['scale'], zero: boolean): ResolvedDomain | undefined {
  const cells = binding.flatMap((layer) => layer.channels[channel]!.values);
  if (scale === 'quantitative') return quantitative(cells, zero);
  if (scale === 'temporal') return temporal(cells);
  return categorical(cells);
}

/** `[min, max]` over the finite numbers, extended to 0 under the zero policy. A non-number cell is an absence, not a 0. */
function quantitative(cells: readonly unknown[], zero: boolean): ResolvedDomain | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const cell of cells) {
    if (typeof cell !== 'number' || !Number.isFinite(cell)) continue;
    if (cell < lo) lo = cell;
    if (cell > hi) hi = cell;
  }
  // not one readable cell: no domain. `zero: true` says where a domain must REACH, never that one exists
  if (lo === Infinity) return undefined;
  return { scale: 'quantitative', domain: zero ? [Math.min(lo, 0), Math.max(hi, 0)] : [lo, hi] };
}

/**
 * `[earliest, latest]` over the ISO-8601 strings — compared as strings, which
 * for ISO-8601 IS chronological order.
 *
 * A `Date` OBJECT counts, as its own ISO spelling. The engines hand ISO strings
 * for a date column, but a def can be written in TypeScript and an adapter can
 * answer with real Dates — and a dropped Date is worse than no domain: mixed
 * with strings it leaves a domain that EXCLUDES rows the frame is drawing. An
 * invalid Date is an absence like any other.
 */
function temporal(cells: readonly unknown[]): ResolvedDomain | undefined {
  let lo: string | undefined;
  let hi: string | undefined;
  for (const cell of cells) {
    const when = isoOf(cell);
    if (when === undefined) continue;
    if (lo === undefined || when < lo) lo = when;
    if (hi === undefined || when > hi) hi = when;
  }
  return lo === undefined || hi === undefined ? undefined : { scale: 'temporal', domain: [lo, hi] };
}

/** One cell as a date the fold can compare, or `undefined` for one it cannot read. */
function isoOf(cell: unknown): string | undefined {
  if (typeof cell === 'string') return cell.length === 0 ? undefined : cell;
  if (cell instanceof Date) return Number.isFinite(cell.getTime()) ? cell.toISOString() : undefined;
  return undefined;
}

/** The union of the categories in first-seen order across the layers, in declaration order. */
function categorical(cells: readonly unknown[]): ResolvedDomain | undefined {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    if (cell === null || cell === undefined) continue; // an absent category is not the category "null"
    const name = String(cell);
    if (seen.has(name)) continue;
    seen.add(name);
    order.push(name);
  }
  return order.length === 0 ? undefined : { scale: 'categorical', domain: order };
}
