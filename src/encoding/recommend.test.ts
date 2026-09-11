/**
 * THE POLICY, READ AS DATA — and the one thing a recommender may never do.
 *
 * Two claims are pinned here and they are the whole contract. The first is that
 * every rule in `RANKING_POLICY` is inspectable: a host can read which channels
 * it speaks about, which column it names and the sentence it says, and can
 * replace the list entirely. The second is the LAW — passing a recommender
 * through `whatFits`'s `ports` changes the ORDER and never the membership, so
 * the columns that fit and the sentences refusing the ones that do not come
 * back identical either way.
 */
import { describe, expect, it } from 'vitest';
import type { ColumnFacet } from '../data/types.js';
import { CHANNEL_NAMES, DEFAULT_RANKING_REASON, RANKING_POLICY, acceptsOf, placeIn, policyRecommender, whatFits } from './index.js';
import type { FitColumn, RankingRule } from './index.js';

/** An NNDSS-shaped table as a wizard holds it — the same shape `whatFits.test.ts` judges. */
const COLUMNS: FitColumn[] = [
  { name: 'jurisdiction', type: 'string', role: 'identifier' },
  { name: 'disease', type: 'string', role: 'dimension' },
  { name: 'week', type: 'date', role: 'dimension' },
  { name: 'cases', type: 'number', role: 'measure' },
  { name: 'ytd', type: 'number', role: 'measure', label: 'year to date' },
  { name: 'report_state', type: 'string' },
];
const ABSENCE = { field: 'report_state', states: ['present', 'unavailable', 'unknown'] };

const facet = (over: Partial<ColumnFacet> & { readonly field: string }): ColumnFacet => ({ type: 'string', ...over });

describe('the policy is data', () => {
  it('is six rules, each with an id, a place and a sentence a person can read', () => {
    expect(RANKING_POLICY.map((rule) => rule.id)).toEqual(['date-on-an-axis', 'measure-on-a-magnitude', 'named-for-the-channel', 'an-order-on-an-axis', 'dimension-on-a-category', 'an-identifier-last']);
    expect(RANKING_POLICY.filter((rule) => rule.place === 'last').map((rule) => rule.id)).toEqual(['an-identifier-last']);
    for (const rule of RANKING_POLICY) expect(rule.because).toContain('{column}');
  });

  it('places a column in one of three bands: preferred, named by nobody, demoted', () => {
    // a preference — negative, and the earlier rule ranks lower
    expect(placeIn(facet({ field: 'week', type: 'date' }), 'x')).toEqual({
      rule: 'date-on-an-axis',
      rank: -6,
      reason: '"week" is a date and x is an ordered axis — time is the thing an axis reads best',
    });
    expect(placeIn(facet({ field: 'cases', type: 'number', role: 'measure' }), 'y').rank).toBe(-5);
  });

  it('prefers a column that carries an order of its own on an axis — so a line over a category is offered after the same columns\' bar, never ahead of it', () => {
    // THE LAW behind the rule: a line's x takes a category now (the door and the frame renderer agree on
    // the band line), so the policy has to say where a category sits on an axis. An undeclared number is
    // continuous by its type, and it is preferred on x over an undeclared string with a sentence…
    expect(placeIn(facet({ field: 'sales', type: 'number', scale: 'continuous' }), 'x')).toEqual({
      rule: 'an-order-on-an-axis',
      rank: -3,
      reason: '"sales" is continuous — it carries an order of its own, and x is an ordered axis; a category has no order to read along one',
    });
    // …while the string falls to the default band (a PREFERENCE for the ordered column, never a demotion
    // of the category — a bar's x is made of categories, and "offered after" would be false there)
    expect(placeIn(facet({ field: 'region', type: 'string', scale: 'discrete' }), 'x')).toMatchObject({ rule: null, rank: 0 });
    // a number the def declared DISCRETE (a zip code) carries no order to read, and is not preferred
    expect(placeIn(facet({ field: 'zip', type: 'number', scale: 'discrete' }), 'x').rule).toBeNull();
    // it speaks about the two axes only: a continuous column on `size` or `color` is nobody's business here
    expect(placeIn(facet({ field: 'sales', type: 'number', scale: 'continuous' }), 'size').rule).toBeNull();
    expect(placeIn(facet({ field: 'sales', type: 'number', scale: 'continuous' }), 'color').rule).toBeNull();
    // and the earlier rules still speak first: a date is a date, a measure is a measure
    expect(placeIn(facet({ field: 'week', type: 'date', scale: 'continuous' }), 'x').rule).toBe('date-on-an-axis');
    expect(placeIn(facet({ field: 'cases', type: 'number', role: 'measure', scale: 'continuous' }), 'x').rule).toBe('measure-on-a-magnitude');
  });

  it('says out loud when no rule names a column', () => {
    const placed = placeIn(facet({ field: 'report_state' }), 'color');
    expect(placed.rule).toBeNull();
    expect(placed.rank).toBe(0);
    expect(placed.reason).toBe(DEFAULT_RANKING_REASON.replace('{column}', 'report_state').replace('{channel}', 'color'));
  });

  it('demotes an identifier below the columns no rule named, wherever one is allowed at all', () => {
    const placed = placeIn(facet({ field: 'jurisdiction', role: 'identifier' }), 'color');
    expect(placed).toMatchObject({ rule: 'an-identifier-last', rank: 6 });
    expect(placed.reason).toContain('one mark per row is a list rather than a chart');
  });

  it('reads a name only for the channels that have one, and only when nothing better spoke', () => {
    expect(CHANNEL_NAMES['region']!.has('jurisdiction')).toBe(true);
    // named for the channel: the third rule, and it beats "a dimension on a category"
    expect(placeIn(facet({ field: 'jurisdiction', role: 'identifier' }), 'region').rule).toBe('named-for-the-channel');
    expect(placeIn(facet({ field: 'disease', role: 'dimension' }), 'region').rule).toBe('dimension-on-a-category');
    // a channel with no vocabulary of its own, and a name that is in no vocabulary
    expect(placeIn(facet({ field: 'week' }), 'facet').rule).toBeNull();
    expect(placeIn(facet({ field: 'disease' }), 'x').rule).toBeNull();
  });

  it('a rule speaks only where it says it does — by channel name, by class, or everywhere', () => {
    // `date-on-an-axis` names channels: a date on `color` is nobody's business
    expect(placeIn(facet({ field: 'week', type: 'date' }), 'color').rule).toBeNull();
    // `measure-on-a-magnitude` names a CLASS: not on a category channel
    expect(placeIn(facet({ field: 'cases', type: 'number', role: 'measure' }), 'color').rule).toBeNull();
    expect(placeIn(facet({ field: 'cases', type: 'number', role: 'measure' }), 'size').rule).toBe('measure-on-a-magnitude');
    // `dimension-on-a-category` likewise: a bar's x is discrete but it is not a category CHANNEL
    expect(placeIn(facet({ field: 'disease', role: 'dimension' }), 'x').rule).toBeNull();
  });
});

describe('a policy a host wrote', () => {
  const mine: readonly RankingRule[] = [{ id: 'only-longs', when: (f) => f.field.length > 8, place: 'first', because: '"{column}" has a long name, which is what this host prefers ({type}, {role}, {scale})' }];

  it('replaces the shipped one entirely, sentences and all', () => {
    const placed = placeIn(facet({ field: 'jurisdiction', role: 'identifier', scale: 'discrete' }), 'color', mine);
    expect(placed).toEqual({ rule: 'only-longs', rank: -1, reason: '"jurisdiction" has a long name, which is what this host prefers (string, identifier, discrete)' });
    expect(placeIn(facet({ field: 'week' }), 'x', mine).rule).toBeNull();
  });

  it('ranks through the port the same way', () => {
    const ranked = policyRecommender(mine).rank('color', [{ field: 'disease', ok: true }, { field: 'jurisdiction', ok: true }], [facet({ field: 'disease' }), facet({ field: 'jurisdiction' })]);
    expect(ranked.map((f) => f.field)).toEqual(['jurisdiction', 'disease']);
  });
});

describe('the port', () => {
  it('stamps every ranked fit with the reason that placed it', () => {
    const facets: ColumnFacet[] = [facet({ field: 'disease', role: 'dimension' }), facet({ field: 'jurisdiction', role: 'identifier' }), facet({ field: 'report_state' })];
    const ranked = policyRecommender().rank('color', facets.map((f) => ({ field: f.field, ok: true })), facets);
    expect(ranked.map((f) => f.field)).toEqual(['disease', 'report_state', 'jurisdiction']);
    expect(ranked.map((f) => f.reason)).toEqual([
      '"disease" is a declared dimension, and color carries a category',
      DEFAULT_RANKING_REASON.replace('{column}', 'report_state').replace('{channel}', 'color'),
      '"jurisdiction" is a declared identifier, and one mark per row is a list rather than a chart — it is offered after every column that names something shared',
    ]);
  });

  it('a fit whose column the caller never described falls to the default band', () => {
    // the port is a public shape: a caller may hand it a fit for a column it
    // described nothing about, and no rule can name a column nobody described
    const ranked = policyRecommender().rank('y', [{ field: 'ghost', ok: true }], []);
    expect(ranked).toEqual([{ field: 'ghost', ok: true, reason: DEFAULT_RANKING_REASON.replace('{column}', 'ghost').replace('{channel}', 'y') }]);
  });

  it('keeps the table\'s own order among columns it has nothing to say about', () => {
    const facets: ColumnFacet[] = [facet({ field: 'b' }), facet({ field: 'a' })];
    expect(policyRecommender().rank('color', [{ field: 'b', ok: true }, { field: 'a', ok: true }], facets).map((f) => f.field)).toEqual(['b', 'a']);
  });
});

describe('the law: ordering only, never membership', () => {
  const channels = ['x', 'y', 'color'];
  const plain = whatFits({ columns: COLUMNS, absence: ABSENCE, chartKind: 'line', channels });
  const ranked = whatFits({ columns: COLUMNS, absence: ABSENCE, chartKind: 'line', channels, ports: { recommender: policyRecommender() } });

  it('admits exactly the same columns, on every channel', () => {
    for (const channel of channels) {
      expect([...acceptsOf(ranked)[channel]!].sort()).toEqual([...acceptsOf(plain)[channel]!].sort());
    }
  });

  it('refuses exactly the same columns, in the same sentences', () => {
    for (const channel of channels) {
      const refused = (fits: readonly { readonly field: string; readonly ok: boolean; readonly because?: string }[]): unknown =>
        fits.filter((f) => !f.ok).map((f) => [f.field, f.because]);
      expect(refused(ranked[channel]!)).toEqual(refused(plain[channel]!));
    }
  });

  it('and changes the order, which is the whole of what it is for', () => {
    // a line's x admits the dimension string too (the band line): the table lists it first, the policy offers it last
    expect(acceptsOf(plain)['x']).toEqual(['disease', 'week', 'cases', 'ytd']);
    expect(acceptsOf(ranked)['x']).toEqual(['week', 'cases', 'ytd', 'disease']);
    expect(acceptsOf(plain)['color']).toEqual(['jurisdiction', 'disease', 'report_state']);
    expect(acceptsOf(ranked)['color']).toEqual(['disease', 'report_state', 'jurisdiction']);
  });
});
