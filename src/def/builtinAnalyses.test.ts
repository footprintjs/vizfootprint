import { describe, expect, it } from 'vitest';
import {
  BUILTIN_ANALYSES,
  BuiltinAnalysisError,
  buildBuiltinAnalysis,
  buildDashboard,
  isBuiltinRecord,
  validateBuiltinAnalysis,
  validateDashboardDef,
} from './index.js';
import { registerAnalysisSlot } from './register.js';
import { groupByAnalysis } from '../analysis/index.js';
import type { BuiltinAnalysisDecl, DashboardDef } from './index.js';

const problemsOf = (decl: unknown): string[] => {
  const out: string[] = [];
  validateBuiltinAnalysis(decl, 'analyses["a"]', out);
  return out;
};

/** An NNDSS-shaped table: a week's counts per disease per jurisdiction. */
const ROWS = Array.from({ length: 12 }, (_, i) => ({
  jurisdiction: ['Texas', 'Ohio', 'Maine'][i % 3]!,
  disease: ['Lyme', 'Zika'][i % 2]!,
  cases: 10 + i * 3,
  ytd: 100 + i * 9,
}));

describe('the builtin analysis record — what it refuses', () => {
  it('refuses a slot that is not an object at all', () => {
    expect(problemsOf(null)).toEqual(['analyses["a"] must be an object { builtin, … }']);
    expect(problemsOf([{ builtin: 'groupBy' }])).toEqual(['analyses["a"] must be an object { builtin, … }']);
    expect(problemsOf(42)).toEqual(['analyses["a"] must be an object { builtin, … }']);
  });

  it('refuses a record whose `builtin` is not a name', () => {
    expect(problemsOf({ builtin: 7 })).toEqual([
      'analyses["a"].builtin must name a builtin analysis — one of groupBy | correlation | regression | clustering | formula',
    ]);
  });

  it('refuses an unknown builtin name, and says which names there are', () => {
    expect(problemsOf({ builtin: 'kmeans', column: 'cases' })).toEqual([
      'analyses["a"].builtin "kmeans" is not a builtin analysis — one of groupBy | correlation | regression | clustering | formula',
    ]);
  });

  it('refuses an option the analysis does not take, and lists the ones it does', () => {
    expect(problemsOf({ builtin: 'correlation', x: 'cases', y: 'ytd', pValue: 'my-judge' })).toEqual([
      'analyses["a"].pValue is not an option of the "correlation" analysis — it takes x, y, id, branchId',
    ]);
  });

  it('refuses a missing required option, naming the analysis that needs it', () => {
    expect(problemsOf({ builtin: 'groupBy' })).toEqual([
      'analyses["a"].by must be a non-empty string (the "groupBy" analysis needs it)',
      'analyses["a"].measure must be a non-empty string (the "groupBy" analysis needs it)',
    ]);
    expect(problemsOf({ builtin: 'groupBy', by: '', measure: 'cases' })).toEqual([
      'analyses["a"].by must be a non-empty string (the "groupBy" analysis needs it)',
    ]);
  });

  it('refuses a required option of the wrong type — k is a whole number of at least 1', () => {
    expect(problemsOf({ builtin: 'clustering', column: 'cases', k: 'four' })).toEqual([
      'analyses["a"].k must be a whole number of at least 1 (the "clustering" analysis needs it)',
    ]);
    expect(problemsOf({ builtin: 'clustering', column: 'cases', k: 2.5 })).toHaveLength(1);
    // 0 bins is what `quantileBins` throws on — refused at declaration instead
    expect(problemsOf({ builtin: 'clustering', column: 'cases', k: 0 })).toHaveLength(1);
  });

  it('refuses an optional option of the wrong type, and accepts a well-typed one', () => {
    expect(problemsOf({ builtin: 'regression', x: 'cases', y: 'ytd', minPoints: -1 })).toEqual([
      'analyses["a"].minPoints, if present, must be a non-negative finite number',
    ]);
    expect(problemsOf({ builtin: 'regression', x: 'cases', y: 'ytd', minPoints: Number.NaN })).toHaveLength(1);
    expect(problemsOf({ builtin: 'regression', x: 'cases', y: 'ytd', minPoints: '10' })).toHaveLength(1);
    expect(problemsOf({ builtin: 'regression', x: 'cases', y: 'ytd', layer: 4 })).toEqual([
      'analyses["a"].layer, if present, must be a non-empty string',
    ]);
    expect(problemsOf({ builtin: 'regression', x: 'cases', y: 'ytd', minPoints: 4, layer: 'fit', id: 'r' })).toEqual([]);
  });

  it('accepts every builtin at its plainest', () => {
    expect(BUILTIN_ANALYSES).toEqual(['groupBy', 'correlation', 'regression', 'clustering', 'formula']);
    expect(problemsOf({ builtin: 'groupBy', by: 'disease', measure: 'cases' })).toEqual([]);
    expect(problemsOf({ builtin: 'correlation', x: 'cases', y: 'ytd' })).toEqual([]);
    expect(problemsOf({ builtin: 'regression', x: 'cases', y: 'ytd' })).toEqual([]);
    expect(problemsOf({ builtin: 'clustering', column: 'cases', k: 4 })).toEqual([]);
    expect(problemsOf({ builtin: 'formula', expression: 'cases / 1000', name: 'rate' })).toEqual([]);
  });

  it('refuses a formula the grammar has no rule for, in the grammar\'s own sentence', () => {
    expect(problemsOf({ builtin: 'formula', expression: 'cases % 2', name: 'rate' })).toEqual([
      'analyses["a"].expression is not a formula: the formula has no rule for "%" at position 7',
    ]);
    // a MISSING expression is one sentence, not two: the grammar is not asked about a field that is not there
    expect(problemsOf({ builtin: 'formula', name: 'rate' })).toEqual([
      'analyses["a"].expression must be a non-empty string (the "formula" analysis needs it)',
    ]);
    expect(problemsOf({ builtin: 'formula', expression: 'cases', name: '' })).toEqual([
      'analyses["a"].name must be a non-empty string (the "formula" analysis needs it)',
    ]);
    expect(problemsOf({ builtin: 'formula', expression: 'cases', name: 'rate', type: 'number' })).toEqual([
      'analyses["a"].type, if present, must be "int" or "float"',
    ]);
    expect(problemsOf({ builtin: 'formula', expression: 'cases', name: 'rate', type: 'int', table: 'other', id: 'f' })).toEqual([]);
  });
});

describe('the three forms are told apart by SHAPE', () => {
  it('a `run` function is a module, a `build` function is a def, a `builtin` name is a record', () => {
    expect(isBuiltinRecord({ builtin: 'groupBy', by: 'disease', measure: 'cases' })).toBe(true);
    // a def wins over a stray `builtin` key: `build` is the def's tell
    expect(isBuiltinRecord({ builtin: 'groupBy', build: () => ({}) })).toBe(false);
    expect(isBuiltinRecord({ run: () => ({}) })).toBe(false);
    expect(isBuiltinRecord(null)).toBe(false);
    expect(isBuiltinRecord([])).toBe(false);
  });
});

describe('a builtin record resolves to its factory', () => {
  it('builds each of the four, with the factory defaults the record left unsaid', () => {
    const g = buildBuiltinAnalysis({ builtin: 'groupBy', by: 'disease', measure: 'cases' });
    expect([g.id, g.kind, g.def.produces]).toEqual(['groupby:disease:cases', 'transform', 'table']);
    const c = buildBuiltinAnalysis({ builtin: 'correlation', x: 'cases', y: 'ytd', branchId: 'b1' });
    expect([c.id, c.kind, c.def.produces]).toEqual(['corr:cases:ytd', 'test', 'scalar']);
    expect(c.def.test?.statistic).toBe('pearson-r');
    const r = buildBuiltinAnalysis({ builtin: 'regression', x: 'cases', y: 'ytd', minPoints: 4 });
    expect([r.id, r.kind, r.def.produces]).toEqual(['reg:cases:ytd', 'transform', 'geometry']);
    expect(r.def.honesty?.minPoints).toBe(4);
    const k = buildBuiltinAnalysis({ builtin: 'clustering', column: 'cases', k: 4, id: 'bins' });
    expect([k.id, k.kind, k.def.produces]).toEqual(['bins', 'transform', 'columns']);
  });

  it('throws with every problem when the record is malformed', () => {
    const bad = { builtin: 'groupBy' } as unknown as BuiltinAnalysisDecl;
    expect(() => buildBuiltinAnalysis(bad)).toThrow(BuiltinAnalysisError);
    try {
      buildBuiltinAnalysis(bad);
      expect.unreachable('a malformed record must not build');
    } catch (e) {
      expect((e as BuiltinAnalysisError).problems).toEqual([
        'builtin analysis.by must be a non-empty string (the "groupBy" analysis needs it)',
        'builtin analysis.measure must be a non-empty string (the "groupBy" analysis needs it)',
      ]);
    }
  });

  it('registers and RUNS like any other analysis', async () => {
    const registered = registerAnalysisSlot('byDisease', { builtin: 'groupBy', by: 'disease', measure: 'cases' });
    expect([registered.id, registered.kind]).toEqual(['byDisease', 'transform']);
    const out = await registered.run(ROWS);
    expect(out.result.ok).toBe(true);
    expect(out.result.ok && out.result.output.as).toBe('table');
  });

  it('takes the KEY it was declared under as its id — the name a person will look for', async () => {
    const named = registerAnalysisSlot('byDisease', { builtin: 'groupBy', by: 'disease', measure: 'cases' });
    expect([named.id, named.def.id]).toEqual(['byDisease', 'byDisease']);
    // an explicit id on the record still wins
    const explicit = registerAnalysisSlot('slot', { builtin: 'groupBy', by: 'disease', measure: 'cases', id: 'chosen' });
    expect([explicit.id, explicit.def.id]).toEqual(['slot', 'chosen']);
    // a hand-written module keeps its own identity, exactly as before — a developer wrote it
    const mod = registerAnalysisSlot('slot', groupByAnalysis({ by: 'disease', measure: 'cases' }));
    expect([mod.id, mod.def.id]).toEqual(['slot', 'groupby:disease:cases']);
    // and the factory default is still what the record resolves to on its own
    expect(buildBuiltinAnalysis({ builtin: 'groupBy', by: 'disease', measure: 'cases' }).id).toBe('groupby:disease:cases');
  });

  it('so the hypothesis a declared test emits wears the declared name', async () => {
    const corr = registerAnalysisSlot('casesVsYtd', { builtin: 'correlation', x: 'cases', y: 'ytd' });
    const out = await corr.run(ROWS);
    expect(out.hypothesis?.hypothesisId).toBe('casesVsYtd');
  });
});

describe('the def door', () => {
  const defWith = (analyses: DashboardDef['analyses']): unknown => ({
    data: { cases: { rows: ROWS } },
    actors: { bars: { actor: 'user' } },
    analyses,
  });

  it('accepts a def whose analyses are all records — and it is all JSON', () => {
    const def = defWith({
      byDisease: { builtin: 'groupBy', by: 'disease', measure: 'cases' },
      casesVsYtd: { builtin: 'correlation', x: 'cases', y: 'ytd' },
      trend: { builtin: 'regression', x: 'cases', y: 'ytd', minPoints: 4 },
      bins: { builtin: 'clustering', column: 'cases', k: 4 },
    }) as DashboardDef;
    expect(validateDashboardDef(def)).toEqual([]);
    const roundTripped = JSON.parse(JSON.stringify(def)) as DashboardDef;
    expect(roundTripped).toEqual(def);
    expect(validateDashboardDef(roundTripped)).toEqual([]);
  });

  it('refuses a bad record with the analysis id in the sentence', () => {
    expect(validateDashboardDef(defWith({ bins: { builtin: 'clustering', column: 'cases' } } as never))).toEqual([
      'analyses["bins"].k must be a whole number of at least 1 (the "clustering" analysis needs it)',
    ]);
  });

  it('refuses an empty analysis id — one sentence, whichever form the slot is', () => {
    // the key is judged BEFORE the slot, so all three forms get the same sentence
    const record = { builtin: 'groupBy', by: 'disease', measure: 'cases' };
    const rawDef = { id: 'x', kind: 'transform', produces: 'table', inputs: [], build: () => ({}), toRunInput: () => ({}), readOutput: () => ({}) };
    const module_ = groupByAnalysis({ by: 'disease', measure: 'cases' });
    for (const slot of [record, rawDef, module_]) {
      expect(validateDashboardDef(defWith({ '': slot } as never))).toEqual(['analyses[""]: an analysis id must be a non-empty string']);
    }
    // and the def door refuses it, so the registry's key-as-id injection never sees it
    expect(() => buildDashboard(defWith({ '': record } as never) as DashboardDef)).toThrow('an analysis id must be a non-empty string');
  });

  it('still re-firewalls a raw def, and still trusts a built module', () => {
    const broken = { id: 'x', kind: 'test', produces: 'scalar', inputs: [], build: () => ({}), toRunInput: () => ({}), readOutput: () => ({}) };
    expect(validateDashboardDef(defWith({ broken } as never)).some((p) => p.startsWith('analyses["broken"]'))).toBe(true);
    // neither shape at all — L3's own refusal names it
    expect(validateDashboardDef(defWith({ nothing: 7 } as never))).toEqual(['analyses["nothing"]: def must be a plain object']);
  });

  it('builds a dashboard whose analyses were named, not written', async () => {
    const def = defWith({ byDisease: { builtin: 'groupBy', by: 'disease', measure: 'cases' } }) as DashboardDef;
    const dash = buildDashboard(def);
    const session = dash.createSession();
    expect(session.analysisIds()).toContain('byDisease');
    const commit = await session.declareAnalysis('byDisease');
    expect(commit.result.ok).toBe(true);
  });
});
