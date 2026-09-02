import { describe, it, expect } from 'vitest';
import { applyLinkOverrides, edgeId, edgesFrom, edgesInto, impliedKinds, linksToMermaid, materializeLinks, validateLinks, voiceOf, type LinkView } from './index.js';

const VIEWS: LinkView[] = [
  { viewId: 'map', voice: ['point', 'match'] },
  { viewId: 'weeks', voice: ['interval', 'point', 'match'] },
  { viewId: 'table', voice: ['point', 'match'] },
  { viewId: 'mute', voice: [] },
];

describe('voice — the ONE owner of "what can this view emit"', () => {
  it('nothing declared = every kind; canProbe false = silent; a declared point implies match', () => {
    expect(voiceOf(undefined)).toEqual(['point', 'interval', 'cell', 'match']);
    expect(voiceOf({ canProbe: false, encodings: ['point'] })).toEqual([]);
    expect(voiceOf({ canProbe: true })).toEqual(['point', 'interval', 'cell', 'match']);
    expect(voiceOf({ canProbe: true, encodings: ['point'] })).toEqual(['point', 'match']);
    expect(impliedKinds(['interval'])).toEqual(['interval']);
    expect(impliedKinds(['point', 'match'])).toEqual(['point', 'match']);
  });
});

describe('materialize — the default rule written out, declared edges overriding IN PLACE', () => {
  it('crossfilter: every (source, kind) reaches every OTHER view as a default filter; a silent view drives nothing', () => {
    const g = materializeLinks(VIEWS);
    expect(g.default).toBe('crossfilter');
    // map: 2 kinds × 3 others; weeks: 3 × 3; table: 2 × 3; mute: 0
    expect(g.edges).toHaveLength(2 * 3 + 3 * 3 + 2 * 3);
    expect(g.edges.every((e) => e.response === 'filter' && e.origin === 'default')).toBe(true);
    expect(g.edges.some((e) => e.source === e.target)).toBe(false);
    expect(edgesFrom(g, 'mute')).toEqual([]);
    expect(edgesInto(g, 'mute')).toHaveLength(2 + 3 + 2); // a silent view still LISTENS
  });
  it('a declared edge replaces the default edge with the same (source, kind, target), keeping its position; a new one appends', () => {
    const g = materializeLinks(VIEWS, [
      { source: 'map', kind: 'point', target: 'table', response: 'mirror', label: 'same state' },
      { source: 'table', kind: 'point', target: 'map', response: 'none' },
    ]);
    const mirror = g.edges.find((e) => e.id === edgeId('map', 'point', 'table'))!;
    expect(mirror).toMatchObject({ response: 'mirror', origin: 'declared', label: 'same state' });
    expect(g.edges.indexOf(mirror)).toBe(materializeLinks(VIEWS).edges.findIndex((e) => e.id === mirror.id)); // in place
    expect(g.edges.filter((e) => e.origin === 'declared')).toHaveLength(2);
    expect(g.edges).toHaveLength(materializeLinks(VIEWS).edges.length); // both replaced defaults — nothing appended
  });
  it('default none starts from silence: only the declared edges exist', () => {
    const g = materializeLinks(VIEWS, [{ source: 'weeks', kind: 'interval', target: 'map', response: 'navigate' }], 'none');
    expect(g.default).toBe('none');
    expect(g.edges).toEqual([{ id: 'weeks:interval→map', source: 'weeks', kind: 'interval', target: 'map', response: 'navigate', origin: 'declared' }]);
  });
});

describe('validate — refusals in sentences, at declaration', () => {
  const run = (links: unknown, linkDefault?: unknown) => {
    const problems: string[] = [];
    validateLinks(links, linkDefault, VIEWS, problems);
    return problems;
  };
  it('accepts a well-formed declaration and an absent one', () => {
    expect(run(undefined)).toEqual([]);
    expect(run([{ source: 'map', kind: 'point', target: 'table', response: 'mirror', mapping: [{ from: 'jurisdiction', to: 'state' }], onClear: 'leave', fold: 'sum', label: 'x' }], 'none')).toEqual([]);
  });
  it('names every bad shape', () => {
    expect(run('nope')).toEqual(['links, if present, must be an array of LinkDecl']);
    expect(run([], 'sometimes')).toEqual(['linkDefault, if present, must be one of crossfilter|none']);
    expect(run([42])).toEqual(['links[0] must be an object { source, kind, target, response, mapping?, channels?, onClear?, fold?, label? }']);
    const p = run([{ source: '', target: 'ghost', kind: 'blob', response: 'shout', mapping: [{ from: 'a' }], onClear: 'never', fold: '', label: 3, extra: 1 }]);
    expect(p).toEqual([
      'links[0]: unknown key "extra"',
      'links[0].source must be a declared view id',
      'links[0].target "ghost" is not a declared view',
      'links[0].kind must be one of point|interval|cell|match|encoding',
      'links[0].response must be one of filter|highlight|navigate|mirror|none',
      'links[0].mapping, if present, must be an array of { from, to } field names',
      'links[0].onClear, if present, must be one of leave|showAll|excludeAll',
      'links[0].fold, if present, must be a non-empty string',
      'links[0].label, if present, must be a string',
    ]);
  });
  it('refuses a self link, a kind outside the voice, a silent source, and a repeated edge', () => {
    expect(run([{ source: 'map', kind: 'point', target: 'map', response: 'filter' }])).toEqual(['links[0]: a view cannot link to itself (self-exclusion is the rule)']);
    expect(run([{ source: 'map', kind: 'interval', target: 'table', response: 'filter' }])).toEqual(['links[0]: view "map" does not emit interval — its voice is point, match']);
    expect(run([{ source: 'mute', kind: 'point', target: 'table', response: 'filter' }])).toEqual(['links[0]: view "mute" does not emit point — its voice is silent (canProbe: false)']);
    expect(run([{ source: 'ghost', kind: 'point', target: 'table', response: 'filter' }])).toEqual(['links[0].source "ghost" is not a declared view']);
    expect(run([{ source: 'map', kind: 'point', target: '', response: 'filter' }])).toEqual(['links[0].target must be a declared view id']);
    expect(run([
      { source: 'map', kind: 'point', target: 'table', response: 'filter' },
      { source: 'map', kind: 'point', target: 'table', response: 'none' },
    ])).toEqual(['links[1] repeats the edge map:point→table — one edge per (source, kind, target)']);
  });
});

describe('mermaid — declared === drawn', () => {
  it('draws a node per view with its voice and an edge per link, none dashed; defaults can be folded into a note', () => {
    const g = materializeLinks(VIEWS.slice(0, 2), [{ source: 'map', kind: 'point', target: 'weeks', response: 'none' }]);
    const full = linksToMermaid(g);
    expect(full.split('\n')[0]).toBe('flowchart LR');
    expect(full).toContain('map["map · point, match"]');
    expect(full).toContain('map -. "none · point" .-> weeks');
    expect(full).toContain('weeks -- "filter (default) · interval" --> map');
    const declaredOnly = linksToMermaid(g, { defaults: false });
    expect(declaredOnly).not.toContain('(default)');
    expect(declaredOnly).toContain('%% default rule: every view filters every other view, self excluded');
    const silent = linksToMermaid(materializeLinks([{ viewId: 'a b', voice: [] }], [], 'none'), { defaults: false });
    expect(silent).toContain('a_b["a b · silent"]');
    expect(silent).not.toContain('%% default rule');
  });
});

describe('applyLinkOverrides — the session\'s edits over the base graph', () => {
  it('replaces a base edge in place with origin edited, appends an edge the base never had, and leaves the graph untouched with no overrides', () => {
    const base = materializeLinks(VIEWS.slice(0, 2), [], 'none');
    expect(applyLinkOverrides(base, new Map())).toBe(base);
    const declared = materializeLinks(VIEWS.slice(0, 2));
    const id = edgeId('map', 'point', 'weeks');
    const at = declared.edges.findIndex((e) => e.id === id);
    const edited = applyLinkOverrides(declared, new Map([[id, { source: 'map', kind: 'point', target: 'weeks', response: 'highlight' }]]));
    expect(edited.edges[at]).toEqual({ id, source: 'map', kind: 'point', target: 'weeks', response: 'highlight', origin: 'edited' });
    expect(edited.edges).toHaveLength(declared.edges.length);
    const appended = applyLinkOverrides(base, new Map([[id, { source: 'map', kind: 'point', target: 'weeks', response: 'mirror' }]]));
    expect(appended.edges).toEqual([{ id, source: 'map', kind: 'point', target: 'weeks', response: 'mirror', origin: 'edited' }]);
  });
});
