/**
 * The encoding link kind: a source view's channel binding carried to a target,
 * outside the emission kinds — never a default edge, always written out with
 * its channel pairs, refused with a sentence when an end has no surface.
 */
import { describe, expect, it } from 'vitest';
import { ENCODING_KIND, LINK_KINDS, defaultChannelPairs, edgeId, materializeLinks, applyLinkOverrides, responsesFor, validateLinks, voiceOf } from './index.js';
import type { LinkView } from './index.js';

const views: LinkView[] = [
  { viewId: 'weeks', voice: ['point', 'interval', 'match', ENCODING_KIND], channels: ['x', 'y', 'color'] },
  { viewId: 'trend', voice: ['point', 'interval', 'match', ENCODING_KIND], channels: ['x', 'y', 'color', 'facet'] },
  { viewId: 'map', voice: ['point', 'match'] },
  { viewId: 'mute', voice: [ENCODING_KIND], channels: ['category'] },
];

describe('the vocabulary', () => {
  it('encoding sits outside the emission kinds; its responses are follow or none', () => {
    expect(LINK_KINDS).toEqual(['point', 'interval', 'cell', 'match', 'encoding']);
    expect(responsesFor('encoding')).toEqual(['follow', 'none']);
    expect(responsesFor('point')).toEqual(['filter', 'highlight', 'navigate', 'mirror', 'none']);
    expect(edgeId('weeks', 'encoding', 'trend')).toBe('weeks:encoding→trend');
  });
  it('a view gets the encoding voice from its surface, even when nobody can brush it; the selection kinds are untouched', () => {
    expect(voiceOf(undefined, { hasEncodingSurface: true })).toEqual(['point', 'interval', 'cell', 'match', 'encoding']);
    expect(voiceOf({ canProbe: false }, { hasEncodingSurface: true })).toEqual(['encoding']);
    expect(voiceOf({ canProbe: false })).toEqual([]);
    expect(voiceOf({ canProbe: true, encodings: ['point'] }, { hasEncodingSurface: true })).toEqual(['point', 'match', 'encoding']);
  });
  it('default channel pairs are the channels both ends declare, by name', () => {
    expect(defaultChannelPairs(views[0], views[1])).toEqual([{ from: 'x', to: 'x' }, { from: 'y', to: 'y' }, { from: 'color', to: 'color' }]);
    expect(defaultChannelPairs(views[0], views[2])).toEqual([]);
    expect(defaultChannelPairs(undefined, views[1])).toEqual([]);
  });
});

describe('materialization', () => {
  it('writes NO default encoding edge (absent is a silence), and writes a declared one out with its pairs', () => {
    const g = materializeLinks(views);
    expect(g.edges.some((e) => e.kind === 'encoding')).toBe(false);
    // the emission edges are unchanged by the new voice entry: weeks(3 kinds) + trend(3) + map(2) → each to 3 others
    expect(g.edges).toHaveLength((3 + 3 + 2) * 3);
    const declared = materializeLinks(views, [{ source: 'weeks', kind: 'encoding', target: 'trend', response: 'follow' }]);
    const e = declared.edges.find((x) => x.id === 'weeks:encoding→trend')!;
    expect(e).toMatchObject({ origin: 'declared', response: 'follow', channels: [{ from: 'x', to: 'x' }, { from: 'y', to: 'y' }, { from: 'color', to: 'color' }] });
    // stated pairs are kept as stated
    const stated = materializeLinks(views, [{ source: 'weeks', kind: 'encoding', target: 'trend', response: 'follow', channels: [{ from: 'color', to: 'facet' }] }]);
    expect(stated.edges.find((x) => x.kind === 'encoding')!.channels).toEqual([{ from: 'color', to: 'facet' }]);
  });
  it('an edited encoding edge is written out too', () => {
    const g = materializeLinks(views);
    const edited = applyLinkOverrides(g, new Map([['weeks:encoding→trend', { source: 'weeks', kind: 'encoding', target: 'trend', response: 'follow' }]]));
    expect(edited.edges.find((x) => x.id === 'weeks:encoding→trend')).toMatchObject({ origin: 'edited', channels: [{ from: 'x', to: 'x' }, { from: 'y', to: 'y' }, { from: 'color', to: 'color' }] });
  });
});

describe('refusals', () => {
  const run = (links: unknown) => {
    const problems: string[] = [];
    validateLinks(links, undefined, views, problems);
    return problems;
  };
  it('a lawful encoding edge passes, with or without stated pairs', () => {
    expect(run([{ source: 'weeks', kind: 'encoding', target: 'trend', response: 'follow' }])).toEqual([]);
    expect(run([{ source: 'mute', kind: 'encoding', target: 'trend', response: 'none', channels: [{ from: 'category', to: 'facet' }] }])).toEqual([]);
  });
  it('names every way an encoding edge can be wrong', () => {
    expect(run([{ source: 'map', kind: 'encoding', target: 'trend', response: 'follow' }])).toEqual(['links[0]: view "map" declares no encoding surface — it has no binding to follow']);
    expect(run([{ source: 'weeks', kind: 'encoding', target: 'map', response: 'follow' }])).toEqual(['links[0]: view "map" declares no encoding surface — nothing to follow into']);
    expect(run([{ source: 'weeks', kind: 'encoding', target: 'trend', response: 'filter' }])).toEqual(["links[0].response: an encoding edge's response must be one of follow|none"]);
    expect(run([{ source: 'weeks', kind: 'encoding', target: 'trend', response: 'follow', channels: [{ from: 'color', to: 'size' }, { from: 'shape', to: 'x' }, 'x'] }])).toEqual([
      'links[0].channels, if present, must be an array of { from, to } channel names',
    ]);
    expect(run([{ source: 'weeks', kind: 'encoding', target: 'trend', response: 'follow', channels: [{ from: 'color', to: 'size' }, { from: 'shape', to: 'x' }] }])).toEqual([
      'links[0].channels[0]: view "trend" has no "size" channel — valid: x, y, color, facet',
      'links[0].channels[1]: view "weeks" has no "shape" channel — valid: x, y, color',
    ]);
    expect(run([{ source: 'weeks', kind: 'encoding', target: 'trend', response: 'follow', onClear: 'leave', fold: 'sum' }])).toEqual([
      'links[0].onClear does not apply to an encoding edge — a binding is never cleared',
      'links[0].fold does not apply to an encoding edge — a binding has no grain',
    ]);
    expect(run([{ source: 'weeks', kind: 'point', target: 'trend', response: 'filter', channels: [{ from: 'x', to: 'x' }] }])).toEqual(['links[0].channels applies to an encoding edge only']);
    expect(run([{ source: 'weeks', kind: 'point', target: 'trend', response: 'follow' }])).toEqual(['links[0].response must be one of filter|highlight|navigate|mirror|none']);
    expect(run([{ source: 'weeks', kind: 'binding', target: 'trend', response: 'filter' }])).toEqual(['links[0].kind must be one of point|interval|cell|match|encoding']);
    // channel pairs on an edge whose ends are not even named: the end sentences fire, the pairs are not judged against nothing
    expect(run([{ source: '', kind: 'encoding', target: 'ghost', response: 'follow', channels: [{ from: 'x', to: 'x' }] }])).toEqual([
      'links[0].source must be a declared view id',
      'links[0].target "ghost" is not a declared view',
    ]);
    expect(run([{ source: 'weeks', kind: 'encoding', target: '', response: 'follow', channels: [{ from: 'x', to: 'x' }] }])).toEqual(['links[0].target must be a declared view id']);
    // an emission-kind refusal never lists the encoding voice as something the view "emits"
    expect(run([{ source: 'mute', kind: 'point', target: 'trend', response: 'filter' }])).toEqual(['links[0]: view "mute" does not emit point — its voice is silent (canProbe: false)']);
    // one edge per (source, kind, target) still holds across kinds
    expect(run([{ source: 'weeks', kind: 'encoding', target: 'trend', response: 'follow' }, { source: 'weeks', kind: 'encoding', target: 'trend', response: 'none' }])).toEqual([
      'links[1] repeats the edge weeks:encoding→trend — one edge per (source, kind, target)',
    ]);
  });
});
