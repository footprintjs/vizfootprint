/**
 * PROPOSE A WHOLE CHART — the smart layer's one door, and it composes rather
 * than decides.
 *
 * `whatFits` answers one channel at a time: *may this column sit here, and if
 * not, why not*. A person at an authoring wizard has a harder question than
 * that, and it is the one nothing in this library answered: **given this table,
 * what chart should I make?** Answering it by hand means picking a kind,
 * guessing which column each channel wants, and finding out one refusal at a
 * time — which is a person doing the plane's own work, in their head, with less
 * evidence than the plane has.
 *
 * So: for every chart kind the requirement tables know, enumerate the bindings
 * that fit every channel of the kind, order them with the recommender, and hand
 * back the best few — each carrying, per channel, the sentence saying what the
 * channel takes and the sentence saying why that column was offered first.
 *
 * ## It adds no rule of its own
 *
 * Every binding in every proposal is one `whatFits` accepts, and a binding
 * `whatFits` refuses can never appear — `propose.test.ts` pins both directions.
 * That is not a nicety, it is the same law the three doors keep: one rule for
 * fit. This file does two things the plane does not: it ENUMERATES (which is
 * arithmetic, not law) and it ORDERS (which is the `Recommender` port, and the
 * default policy is `./recommend.ts`, data a host can read and replace).
 *
 * Two enumeration choices are stated here because they are not the plane's:
 *
 *   - **one column never sits on two channels of one chart.** The plane would
 *     allow it — nothing about `x = cases, y = cases` breaks a requirement —
 *     and it is still not a chart anybody meant to be offered.
 *   - **a chart kind that binds nothing is not proposed.** `table` names no
 *     channel, so there is nothing to bind, nothing to rank and nothing to give
 *     a reason for. It is offered by whoever draws the picker, not here.
 *
 * ## The caps, and saying when they bit
 *
 * Enumeration is a product, so it needs a ceiling, and a ceiling nobody is told
 * about is a silent omission. Both are constants below, and every one that bit
 * comes back as a sentence in {@link ChartProposals.notEnumerated} naming what
 * was left out. The per-CHANNEL ceiling bites on any ordinary table — five
 * columns fitting one channel is nothing unusual — and the per-KIND one cannot
 * bite on a built-in kind at all, because four candidates on at most three
 * channels is sixty-four. Both numbers are where a reader can check them.
 */
import type { AbsenceDecl } from '../def/types.js';
import { CHART_KIND_FOR_READING, graphReadingFor, type GraphFact, type GraphReading, type GraphReadingKind } from './graphReading.js';
import { policyRecommender } from './recommend.js';
import { KINDS_NOT_PROPOSED, channelsOf, chartKindsOf, requirementFor } from './requirements.js';
import { fill, listOf } from './sentences.js';
import type { Bindings, ChannelRequirements, EncodingPorts, EncodingRules, Fit } from './types.js';
import { whatFits, type FitColumn } from './whatFits.js';

/** How many proposals come back when the caller states no limit. */
export const PROPOSAL_LIMIT = 8;
/** How many of a channel's fitting columns, in the recommender's order, a proposal may be built from. */
export const PROPOSAL_CANDIDATES = 4;
/** How many bindings of ONE chart kind are enumerated. Four candidates on three channels is sixty-four, so no built-in kind reaches it. */
export const PROPOSAL_BINDINGS = 64;

/**
 * The offer's own sentences.
 *
 * They are not in `sentences.ts` on purpose: that file is the VALIDATOR's, and
 * every line in it is a refusal read by the three doors. These are the offer's
 * — what a channel takes, and what was not enumerated — and nothing judges
 * anything with them.
 */
export const OFFER_SENTENCES = Object.freeze({
  accepts: 'the {channel} of a {chart} takes {accepts}',
  scale: 'the {channel} of a {chart} takes a {needScale} column',
  roles: 'the {channel} of a {chart} takes {roles}',
  any: 'the {channel} of a {chart} takes any column',
  unranked: 'the recommender that ranked "{column}" for {channel} gave no reason',
  channelCapped: 'the {channel} of a {chart} had {n} columns that fit, and only the first {cap} were built into a proposal — the recommender’s own order decided which',
  bindingsCapped: 'a {chart} had more than {cap} bindings to try; the {cap} best-ranked were tried and the rest were not',
  limited: '{n} proposals were found and the first {limit} came back — ask for a larger limit to see the rest',
});

/** A chart kind and the channels a proposal of it must bind. */
export interface ProposalKind {
  readonly chartKind: string;
  readonly channels: readonly string[];
}

/** One whole chart, offered. */
export interface ChartProposal {
  readonly chartKind: string;
  /** channel → the column offered for it. */
  readonly channels: Bindings;
  /** channel → why: what the channel takes, and why this column was offered for it. */
  readonly reasons: Readonly<Record<string, string>>;
  /**
   * How far this binding sat from the recommender's first choices: the sum of
   * each channel's OFFER INDEX, so 0 means every channel took the one the
   * policy offered first. Lower is offered first — a COST, not a score, and
   * named that way deliberately: "score" reads as higher-is-better to everyone
   * who has ever seen one, and a name that fights its own semantics is a bug
   * waiting for a consumer. It is derived from the reasons rather than a
   * judgement standing beside them, and it measures nothing but the ranks.
   */
  readonly cost: number;
}

/** The proposals, and what was left out of them. */
export interface ChartProposals {
  readonly proposals: readonly ChartProposal[];
  /** A sentence per cap that bit. Empty when everything was enumerated. */
  readonly notEnumerated: readonly string[];
  /**
   * The graph reading in force, when the caller stated a `graph` fact: which of
   * the two pictures of a graph reads better here, and WHY, with its study
   * named (`./graphReading.ts`). It is a ruling, never a refusal — the offer
   * still carries both pictures if both fit, with the preferred one first.
   */
  readonly reading?: GraphReading;
}

export interface ProposeChartsInput {
  /** The described table plus the person's declarations — `whatFits`'s own column shape. */
  readonly columns: readonly FitColumn[];
  /** The table's absence declaration, when it declared one — bare or a LIST, since silence belongs to a column (`../data/silence.ts`); handed straight to {@link resolveFacets}. */
  readonly absence?: AbsenceDecl | readonly AbsenceDecl[];
  /** The rule set the def carries (or would carry) — its `channels` also widen which kinds are proposed. */
  readonly rules?: EncodingRules;
  /** The ports a build would pass. With no `recommender` among them, {@link policyRecommender} ranks. */
  readonly ports?: EncodingPorts;
  /** How many proposals to return. Default {@link PROPOSAL_LIMIT}. */
  readonly limit?: number;
  /**
   * What is known about the GRAPH these columns describe, when they describe
   * one: how many nodes, how many edges (or the density outright), what the
   * reader is asking, and whether they can explore it. Stating it turns on the
   * reading rule — the offer comes back with a `reading` naming which of the
   * two pictures of a graph reads better here and why, and the two are ordered
   * by it. Absent = no ruling, no reordering; nothing else changes.
   */
  readonly graph?: GraphFact;
  /**
   * The kinds to propose, and the channels each must bind. Default: every kind
   * the requirement tables know, with its own non-optional channels.
   *
   * A caller states this when it can only DRAW some of them, or draws one with
   * channels of its own — the studio wizard's `bar` binds `category` and counts
   * rows, where the library's binds `x` and `y`. A proposal it cannot draw is a
   * proposal it must not offer, so it says which it can.
   */
  readonly kinds?: readonly ProposalKind[];
}

/** What the channel TAKES, in the positive — read off the requirement in force, never re-derived. */
function takes(chartKind: string, channel: string, overrides?: ChannelRequirements): string {
  const req = requirementFor(chartKind, channel, overrides);
  const slots = { channel, chart: chartKind };
  if (req === undefined) return fill(OFFER_SENTENCES.any, slots);
  if (req.accepts !== undefined) return fill(OFFER_SENTENCES.accepts, { ...slots, accepts: listOf(req.accepts) });
  if (req.scale !== undefined) return fill(OFFER_SENTENCES.scale, { ...slots, needScale: req.scale });
  if (req.roles !== undefined) return fill(OFFER_SENTENCES.roles, { ...slots, roles: listOf(req.roles) });
  // Only a negative left (`notRoles` refuses an identifier on an axis): a
  // refusal is not an offer, so the honest positive is that anything else goes.
  return fill(OFFER_SENTENCES.any, slots);
}

/** One binding under construction: what it binds, and the ranks it has spent getting there. */
interface Combination {
  readonly bindings: Bindings;
  readonly cost: number;
}

/**
 * Propose whole charts over a described table.
 *
 * ```ts
 * const { proposals } = proposeCharts({ columns, absence: { field: 'report_state', states } });
 * proposals[0];
 * // { chartKind: 'line', channels: { x: 't', y: 'cases' }, cost: 0,
 * //   reasons: { x: 'the x of a line takes a number, a date, a string or a boolean; "t" is a date and x is an ordered axis — …',
 * //              y: 'the y of a line takes a number; "cases" is a declared measure, and y carries a magnitude' } }
 * ```
 *
 * Best first, by {@link ChartProposal.cost}, and kinds that tie keep the order
 * the requirement tables list them in.
 */
/** Which picture of a graph this chart kind IS, or null for a chart that is not one. */
function readingOf(chartKind: string): GraphReadingKind | null {
  const found = Object.entries(CHART_KIND_FOR_READING).find(([, kind]) => kind === chartKind);
  return found === undefined ? null : (found[0] as GraphReadingKind);
}

/**
 * The reading's ONE effect on the offer: between the two pictures of a graph,
 * the preferred one comes first.
 *
 * WHY as a re-fill of the positions the graph proposals already occupy, and not
 * as a comparator: cost orders everything else, and a comparator that mixed the
 * two rules would not be transitive (a bar could sit between two pictures that
 * the reading orders the other way round), which is a sort with no defined
 * answer. A reading is a judgement about which PICTURE of a graph reads better;
 * it has no opinion about a bar chart, and this keeps it that way.
 */
function readFirst(proposals: readonly ChartProposal[], reading: GraphReading): ChartProposal[] {
  const out = [...proposals];
  const slots: number[] = [];
  const pictures: ChartProposal[] = [];
  out.forEach((proposal, at) => {
    if (readingOf(proposal.chartKind) !== null) {
      slots.push(at);
      pictures.push(proposal);
    }
  });
  const first = pictures.filter((p) => readingOf(p.chartKind) === reading.prefer);
  const rest = pictures.filter((p) => readingOf(p.chartKind) !== reading.prefer);
  [...first, ...rest].forEach((proposal, i) => {
    out[slots[i]!] = proposal;
  });
  return out;
}

export function proposeCharts(input: ProposeChartsInput): ChartProposals {
  const limit = input.limit ?? PROPOSAL_LIMIT;
  const overrides = input.rules?.channels;
  const ports: EncodingPorts = { ...input.ports, recommender: input.ports?.recommender ?? policyRecommender() };
  const kinds = input.kinds ?? proposableKinds(overrides);
  const notEnumerated: string[] = [];
  const found: ChartProposal[] = [];
  for (const kind of kinds) {
    // a kind that binds nothing has nothing to propose — `table` is the one built-in
    if (kind.channels.length > 0) found.push(...proposeKind(input, kind, ports, limit, notEnumerated));
  }
  const byCost = found.sort((a, b) => a.cost - b.cost);
  // the ruling is made on the FACTS, before anything is cut: a caller that
  // asked with a graph fact is told which picture reads better even when only
  // one of the two was proposable here
  const reading = input.graph === undefined ? undefined : graphReadingFor(input.graph);
  const best = reading === undefined ? byCost : readFirst(byCost, reading);
  if (best.length > limit) notEnumerated.push(fill(OFFER_SENTENCES.limited, { n: String(best.length), limit: String(limit) }));
  return { proposals: best.slice(0, limit), notEnumerated, ...(reading === undefined ? {} : { reading }) };
}

/** Every proposal of ONE chart kind, best first, capped — and each of them verified by `whatFits`. */
function proposeKind(input: ProposeChartsInput, kind: ProposalKind, ports: EncodingPorts, limit: number, notEnumerated: string[]): ChartProposal[] {
  const { chartKind, channels } = kind;
  const overrides = input.rules?.channels;
  const asked = {
    columns: input.columns,
    ...(input.absence !== undefined ? { absence: input.absence } : {}),
    ...(input.rules !== undefined ? { rules: input.rules } : {}),
    chartKind,
    channels,
    ports,
  };
  // The OPEN pass: every column judged alone on every channel, ranked. It is
  // where the candidates and their reasons come from — and where a channel
  // nothing fits ends the kind.
  const open = whatFits(asked);
  const candidates: Record<string, readonly Fit[]> = {};
  for (const channel of channels) {
    const fitting = open[channel]!.filter((fit) => fit.ok);
    if (fitting.length > PROPOSAL_CANDIDATES) {
      notEnumerated.push(fill(OFFER_SENTENCES.channelCapped, { channel, chart: chartKind, n: String(fitting.length), cap: String(PROPOSAL_CANDIDATES) }));
    }
    candidates[channel] = fitting.slice(0, PROPOSAL_CANDIDATES);
  }
  if (channels.some((channel) => candidates[channel]!.length === 0)) return [];

  let combinations: Combination[] = [{ bindings: {}, cost: 0 }];
  let capped = false;
  for (const channel of channels) {
    const next: Combination[] = [];
    for (const combination of combinations) {
      candidates[channel]!.forEach((fit, offer) => {
        // one column, one channel — the plane would allow the repeat, and it is
        // still not a chart anybody meant to be offered
        if (!Object.values(combination.bindings).includes(fit.field)) {
          next.push({ bindings: { ...combination.bindings, [channel]: fit.field }, cost: combination.cost + offer });
        }
      });
    }
    if (next.length > PROPOSAL_BINDINGS) capped = true;
    combinations = next.slice(0, PROPOSAL_BINDINGS);
  }
  if (capped) notEnumerated.push(fill(OFFER_SENTENCES.bindingsCapped, { chart: chartKind, cap: String(PROPOSAL_BINDINGS) }));

  const kept: ChartProposal[] = [];
  for (const combination of combinations.sort((a, b) => a.cost - b.cost)) {
    // more than the caller asked for, from one kind, is work nobody reads
    if (kept.length === limit) break;
    // THE VERIFICATION: the whole binding judged at once, because a rule about
    // two columns (`never-together`, `only-with`) cannot fire while each column
    // is judged alone. Every proposal that survives is one `whatFits` accepts.
    const judged = whatFits({ ...asked, bindings: combination.bindings });
    if (channels.every((channel) => judged[channel]!.some((fit) => fit.field === combination.bindings[channel] && fit.ok))) {
      kept.push({ chartKind, channels: combination.bindings, reasons: reasonsOf(chartKind, channels, combination.bindings, open, overrides), cost: combination.cost });
    }
  }
  return kept;
}

/** Per channel: what it takes, and why this column was offered for it. */
function reasonsOf(chartKind: string, channels: readonly string[], bindings: Bindings, open: Readonly<Record<string, readonly Fit[]>>, overrides?: ChannelRequirements): Record<string, string> {
  const out: Record<string, string> = {};
  for (const channel of channels) {
    const field = bindings[channel]!;
    const fit = open[channel]!.find((f) => f.field === field)!;
    // A recommender is a port: a host's own may rank without saying why, and
    // the honest thing is to report that rather than to invent a reason for it.
    const why = fit.reason ?? fill(OFFER_SENTENCES.unranked, { column: field, channel });
    out[channel] = `${takes(chartKind, channel, overrides)}; ${why}`;
  }
  return out;
}

/** The built-in kinds a proposal can be made of, with the channels each binds — what `proposeCharts` enumerates by default. */
export function proposableKinds(overrides?: ChannelRequirements): readonly ProposalKind[] {
  return chartKindsOf(overrides)
    .filter((chartKind) => !KINDS_NOT_PROPOSED.includes(chartKind))
    .map((chartKind) => ({ chartKind, channels: channelsOf(chartKind, overrides) }))
    .filter((kind) => kind.channels.length > 0);
}
