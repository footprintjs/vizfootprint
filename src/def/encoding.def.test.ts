import { describe, expect, it } from 'vitest';
import { DashboardDefError, buildDashboard, validateDashboardDef } from './index.js';
import type { DashboardDef } from './index.js';

const rows = [
  { area: 'TX', disease: 'flu', cases: 3, ytd: 30, state: 'present', t: new Date('2026-01-04') },
  { area: 'CA', disease: 'flu', cases: 5, ytd: 50, state: 'unknown', t: new Date('2026-01-11') },
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
  it('types are not the def\'s to prove: a string on x passes the build door and is caught by lint() with the data', async () => {
    const def: DashboardDef = { ...base, encodings: [{ viewId: 'line', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'disease', y: 'cases' } }] };
    expect(validateDashboardDef(def)).toEqual([]);
    const problems = await buildDashboard(def).lint();
    expect(problems.map((p) => p.sentence)).toEqual(['"disease" is string; the x channel of a line needs a number or a date']);
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
    expect(problems[0]).toMatchObject({ viewId: 'line', channel: 'x', field: 'disease', severity: 'refused' });
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
    await expect(buildDashboard(def, { availableEngines: ['memory', 'wasm'] }).lint()).rejects.toThrow(/cannot list its columns/);
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
