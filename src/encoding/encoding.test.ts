import { describe, expect, it } from 'vitest';
import type { ColumnFacet } from '../data/types.js';
import {
  BUILTIN_RULES,
  CHART_REQUIREMENTS,
  DEFAULT_CHANNEL_REQUIREMENTS,
  acceptsOf,
  describeRule,
  describeRules,
  discreteCoercer,
  fill,
  fitsFor,
  formatProblem,
  lintEncodings,
  listOf,
  refuses,
  requirementFailure,
  requirementFor,
  resolveFacet,
  resolveFacets,
  ruleId,
  scaleOfType,
  validateBindings,
  validateColumnDecls,
  validateEncodingRulesShape,
} from './index.js';
import type { BusinessRule, EncodingRules, EncodingSurface } from './index.js';

const cols = [
  { name: 'jurisdiction', type: 'string' },
  { name: 'disease', type: 'string' },
  { name: 'cases', type: 'number' },
  { name: 'ytd', type: 'number' },
  { name: 't', type: 'date' },
  { name: 'report_state', type: 'string' },
  { name: 'flag', type: 'boolean' },
  { name: 'mystery', type: 'unknown' },
] as const;
const source = {
  absence: { field: 'report_state', states: ['present', 'unavailable', 'unknown'] },
  columns: { jurisdiction: { role: 'identifier' as const }, cases: { role: 'measure' as const }, ytd: { role: 'measure' as const, label: 'year to date' } },
};
const facets: ColumnFacet[] = resolveFacets(cols, source);
const line: EncodingSurface = { viewId: 'weeks', chartKind: 'line', channels: ['x', 'y', 'color'], initial: { x: 't', y: 'cases' } };
const bar: EncodingSurface = { viewId: 'diseases', chartKind: 'bar', channels: ['category'], initial: { category: 'disease' } };

describe('facets', () => {
  it('derives the absence role, the scale from the type, and carries declared roles + labels', () => {
    const f = Object.fromEntries(facets.map((x) => [x.field, x]));
    expect(f['report_state']).toEqual({ field: 'report_state', type: 'string', role: 'absence', scale: 'discrete', absence: source.absence.states });
    expect(f['cases']).toEqual({ field: 'cases', type: 'number', role: 'measure', scale: 'continuous' });
    expect(f['ytd']!.label).toBe('year to date');
    expect(f['t']!.scale).toBe('continuous');
    expect(f['flag']!.scale).toBe('discrete');
    expect(f['disease']!.role).toBeUndefined();
    expect(f['mystery']!.scale).toBeUndefined();
  });
  it('a declared type wins over the provider\'s (an ISO string that is a date), and the scale follows it', () => {
    expect(resolveFacet({ name: 't', type: 'string' }, { columns: { t: { type: 'date' } } })).toEqual({ field: 't', type: 'date', scale: 'continuous' });
  });
  it('a declared scale wins over the derived one; no source at all still resolves', () => {
    expect(resolveFacet({ name: 'zip', type: 'number' }, { columns: { zip: { scale: 'discrete' } } }).scale).toBe('discrete');
    expect(resolveFacet({ name: 'zip', type: 'number' })).toEqual({ field: 'zip', type: 'number', scale: 'continuous' });
    expect(scaleOfType('unknown')).toBeUndefined();
  });
});

describe('requirements', () => {
  it('layers def override > chart kind > by-name default > nothing', () => {
    expect(requirementFor('line', 'x')!.scale).toBe('continuous');
    expect(requirementFor('scatter', 'x')!.accepts).toEqual(['number', 'date']);
    expect(requirementFor('someKind', 'x')).toBe(DEFAULT_CHANNEL_REQUIREMENTS.find((r) => r.channel === 'x'));
    expect(requirementFor('bar', 'category')!.scale).toBe('discrete');
    expect(requirementFor('table', 'anything')).toBeUndefined();
    const override = { line: [{ channel: 'x', accepts: ['date'] as const }] };
    expect(requirementFor('line', 'x', override)!.accepts).toEqual(['date']);
    expect(requirementFor('unknownKind', 'y')).toEqual({ channel: 'y', notRoles: ['identifier'] });
    expect(requirementFor('bar', 'x')!.scale).toBe('discrete');
    expect(Object.keys(CHART_REQUIREMENTS)).toContain('heatmap');
  });
  it('requirementFailure judges type, scale, roles, notRoles — and stays silent on ignorance', () => {
    const view = line;
    const req = requirementFor('line', 'x')!;
    expect(requirementFailure(facets.find((f) => f.field === 'disease')!, req, view, 'x')).toBe('"disease" is string; the x channel of a line needs a number or a date');
    expect(requirementFailure(facets.find((f) => f.field === 't')!, req, view, 'x')).toBeUndefined();
    expect(requirementFailure(facets.find((f) => f.field === 'mystery')!, req, view, 'x')).toBeUndefined();
    expect(requirementFailure({ field: 'n', type: 'number', scale: 'discrete' }, req, view, 'x')).toBe('"n" is discrete; the x channel of a line needs a continuous column');
    expect(requirementFailure({ field: 'id', type: 'number', role: 'identifier' }, req, view, 'x')).toBe('"id" is identifier — it cannot be the x of a line');
    expect(requirementFailure({ field: 'm', type: 'number', role: 'measure' }, { channel: 'q', roles: ['dimension', 'identifier'] }, view, 'q')).toBe('"m" is measure; the q channel of a line only takes a dimension or a identifier');
    expect(requirementFailure({ field: 'm', type: 'number' }, { channel: 'q', accepts: ['string'], sentence: 'custom {column} on {channel}' }, view, 'q')).toBe('custom m on q');
  });
});

describe('sentences', () => {
  it('fills known slots and leaves unknown ones visible', () => {
    expect(fill('{a} and {b}', { a: '1' })).toBe('1 and {b}');
    expect(listOf([])).toBe('nothing');
    expect(listOf(['number'])).toBe('a number');
    expect(listOf(['number', 'date', 'string'])).toBe('a number, a date or a string');
  });
});

describe('validateBindings', () => {
  it('passes a lawful binding and refuses a category on a magnitude', () => {
    expect(validateBindings({ view: line, bindings: { x: 't', y: 'cases' }, facets })).toEqual([]);
    const p = validateBindings({ view: line, bindings: { x: 't', y: 'disease' }, facets, changed: ['y'] });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ rule: 'channel:line.y', viewId: 'weeks', channel: 'y', field: 'disease', severity: 'refused' });
    expect(refuses(p)).toBe(true);
  });
  it('the built-in law: the absence column never binds to a magnitude, with the historical sentence', () => {
    const p = validateBindings({ view: line, bindings: { x: 't', y: 'report_state' }, facets, changed: ['y'] });
    const law = p.find((x) => x.rule === 'absence-never-magnitude');
    expect(law?.sentence).toBe('"report_state" is the declared absence column — it cannot bind to the magnitude channel "y"; absence is a category, never a magnitude');
    expect(BUILTIN_RULES[0]!.id).toBe('absence-never-magnitude');
    // and it is allowed on a category channel
    expect(validateBindings({ view: bar, bindings: { category: 'report_state' }, facets })).toEqual([]);
  });
  it('a field that is not a column is named', () => {
    const p = validateBindings({ view: bar, bindings: { category: 'nope' }, facets });
    expect(p[0]!.sentence).toBe('"nope" is not a column of the table');
    expect(p[0]!.rule).toBe('column');
  });
  it('never-on by column and by role, by channels and by class', () => {
    const rules: EncodingRules = {
      rules: [
        { rule: 'never-on', column: 'ytd', channels: ['color'] },
        { rule: 'never-on', role: 'identifier', class: 'magnitude', id: 'ids-are-not-quantities' },
      ],
    };
    const scatter: EncodingSurface = { viewId: 's', chartKind: 'scatter', channels: ['x', 'y', 'color'] };
    const byColumn = validateBindings({ view: scatter, bindings: { color: 'ytd' }, facets, rules });
    expect(byColumn.map((p) => [p.rule, p.sentence])).toEqual([['never-on#0', '"ytd" never binds to color']]);
    const byRole = validateBindings({ view: scatter, bindings: { x: 'jurisdiction' }, facets, rules, changed: ['x'] });
    const hit = byRole.find((p) => p.rule === 'ids-are-not-quantities');
    expect(hit?.sentence).toBe('"jurisdiction" is identifier — it never binds to x');
    // an undeclared role never matches a role rule; an unlisted channel never matches
    expect(validateBindings({ view: scatter, bindings: { x: 'cases' }, facets, rules })).toEqual([]);
    expect(validateBindings({ view: scatter, bindings: { color: 'jurisdiction' }, facets, rules })).toEqual([]);
  });
  it('never-together: view scope sees one chart, dashboard scope sees the page; only the changed side is reported', () => {
    const scatter: EncodingSurface = { viewId: 's', chartKind: 'scatter', channels: ['x', 'y'] };
    const viewScoped: EncodingRules = { rules: [{ rule: 'never-together', columns: ['cases', 'ytd'], scope: 'view', sentence: 'a week and a year never share a chart ({column} vs {other})' }] };
    const p = validateBindings({ view: scatter, bindings: { x: 'cases', y: 'ytd' }, facets, rules: viewScoped, changed: ['y'] });
    expect(p.map((x) => [x.channel, x.field, x.sentence])).toEqual([['y', 'ytd', 'a week and a year never share a chart (ytd vs cases)']]);
    // view scope: the other column on ANOTHER view is fine
    expect(validateBindings({ view: scatter, bindings: { x: 'cases' }, facets, rules: viewScoped, others: { t: { y: 'ytd' } } })).toEqual([]);
    // dashboard scope (the default): the other column anywhere on the page collides
    const pageScoped: EncodingRules = { rules: [{ rule: 'never-together', columns: ['cases', 'ytd'] }] };
    const q = validateBindings({ view: scatter, bindings: { x: 'cases' }, facets, rules: pageScoped, others: { t: { y: 'ytd' } } });
    expect(q[0]!.sentence).toBe('"cases" and "ytd" never share the page');
    // ruleScope on the rule set sets the default
    expect(validateBindings({ view: scatter, bindings: { x: 'cases' }, facets, rules: { ...pageScoped, ruleScope: 'view' }, others: { t: { y: 'ytd' } } })).toEqual([]);
    // lint mode (no `changed`) or a set touching both sides: the pair is reported ONCE, on the first column's channel
    expect(validateBindings({ view: scatter, bindings: { x: 'cases', y: 'ytd' }, facets, rules: viewScoped }).map((p) => p.channel)).toEqual(['x']);
    expect(validateBindings({ view: scatter, bindings: { x: 'ytd', y: 'cases' }, facets, rules: viewScoped, changed: ['x', 'y'] }).map((p) => [p.channel, p.field])).toEqual([['y', 'cases']]);
    // an unrelated act on another channel does not trip a pre-existing violation
    expect(validateBindings({ view: { ...scatter, channels: ['x', 'y', 'color'] }, bindings: { x: 'cases', y: 'ytd', color: 'disease' }, facets, rules: viewScoped, changed: ['color'] })).toEqual([]);
  });
  it('only-with: the companion must be bound (on the chart, or on the page under dashboard scope)', () => {
    const trend: EncodingSurface = { viewId: 'trend', chartKind: 'line', channels: ['x', 'y', 'color'] };
    const rules: EncodingRules = { rules: [{ rule: 'only-with', column: 'cases', companion: 'disease' }] };
    const p = validateBindings({ view: trend, bindings: { x: 't', y: 'cases' }, facets, rules, changed: ['y'] });
    expect(p[0]!.sentence).toBe('"cases" is only meaningful with "disease" on the same chart — bind "disease" first');
    expect(validateBindings({ view: trend, bindings: { x: 't', y: 'cases', color: 'disease' }, facets, rules, changed: ['y'] })).toEqual([]);
    const page: EncodingRules = { rules: [{ rule: 'only-with', column: 'cases', companion: 'disease', scope: 'dashboard' }] };
    expect(validateBindings({ view: trend, bindings: { x: 't', y: 'cases' }, facets, rules: page, others: { bar: { category: 'disease' } }, changed: ['y'] })).toEqual([]);
    expect(validateBindings({ view: trend, bindings: { x: 't', y: 'cases' }, facets, rules: page, changed: ['y'] })[0]!.sentence).toContain('on the page');
    // the column not bound at all: silent
    expect(validateBindings({ view: trend, bindings: { x: 't' }, facets, rules })).toEqual([]);
    // judged on the RESULT: an act on another channel that leaves the column without its companion is refused too
    // (rebinding the companion's channel away is the case that matters)
    const orphaned = validateBindings({ view: trend, bindings: { x: 't', y: 'cases', color: 'flag' }, facets, rules, changed: ['color'] });
    expect(orphaned.map((p) => [p.rule, p.channel])).toEqual([['only-with#0', 'y']]);
  });
  it('coerce policy: the named coercer takes a binding the requirement refused; refuse (default) never does; unknown names coerce nothing', () => {
    const heat: EncodingSurface = { viewId: 'h', chartKind: 'heatmap', channels: ['x', 'y', 'color'] };
    const refused = validateBindings({ view: heat, bindings: { x: 'cases' }, facets, ports: { coercers: [discreteCoercer] } });
    expect(refused[0]!.severity).toBe('refused');
    const coerced = validateBindings({ view: heat, bindings: { x: 'cases' }, facets, rules: { onInvalid: 'discrete' }, ports: { coercers: [discreteCoercer] } });
    expect(coerced[0]).toMatchObject({ severity: 'coerced', coercedTo: { field: 'cases', scale: 'discrete' }, sentence: '"cases" is continuous; the x channel of a heatmap needs a discrete column' });
    expect(refuses(coerced)).toBe(false);
    expect(validateBindings({ view: heat, bindings: { x: 'cases' }, facets, rules: { onInvalid: 'nope' }, ports: { coercers: [discreteCoercer] } })[0]!.severity).toBe('refused');
    // a coercer cannot make a category a magnitude
    expect(discreteCoercer.coerce(facets.find((f) => f.field === 'disease')!, { channel: 'y', accepts: ['number'] })).toBeNull();
    // a coercer never applies to a business rule
    const law = validateBindings({ view: heat, bindings: { color: 'report_state' }, facets, rules: { onInvalid: 'discrete' }, ports: { coercers: [discreteCoercer] } });
    expect(law.every((p) => p.severity === 'refused')).toBe(true);
  });
  it('an explainer adds prose; the template sentence stays', () => {
    const p = validateBindings({ view: line, bindings: { y: 'disease' }, facets, ports: { explainer: { explain: (x) => `because: ${x.rule}` } } });
    expect(p[0]!.explained).toBe('because: channel:line.y');
    expect(p[0]!.sentence).toContain('needs a number');
  });
  it('ruleId falls back to kind#index', () => {
    expect(ruleId({ rule: 'only-with', column: 'a', companion: 'b' }, 3)).toBe('only-with#3');
    expect(ruleId({ rule: 'only-with', column: 'a', companion: 'b', id: 'x' }, 3)).toBe('x');
  });
});

describe('fits', () => {
  it('judges every column per channel, fitting ones first, with the sentence on each refusal; accepts projects the names', () => {
    const fits = fitsFor({ view: line, bindings: { x: 't', y: 'cases' }, facets });
    const y = fits['y']!;
    expect(y.filter((f) => f.ok).map((f) => f.field)).toEqual(['cases', 'ytd', 'mystery']);
    expect(y.find((f) => f.field === 'report_state')!.because).toContain('absence is a category');
    expect(y.find((f) => f.field === 'disease')!.because).toContain('needs a number');
    expect(y.find((f) => f.field === 't')!.because).toBe('"t" is date; the y channel of a line needs a number');
    expect(acceptsOf(fits)['x']).toEqual(['cases', 'ytd', 't', 'mystery']);
    expect(Object.keys(fits)).toEqual(['x', 'y', 'color']);
  });
  it('a recommender ranks the fitting columns only; rules, others and an explainer ride through', () => {
    const fits = fitsFor({
      view: line,
      bindings: { x: 't' },
      facets,
      rules: { rules: [{ rule: 'never-together', columns: ['cases', 'ytd'] }] },
      others: { s: { x: 'ytd' } },
      ports: {
        recommender: { rank: (_channel, ok) => [...ok].reverse() },
        explainer: { explain: (p) => `${p.field}!` },
      },
    });
    const y = fits['y']!;
    expect(y.filter((f) => f.ok).map((f) => f.field)).toEqual(['mystery', 'ytd']);
    expect(y.find((f) => f.field === 'cases')).toEqual({ field: 'cases', ok: false, because: 'cases!' });
  });
});

describe('lint + describe', () => {
  it('lint judges every view against the others; formatProblem reads as one line', () => {
    const views: EncodingSurface[] = [
      { viewId: 'a', chartKind: 'scatter', channels: ['x', 'y'], initial: { x: 'cases', y: 'disease' } },
      { viewId: 'b', chartKind: 'bar', channels: ['category'], initial: { category: 'ytd' } },
      { viewId: 'c', chartKind: 'bar', channels: ['category'] },
    ];
    const problems = lintEncodings({ views, facets, rules: { rules: [{ rule: 'never-together', columns: ['cases', 'ytd'] }] } });
    expect(problems.map(formatProblem)).toEqual([
      'a.x = "cases": "cases" and "ytd" never share the page',
      'a.y = "disease": "disease" is string; the y channel of a scatter needs a number or a date',
      'b.category = "ytd": "ytd" and "cases" never share the page',
      'b.category = "ytd": "ytd" is continuous; the category channel of a bar needs a discrete column',
    ]);
    expect(formatProblem({ ...problems[3]!, severity: 'coerced' })).toContain('(coerced)');
    expect(lintEncodings({ views: [views[2]!], facets, ports: {} })).toEqual([]);
  });
  it('describes the built-in law and the def rules as sentences', () => {
    const rules: BusinessRule[] = [
      { rule: 'never-on', column: 'ytd', channels: ['color', 'size'] },
      { rule: 'never-on', role: 'identifier', class: 'magnitude' },
      { rule: 'never-together', columns: ['cases', 'ytd'], scope: 'view' },
      { rule: 'never-together', columns: ['a', 'b'] },
      { rule: 'only-with', column: 'value', companion: 'entity' },
      { rule: 'only-with', column: 'value', companion: 'entity', scope: 'dashboard', sentence: 'custom {column}/{companion}' },
    ];
    const lines = describeRules({ rules });
    expect(lines[0]).toEqual({ id: 'absence-never-magnitude', builtIn: true, sentence: '"a column whose role is absence" is the declared absence column — it cannot bind to the magnitude channel "any magnitude channel (x, y, size, r, radius, theta)"; absence is a category, never a magnitude' });
    expect(lines.slice(1).map((l) => l.sentence)).toEqual([
      '"ytd" never binds to color, size',
      '"a column whose role is identifier" is identifier — it never binds to any magnitude channel (x, y, size, r, radius, theta)',
      '"cases" and "ytd" never share a chart',
      '"a" and "b" never share the page',
      '"value" is only meaningful with "entity" on the same chart — bind "entity" first',
      'custom value/entity',
    ]);
    expect(describeRule({ rule: 'never-together', columns: ['a', 'b'] }, 'view')).toContain('share a chart');
    expect(describeRules().map((l) => l.id)).toEqual(['absence-never-magnitude']);
  });
});

describe('shape checks (the def door)', () => {
  it('column declarations', () => {
    const problems: string[] = [];
    validateColumnDecls('x', 'data["t"].columns', problems);
    validateColumnDecls({ a: 1, b: { role: 'boss', scale: 'huge', label: 2, extra: 1, type: 'int' }, rs: { role: 'measure' } }, 'c', problems, 'rs');
    expect(problems).toEqual([
      'data["t"].columns must be an object mapping field -> { type?, role?, scale?, label? }',
      'c["a"] must be an object',
      'c["b"].extra is not a column declaration key',
      'c["b"].type must be one of number, string, boolean, date, unknown',
      'c["b"].role must be one of identifier, dimension, measure, absence',
      'c["b"].scale must be one of discrete, continuous',
      'c["b"].label must be a string',
      'c["rs"].role is "measure" but "rs" is the table\'s declared absence column — its role is absence',
    ]);
    const fine: string[] = [];
    validateColumnDecls({ rs: { role: 'absence' }, m: { role: 'measure', scale: 'continuous', label: 'M', type: 'number' } }, 'c', fine, 'rs');
    expect(fine).toEqual([]);
  });
  it('the rule set', () => {
    const problems: string[] = [];
    validateEncodingRulesShape([], 'encodingRules', problems);
    validateEncodingRulesShape({ bogus: 1, onInvalid: '', ruleScope: 'page', channels: 'x', rules: 'y' }, 'e', problems);
    validateEncodingRulesShape(
      {
        channels: { line: 'x', bar: [1, { channel: '', accepts: ['int'], scale: 'log', roles: ['boss'], notRoles: 'x', sentence: 1, extra: 1 }, { channel: '*' }] },
        rules: [
          1,
          { rule: 'sometimes' },
          { rule: 'never-on', id: '', sentence: 1, scope: 'view' },
          { rule: 'never-on', column: '', role: 'boss', channels: [], class: 'shape' },
          { rule: 'never-on', column: 'a', class: 'magnitude' },
          { rule: 'never-together', columns: ['a'] },
          { rule: 'never-together', columns: ['a', 'a'], scope: 'nowhere' },
          { rule: 'only-with', column: '', companion: '' },
          { rule: 'only-with', column: 'a', companion: 'a' },
          { rule: 'only-with', column: 'a', companion: 'b', scope: 'dashboard', id: 'ok' },
        ],
      },
      'e',
      problems,
    );
    expect(problems).toEqual([
      'encodingRules must be an object { channels?, rules?, onInvalid?, ruleScope? }',
      'e.bogus is not an encodingRules key',
      'e.onInvalid must be "refuse" or the name of a coercer passed at build',
      'e.ruleScope must be one of view, dashboard',
      'e.channels must be an object mapping chartKind -> ChannelRequirement[]',
      'e.rules must be an array of BusinessRule',
      'e.channels["line"] must be an array of ChannelRequirement',
      'e.channels["bar"][0] must be an object',
      'e.channels["bar"][1].extra is not a ChannelRequirement key',
      'e.channels["bar"][1].channel must be a non-empty string',
      'e.channels["bar"][1].accepts must be an array of column types (number, string, boolean, date, unknown)',
      'e.channels["bar"][1].scale must be one of discrete, continuous',
      'e.channels["bar"][1].roles must be an array of roles (identifier, dimension, measure, absence)',
      'e.channels["bar"][1].notRoles must be an array of roles (identifier, dimension, measure, absence)',
      'e.channels["bar"][1].sentence must be a string',
      'e.channels["bar"][2].channel may not be "*" — it is reserved for a binding set',
      'e.rules[0] must be an object',
      'e.rules[1].rule must be one of never-on, never-together, only-with',
      'e.rules[2].id must be a non-empty string',
      'e.rules[2].sentence must be a string',
      'e.rules[2] must name exactly one of column, role',
      'e.rules[2] must name exactly one of channels, class',
      'e.rules[2].scope does not apply to never-on',
      'e.rules[3] must name exactly one of column, role',
      'e.rules[3].column must be a non-empty string',
      'e.rules[3].role must be one of identifier, dimension, measure, absence',
      'e.rules[3] must name exactly one of channels, class',
      'e.rules[3].channels must be a non-empty array of channel names',
      'e.rules[3].class must be one of magnitude, category',
      'e.rules[5].columns must be exactly two column names',
      'e.rules[6].scope must be one of view, dashboard',
      'e.rules[6].columns names the same column twice',
      'e.rules[7].column must be a non-empty string',
      'e.rules[7].companion must be a non-empty string',
      'e.rules[8].companion is the column itself',
    ]);
  });
});

describe('the edges the coverage gate names', () => {
  it('a changed channel with no binding is skipped; a bound field that is not a column never matches a role rule', () => {
    const scatter: EncodingSurface = { viewId: 's', chartKind: 'scatter', channels: ['x', 'y', 'color'] };
    expect(validateBindings({ view: scatter, bindings: { x: 'cases' }, facets, changed: ['color'] })).toEqual([]);
    const rules: EncodingRules = { rules: [{ rule: 'never-on', role: 'measure', channels: ['color'] }, { rule: 'never-on', column: 'ghost', channels: ['color'] }] };
    const p = validateBindings({ view: scatter, bindings: { color: 'ghost' }, facets, rules });
    expect(p.map((x) => x.rule)).toEqual(['never-on#1', 'column']);
  });
  it('a coercer whose result still fails leaves the refusal in place', () => {
    const heat: EncodingSurface = { viewId: 'h', chartKind: 'heatmap', channels: ['x'] };
    const useless = { name: 'useless', coerce: (f: ColumnFacet) => ({ ...f }) };
    const p = validateBindings({ view: heat, bindings: { x: 'cases' }, facets, rules: { onInvalid: 'useless' }, ports: { coercers: [useless] } });
    expect(p[0]!.severity).toBe('refused');
  });
  it('describe: only-with under dashboard scope without a custom sentence; never-together scoped by the rule set', () => {
    expect(describeRule({ rule: 'only-with', column: 'a', companion: 'b', scope: 'dashboard' })).toBe('"a" is only meaningful while "b" is on the page — bind "b" first');
    expect(describeRules({ ruleScope: 'view', rules: [{ rule: 'never-together', columns: ['a', 'b'] }] })[1]!.sentence).toBe('"a" and "b" never share a chart');
  });
  it('shape: a requirement with every key valid passes', () => {
    const problems: string[] = [];
    validateEncodingRulesShape({ channels: { bar: [{ channel: 'x', accepts: ['number'], scale: 'discrete', roles: ['measure'], notRoles: ['absence'], sentence: 's' }] }, onInvalid: 'refuse', ruleScope: 'view' }, 'e', problems);
    expect(problems).toEqual([]);
  });
});
