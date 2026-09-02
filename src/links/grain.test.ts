/**
 * GRAIN — an edge that crosses grains must state its fold; a default edge that
 * crosses carries the rule's own fold; unknown grains are never judged.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_FOLD, crossesGrain, grainWords, materializeLinks, sameGrain, validateLinks } from './index.js';
import type { LinkView } from './index.js';

const views: LinkView[] = [
  { viewId: 'bars', voice: ['point'], grain: ['category'] }, // one bar per category
  { viewId: 'rows', voice: ['point'], grain: [] }, // one mark per row
  { viewId: 'cells', voice: ['point'], grain: ['category', 'region'] },
  { viewId: 'other', voice: ['point'], grain: ['category'] }, // the same grain as bars
  { viewId: 'unknown', voice: ['point'] }, // no grain declared
];

describe('crossesGrain — the rule itself', () => {
  it('an aggregate reaching another grain crosses; rows reaching anything, the same grain, or an unknown grain never do', () => {
    const v = (id: string) => views.find((x) => x.viewId === id);
    expect(crossesGrain(v('bars'), v('rows'))).toBe(true);
    expect(crossesGrain(v('bars'), v('cells'))).toBe(true);
    expect(crossesGrain(v('rows'), v('bars'))).toBe(false); // a row's field names the target's rows directly
    expect(crossesGrain(v('bars'), v('other'))).toBe(false);
    expect(crossesGrain(v('bars'), v('unknown'))).toBe(false);
    expect(crossesGrain(v('unknown'), v('rows'))).toBe(false);
    expect(crossesGrain(undefined, v('rows'))).toBe(false);
    expect(sameGrain(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameGrain(['a'], ['a', 'b'])).toBe(false);
    expect(grainWords([])).toBe('rows');
    expect(grainWords(['category', 'region'])).toBe('category × region');
  });
});

describe('validateLinks — the fold refusal', () => {
  it('refuses a crossing edge without a fold, in one sentence; accepts it with a fold, the same grain, rows as the source, or an unknown grain', () => {
    const at = (link: object): string[] => {
      const problems: string[] = [];
      validateLinks([link], undefined, views, problems);
      return problems;
    };
    expect(at({ source: 'bars', kind: 'point', target: 'rows', response: 'filter' })).toEqual(['links[0]: view "bars" emits over category and view "rows" shows rows — an edge that crosses grains must state its fold']);
    expect(at({ source: 'bars', kind: 'point', target: 'cells', response: 'highlight' })).toEqual(['links[0]: view "bars" emits over category and view "cells" shows category × region — an edge that crosses grains must state its fold']);
    expect(at({ source: 'bars', kind: 'point', target: 'rows', response: 'filter', fold: 'every row of the picked category' })).toEqual([]);
    expect(at({ source: 'bars', kind: 'point', target: 'other', response: 'filter' })).toEqual([]);
    expect(at({ source: 'rows', kind: 'point', target: 'bars', response: 'filter' })).toEqual([]);
    expect(at({ source: 'bars', kind: 'point', target: 'unknown', response: 'filter' })).toEqual([]);
    expect(at({ source: 'unknown', kind: 'point', target: 'rows', response: 'filter' })).toEqual([]);
    expect(at({ source: 'bars', kind: 'point', target: 'rows', response: 'none' })).toEqual([]); // nothing crosses on a none edge
    expect(at({ source: 'bars', kind: 'point', target: 'rows', response: 'navigate' })).toEqual([]); // a viewport moves, no rows fold
    expect(at({ source: 'bars', kind: 'point', target: 'rows', response: 'mirror' })).toEqual([]); // a value is outlined, no rows fold
    expect(at({ source: 'bars', kind: 'point', target: 'rows', response: 'highlight' })).toHaveLength(1);
    expect(sameGrain(['a', 'a'], ['a', 'b'])).toBe(false); // set equality, not length
  });
});

describe('materializeLinks — the rule written out states its fold where it crosses', () => {
  it('a default edge from an aggregate to another grain carries `crossfilter`; the others carry none', () => {
    const g = materializeLinks(views);
    const fold = (source: string, target: string) => g.edges.find((e) => e.source === source && e.target === target)?.fold;
    expect(fold('bars', 'rows')).toBe(DEFAULT_FOLD);
    expect(fold('bars', 'cells')).toBe('crossfilter');
    expect(fold('bars', 'other')).toBeUndefined();
    expect(fold('rows', 'bars')).toBeUndefined();
    expect(fold('bars', 'unknown')).toBeUndefined();
    expect(g.views.find((v) => v.viewId === 'cells')?.grain).toEqual(['category', 'region']);
  });
});
