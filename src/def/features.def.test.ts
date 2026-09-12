/**
 * `defFeatures` — the feature card of a BUILT dashboard, and the two laws it
 * follows: every field is a projection of something the build already holds,
 * and a default that lives in another module is reported as `null` rather than
 * restated (src/def/README.md, "The card a demo cannot get wrong").
 *
 * The two defs below are the two ends of the range: RICH declares one of
 * everything, BARE declares the least a dashboard can and still build.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, buildDashboardAsync, defFeatures } from './index.js';
import type { DashboardDef, SourceAdapter } from './index.js';
import { correlationAnalysis } from '../analysis/index.js';
import { voiceOf } from '../links/index.js';

const CELLS = [
  { disease: 'A', cases: 3, state: 'present' },
  { disease: 'B', cases: 5, state: 'unknown' },
];
const NODES = [{ disease: 'A', x: 0, y: 0 }, { disease: 'B', x: 1, y: 1 }];
const EDGES = [{ source: 'A', target: 'B', source_x: 0, source_y: 0, target_x: 1, target_y: 1 }];

/** One of everything: three tables, a layered view, links, relations, both analysis forms, prose, rules, FDR. */
const RICH = (): DashboardDef => ({
  data: {
    cells: {
      source: { format: 'rows', via: 'inline', at: CELLS },
      absence: { field: 'state', states: ['present', 'unknown'] },
      columns: { disease: { role: 'dimension' }, cases: { role: 'measure' } },
    },
    nodes: { rows: NODES, key: 'disease', columns: { disease: { role: 'identifier' }, x: { role: 'measure' }, y: { role: 'measure' } } },
    edges: { rows: EDGES, columns: { source: { role: 'dimension' }, target: { role: 'dimension' } } },
  },
  actors: { bar: { actor: 'user' }, net: { actor: 'user' }, readout: { actor: 'agent' } },
  capabilities: [
    { viewId: 'net', canProbe: true, encodings: ['point', 'match', 'neighbourhood'] },
    { viewId: 'readout', canProbe: false },
  ],
  encodings: [
    { viewId: 'bar', chartKind: 'bar', channels: ['category'], initial: { category: 'disease' } },
    {
      viewId: 'net',
      chartKind: 'network',
      channels: ['x', 'y'],
      layers: [
        { layerId: 'edges', table: 'edges', chartKind: 'network', channels: ['source', 'target'], initial: { source: 'source', target: 'target' }, label: 'Co-occurrences' },
        { layerId: 'nodes', table: 'nodes', chartKind: 'network', channels: ['x', 'y', 'key'], initial: { x: 'x', y: 'y', key: 'disease' } },
      ],
    },
  ],
  grains: [{ viewId: 'bar', keys: ['disease'] }],
  // RE-PINNED (the frame is its layers, ../def/README.md "Layers" law 6a): `net` binds nothing at its own level, so it is
  // a FRAME that reads only through its layers and a declared edge naming it is refused at the door by that name. The
  // edges name the layer that reads (`net~nodes`); every card fact asserted below (counts, kinds, responses) is unchanged.
  links: [
    { source: 'bar', kind: 'point', target: 'net~nodes', response: 'highlight', onClear: 'leave', fold: 'cases of the lit diseases' },
    { source: 'net~nodes', kind: 'neighbourhood', target: 'bar', response: 'none' },
  ],
  linkDefault: 'none',
  relations: [
    { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'disease' } },
    { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'disease' }, kind: 'one-to-one', label: 'the other end' },
  ],
  analyses: {
    byDisease: { builtin: 'groupBy', by: 'disease', measure: 'cases' },
    linked: correlationAnalysis({ x: 'cases', y: 'cases' }),
  },
  prose: [{ viewId: 'bar', slots: { title: { text: 'Cases per disease', author: { kind: 'human', by: 'the author' } } } }],
  encodingRules: {
    rules: [{ rule: 'never-together', columns: ['cases', 'disease'], scope: 'view' }],
    channels: { bar: [{ channel: 'category', roles: ['dimension'] }] },
    ruleScope: 'view',
    onInvalid: 'refuse',
  },
  fdr: { procedure: 'alpha-investing', alpha: 0.1, gamma: (j) => 1 / (j + 1) },
  defaultTable: 'cells',
});

/** The least a def can declare: one table of bare rows, one view, nothing else. */
const BARE = (): DashboardDef => ({ data: { only: { rows: CELLS } }, actors: { plain: { actor: 'user' } } });

const richCard = () => defFeatures(buildDashboard(RICH()));
const bareCard = () => defFeatures(buildDashboard(BARE()));

describe('defFeatures — the three facts only a BUILD holds', () => {
  it('carries the build\'s own revision, and two defs that differ carry different ones', () => {
    const card = richCard();
    expect(card.revision).toBe(buildDashboard(RICH()).revision);
    expect(card.revision).not.toBe(bareCard().revision);
  });

  it('reports the engine a table ROUTED to, never the one it declared', () => {
    // `auto` is a question at declaration; the card answers it
    const def: DashboardDef = { ...BARE(), data: { only: { rows: CELLS, engine: 'auto' } } };
    expect(defFeatures(buildDashboard(def)).tables).toEqual([{ table: 'only', engine: 'memory' }]);
  });

  it('lists ONE vocabulary PER STATE COLUMN — a table may declare one per measured quantity', () => {
    // silence belongs to a column: a row lists what each state column speaks, in declaration order
    const def: DashboardDef = {
      ...BARE(),
      data: {
        only: {
          rows: [{ pl_rade: 1, radius_state: 'present', pl_masse: 1, mass_state: 'present' }],
          columns: { pl_rade: { role: 'measure' }, pl_masse: { role: 'measure' } },
          absence: [
            { field: 'radius_state', states: ['present', 'upper-bound', 'unknown'], governs: ['pl_rade'] },
            { field: 'mass_state', states: ['present', 'unknown'], governs: ['pl_masse'] },
          ],
        },
      },
    };
    expect(defFeatures(buildDashboard(def)).tables).toEqual([
      { table: 'only', engine: 'memory', absence: [['present', 'upper-bound', 'unknown'], ['present', 'unknown']] },
    ]);
  });

  it('a table with a source carries what the source vouched for; a bare `rows` table carries none', () => {
    const card = richCard();
    expect(card.tables).toEqual([
      { table: 'cells', engine: 'memory', source: { format: 'rows', via: 'inline' }, absence: [['present', 'unknown']] },
      { table: 'nodes', engine: 'memory', key: 'disease' },
      { table: 'edges', engine: 'memory' },
    ]);
  });

  it('a LOCATOR is carried when the source has one — an inline payload is never repeated', async () => {
    const http: SourceAdapter = {
      via: 'http',
      open: async () => ({
        capabilities: { live: false, pushdown: false },
        snapshot: async () => ({ rows: CELLS, version: 'v1', retrievedAt: '2026-01-01T00:00:00.000Z' }),
        close: async () => {},
      }),
    };
    const def: DashboardDef = { ...BARE(), data: { only: { source: { format: 'json', via: 'http', at: 'https://example.test/rows' } } } };
    const card = defFeatures(await buildDashboardAsync(def, { sources: [http] }));
    expect(card.tables).toEqual([{ table: 'only', engine: 'memory', source: { format: 'json', via: 'http', at: 'https://example.test/rows' } }]);
  });
});

describe('defFeatures — the views, and the VOICE the link graph reads', () => {
  it('projects each view\'s id, actor, chart kind, channels, layers and grain', () => {
    const views = richCard().views;
    expect(views.map((v) => v.viewId)).toEqual(['bar', 'net', 'readout']);
    expect(views[0]).toEqual({ viewId: 'bar', actor: 'user', chartKind: 'bar', channels: ['category'], grain: ['disease'], voice: voiceOf(undefined, { hasEncodingSurface: true }) });
    expect(views[1]!.layers).toEqual([
      { layerId: 'edges', table: 'edges', chartKind: 'network', channels: ['source', 'target'] },
      { layerId: 'nodes', table: 'nodes', chartKind: 'network', channels: ['x', 'y', 'key'] },
    ]);
    // a view with no encoding, no grain and no layers carries none of those keys
    expect(views[2]).toEqual({ viewId: 'readout', actor: 'agent', voice: [] });
  });

  it('the voice is `voiceOf`\'s answer and nobody else\'s — a declared walk, an assumed set, a mute view', () => {
    const views = richCard().views;
    expect(views.find((v) => v.viewId === 'net')!.voice).toEqual(voiceOf({ canProbe: true, encodings: ['point', 'match', 'neighbourhood'] }, { hasEncodingSurface: true }));
    // `readout` declares canProbe: false — it emits nothing, and has no encoding surface to lend it the encoding kind
    expect(views.find((v) => v.viewId === 'readout')!.voice).toEqual([]);
    // a view that declares no capability at all is ASSUMED every kind but the walk
    expect(bareCard().views).toEqual([{ viewId: 'plain', actor: 'user', voice: voiceOf(undefined) }]);
  });

  it('the chart kinds and channels are drawn from the frames AND their layers', () => {
    const card = richCard();
    expect(card.chartKinds).toEqual(['bar', 'network']);
    expect(card.channels).toEqual(['category', 'key', 'source', 'target', 'x', 'y']);
    // a def with no encoding surface anywhere draws with nothing
    expect(bareCard().chartKinds).toEqual([]);
    expect(bareCard().channels).toEqual([]);
  });

  it('the selection kinds are the union of the voices, in the library\'s own kind order, and never the encoding kind', () => {
    expect(richCard().selectionKinds).toEqual(['point', 'interval', 'cell', 'match', 'neighbourhood']);
    // BARE's one view is assumed every kind but the walk
    expect(bareCard().selectionKinds).toEqual(['point', 'interval', 'cell', 'match']);
    // a def whose every view is mute emits nothing
    const mute: DashboardDef = { ...BARE(), capabilities: [{ viewId: 'plain', canProbe: false }] };
    expect(defFeatures(buildDashboard(mute)).selectionKinds).toEqual([]);
  });
});

describe('defFeatures — links, relations, analyses, rules, FDR', () => {
  it('the link plane reports what the def DECLARED, and `null` for the rule it did not', () => {
    expect(richCard().links).toEqual({
      linkDefault: 'none',
      declared: 2,
      kinds: ['neighbourhood', 'point'],
      responses: ['highlight', 'none'],
      onClear: ['leave'],
      statesFold: true,
    });
    // law 2: an undeclared default is `null`, never the fallback `buildDashboard` applies
    expect(bareCard().links).toEqual({ linkDefault: null, declared: 0, kinds: [], responses: [], onClear: [], statesFold: false });
  });

  it('a relation carries the kind the build resolved — the declared one, or the default nobody spelled out', () => {
    expect(richCard().relations).toEqual([
      { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'disease' }, kind: 'many-to-one' },
      { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'disease' }, kind: 'one-to-one' },
    ]);
    expect(bareCard().relations).toEqual([]);
  });

  it('an analysis carries the kind the registry gave it, and the builtin only when it IS one', () => {
    expect(richCard().analyses).toEqual([
      { id: 'byDisease', kind: 'transform', builtin: 'groupBy' },
      { id: 'linked', kind: 'test' },
    ]);
    expect(bareCard().analyses).toEqual([]);
  });

  it('the prose subjects are the views the def writes words for', () => {
    expect(richCard().proseSubjects).toEqual(['bar']);
    expect(bareCard().proseSubjects).toEqual([]);
  });

  it('the encoding rule set is counted, its kinds named, and its unstated halves left `null`', () => {
    expect(richCard().encodingRules).toEqual({ rules: 1, kinds: ['never-together'], chartKinds: ['bar'], ruleScope: 'view', onInvalid: 'refuse' });
    expect(bareCard().encodingRules).toEqual({ rules: 0, kinds: [], chartKinds: [], ruleScope: null, onInvalid: null });
    // a rule set that states only its rules leaves the policy halves unstated
    const partial: DashboardDef = { ...BARE(), encodingRules: { rules: [{ rule: 'never-on', column: 'cases', channels: ['color'] }] } };
    expect(defFeatures(buildDashboard(partial)).encodingRules).toEqual({ rules: 1, kinds: ['never-on'], chartKinds: [], ruleScope: null, onInvalid: null });
  });

  it('the FDR settings are the declared ones, and `null` when the def declared none', () => {
    expect(richCard().fdr).toEqual({ procedure: 'alpha-investing', alpha: 0.1, statesGamma: true });
    expect(bareCard().fdr).toBeNull();
    const noGamma: DashboardDef = { ...BARE(), fdr: { procedure: 'LORD++', alpha: 0.05 } };
    expect(defFeatures(buildDashboard(noGamma)).fdr).toEqual({ procedure: 'LORD++', alpha: 0.05, statesGamma: false });
  });
});
