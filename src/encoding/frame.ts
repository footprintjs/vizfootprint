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
 *   1. THE SILENCES ARE ALREADY OUT. A state column says a cell is a SILENCE,
 *      not a low number ("unavailable" is not zero), so a cell its governing
 *      state column excludes must never reach a domain. The adapter drops them
 *      before it folds, PER COLUMN — silence belongs to a column and not to the
 *      row (`../data/silence.ts`), so a planet with no radius still lends its
 *      period to the period axis (see `frameFor`).
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
  | {
      readonly scale: 'quantitative';
      readonly domain: readonly [number, number];
      /**
       * HOW MANY CELLS THE TRANSFORM COULD NOT PLACE — a zero or a negative
       * number on a LOGARITHMIC axis (`ChannelResolution.transform`), which a
       * logarithm has no answer for. Set only when something was excluded, so a
       * linear fold is byte-identical to the one that existed before.
       *
       * WHY it is counted and not dropped: which cells those are is DATA, not
       * declaration, so the door cannot refuse them — and a picture that
       * silently draws 300 of 1000 planets is worse than one that says so
       * ("exclude and count, never silently drop", the law the absence work set
       * in `../data/silence.ts`). It is a SEPARATE fact from a silence: a
       * silence is a cell the data says nothing about, and this is a cell the
       * data speaks plainly about but a logarithm cannot place. The adapter has
       * already dropped the silences before this fold sees a value.
       */
      readonly excluded?: number;
    }
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
      /** WHICH SCALE A RENDERER MUST BUILD. Echoed from the declaration and absent unless one was declared, so a linear axis carries no key at all (`scaleFor`, `vizfootprint-ui/primitives/scales.ts`, is the one owner of the answer on the chart side). */
      readonly transform?: 'linear' | 'log';
      /** WHETHER A LINE IS DRAWN WHERE THIS AXIS CROSSES ZERO. Echoed from the declaration, exactly as `transform` is, and absent unless one was declared — see {@link ChannelResolution.zeroGuide} for why the fold does not decide it. */
      readonly zeroGuide?: boolean;
      /**
       * WHAT THE QUANTITY CAN BE — the declared extent this axis is read on
       * ({@link ChannelResolution.bounds}), echoed and NEVER folded. It sits
       * beside `domain` rather than replacing it because the two are different
       * claims: `domain` is what this data reaches, `bounds` is what the
       * quantity can reach, and a reader that has both can see a table covering
       * a third of its own axis. The CHART prefers it when it draws (`spanOf`,
       * `vizfootprint-ui/contract/renderers.tsx`).
       */
      readonly bounds?: readonly [number, number];
    } & ResolvedDomain)
  | { readonly mode: 'independent'; readonly guide: 'per-layer'; readonly transform?: 'linear' | 'log'; readonly zeroGuide?: boolean };

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

/**
 * THE MARKS THAT MAY TAKE A SCALE OF THEIR OWN ON A FRAME — and only the FIRST
 * one. A bar of a count on the LEFT with a line of a rate on the right is the
 * commonest two-scale figure there is, and it is honest in that one
 * arrangement: the left axis is where a reader reads an extent from a
 * baseline. A bar on the RIGHT, read against a second baseline behind a line,
 * is exactly the overstatement law 9 exists to prevent — so the right edge
 * stays a position mark's (a line, a point).
 *
 * WHY only a bar, when three kinds are zero-anchored ({@link
 * ZERO_ANCHORED_KINDS}): a box plot and a histogram summarise a DISTRIBUTION
 * on an axis of their own — neither reads as "this much, from zero" beside a
 * second scale — and neither draws a y axis on a frame's edge in this version,
 * so a def that declared one would be refused by the frame that has to draw
 * it. Their half of law 9 is untouched, in the words it always said. Kept as
 * its own list rather than as a `=== 'bar'` for the reason {@link
 * EXTENT_ON_A_BOUND_CHANNEL} is: the two lists differ, and a reader has to be
 * able to see which marks each one names.
 */
const MAY_TAKE_THE_FIRST_SCALE: readonly string[] = Object.freeze(['bar']);

/**
 * The channel a frame's two edges ARE: its y. Left and right are y edges
 * (`AxisSide`, `vizfootprint-ui/primitives/scales.ts`), so a bar's own scale
 * on any OTHER magnitude channel — a `size` legend, an independent x — is no
 * edge of anything and keeps law 9's original refusal.
 */
const FIRST_SCALE_CHANNEL = 'y';

/**
 * MAY THIS MARK TAKE A SCALE OF ITS OWN HERE, as the FIRST one? The one owner
 * of that question, asked by BOTH twins of law 9 — the def door
 * (`../def/layers.ts` · `judgeChannelLaws`) and the frame that draws it
 * (`vizfootprint-ui/contract/renderers.tsx` · `twoScalesRefusal`) — so a def
 * the door accepts is never a frame the renderer refuses.
 *
 * The kind is not optional here, where {@link zeroAnchorsChannel}'s is: that
 * one is asked by the FOLD, over layers a host may hand in with no mark named
 * at all; this one is asked by the two doors, and a layer that named no mark
 * was refused for that on its own line.
 *
 * It answers about the MARK and the CHANNEL only. WHICH layer is first is the
 * DECLARATION's answer, and each twin reads it where it stands: the door off
 * the declared channel list, the frame off what a layer bound (the frame hands
 * its sides out in declaration order, so both are the same order).
 */
export function mayTakeFirstScale(chartKind: string, channel: string): boolean {
  return MAY_TAKE_THE_FIRST_SCALE.includes(chartKind) && channel === FIRST_SCALE_CHANNEL;
}

/**
 * THE WORDS FOR A BAR THAT WOULD TAKE THE SECOND SCALE — one sentence, one
 * owner, said by the def door with its address in front of it and by the frame
 * exactly as it stands (the two twins of law 9 say the same thing, so a reader
 * who fixes the def and a reader who fixes a hand-folded `RenderState.frame`
 * read one sentence, not two spellings of it).
 *
 * `subject` and `holder` arrive already named the way each twin names a layer
 * (`layer "counts"`), and the refusal ends in the two ways out: declare the bar
 * first, or leave the second scale to the line.
 */
export function firstScaleTakenRefusal(subject: string, chartKind: string, holder: string): string {
  return `${subject} is a ${chartKind} with a y of its own, but ${holder} already takes the first scale — a ${chartKind} reads its extent from the LEFT baseline, so declare it first, or give the line the independent y`;
}

// ── zero is a place on the axis (law 12) ──────────────────────────────────────

/**
 * WHICH MARKS DRAW A ZERO GUIDE, AND ON WHICH CHANNELS — the one owner of that
 * question, asked by the def door (`../def/layers.ts` · `judgeZeroGuide`) and
 * by the frame that has to draw it (`vizfootprint-ui/contract/renderers.tsx` ·
 * `zeroGuideRefusal`), so a def the door accepts is never a frame the renderer
 * refuses.
 *
 * A POINT (a scatter, under both its names) draws one on either axis: φ against
 * ψ is the figure that asked for this, and both angles are signed. A LINE draws
 * one on y alone — its x is a run of dates or a band of categories, and neither
 * has a zero (a date's epoch zero is 1970, which is an accident of the encoding
 * and not a place a reader reads a sign from).
 *
 * Nobody else, and each for its own reason. A BAR, a HISTOGRAM's count and a
 * BOXPLOT read their extent from a baseline that IS zero
 * ({@link ZERO_ANCHORED_KINDS}) — a second line drawn over that baseline is
 * furniture on top of furniture, saying nothing the axis does not already say.
 * A HEATMAP's channels are two category lists and a ramp; a MAP has regions; a
 * TABLE has rows; a NETWORK's x and y are one spatial substrate with one
 * px-per-unit, where a line at zero marks nothing a reader can read.
 *
 * A Map rather than a record, so a `chartKind` of `"__proto__"` off a hand-
 * written def answers no instead of reaching Object.prototype.
 */
const ZERO_GUIDE_CHANNELS: ReadonlyMap<string, readonly string[]> = new Map([
  ['scatter', ['x', 'y']],
  ['point', ['x', 'y']],
  ['line', ['y']],
]);

/** DOES THIS MARK DRAW A ZERO GUIDE ON THIS CHANNEL? The predicate both twins of law 12 ask — see {@link ZERO_GUIDE_CHANNELS} for the list and the reasons. */
export function drawsZeroGuide(chartKind: string, channel: string): boolean {
  return (ZERO_GUIDE_CHANNELS.get(chartKind) ?? []).includes(channel);
}

/**
 * THE WORDS FOR A MARK ASKED FOR A ZERO GUIDE IT DOES NOT DRAW — one sentence,
 * one owner, said by the def door with its address in front of it and by the
 * frame exactly as it stands (the {@link firstScaleTakenRefusal} precedent).
 *
 * It names the CHANNEL as well as the mark, because the answer is per pair: a
 * line draws one on y and not on x, so "a line draws no zero guide" would be a
 * false sentence for half of the refusals this covers.
 *
 * `subject` arrives already named the way each twin names a binder (`layer
 * "phi-psi"`, `view "rama"`), and the refusal ends in the two ways out: declare
 * it where it is drawn, or drop the key. It is a REFUSAL and not a silent drop
 * on purpose: a picture that quietly ignores a declaration is a picture whose
 * record says something it does not show.
 */
export function zeroGuideKindRefusal(subject: string, chartKind: string, channel: string): string {
  return `${subject} is a ${chartKind}, and a ${chartKind} draws no zero guide on ${channel} — a point draws one on x and y, a line on y; declare it there, or drop "zeroGuide"`;
}

/**
 * A LOGARITHMIC AXIS HAS NO ZERO — the clause, with the key it was asked of,
 * and the ONE owner of those words. The def door says it of a declared `zero`
 * (law 11a) and of a declared `zeroGuide` (law 12), and the CHART says it of a
 * `zeroGuide` it was handed on a log axis
 * (`vizfootprint-ui/primitives/zeroGuide.ts`) — three refusals, one vocabulary,
 * which is what the packet asked for: a log axis has no zero at all, so the
 * answer there is the sentence the logarithm already had and not a new one
 * about a domain.
 *
 * The key is a parameter rather than two spellings because the two keys are two
 * different asks — `zero` extends a domain to REACH zero, `zeroGuide` draws a
 * line where the axis crosses it — and a reader must be told which one to drop.
 */
export function noZeroOnALogAxis(key: string): string {
  return `a logarithmic axis has no zero — drop "${key}", or draw this channel linearly`;
}

/**
 * IS ZERO A PLACE ON THIS AXIS? The one owner of that inequality, asked by the
 * chart that has the domain it actually drew on
 * (`vizfootprint-ui/primitives/zeroGuide.ts`).
 *
 * The domain is a CLOSED interval, so zero AT AN END is inside it and the guide
 * is drawn — coincident with the axis line, which is exactly where zero is. The
 * other reading would make the two zero keys contradict each other: `zero: true`
 * extends an all-positive domain to `[0, hi]` precisely so the axis reaches
 * zero, and a `zeroGuide` that then refused the end it was just given would be
 * refusing the thing the sibling key arranged.
 *
 * Order-insensitive, because a hand-folded domain may arrive either way round
 * (`domainOr` is the chart-side normaliser and it sorts, but this predicate is
 * asked of pairs from both doors).
 */
export function zeroOnAxis(lo: number, hi: number): boolean {
  return Math.min(lo, hi) <= 0 && Math.max(lo, hi) >= 0;
}

// ── a band is a range too (law 13) ───────────────────────────────────────────

/**
 * THE MARKS THAT DRAW A HORIZONTAL INTERVAL BRUSH — one drag, one `interval`
 * emission over the x channel. A SCATTER (a point, under both its names), a
 * LINE and a HISTOGRAM: the three that hand `useHorizontalBrush` a `snap`
 * (`vizfootprint-ui/primitives/brush.tsx`).
 *
 * Nobody else, and each for its own reason. A BAR's x is a band by
 * construction — one slot per category — so its drag is a run of slots and
 * lands a MATCH (`VizBar` · `endRun`), never an interval. A BOX PLOT's is the
 * same band with no drag at all; a HEATMAP's gesture is the compound cell; a
 * MAP has regions, a TABLE rows, a NETWORK a walk.
 *
 * A Map rather than a record, so a `chartKind` of `"__proto__"` off a hand-
 * written def answers no instead of reaching Object.prototype — the
 * {@link ZERO_GUIDE_CHANNELS} precedent.
 */
const INTERVAL_BRUSH_KINDS: ReadonlySet<string> = new Set(['scatter', 'point', 'line', 'histogram']);

/**
 * DOES THIS MARK DRAW AN INTERVAL BRUSH ON AN X OF THIS SCALE KIND? The
 * predicate both twins of law 13 ask — the def door
 * (`../def/layers.ts` · `validateDeclaredGestures`) and the frame that has to
 * draw it (`vizfootprint-ui/contract/renderers.tsx` · `intervalBrushRefusal`)
 * — so a def this door accepts is never a gesture the renderer refuses (the
 * law 9 and 12 arrangement).
 *
 * TWO WAYS TO ANSWER NO, and the answer is per PAIR because of the second.
 * A mark that draws no brush at all ({@link INTERVAL_BRUSH_KINDS}) never draws
 * one. And a CATEGORICAL x is a band: a band has no BETWEEN for an interval to
 * name — the string interval predicate compares lexicographically and not in
 * slot order — so a drag across its slots is a RUN of them, which is the match
 * language every band already speaks (`matchEmission`). That is why a LINE, a
 * mark whose x may be either, brushes an interval on a run of dates and a
 * MATCH over a band of categories.
 *
 * The scale kind is the FOLD's answer ({@link frameScaleOf} is its one owner),
 * which is why it is a parameter and never re-derived here.
 */
export function drawsIntervalBrush(chartKind: string, scale: ResolvedDomain['scale']): boolean {
  return INTERVAL_BRUSH_KINDS.has(chartKind) && scale !== 'categorical';
}

/**
 * THE WORDS FOR A DECLARED `interval` A MARK WILL NOT DRAW — one owner, said
 * by the def door with its address in front of it and by the frame exactly as
 * it stands ({@link zeroGuideKindRefusal}'s arrangement).
 *
 * TWO ARMS IN ONE FUNCTION, chosen by the evidence, because the two mistakes
 * have two different repairs (`../def/layers.ts` · `refuseOwnScale` is the
 * precedent): a mark whose x is a BAND does have a drag gesture and it lands a
 * `match`, so the repair is to declare THAT; a mark that draws no brush at all
 * has no drag to declare, so the repair is to drop the key. Naming the COLUMN
 * matters on the first arm — a field is a band because of its DATA, and the
 * author has to be able to see which column made it one.
 */
export function intervalGestureRefusal(subject: string, chartKind: string, scale: ResolvedDomain['scale'], column: string): string {
  return scale === 'categorical'
    ? `${subject} declares it emits an interval, but its x is the category column "${column}" — a band has no between for an interval, so a drag across a ${chartKind}'s slots is a RUN of them; declare encodings: ["match"], or bind x to a date or a number`
    : `${subject} declares it emits an interval, but a ${chartKind} draws no interval brush at all — declare the kinds its own gestures emit, or drop "interval"`;
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
  | { readonly mode: 'shared'; readonly domain: 'union'; readonly basis: 'table' | 'rows'; readonly guide: 'merged' | 'per-layer'; readonly zero?: boolean; readonly transform?: 'linear' | 'log'; readonly zeroGuide?: boolean; readonly bounds?: readonly [number, number] }
  | { readonly mode: 'independent'; readonly guide: 'per-layer'; readonly transform?: 'linear' | 'log'; readonly zeroGuide?: boolean };

export function resolutionFor(channel: string, frame?: Readonly<Record<string, ChannelResolution>>): EffectiveResolution {
  const declared = frame?.[channel];
  if (declared === undefined) return { mode: 'shared', domain: 'union', basis: 'table', guide: 'merged' };
  // `transform` and `zeroGuide` are the AXIS's own nature and ride on BOTH modes; like `zero` they stay
  // absent where they were not declared, because 'linear' is what every scale already is, a chart drew no
  // zero line before either, and a key nobody typed is not a decision
  const nature = { ...(declared.transform !== undefined ? { transform: declared.transform } : {}), ...(declared.zeroGuide !== undefined ? { zeroGuide: declared.zeroGuide } : {}) };
  // an independent channel has one guide and no domain by definition: each layer keeps its own scale
  if (declared.mode === 'independent') return { mode: 'independent', guide: 'per-layer', ...nature };
  // `bounds` is the axis's own nature too, but it rides the SHARED arm alone: an independent channel gives
  // every layer its own scale, so there is no one axis for one claim about the quantity (the def door
  // refuses it there by name, with the other keys an independent channel has no use for)
  return { mode: 'shared', domain: 'union', basis: declared.basis ?? 'table', guide: declared.guide ?? 'merged', ...(declared.zero !== undefined ? { zero: declared.zero } : {}), ...nature, ...(declared.bounds !== undefined ? { bounds: declared.bounds } : {}) };
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
export function zeroPolicyFor(chartKinds: readonly (string | undefined)[], declared?: boolean, transform?: 'linear' | 'log'): boolean {
  // A LOGARITHMIC AXIS HAS NO ZERO, and this is the one predicate that says so — asked here, so no caller has to
  // remember it. The def door refuses a DECLARED `zero: true` beside `transform: 'log'`, so the only pair that
  // can reach this is a zero the MARKS implied, and those marks are refused a log axis on that very channel.
  if (transform === 'log') return false;
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
    // the transform and the zero guide are the AXIS's own nature, so they ride BOTH modes: an independent
    // channel folds no domain here, but each layer still builds a scale and draws its own furniture, and
    // both must be what the def asked for
    const nature = { ...(resolution.transform !== undefined ? { transform: resolution.transform } : {}), ...(resolution.zeroGuide !== undefined ? { zeroGuide: resolution.zeroGuide } : {}) };
    if (resolution.mode === 'independent') {
      out[channel] = { mode: 'independent', guide: 'per-layer', ...nature };
      continue;
    }
    const binding = layers.filter((layer) => layer.channels[channel] !== undefined);
    const scale = firstScaleOf(binding, channel);
    if (scale === undefined) continue; // nothing folds from `unknown` — no entry, no claim
    // only the layers whose EXTENT is read on this channel may imply a zero (a histogram's bins are a position),
    // and a LOGARITHMIC axis has no zero at all — `zeroPolicyFor` is the one predicate asked, so nothing here decides it twice
    const zero = zeroPolicyFor(binding.filter((layer) => zeroAnchorsChannel(layer.chartKind, channel)).map((layer) => layer.chartKind), resolution.zero, resolution.transform);
    const domain = foldDomain(binding, channel, scale, zero, resolution.transform);
    if (domain === undefined) continue; // every cell was absent or unreadable — an invented domain would be a drawn lie
    out[channel] = { mode: 'shared', basis: resolution.basis, guide: resolution.guide, ...nature, ...(resolution.bounds !== undefined ? { bounds: resolution.bounds } : {}), ...domain };
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
function foldDomain(binding: readonly FrameLayer[], channel: string, scale: ResolvedDomain['scale'], zero: boolean, transform?: 'linear' | 'log'): ResolvedDomain | undefined {
  const cells = binding.flatMap((layer) => layer.channels[channel]!.values);
  if (scale === 'quantitative') return quantitative(cells, zero, transform);
  if (scale === 'temporal') return temporal(cells);
  return categorical(cells);
}

/**
 * `[min, max]` over the finite numbers, extended to 0 under the zero policy. A
 * non-number cell is an absence, not a 0.
 *
 * ON A LOGARITHMIC AXIS the union is over the POSITIVE cells only — a logarithm
 * has no answer for 0 or a negative number — and the ones it could not place
 * are COUNTED on the domain (`excluded`), never silently dropped. Two
 * exclusions live side by side and are deliberately NOT summed: a SILENCE is
 * already gone before this fold sees a cell (the adapter drops it per column),
 * and this count is only the cells a logarithm cannot place. They are different
 * facts about the data, and a reader told "700 excluded" without knowing which
 * has learned nothing.
 *
 * When NOTHING is placeable there is no domain at all — the existing "nothing
 * folds" arm, because an invented domain is a drawn lie. The count has no
 * domain to ride on then, and the CHART is where a reader meets the number
 * (`excludedNote`, `vizfootprint-ui/primitives/scales.ts`): it is the picture
 * the marks are missing from.
 */
function quantitative(cells: readonly unknown[], zero: boolean, transform?: 'linear' | 'log'): ResolvedDomain | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  let excluded = 0;
  for (const cell of cells) {
    if (typeof cell !== 'number' || !Number.isFinite(cell)) continue;
    if (transform === 'log' && cell <= 0) {
      excluded += 1;
      continue;
    }
    if (cell < lo) lo = cell;
    if (cell > hi) hi = cell;
  }
  // not one readable cell: no domain. `zero: true` says where a domain must REACH, never that one exists
  if (lo === Infinity) return undefined;
  return { scale: 'quantitative', domain: zero ? [Math.min(lo, 0), Math.max(hi, 0)] : [lo, hi], ...(excluded > 0 ? { excluded } : {}) };
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
