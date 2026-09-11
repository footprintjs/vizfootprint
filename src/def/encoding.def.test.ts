import { describe, expect, it } from 'vitest';
import { DashboardDefError, buildDashboard, frameDomains, validateDashboardDef } from './index.js';
import type { DashboardDef, LayerDecl } from './index.js';

const rows = [
  { area: 'TX', disease: 'flu', cases: 3, ytd: 30, state: 'present', t: new Date('2026-01-04') },
  // a silent row carries NO value in its measures — a number there would contradict the absence column, and the def door refuses it
  { area: 'CA', disease: 'flu', cases: null, ytd: null, state: 'unknown', t: new Date('2026-01-11') },
];
const base: DashboardDef = {
  data: {
    cases: {
      rows,
      absence: { field: 'state', states: ['present', 'unknown'] },
      columns: { area: { role: 'identifier' }, cases: { role: 'measure' }, ytd: { role: 'measure', label: 'year to date' } },
    },
  },
  actors: { bar: { actor: 'user' }, line: { actor: 'user' } },
  encodings: [
    { viewId: 'bar', chartKind: 'bar', channels: ['category'], initial: { category: 'disease' } },
    { viewId: 'line', chartKind: 'line', channels: ['x', 'y', 'color'], initial: { x: 't', y: 'cases' } },
  ],
};

describe('the def door (build throws) for the encoding plane', () => {
  it('a lawful def builds; the runtime carries the rule set, the ports and facet resolution', () => {
    const d = buildDashboard({ ...base, encodingRules: { rules: [{ rule: 'never-together', columns: ['cases', 'ytd'], scope: 'view' }] } }, { encoding: { explainer: { explain: (p) => p.rule } } });
    expect(d.def.encodingRules?.rules).toHaveLength(1);
    expect(validateDashboardDef(base)).toEqual([]);
  });
  it('column declarations and the rule set are shape-checked with the def', () => {
    const problems = validateDashboardDef({
      ...base,
      data: { cases: { ...base.data['cases']!, columns: { state: { role: 'measure' }, cases: { scale: 'wide' } } } },
      encodingRules: { rules: [{ rule: 'only-with', column: 'a', companion: 'a' }], ruleScope: 'page' },
    } as unknown as DashboardDef);
    expect(problems).toEqual([
      'data["cases"].columns["state"].role is "measure" but "state" is the table\'s declared absence column — its role is absence',
      'data["cases"].columns["cases"].scale must be one of discrete, continuous',
      'encodingRules.ruleScope must be one of view, dashboard',
      'encodingRules.rules[0].companion is the column itself',
    ]);
  });
  it('an initial binding that breaks a declared role, a business rule, or the absence law refuses the build with the sentence', () => {
    const def: DashboardDef = {
      ...base,
      encodings: [
        { viewId: 'bar', chartKind: 'bar', channels: ['category', 'y'], initial: { category: 'disease', y: 'area' } },
        { viewId: 'line', chartKind: 'line', channels: ['x', 'y', 'color'], initial: { x: 'cases', y: 'ytd', color: 'state' } },
      ],
      encodingRules: { rules: [{ rule: 'never-together', columns: ['cases', 'ytd'], scope: 'view', sentence: '{column} and {other} never share a chart' }, { rule: 'never-on', column: 'state', channels: ['color'] }] },
    };
    expect(() => buildDashboard(def)).toThrow(DashboardDefError);
    expect(validateDashboardDef(def)).toEqual([
      'encodings[0].initial.y: "area" is identifier — it cannot be the y of a bar',
      'encodings[1].initial.x: cases and ytd never share a chart',
      'encodings[1].initial.color: "state" never binds to color',
    ]);
    // the binding-set marker is not a channel name
    expect(validateDashboardDef({ ...base, encodings: [{ viewId: 'bar', chartKind: 'bar', channels: ['category', '*'] }] })).toEqual([
      'encodings[0].channels may not name "*" — it is reserved for a binding set',
    ]);
  });
  it('THE LAW — the door and the renderer agree, kind by kind: a line over a string or a boolean column builds and lints clean; an identifier on it and a scatter over the string are still refused', async () => {
    // Before this law the door refused a line over `disease` while the frame renderer drew it as a band line
    // (a bar's slots with the line's points at their centres) — a capability hidden at declaration. Now the
    // door accepts what the renderer draws: `CHART_REQUIREMENTS.line.x` takes a category and fixes no scale.
    const line: DashboardDef = { ...base, encodings: [{ viewId: 'line', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'disease', y: 'cases' } }] };
    expect(validateDashboardDef(line)).toEqual([]);
    expect(await buildDashboard(line).lint()).toEqual([]);
    // …and with the TYPE declared, so the build door itself judges it (types the def declares are judged at build)
    const declared: DashboardDef = { ...line, data: { cases: { ...base.data['cases']!, columns: { ...base.data['cases']!.columns, disease: { type: 'string', role: 'dimension' } } } } };
    expect(validateDashboardDef(declared)).toEqual([]);
    // a boolean folds as a category too (`frameScaleOf`), so it is a band line's x as well
    const flagged: DashboardDef = {
      ...base,
      data: { cases: { ...base.data['cases']!, rows: rows.map((r, i) => ({ ...r, flag: i === 0 })) } },
      encodings: [{ viewId: 'line', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'flag', y: 'cases' } }],
    };
    expect(validateDashboardDef(flagged)).toEqual([]);
    expect(await buildDashboard(flagged).lint()).toEqual([]);
    // an identifier is still not a line's x — along a run it is a lie about order, and whether it makes an honest band is a question the entry does not take
    expect(validateDashboardDef({ ...base, encodings: [{ viewId: 'line', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'area', y: 'cases' } }] })).toEqual([
      'encodings[0].initial.x: "area" is identifier — it cannot be the x of a line',
    ]);
    // a SCATTER over the string is still refused, in today's sentence: `VizScatter` draws no band in this version and the
    // frame refuses a point on a band in words, so the door refusing it too is the two agreeing (`CHART_REQUIREMENTS.scatter.x`)
    const dots: DashboardDef = { ...declared, actors: { ...base.actors, dots: { actor: 'user' } }, encodings: [{ viewId: 'dots', chartKind: 'scatter', channels: ['x', 'y'], initial: { x: 'disease', y: 'cases' } }] };
    expect(validateDashboardDef(dots)).toEqual(['encodings[0].initial.x: "disease" is string; the x channel of a scatter needs a number or a date']);
  });
  it('the gallery figure, declared: a bar layer and a line layer on one frame, both binding one string column to x — builds, lints clean, and the frame folds ONE categorical x for the two bands', async () => {
    // The figure packet U made drawable by hand (bars by year with a line of the mean over them) is now a
    // DEFINITION: two layers, the same `year` on both x channels, and the frame's law 10 finds them agreeing
    // (same table, same column). The fold is the one the ui adapter runs (`frameDomains`, the same door).
    const sales = [
      { year: '2019', count: 3, mean: 1.5 },
      { year: '2020', count: 5, mean: 2.5 },
      { year: '2021', count: 4, mean: 2 },
    ];
    const bars: LayerDecl = { layerId: 'bars', table: 'sales', chartKind: 'bar', channels: ['x', 'y'], initial: { x: 'year', y: 'count' } };
    const mean: LayerDecl = { layerId: 'mean', table: 'sales', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'year', y: 'mean' } };
    const def: DashboardDef = {
      data: { sales: { rows: sales, columns: { year: { type: 'string', role: 'dimension' }, count: { role: 'measure' }, mean: { role: 'measure' } } } },
      actors: { fig: { actor: 'user' } },
      encodings: [{ viewId: 'fig', chartKind: 'bar', channels: ['x', 'y'], layers: [bars, mean], frame: { x: { mode: 'shared' } } }],
      defaultTable: 'sales',
    };
    expect(validateDashboardDef(def)).toEqual([]);
    const built = buildDashboard(def);
    expect(await built.lint()).toEqual([]);
    expect(built.lintFrames()).toEqual([]);
    // the two-bands law: two bands line up only off ONE category list, and the frame folds exactly one — the
    // union of both layers' years in declaration order, `categorical` because a string folds as a category
    const frame = frameDomains(
      [bars, mean].map((layer) => ({
        layerId: layer.layerId,
        chartKind: layer.chartKind,
        channels: { x: { type: 'string', values: sales.map((r) => r.year) }, y: { type: 'number', values: sales.map((r) => r[layer.initial!['y'] as 'count' | 'mean']) } },
      })),
      { x: { mode: 'shared' } },
    );
    expect(frame['x']).toMatchObject({ mode: 'shared', scale: 'categorical', domain: ['2019', '2020', '2021'] });
    expect(frame['y']).toMatchObject({ scale: 'quantitative' });
  });
  it('types are not the def\'s to prove: a string on a scatter\'s x passes the build door and is caught by lint() with the data', async () => {
    const def: DashboardDef = { ...base, actors: { ...base.actors, dots: { actor: 'user' } }, encodings: [{ viewId: 'dots', chartKind: 'scatter', channels: ['x', 'y'], initial: { x: 'disease', y: 'cases' } }] };
    expect(validateDashboardDef(def)).toEqual([]);
    const problems = await buildDashboard(def).lint();
    expect(problems.map((p) => p.sentence)).toEqual(['"disease" is string; the x channel of a scatter needs a number or a date']);
    // a view that reads ANOTHER table's columns is not "missing a column" to lint — the same union the build door judges
    const twoTables: DashboardDef = {
      ...base,
      data: { ...base.data, series: { rows: [{ entity: 'a', value: 1 }], columns: { value: { role: 'measure' }, entity: { role: 'identifier' } } } },
      encodings: [{ viewId: 'line', chartKind: 'line', channels: ['x', 'y', 'color'], initial: { x: 't', y: 'value', color: 'entity' } }],
    };
    expect(await buildDashboard(twoTables).lint()).toEqual([]);
    const elsewhere: DashboardDef = { ...base, encodings: [{ viewId: 'line', chartKind: 'line', channels: ['x', 'y'], initial: { x: 't', y: 'mystery' } }] };
    expect(await buildDashboard(elsewhere).lint()).toEqual([]);
    // a second table without column declarations, one declaring a column the default table already has, and a surface without initial: all quiet
    const mixed: DashboardDef = {
      ...base,
      data: { ...base.data, other: { rows: [{ cases: 1 }], columns: { cases: { role: 'measure' } } }, bare: { rows: [{ z: 1 }] } },
      encodings: [{ viewId: 'bar', chartKind: 'bar', channels: ['category'] }, { viewId: 'line', chartKind: 'line', channels: ['x', 'y'], initial: { x: 't', y: 'cases' } }],
    };
    expect(await buildDashboard(mixed).lint()).toEqual([]);
    expect(problems[0]).toMatchObject({ viewId: 'dots', channel: 'x', field: 'disease', severity: 'refused' });
    // and a lawful def lints clean, with the ports riding through
    const clean = await buildDashboard(base, { encoding: { explainer: { explain: () => 'never called' } } }).lint();
    expect(clean).toEqual([]);
  });
  it('lint() with the coerce policy reports a coercion instead of a refusal', async () => {
    const def: DashboardDef = {
      ...base,
      encodings: [{ viewId: 'heat', chartKind: 'heatmap', channels: ['x', 'y'], initial: { x: 'cases', y: 'disease' } }],
      actors: { heat: { actor: 'user' } },
      encodingRules: { onInvalid: 'discrete' },
    };
    const { discreteCoercer } = await import('./index.js');
    const problems = await buildDashboard(def, { encoding: { coercers: [discreteCoercer] } }).lint();
    expect(problems.map((p) => [p.field, p.severity])).toEqual([['cases', 'coerced']]);
  });
  it('lint() throws when the provider cannot list columns (a stub engine): nothing to judge is not nothing wrong', async () => {
    const def: DashboardDef = { ...base, data: { cases: { rows, engine: 'wasm' } }, encodings: [] };
    // the engine is real (it opens a DuckDB where it finds a host), so the thing this
    // test needs — a provider that cannot list columns — is made by refusing the OPEN
    const cannotOpen = { availableEngines: ['memory' as const, 'wasm' as const], openSqlConnection: () => Promise.reject(new Error('no database in this test')) };
    await expect(buildDashboard(def, cannotOpen).lint()).rejects.toThrow(/cannot list its columns/);
  });
  it('a malformed encodings entry is refused structurally and not judged again; a def with no default-table data still validates', () => {
    const problems = validateDashboardDef({ ...base, encodings: [{ viewId: 'bar', chartKind: 'bar', channels: ['category'], initial: { category: 1 } }] } as unknown as DashboardDef);
    expect(problems).toEqual(['encodings[0].initial, if present, must be an object mapping channel -> field (strings)']);
    const noTable = validateDashboardDef({ ...base, defaultTable: 'nope' } as DashboardDef);
    expect(noTable.some((p) => p.includes('defaultTable'))).toBe(true);
  });
});

describe('the def door keeps judging when parts are malformed', () => {
  it('a malformed absence is refused on its own and does not break the column check; a malformed encodings entry is not judged', () => {
    const problems = validateDashboardDef({
      ...base,
      data: { cases: { rows, absence: { field: 7, states: ['unknown'] }, columns: { area: { role: 'identifier' } } } },
      encodings: [{ viewId: 'bar', chartKind: 'bar', channels: ['category', 3], initial: { category: 'disease' } }, { viewId: 'line', chartKind: 'line', channels: ['x', 'y'], initial: { x: 't', y: 'area' } }],
    } as unknown as DashboardDef);
    expect(problems.some((p) => p.includes('absence.field'))).toBe(true);
    expect(problems.some((p) => p.includes('encodings[0].channels'))).toBe(true);
    expect(problems).toContain('encodings[1].initial.y: "area" is identifier — it cannot be the y of a line');
  });
});
