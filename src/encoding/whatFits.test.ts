import { describe, expect, it } from 'vitest';
import { WHAT_FITS_VIEW_ID, acceptsOf, channelsOf, whatFits } from './index.js';
import type { FitColumn } from './index.js';

/** An NNDSS-shaped table as a wizard holds it: what was sniffed, plus what was declared. */
const COLUMNS: FitColumn[] = [
  { name: 'jurisdiction', type: 'string', role: 'identifier' },
  { name: 'case_id', type: 'number', role: 'identifier' },
  { name: 'disease', type: 'string', role: 'dimension' },
  { name: 'cases', type: 'number', role: 'measure' },
  { name: 'ytd', type: 'number', role: 'measure', label: 'year to date' },
  { name: 't', type: 'date' },
  { name: 'report_state', type: 'string' },
  { name: 'mystery' }, // described but never typed — no evidence, so no refusal
];
const ABSENCE = { field: 'report_state', states: ['present', 'unavailable', 'unknown'] };

describe('whatFits — what fits, before a build', () => {
  it('answers per channel: what fits, and the sentence for everything that does not', () => {
    const fits = whatFits({ columns: COLUMNS, absence: ABSENCE, chartKind: 'line', channels: ['x', 'y', 'color'] });
    expect(Object.keys(fits)).toEqual(['x', 'y', 'color']);
    expect(acceptsOf(fits)).toEqual({
      // a line's x takes a category (the frame draws a band line) — `disease` fits; the identifier and the absence column still do not
      x: ['disease', 'cases', 'ytd', 't', 'mystery'],
      y: ['cases', 'ytd', 'mystery'],
      color: ['jurisdiction', 'disease', 'report_state', 'mystery'],
    });
    const y = fits['y']!;
    expect(y.find((f) => f.field === 't')!.because).toBe('"t" is date; the y channel of a line needs a number');
    expect(y.find((f) => f.field === 'jurisdiction')!.because).toBe('"jurisdiction" is string; the y channel of a line needs a number');
    // a number that is an IDENTIFIER: the type passes, the declared role refuses
    expect(y.find((f) => f.field === 'case_id')!.because).toBe('"case_id" is identifier — it cannot be the y of a line');
    // the built-in law: the declared absence column is never a magnitude
    expect(y.find((f) => f.field === 'report_state')!.because).toContain('absence is a category, never a magnitude');
  });

  it('a column with no declared type is refused by nothing — evidence, never ignorance', () => {
    const fits = whatFits({ columns: [{ name: 'mystery' }], chartKind: 'bar', channels: ['x', 'y'] });
    expect(acceptsOf(fits)).toEqual({ x: ['mystery'], y: ['mystery'] });
  });

  it('with no absence declared, the absence column is an ordinary string column', () => {
    const fits = whatFits({ columns: COLUMNS, chartKind: 'line', channels: ['y'] });
    expect(fits['y']!.find((f) => f.field === 'report_state')!.because).toBe('"report_state" is string; the y channel of a line needs a number');
  });

  it('judges every column as the binding WOULD be — the rest of the view held still', () => {
    const rules = { rules: [{ rule: 'never-together' as const, columns: ['cases', 'ytd'] as [string, string], scope: 'view' as const }] };
    const free = whatFits({ columns: COLUMNS, chartKind: 'line', channels: ['x', 'y'], rules });
    expect(acceptsOf(free)['y']).toContain('ytd');
    const taken = whatFits({ columns: COLUMNS, chartKind: 'line', channels: ['x', 'y'], bindings: { x: 'cases' }, rules });
    expect(acceptsOf(taken)['y']).not.toContain('ytd');
    expect(taken['y']!.find((f) => f.field === 'ytd')!.because).toBe('"ytd" and "cases" never share a chart');
  });

  it('a rule whose scope is the page reads the other views\' bindings', () => {
    const rules = { rules: [{ rule: 'never-together' as const, columns: ['cases', 'ytd'] as [string, string] }], ruleScope: 'dashboard' as const };
    const fits = whatFits({ columns: COLUMNS, chartKind: 'line', channels: ['y'], rules, others: { elsewhere: { y: 'cases' } } });
    expect(fits['y']!.find((f) => f.field === 'ytd')!.because).toBe('"ytd" and "cases" never share the page');
  });

  it('takes the ports a build would pass, and names the view when asked', () => {
    const fits = whatFits({
      columns: COLUMNS,
      absence: ABSENCE,
      chartKind: 'line',
      channels: ['y'],
      viewId: 'weeks',
      ports: { recommender: { rank: (_c, ok) => [...ok].reverse() }, explainer: { explain: (p) => `${p.viewId}: ${p.sentence}` } },
    });
    expect(acceptsOf(fits)['y']).toEqual(['mystery', 'ytd', 'cases']);
    expect(fits['y']!.find((f) => f.field === 't')!.because).toBe('weeks: "t" is date; the y channel of a line needs a number');
    expect(WHAT_FITS_VIEW_ID).toBe('view');
  });
});

/**
 * The node-link kind, judged one LAYER at a time — which is the only way a
 * node-link is ever judged: the nodes and the edges are two tables, so the
 * frame's channels are never asked about both at once.
 */
describe('whatFits — a network, layer by layer', () => {
  /** The nodes table AFTER the layout act: the key it came with, and the x and y the act wrote. */
  const NODES: FitColumn[] = [
    { name: 'disease', type: 'string', role: 'identifier' },
    { name: 'node_id', type: 'number', role: 'identifier' },
    { name: 'x', type: 'number' },
    { name: 'y', type: 'number' },
    { name: 'cases', type: 'number', role: 'measure' },
  ];

  /** The edges table AFTER `bringOver`: the two endpoints it came with, and the four positions the act wrote. */
  const EDGES: FitColumn[] = [
    { name: 'source', type: 'string', role: 'dimension' },
    { name: 'target', type: 'string', role: 'dimension' },
    { name: 'source_x', type: 'number' },
    { name: 'source_y', type: 'number' },
    { name: 'target_x', type: 'number' },
    { name: 'target_y', type: 'number' },
    { name: 'weight', type: 'number', role: 'measure' },
  ];

  it('accepts a node layer: the act\'s positions on x and y, the key on a channel of its own', () => {
    expect(channelsOf('network')).toEqual(['x', 'y', 'key']);
    const fits = whatFits({ columns: NODES, chartKind: 'network', channels: channelsOf('network'), viewId: 'net~nodes' });
    expect(acceptsOf(fits)).toEqual({
      x: ['x', 'y', 'cases'],
      y: ['x', 'y', 'cases'],
      // the key takes the identifier the axes turn away, and refuses the two roles
      // that are evidence AGAINST an identity: `cases` is a declared measure
      key: ['disease', 'node_id', 'x', 'y'],
    });
  });

  it('refuses the key on a position — the sentence that says why the kind names a key channel at all', () => {
    // a network layer that names no `key`: there is nowhere for a node's identity to go, and the judge says so twice over
    const fits = whatFits({ columns: NODES, chartKind: 'network', channels: ['x', 'y'], viewId: 'net~nodes' });
    expect(Object.keys(fits)).toEqual(['x', 'y']);
    expect(fits['x']!.find((f) => f.field === 'disease')).toEqual({
      field: 'disease',
      ok: false,
      because: '"disease" is string; the x channel of a network needs a number or a date',
    });
    // a NUMERIC key passes the type and is refused by the ROLE — a network's x and y are positions like any other chart's
    expect(fits['y']!.find((f) => f.field === 'node_id')).toEqual({
      field: 'node_id',
      ok: false,
      because: '"node_id" is identifier — it cannot be the y of a network',
    });
  });

  it('refuses a measure and the silence on the key — the two roles that are evidence against an identity', () => {
    const columns: FitColumn[] = [...NODES, { name: 'report_state', type: 'string' }];
    const absence = { field: 'report_state', states: ['present', 'unavailable'] };
    const fits = whatFits({ columns, absence, chartKind: 'network', channels: ['key'], viewId: 'net~nodes' });
    expect(fits['key']!.find((f) => f.field === 'cases')).toEqual({
      field: 'cases',
      ok: false,
      because: '"cases" is measure — it cannot be the key of a network',
    });
    expect(fits['key']!.find((f) => f.field === 'report_state')!.ok).toBe(false);
    // and the identifier, which is the whole reason the channel exists, still passes
    expect(fits['key']!.find((f) => f.field === 'disease')!.ok).toBe(true);
  });

  it('holds the four endpoint positions to the magnitude law, the same as x and y', () => {
    // the declared silence is refused as a node position AND as an edge endpoint:
    // they are the same pixel, so the class that names one names the other
    const columns: FitColumn[] = [...EDGES, { name: 'report_state', type: 'number' }];
    const absence = { field: 'report_state', states: ['present', 'unavailable'] };
    const fits = whatFits({ columns, absence, chartKind: 'network', channels: ['sourceX', 'targetY'], viewId: 'net~edges' });
    for (const channel of ['sourceX', 'targetY']) {
      expect(fits[channel]!.find((f) => f.field === 'report_state')).toEqual({
        field: 'report_state',
        ok: false,
        because: `"report_state" is the declared absence column — it cannot bind to the magnitude channel "${channel}"; absence is a category, never a magnitude`,
      });
    }
    // and a def's own `class: 'magnitude'` rule reaches them too
    const ruled = whatFits({ columns: EDGES, chartKind: 'network', channels: ['sourceX'], rules: { rules: [{ rule: 'never-on', column: 'weight', class: 'magnitude' }] }, viewId: 'net~edges' });
    expect(ruled['sourceX']!.find((f) => f.field === 'weight')!.ok).toBe(false);
  });

  it('accepts an edge layer on the endpoint channels, which a nodes-only layer never binds', () => {
    const channels = ['source', 'target', 'sourceX', 'sourceY', 'targetX', 'targetY'];
    // optional, every one of them: that is why `channelsOf` above is three channels and not nine
    expect(channels.some((channel) => channelsOf('network').includes(channel))).toBe(false);
    const fits = whatFits({ columns: EDGES, chartKind: 'network', channels, viewId: 'net~edges' });
    const ends = ['source_x', 'source_y', 'target_x', 'target_y', 'weight'];
    const every = ['source', 'target', ...ends];
    expect(acceptsOf(fits)).toEqual({ source: every, target: every, sourceX: ends, sourceY: ends, targetX: ends, targetY: ends });
    expect(fits['targetY']!.find((f) => f.field === 'target')!.because).toBe('"target" is string; the targetY channel of a network needs a number or a date');
  });
});
