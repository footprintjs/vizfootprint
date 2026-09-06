import { describe, expect, it } from 'vitest';
import { buildDashboard, parseDashboardDef, validateDashboardDef } from './index.js';

const JSON_DEF = `{
  "data": { "cases": { "rows": [{ "disease": "Lyme", "cases": 12 }, { "disease": "Zika", "cases": 3 }] } },
  "actors": { "bars": { "actor": "user", "label": "Cases by disease" } },
  "analyses": { "byDisease": { "builtin": "groupBy", "by": "disease", "measure": "cases" } },
  "encodings": [{ "viewId": "bars", "chartKind": "bar", "channels": ["x", "y"], "initial": { "x": "disease", "y": "cases" } }],
  "defaultTable": "cases"
}`;

describe('parseDashboardDef — the door that narrows', () => {
  it('narrows a definition that arrived as JSON, and the def it hands back builds', () => {
    const parsed = parseDashboardDef(JSON.parse(JSON_DEF));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return expect.unreachable('a well-formed def must parse');
    // narrowed: these are reads off a `DashboardDef`, not off an `unknown`
    expect(Object.keys(parsed.def.data)).toEqual(['cases']);
    expect(parsed.def.defaultTable).toBe('cases');
    expect(Object.keys(buildDashboard(parsed.def).engines)).toEqual(['cases']);
  });

  it('hands back the sentences instead, and never a half-typed def', () => {
    const parsed = parseDashboardDef({ data: {}, actors: {}, fdr: { procedure: 'BH', alpha: 2 } });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return expect.unreachable('a malformed def must not parse');
    expect(parsed.problems).toEqual([
      'data must declare at least one table',
      'fdr.procedure must be "LORD++" | "alpha-investing"',
      'fdr.alpha must be a number in (0,1)',
    ]);
  });

  it('is the validator, not a second opinion — the same problems, over anything', () => {
    for (const value of [null, 42, 'a def', [], {}, { data: { t: { rows: [] } } }, JSON.parse(JSON_DEF)]) {
      const problems = validateDashboardDef(value);
      const parsed = parseDashboardDef(value);
      expect(parsed.ok ? [] : parsed.problems).toEqual(problems);
    }
  });
});
