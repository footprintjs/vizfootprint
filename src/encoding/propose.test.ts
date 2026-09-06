/**
 * WHOLE CHARTS, PROPOSED — and the pin that they are nothing but `whatFits`
 * and the recommender put together.
 *
 * The first two tests are the contract. Every binding a proposal carries is one
 * `whatFits` accepts, judged as a WHOLE binding rather than a column at a time;
 * and a binding `whatFits` refuses never appears, whichever door refused it —
 * a channel requirement, the built-in absence law, or a business rule about two
 * columns that only bites once both are bound. Everything after that is the
 * arithmetic: what is enumerated, what is capped, and what the caps say when
 * they bite.
 */
import { describe, expect, it } from 'vitest';
import {
  OFFER_SENTENCES,
  PROPOSAL_BINDINGS,
  PROPOSAL_CANDIDATES,
  PROPOSAL_LIMIT,
  channelsOf,
  chartKindsOf,
  proposableKinds,
  proposeCharts,
  whatFits,
} from './index.js';
import type { ChartProposal, EncodingRules, FitColumn } from './index.js';

/** The NNDSS-shaped table: a geography, a category, a week, two measures, and the column that carries silence. */
const COLUMNS: FitColumn[] = [
  { name: 'jurisdiction', type: 'string', role: 'identifier' },
  { name: 'disease', type: 'string', role: 'dimension' },
  { name: 'week', type: 'date', role: 'dimension' },
  { name: 'cases', type: 'number', role: 'measure' },
  { name: 'ytd', type: 'number', role: 'measure', label: 'year to date' },
  { name: 'report_state', type: 'string' },
];
const ABSENCE = { field: 'report_state', states: ['present', 'unavailable', 'unknown'] };

/** Re-ask the plane about a whole proposal, the way a build door would. */
function accepts(proposal: ChartProposal, rules?: EncodingRules): boolean {
  const channels = Object.keys(proposal.channels);
  const fits = whatFits({ columns: COLUMNS, absence: ABSENCE, chartKind: proposal.chartKind, channels, bindings: proposal.channels, ...(rules === undefined ? {} : { rules }) });
  return channels.every((channel) => fits[channel]!.some((fit) => fit.field === proposal.channels[channel] && fit.ok));
}

describe('the law: a proposal is only ever what whatFits accepts', () => {
  it('every binding of every proposal, judged again as a whole', () => {
    const { proposals } = proposeCharts({ columns: COLUMNS, absence: ABSENCE, limit: 40 });
    expect(proposals.length).toBeGreaterThan(10);
    for (const proposal of proposals) expect([proposal.chartKind, proposal.channels, accepts(proposal)]).toEqual([proposal.chartKind, proposal.channels, true]);
  });

  it('a binding the plane refuses never appears — a requirement, the absence law, or a rule about two columns', () => {
    const rules: EncodingRules = { rules: [{ rule: 'never-together', columns: ['cases', 'ytd'], scope: 'view' }] };
    const { proposals } = proposeCharts({ columns: COLUMNS, absence: ABSENCE, rules, limit: 40 });
    for (const proposal of proposals) {
      const bound = Object.values(proposal.channels);
      // the business rule: the two measures never share a chart
      expect(bound.includes('cases') && bound.includes('ytd')).toBe(false);
      // the built-in law: the declared absence column is never a magnitude
      expect(proposal.channels['x'] === 'report_state' || proposal.channels['y'] === 'report_state').toBe(false);
      // the requirement: an identifier is not a line's x
      expect(accepts(proposal, rules)).toBe(true);
    }
    // and the combination the rule refuses IS one the open pass admitted, so it
    // was dropped by the verification rather than never enumerated
    const both = whatFits({ columns: COLUMNS, absence: ABSENCE, chartKind: 'scatter', channels: ['x', 'y'], rules });
    expect(both['y']!.find((f) => f.field === 'ytd')!.ok).toBe(true);
  });
});

describe('what an NNDSS-shaped table is offered', () => {
  const { proposals, notEnumerated } = proposeCharts({ columns: COLUMNS, absence: ABSENCE });

  it('a line of the measure over the week, first, with a reason per channel', () => {
    expect(proposals[0]).toEqual({
      chartKind: 'line',
      channels: { x: 'week', y: 'cases' },
      cost: 0,
      reasons: {
        x: 'the x of a line takes a number or a date; "week" is a date and x is an ordered axis — time is the thing an axis reads best',
        y: 'the y of a line takes a number; "cases" is a declared measure, and y carries a magnitude',
      },
    });
  });

  it('a map of the jurisdiction, because somebody called the column that', () => {
    const map = proposals.find((p) => p.chartKind === 'map')!;
    expect(map.channels).toEqual({ region: 'jurisdiction' });
    expect(map.reasons['region']).toBe('the region of a map takes a string; "jurisdiction" is named for the region channel — somebody called it that, which is the most specific thing anybody has said about it');
  });

  it('binds a line\'s x and y and not its colour — a line draws without one', () => {
    expect(channelsOf('line')).toEqual(['x', 'y']);
    expect(proposals.filter((p) => p.chartKind === 'line').every((p) => p.channels['color'] === undefined)).toBe(true);
    // a heatmap's colour is the value itself, so it is not optional and IS bound
    expect(channelsOf('heatmap')).toEqual(['x', 'y', 'color']);
  });

  it('offers the best few and says how many it did not', () => {
    expect(proposals.length).toBe(PROPOSAL_LIMIT);
    expect(proposals.map((p) => p.cost)).toEqual([...proposals.map((p) => p.cost)].sort((a, b) => a - b));
    expect(notEnumerated).toEqual([expect.stringContaining('proposals were found and the first 8 came back')]);
    expect(proposeCharts({ columns: COLUMNS, absence: ABSENCE, limit: 2 }).proposals.length).toBe(2);
  });

  it('never puts one column on two channels of one chart', () => {
    for (const proposal of proposals) {
      const bound = Object.values(proposal.channels);
      expect(new Set(bound).size).toBe(bound.length);
    }
  });

  it('proposes nothing for a kind that binds nothing, and nothing for a kind a channel of which nothing fits', () => {
    expect(proposals.some((p) => p.chartKind === 'table')).toBe(false);
    expect(proposableKinds().some((kind) => kind.chartKind === 'table')).toBe(false);
    // a table of nothing but numbers: a map's region takes a string
    const numbers = proposeCharts({ columns: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }] });
    expect(numbers.proposals.some((p) => p.chartKind === 'map')).toBe(false);
    expect(numbers.proposals.some((p) => p.chartKind === 'scatter')).toBe(true);
    // and a caller may hand one over anyway — it is skipped, not proposed empty
    const asked = proposeCharts({ columns: COLUMNS, absence: ABSENCE, kinds: [{ chartKind: 'table', channels: [] }, { chartKind: 'histogram', channels: ['x'] }] });
    expect(asked.proposals.every((p) => p.chartKind === 'histogram')).toBe(true);
  });
});

describe('the kinds, and the caller that can only draw some of them', () => {
  it('takes a caller\'s own kinds and channels — the wizard\'s bar binds a category', () => {
    const { proposals } = proposeCharts({
      columns: COLUMNS,
      absence: ABSENCE,
      kinds: [{ chartKind: 'bar', channels: ['category'] }],
    });
    expect(proposals[0]!.channels).toEqual({ category: 'disease' });
    expect(proposals[0]!.reasons['category']).toBe('the category of a bar takes a discrete column; "disease" is a declared dimension, and category carries a category');
    expect(proposals.every((p) => p.chartKind === 'bar')).toBe(true);
  });

  it('a def that declares a kind of its own has it proposed too', () => {
    const rules: EncodingRules = { channels: { timeline: [{ channel: 'at', accepts: ['date'] }, { channel: 'note', accepts: ['string'], optional: true }] } };
    expect(chartKindsOf(rules.channels)).toContain('timeline');
    expect(channelsOf('timeline', rules.channels)).toEqual(['at']);
    // an override for a channel the built-in kind already names does not double it
    expect(channelsOf('line', { line: [{ channel: 'x', accepts: ['number'] }] })).toEqual(['x', 'y']);
    expect(proposableKinds(rules.channels).find((k) => k.chartKind === 'timeline')).toEqual({ chartKind: 'timeline', channels: ['at'] });

    const { proposals } = proposeCharts({ columns: COLUMNS, absence: ABSENCE, rules, kinds: [{ chartKind: 'timeline', channels: ['at'] }] });
    expect(proposals).toEqual([
      {
        chartKind: 'timeline',
        channels: { at: 'week' },
        cost: 0,
        reasons: { at: 'the at of a timeline takes a date; no rule in this policy names "week" for at — it is offered among the columns no rule names, in the order the table lists them' },
      },
    ]);
  });

  it('says what the channel takes, whatever the requirement in force says — including nothing', () => {
    const rules: EncodingRules = { channels: { odd: [{ channel: 'byRole', roles: ['measure'] }, { channel: 'byNegative', notRoles: ['identifier'] }] } };
    const kinds = [{ chartKind: 'odd', channels: ['byRole'] }, { chartKind: 'odd', channels: ['byNegative'] }, { chartKind: 'line', channels: ['detail'] }];
    const { proposals } = proposeCharts({ columns: COLUMNS, absence: ABSENCE, rules, kinds, limit: 30 });
    const said = (channel: string): string => proposals.find((p) => p.channels[channel] !== undefined)!.reasons[channel]!;
    expect(said('byRole')).toContain('the byRole of a odd takes a measure');
    expect(said('byNegative')).toContain('the byNegative of a odd takes any column');
    // a channel no layer constrains at all: the honest positive is "anything"
    expect(said('detail')).toContain('the detail of a line takes any column');
  });
});

describe('the caps, and saying when they bit', () => {
  it('builds proposals from the first few candidates of a channel, and names the ones it did not', () => {
    const many: FitColumn[] = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, type: 'number' as const }));
    const { proposals, notEnumerated } = proposeCharts({ columns: many, kinds: [{ chartKind: 'histogram', channels: ['x'] }] });
    expect(proposals.map((p) => p.channels['x'])).toEqual(['a', 'b', 'c', 'd']);
    expect(notEnumerated).toEqual([fillSlots(OFFER_SENTENCES.channelCapped, { channel: 'x', chart: 'histogram', n: '5', cap: String(PROPOSAL_CANDIDATES) })]);
  });

  it('stops enumerating one kind\'s bindings at the ceiling, and says so', () => {
    const wide: FitColumn[] = [
      ...['n1', 'n2', 'n3', 'n4'].map((name) => ({ name, type: 'number' as const })),
      ...['s1', 's2', 's3', 's4'].map((name) => ({ name, type: 'string' as const })),
    ];
    const rules: EncodingRules = {
      channels: { grid: [{ channel: 'a', accepts: ['number'] }, { channel: 'b', accepts: ['number'] }, { channel: 'c', accepts: ['string'] }, { channel: 'd', accepts: ['string'] }] },
    };
    const { proposals, notEnumerated } = proposeCharts({ columns: wide, rules, kinds: [{ chartKind: 'grid', channels: ['a', 'b', 'c', 'd'] }] });
    // 4 × 3 × 4 × 3 = 144 bindings, and sixty-four of them were tried
    expect(notEnumerated).toEqual([fillSlots(OFFER_SENTENCES.bindingsCapped, { chart: 'grid', cap: String(PROPOSAL_BINDINGS) })]);
    expect(proposals.length).toBe(PROPOSAL_LIMIT);
    expect(proposals[0]!.channels).toEqual({ a: 'n1', b: 'n2', c: 's1', d: 's2' });
  });

  it('and stays quiet when neither bit — no built-in kind can reach the per-kind one at all', () => {
    const { notEnumerated } = proposeCharts({ columns: COLUMNS, absence: ABSENCE, limit: 100 });
    expect(notEnumerated).toEqual([]);
  });
});

describe('the recommender it ranks with', () => {
  it('is the shipped policy when the caller passes none', () => {
    const { proposals } = proposeCharts({ columns: COLUMNS, absence: ABSENCE, limit: 1 });
    expect(proposals[0]!.reasons['x']).toContain('is a date and x is an ordered axis');
  });

  it('is the caller\'s when they pass one — and reports a rank with no reason as exactly that', () => {
    const { proposals } = proposeCharts({
      columns: COLUMNS,
      absence: ABSENCE,
      // a host's own recommender: it orders, and says nothing about why
      ports: { recommender: { rank: (_channel, fits) => [...fits].reverse() } },
      kinds: [{ chartKind: 'histogram', channels: ['x'] }],
      limit: 1,
    });
    expect(proposals[0]!.channels).toEqual({ x: 'ytd' });
    expect(proposals[0]!.reasons['x']).toBe(`the x of a histogram takes a number or a date; ${fillSlots(OFFER_SENTENCES.unranked, { column: 'ytd', channel: 'x' })}`);
  });
});

/** The test's own slot filler — the sentences are data, so an expectation may read them rather than restate them. */
function fillSlots(template: string, slots: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => slots[key] ?? whole);
}
