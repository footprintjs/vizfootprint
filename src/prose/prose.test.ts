import { describe, expect, it } from 'vitest';
import { AUTHOR_KINDS, CLAIM_LEVELS, PROSE_SLOTS, constructionLine, fillProse, proseRefuses, proseStatus, validateProseDecls, validateProseRecord } from './index.js';
import type { ProseRecord } from './index.js';

const human: ProseRecord = { text: 'Cases by state', author: { kind: 'human', by: 'sanjay' } };
const agent: ProseRecord = { text: 'Oklahoma reports 502 cases.', author: { kind: 'agent', model: 'm' }, levels: ['statistic'], basis: { columns: ['jurisdiction', 'cases'], encodings: { region: 'jurisdiction' } } };

describe('the vocabulary', () => {
  it('names the slots, the levels and the author kinds', () => {
    expect(PROSE_SLOTS).toEqual(['title', 'caption', 'altShort', 'altLong', 'howToRead']);
    expect(CLAIM_LEVELS).toEqual(['construction', 'statistic', 'trend', 'causal']);
    expect(AUTHOR_KINDS).toEqual(['human', 'agent', 'derived', 'humanEdited']);
  });
});

describe('validateProseRecord', () => {
  const run = (slot: string, raw: unknown, world?: Parameters<typeof validateProseRecord>[3]) => validateProseRecord('map', slot, raw, world).map((p) => p.sentence);
  it('accepts a lawful human, agent and derived record', () => {
    expect(run('title', human)).toEqual([]);
    expect(run('caption', agent, { columns: new Set(['jurisdiction', 'cases']) })).toEqual([]);
    expect(run('howToRead', { author: { kind: 'derived' } })).toEqual([]);
    expect(run('altShort', { text: '', role: 'decorative', author: { kind: 'human' } })).toEqual([]);
  });
  it('names every shape problem', () => {
    expect(run('caption', 'just words')).toEqual(['prose for "map".caption must be a record { text, author, levels?, basis?, role? }, never a bare string']);
    expect(run('poem', human)).toEqual(['"poem" is not a prose slot — the slots are title, caption, altShort, altLong, howToRead']);
    expect(run('title', { text: 'x', author: { kind: 'ghost' } })).toEqual(['"map".title.author must be a record whose kind is one of human, agent, derived, humanEdited']);
    expect(run('title', { text: 'x', author: { kind: 'human', by: 1 } })).toEqual(['"map".title.author.by must be a string']);
    expect(run('title', { author: { kind: 'human' } })).toEqual(['"map".title needs text — only a derived slot leaves the words to the library']);
    expect(run('title', { text: 5, author: { kind: 'human' } })).toEqual(['"map".title.text must be a string']);
    expect(run('title', { text: 'x', author: { kind: 'derived' } })).toEqual(['"map".title is derived — the library writes the construction line; leave text out']);
    expect(run('title', { text: 'x', author: { kind: 'human' }, levels: ['vibes'] })).toEqual(['"map".title.levels must be a list of construction, statistic, trend, causal']);
    expect(run('title', { text: 'x', author: { kind: 'human' }, role: 'loud' })).toEqual(['"map".title.role must be informative or decorative']);
    expect(run('title', { text: 'x', author: { kind: 'human' }, basis: 'yes' })).toEqual(['"map".title.basis must be a record { encodings?, filters?, columns?, analysisId?, atCommit? }']);
    expect(run('title', { text: 'x', author: { kind: 'human' }, basis: { columns: 'cases' } })).toEqual(['"map".title.basis.columns must be a list of column names']);
  });
  it('the laws: an agent states a basis, never a cause; a basis names only what exists; ignorance never refuses', () => {
    expect(run('caption', { text: 'x', author: { kind: 'agent' } })).toEqual(['"map".caption was written by an agent and states no basis — without one, a model\'s words are indistinguishable from stated fact']);
    expect(run('caption', { ...agent, levels: ['trend', 'causal'] })).toEqual(['"map".caption claims a cause, which the data cannot carry — an agent may state construction, statistics, and trends, never why']);
    expect(run('caption', { ...human, levels: ['causal'] })).toEqual([]); // a person may say why
    expect(run('caption', agent, { columns: new Set(['cases']) })).toEqual(['"map".caption names a column that is not on this branch: "jurisdiction"']);
    expect(run('caption', { ...agent, basis: { ...agent.basis, analysisId: 'ghost' } }, { analyses: new Set(['corr']) })).toEqual(['"map".caption quotes an analysis that is not declared: "ghost"']);
    expect(run('caption', agent)).toEqual([]); // no world = nothing to judge against
    expect(proseRefuses(validateProseRecord('map', 'caption', agent))).toBe(false);
    expect(proseRefuses(validateProseRecord('map', 'caption', 'x'))).toBe(true);
  });
});

describe('validateProseDecls (the def door)', () => {
  it('judges the list: shape, declared views, one entry per view, every slot', () => {
    const problems: string[] = [];
    validateProseDecls('x', new Set(['map']), problems);
    validateProseDecls([1, { viewId: 'ghost', slots: { title: human } }, { viewId: 'map', slots: { title: human, poem: human } }, { viewId: 'map', slots: {} }], new Set(['map']), problems);
    expect(problems).toEqual([
      'prose, if present, must be an array of { viewId, slots }',
      'prose[0] must be { viewId, slots: { title?, caption?, altShort?, altLong?, howToRead? } }',
      'prose[1].viewId "ghost" is not a declared view',
      'prose[2].poem: "poem" is not a prose slot — the slots are title, caption, altShort, altLong, howToRead',
      'prose[3] repeats view "map" — one prose entry per view',
    ]);
    const none: string[] = [];
    validateProseDecls(undefined, new Set(), none);
    validateProseDecls([{ viewId: 'map', slots: { title: human } }], new Set(['map']), none);
    expect(none).toEqual([]);
  });
});

describe('proseStatus', () => {
  const now = { encodings: { region: 'jurisdiction' }, filters: {}, columns: new Set(['jurisdiction', 'cases']), analyses: new Set(['corr']), surface: { viewId: 'map', chartKind: 'map', channels: ['region', 'color'] } };
  it('current when the basis matches; stale naming what moved; derived recomputed and never stale', () => {
    expect(proseStatus('caption', agent, now)).toMatchObject({ status: 'current', changed: [], text: 'Oklahoma reports 502 cases.' });
    const moved = proseStatus('caption', { ...agent, basis: { ...agent.basis, filters: { map: ['Texas'] }, analysisId: 'corr' } }, { ...now, encodings: { region: 'kind' }, columns: new Set(['cases']), analyses: new Set() });
    expect(moved.status).toBe('stale');
    expect(moved.changed).toEqual(['encodings', 'filters', 'columns', 'analysis']);
    const derived = proseStatus('howToRead', { author: { kind: 'derived' } }, now);
    expect(derived).toMatchObject({ status: 'derived', changed: [], text: 'a map with jurisdiction on region' });
    // no basis at all: a human sentence is simply current
    expect(proseStatus('title', human, now).status).toBe('current');
  });
  it('the construction line reads the surface and the bindings', () => {
    expect(constructionLine({ viewId: 'l', chartKind: 'line', channels: ['x', 'y', 'color'] }, { x: 't', y: 'cases' })).toBe('a line with t on x, cases on y');
    expect(constructionLine({ viewId: 'l', chartKind: 'line', channels: ['x'] }, {})).toBe('a line with nothing bound');
    expect(constructionLine(undefined, {})).toBe('');
  });
});

describe('the edges the gate names', () => {
  it('a template slot nobody fills stays visible; a record without text renders empty; a decorative slot needs no text', () => {
    expect(fillProse('{a} and {b}', { a: 'x' })).toBe('x and {b}');
    expect(proseStatus('title', { author: { kind: 'human' } }, { encodings: {}, filters: {}, columns: new Set(), analyses: new Set() }).text).toBe('');
    expect(validateProseRecord('map', 'altShort', { author: { kind: 'human' }, role: 'decorative' })).toEqual([]);
    expect(validateProseRecord('map', 'altShort', { author: { kind: 'derived' }, role: 'decorative' })).toEqual([]);
    expect(validateProseRecord('map', 'title', { text: 'no author at all' }).map((p) => p.rule)).toEqual(['author']);
  });
});

describe('the review\'s laws', () => {
  it('key order never makes a matching basis stale; a stated filter set means exactly those selections', () => {
    const now = { encodings: { x: 't', y: 'cases' }, filters: { kinds: { kind: 'point', field: 'kind', value: 'state' } }, columns: new Set(['t', 'cases']), analyses: new Set<string>() };
    const rec = { text: 'x', author: { kind: 'human' as const }, basis: { encodings: { y: 'cases', x: 't' }, filters: { kinds: { value: 'state', field: 'kind', kind: 'point' } } } };
    expect(proseStatus('caption', rec, now).status).toBe('current');
    expect(proseStatus('caption', rec, { ...now, filters: { ...now.filters, map: { kind: 'point', field: 'jurisdiction', value: 'Texas' } } }).changed).toEqual(['filters']);
    // no `filters` in the basis: the words do not depend on selections
    expect(proseStatus('caption', { ...rec, basis: { encodings: rec.basis.encodings } }, { ...now, filters: {} }).status).toBe('current');
  });
  it('a derived slot needs a surface to derive from; the law is judged only when the world names the surfaced views', () => {
    expect(validateProseRecord('map', 'howToRead', { author: { kind: 'derived' } }, { surfaced: new Set(['weeks']) }).map((p) => p.sentence)).toEqual(['"map".howToRead is derived, but "map" declares no encoding surface — there is nothing to derive from']);
    expect(validateProseRecord('weeks', 'howToRead', { author: { kind: 'derived' } }, { surfaced: new Set(['weeks']) })).toEqual([]);
    expect(validateProseRecord('map', 'howToRead', { author: { kind: 'derived' } })).toEqual([]);
  });
});

describe('refs — spans that point at a saved interaction', () => {
  const rec = (refs: unknown, text = 'Oklahoma leads; Texas follows.') => ({ text, author: { kind: 'human' as const }, refs });
  it('a lawful ref passes; shape, span, target and existence are each named', () => {
    expect(validateProseRecord('map', 'caption', rec([{ span: [0, 14], commit: 'c1' }, { span: [16, 29], beat: 'week 1', label: 'the beat' }]), { commits: new Set(['c1']), beats: new Set(['week 1']) })).toEqual([]);
    const say = (refs: unknown, world?: Parameters<typeof validateProseRecord>[3]) => validateProseRecord('map', 'caption', rec(refs), world).map((p) => p.sentence);
    expect(say('x')).toEqual(['"map".caption.refs must be a list of { span: [start, end], commit? | beat?, label? }']);
    expect(say([{ span: [1], commit: 'c1' }])).toEqual(['"map".caption.refs must be a list of { span: [start, end], commit? | beat?, label? }']);
    expect(say([{ span: [0, 5], commit: 'c1', label: 3 }])).toEqual(['"map".caption.refs must be a list of { span: [start, end], commit? | beat?, label? }']);
    expect(say([{ span: [10, 99], commit: 'c1' }])).toEqual(['"map".caption.refs[0] spans [10, 99) but the text has 30 characters']);
    expect(say([{ span: [5, 5], commit: 'c1' }])).toEqual(['"map".caption.refs[0] spans [5, 5) but the text has 30 characters']);
    expect(say([{ span: [0, 5] }])).toEqual(['"map".caption.refs[0] must name exactly one of commit, beat']);
    expect(say([{ span: [0, 5], commit: 'c1', beat: 'b' }])).toEqual(['"map".caption.refs[0] must name exactly one of commit, beat']);
    expect(say([{ span: [0, 5], commit: 'ghost' }], { commits: new Set(['c1']) })).toEqual(['"map".caption.refs[0] points at a commit the log does not hold: "ghost"']);
    expect(say([{ span: [0, 5], beat: 'ghost' }], { beats: new Set() })).toEqual(['"map".caption.refs[0] points at a beat that was never named: "ghost"']);
    // no world = nothing to judge existence against
    expect(say([{ span: [0, 5], commit: 'ghost' }])).toEqual([]);
    // a ref on words that do not exist yet has nothing to span
    expect(validateProseRecord('map', 'caption', { author: { kind: 'human' }, role: 'decorative', refs: [{ span: [0, 1], commit: 'c1' }] }).map((p) => p.sentence)).toEqual(['"map".caption.refs[0] spans [0, 1) but the text has 0 characters']);
    // the status carries the refs; a derived slot has none
    expect(proseStatus('caption', rec([{ span: [0, 5], commit: 'c1' }]) as never, { encodings: {}, filters: {}, columns: new Set(), analyses: new Set<string>() }).refs).toEqual([{ span: [0, 5], commit: 'c1' }]);
  });
});

describe('the model\'s permission follows the kind of claim', () => {
  it('an agent may state a statistic, must propose a trend, and the def door (no mode) does not refuse declared words', () => {
    const trend = { text: 'Cases are rising.', author: { kind: 'agent' as const }, levels: ['trend' as const], basis: { columns: [] } };
    expect(validateProseRecord('m', 'caption', trend, { mode: 'set' }).map((p) => p.rule)).toEqual(['agent-trend']);
    expect(validateProseRecord('m', 'caption', trend, { mode: 'proposal' })).toEqual([]);
    expect(validateProseRecord('m', 'caption', trend)).toEqual([]);
    expect(validateProseRecord('m', 'caption', { ...trend, levels: ['statistic'] }, { mode: 'set' })).toEqual([]);
  });
});
