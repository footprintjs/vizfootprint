/**
 * THE DEFAULT RECOMMENDER — preferences as DATA, and never as opinions buried
 * in a function.
 *
 * The `Recommender` port has existed since the plane did, and nothing
 * implemented it: `fitsFor` calls it to order the columns that FIT a channel,
 * and with no port passed they came back in the order the table happened to
 * list them. That is not neutral — it is one particular opinion (the CSV
 * author's) presented as no opinion at all.
 *
 * This is the other kind of answer. A policy is an ordered list of RULES, each
 * of them three things a person can read: which channels it speaks about, which
 * column it names (a predicate over the facet), and the SENTENCE saying why.
 * The first rule that speaks about the channel and names the column wins, and
 * every ranked `Fit` carries the sentence of the rule that placed it. A rank
 * without a reason is an opinion wearing a number, and this library does not
 * ship one of those.
 *
 * ## Preferences before demotions, and the default in between
 *
 * A rule either PREFERS a column (`place: 'first'`) or DEMOTES it
 * (`place: 'last'`), and both are stated against the same middle: the columns
 * no rule named at all. So the ordering is three bands —
 *
 *   preferred (in policy order) · named by nobody (in the table's order) · demoted
 *
 * — which is why "an identifier last, wherever one is allowed at all" is
 * expressible without inverting the list, and why a rule's POSITION means "who
 * speaks first" rather than "who is offered first". Both are visible in
 * {@link Placement.rank}: negative is a preference, 0 is the default, positive
 * is a demotion.
 *
 * ## What this never does
 *
 * It never changes MEMBERSHIP. `whatFits` decides who may sit on a channel and
 * this decides only the order they are offered in — one rule for fit, and the
 * recommender is not it. `recommend.test.ts` pins that: the same columns
 * come back, in a different order, with the refusals untouched.
 */
import type { ColumnFacet } from '../data/types.js';
import { fill } from './sentences.js';
import { CHANNEL_CLASSES } from './types.js';
import type { ChannelClass, Fit, Recommender } from './types.js';

/**
 * One preference, as data.
 *
 * `channels` / `class` say WHERE the rule speaks — by channel name, or by the
 * plane's own channel classes — and a rule that names neither speaks about
 * every channel. `when` says WHICH column it names, over the facet the plane
 * resolved (and the channel, for a rule that is about the two of them
 * together). `because` is the sentence, with the same `{slot}` markers the
 * refusal sentences use: `{column}` `{channel}` `{type}` `{role}` `{scale}`.
 */
export interface RankingRule {
  readonly id: string;
  /** The channels this rule speaks about, by name. */
  readonly channels?: readonly string[];
  /** …or by class (`magnitude`, `category`). Read only when `channels` is absent. */
  readonly class?: ChannelClass;
  /** True when this rule names the column. */
  readonly when: (facet: ColumnFacet, channel: string) => boolean;
  /** `first` — offered ahead of the columns no rule named; `last` — after them. */
  readonly place: 'first' | 'last';
  /** Why it sits where it sits. Slots: {column} {channel} {type} {role} {scale}. */
  readonly because: string;
}

/**
 * The names a column carries when it simply IS the channel.
 *
 * This is the one place the policy reads a NAME rather than a facet, and where
 * it sits took an argument. It is below what the data and the declarations say
 * about a column's TYPE (a date belongs on an ordered axis) and about a MEASURE
 * on a magnitude — those are facts. It is ABOVE "a dimension on a category",
 * because nearly every discrete column is a dimension, and `jurisdiction` on a
 * map's `region` is the more specific evidence: somebody called the column
 * that. Order it the other way and a map of NNDSS is offered `disease` for its
 * geography, which is what sent this rule up the list.
 */
export const CHANNEL_NAMES: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  x: new Set(['x', 'time', 'date', 'when', 'week', 'month', 'year']),
  y: new Set(['y', 'value', 'count', 'total']),
  size: new Set(['size', 'count', 'n', 'weight']),
  color: new Set(['color', 'colour', 'group', 'series']),
  region: new Set(['region', 'state', 'country', 'jurisdiction', 'area']),
});

/** The sentence for a column no rule named — the default branch, and it says so out loud. */
export const DEFAULT_RANKING_REASON = 'no rule in this policy names "{column}" for {channel} — it is offered among the columns no rule names, in the order the table lists them';

/**
 * THE POLICY THIS LIBRARY SHIPS — five rules, in the order they speak.
 *
 * Four are facts about facets and the third is a fact about spelling; where
 * that one sits is argued at {@link CHANNEL_NAMES}. Preferences first, then the
 * demotion: a rule that PREFERS a column always beats a rule that would have
 * demoted it, which is what makes "`jurisdiction` is what a map's region is"
 * survive "an identifier is a list rather than a chart".
 *
 * A host may inspect this, replace it (`policyRecommender(myRules)`) or extend
 * it (`policyRecommender([...RANKING_POLICY.slice(0, 1), mine, ...])`) — it is
 * data, so all three are the same act.
 */
export const RANKING_POLICY: readonly RankingRule[] = Object.freeze([
  {
    id: 'date-on-an-axis',
    channels: ['x', 'y'],
    when: (facet) => facet.type === 'date',
    place: 'first',
    because: '"{column}" is a date and {channel} is an ordered axis — time is the thing an axis reads best',
  },
  {
    id: 'measure-on-a-magnitude',
    class: 'magnitude',
    when: (facet) => facet.role === 'measure',
    place: 'first',
    because: '"{column}" is a declared measure, and {channel} carries a magnitude',
  },
  {
    id: 'named-for-the-channel',
    when: (facet, channel) => CHANNEL_NAMES[channel]?.has(facet.field.toLowerCase()) ?? false,
    place: 'first',
    because: '"{column}" is named for the {channel} channel — somebody called it that, which is the most specific thing anybody has said about it',
  },
  {
    id: 'dimension-on-a-category',
    class: 'category',
    when: (facet) => facet.role === 'dimension',
    place: 'first',
    because: '"{column}" is a declared dimension, and {channel} carries a category',
  },
  {
    id: 'an-identifier-last',
    when: (facet) => facet.role === 'identifier',
    place: 'last',
    because: '"{column}" is a declared identifier, and one mark per row is a list rather than a chart — it is offered after every column that names something shared',
  },
]);

/** Where a column was placed for a channel, and by whom. */
export interface Placement {
  /** The id of the rule that named it, or `null` when none did. */
  readonly rule: string | null;
  /** Lower is offered first: negative is a preference, 0 is the default, positive is a demotion. */
  readonly rank: number;
  /** The sentence — the rule's own, or the default's. */
  readonly reason: string;
}

/** True when the rule speaks about this channel. A rule naming neither `channels` nor `class` speaks about every one. */
function speaksAbout(rule: RankingRule, channel: string): boolean {
  if (rule.channels !== undefined) return rule.channels.includes(channel);
  if (rule.class !== undefined) return CHANNEL_CLASSES[rule.class].has(channel);
  return true;
}

/**
 * Place one column on one channel: the first rule that speaks about the channel
 * and names the column, or the default.
 *
 * The arithmetic is the three bands stated in the header: a preference at
 * position `i` of an `n`-rule policy ranks `i - n` (so it is negative, and
 * earlier rules rank lower), the default ranks 0, and a demotion ranks `i + 1`
 * (positive, and earlier rules still rank lower).
 */
export function placeIn(facet: ColumnFacet, channel: string, rules: readonly RankingRule[] = RANKING_POLICY): Placement {
  const slots = { column: facet.field, channel, type: facet.type, role: facet.role, scale: facet.scale };
  const at = rules.findIndex((rule) => speaksAbout(rule, channel) && rule.when(facet, channel));
  if (at === -1) return { rule: null, rank: 0, reason: fill(DEFAULT_RANKING_REASON, slots) };
  const rule = rules[at]!;
  return { rule: rule.id, rank: rule.place === 'first' ? at - rules.length : at + 1, reason: fill(rule.because, slots) };
}

/**
 * The `Recommender` the plane ships: it orders the columns that fit a channel
 * by {@link RANKING_POLICY} (or by a policy handed in), and stamps each `Fit`
 * with the sentence that placed it.
 *
 * ```ts
 * whatFits({ columns, absence, chartKind: 'line', channels: ['x'], ports: { recommender: policyRecommender() } })['x'];
 * // [ { field: 't', ok: true, reason: '"t" is a date and x is an ordered axis — …' },
 * //   { field: 'cases', ok: true, reason: '"cases" is a declared measure, and x carries a magnitude' }, … ]
 * ```
 *
 * Columns the policy places equally keep the order they arrived in — the
 * table's own — because a sort that reshuffles what it has nothing to say about
 * is a preference nobody declared.
 */
export function policyRecommender(rules: readonly RankingRule[] = RANKING_POLICY): Recommender {
  return {
    rank(channel: string, fits: readonly Fit[], facets: readonly ColumnFacet[]): readonly Fit[] {
      const byField = new Map(facets.map((facet) => [facet.field, facet] as const));
      return fits
        // A fit whose column the caller never described is a column no rule can
        // name: it is placed as an untyped facet, which is the default band.
        .map((fit) => ({ fit, placed: placeIn(byField.get(fit.field) ?? { field: fit.field, type: 'unknown' }, channel, rules) }))
        .sort((a, b) => a.placed.rank - b.placed.rank)
        .map(({ fit, placed }) => ({ ...fit, reason: placed.reason }));
    },
  };
}
