/**
 * The PIN: `whatFits` (asked before anything is built) and the dashboard's own
 * lint (asked after, with the data) must answer the same thing in the same
 * words. They can only do that by being the same two calls — `resolveFacets`
 * then the one validator — which is what this file fails on if either side
 * ever grows a rule of its own.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, lintEncodings, resolveFacets, whatFits } from './index.js';
import type { DashboardDef, EncodingRules, FitColumn } from './index.js';
import { describeTable } from '../data/index.js';
import type { Row } from '../data/index.js';

/** NNDSS-shaped: a week's counts per disease per jurisdiction, with a declared absence column. */
const ROWS: Row[] = Array.from({ length: 12 }, (_, i) => {
  const report_state = ['present', 'unavailable', 'unknown'][i % 3]!;
  // a silent row carries NO value in its measures — a number there would contradict the absence column, and the def door refuses it
  const reported = report_state === 'present';
  return {
    jurisdiction: ['Texas', 'Ohio', 'Maine'][i % 3]!,
    case_id: i,
    disease: ['Lyme', 'Zika'][i % 2]!,
    cases: reported ? 10 + i * 3 : null,
    ytd: reported ? 100 + i * 9 : null,
    t: new Date(Date.UTC(2024, 0, 1 + i * 7)),
    report_state,
  };
});

const DECLS = {
  jurisdiction: { role: 'identifier' as const },
  case_id: { role: 'identifier' as const },
  disease: { role: 'dimension' as const },
  cases: { role: 'measure' as const },
  ytd: { role: 'measure' as const, label: 'year to date' },
};
const ABSENCE = { field: 'report_state', states: ['present', 'unavailable', 'unknown'] };
const RULES: EncodingRules = { rules: [{ rule: 'never-on', column: 'ytd', channels: ['color'] }] };
const CHART_KIND = 'line';
const CHANNELS = ['x', 'y', 'color'];
const VIEW_ID = 'weeks';

/** The table as the wizard holds it: what `describeTable` sniffed, plus what the person declared. */
const wizardColumns = (): FitColumn[] =>
  describeTable(ROWS).columns.map((c) => ({ name: c.name, type: c.type, ...(DECLS[c.name as keyof typeof DECLS] ?? {}) }));

const makeDef = (initial: Record<string, string>): DashboardDef => ({
  data: { cases: { rows: ROWS, absence: ABSENCE, columns: DECLS } },
  actors: { [VIEW_ID]: { actor: 'user', label: 'Weeks' } },
  encodings: [{ viewId: VIEW_ID, chartKind: CHART_KIND, channels: CHANNELS, initial }],
  encodingRules: RULES,
  defaultTable: 'cases',
});

describe('whatFits answers what the build answers', () => {
  it('every column on every channel: the same verdict, the same sentence', () => {
    const columns = wizardColumns();
    const fits = whatFits({ columns, absence: ABSENCE, chartKind: CHART_KIND, channels: CHANNELS, rules: RULES, viewId: VIEW_ID });
    // the facets the def door resolves (`facetSourceOf` + `resolveFacets`), from the same described table
    const facets = resolveFacets(columns.map((c) => ({ name: c.name, type: c.type ?? 'unknown' })), { columns: DECLS, absence: ABSENCE });

    let refusals = 0;
    for (const channel of CHANNELS) {
      for (const { name } of columns) {
        // what the LINT door says when exactly this binding is declared
        const problems = lintEncodings({
          views: [{ viewId: VIEW_ID, chartKind: CHART_KIND, channels: CHANNELS, initial: { [channel]: name } }],
          facets,
          rules: RULES,
        });
        const fit = fits[channel]!.find((f) => f.field === name)!;
        expect(fit.ok).toBe(problems.length === 0);
        expect(fit.because).toBe(problems[0]?.sentence);
        refusals += problems.length;
      }
    }
    expect(refusals).toBe(16); // the fixture really does refuse things; an all-ok sweep would prove nothing
  });

  it('and the same, end to end: describeTable → whatFits vs buildDashboard → lint', async () => {
    const initial = { x: 't', y: 'disease', color: 'cases' };
    const dash = buildDashboard(makeDef(initial));
    const problems = await dash.lint();
    const fits = whatFits({ columns: wizardColumns(), absence: ABSENCE, chartKind: CHART_KIND, channels: CHANNELS, rules: RULES, viewId: VIEW_ID, bindings: initial });

    // the def BUILT: with no column types, nothing the def alone could prove was broken
    expect(problems.map((p) => `${p.channel}: ${p.sentence}`)).toEqual([
      'y: "disease" is string; the y channel of a line needs a number',
      'color: "cases" is continuous; the color channel of a line needs a discrete column',
    ]);
    for (const [channel, field] of Object.entries(initial)) {
      const fit = fits[channel]!.find((f) => f.field === field)!;
      expect(fit.because).toBe(problems.find((p) => p.channel === channel && p.field === field)?.sentence);
    }
  });
});
