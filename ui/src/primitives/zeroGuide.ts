/**
 * ZERO IS A PLACE ON THE AXIS — the picture's half of law 12, and the ONE owner
 * of both the verdict and the words.
 *
 * A chart may be TOLD to draw a line where a signed scale crosses zero
 * (`ChannelResolution.zeroGuide` in the def, `ChartDomain.zeroGuide` on the
 * prop that carries it), so that positive and negative read as two sides of an
 * origin rather than as a cloud of marks in a box. A Ramachandran plot — a
 * backbone φ against ψ, each running −180 to 180 — is the consumer that asked:
 * its whole meaning is which quadrant a residue falls in, and with no crossing
 * lines a reader has to find the origin by reading tick labels off two edges.
 *
 * WHY THE CHART DECIDES, when the declaration is the def's and the fold is the
 * library's: the verdict needs the domain that was actually DRAWN ON, and that
 * is the frame's fold only when a frame handed one over — a standalone chart
 * draws its own extent, padded by its own rules, and nothing upstream has those
 * numbers. So the library echoes the ASK onto the record (`ResolvedChannel`),
 * the def door refuses everything judgeable without numbers (a non-positional
 * channel, a mark that draws none, a logarithm), and the last question — is
 * zero on this axis at all — is answered here, once, for every chart.
 *
 * AND IT REFUSES RATHER THAN SHRUGGING. A domain that excludes zero gets no
 * guide and SAYS SO, in one sentence naming the channel and quoting the axis it
 * was asked of. Not clamped to the edge (that would draw zero where zero is
 * not) and not silently dropped (that would leave a declaration in the record
 * with nothing in the picture answering to it). The chart puts the sentence in
 * the plot and in its accessible name, which is where `excludedNote` already
 * puts the other thing a chart was asked for and could not draw.
 *
 * THE TWO SENTENCES AND WHERE EACH LIVES. The logarithm's clause has THREE
 * speakers — the def door for `zero`, the def door for `zeroGuide`, and this
 * module — so it is owned in the library (`noZeroOnALogAxis`,
 * `vizfootprint/def`) and quoted here. The off-axis sentence has exactly ONE
 * speaker, the chart, because the chart is the only holder of the domain drawn;
 * it is owned here for the same reason the log clause is owned there.
 */
import { noZeroOnALogAxis, zeroOnAxis } from 'vizfootprint/def';
import type { ScaleKind } from './scales.js';

/**
 * WHAT A CHART DOES WITH A ZERO GUIDE IT WAS ASKED FOR: draw it at a pixel, or
 * say why it did not. Two arms and no third — a chart that was NOT asked gets
 * `undefined` from {@link zeroGuideFor} and draws nothing at all, so a picture
 * with no zero guide is byte-identical to the one before the key existed.
 */
export type ZeroGuide =
  /** The pixel along the axis where zero sits — draw the line there. */
  | { readonly at: number }
  /** The sentence for a zero this axis has no place for — put it in the picture. */
  | { readonly refused: string };

/** What {@link zeroGuideFor} is asked: the channel's name for the sentence, whether it was asked at all, the axis it drew on, its curve, and how that axis places a value. */
export interface ZeroGuideAsk {
  /** The channel as a reader knows it (`'x'`, `'y'`) — it is quoted in the refusal. */
  readonly channel: string;
  /** `ChartDomain.zeroGuide?.[channel]` — anything but `true` is "not asked". */
  readonly asked: boolean | undefined;
  /** The domain the chart ACTUALLY DREW ON: the frame's when it was given one, its own padded extent otherwise. */
  readonly domain: readonly [number, number];
  /** The axis's curve (`ChartDomain.transform?.[channel]`), because a logarithmic axis has no zero at all. */
  readonly transform?: ScaleKind;
  /** The chart's own scale for this channel — asked for the one value 0, and only once it is known to be on the axis. */
  readonly place: (value: number) => number;
}

/**
 * THE ONE ANSWER: draw it, refuse it in words, or nothing at all.
 *
 * The order of the two refusals matters and is the packet's own ruling. A
 * LOGARITHMIC axis is refused FIRST, in the logarithm's existing vocabulary,
 * because its domain has already been lifted to strictly positive bounds
 * (`logDomain`) — so the off-axis arm would quote a span the author never
 * declared and blame the data for a property of the curve.
 */
export function zeroGuideFor(ask: ZeroGuideAsk): ZeroGuide | undefined {
  if (ask.asked !== true) return undefined;
  if (ask.transform === 'log') return { refused: `${ask.channel} was asked for a zero guide, and ${noZeroOnALogAxis('zeroGuide')}` };
  const [lo, hi] = ask.domain;
  if (!zeroOnAxis(lo, hi)) return { refused: `${ask.channel} was asked for a zero guide, but its axis runs [${axisNumber(lo)}, ${axisNumber(hi)}] — zero is not a place on it, so there is no line to draw` };
  return { at: ask.place(0) };
}

/** The sentences a chart shows for the guides it was asked for and could not draw, in the order they were asked — empty for a chart that drew every one of them (or was asked for none). */
export function zeroGuideNotes(...guides: readonly (ZeroGuide | undefined)[]): readonly string[] {
  return guides.flatMap((guide) => (guide !== undefined && 'refused' in guide ? [guide.refused] : []));
}

/** A bound as the refusal spells it: to a hundredth, so a padded extent reads as a number and not as a float's tail (`tickText`'s rule, one place further). */
function axisNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}
