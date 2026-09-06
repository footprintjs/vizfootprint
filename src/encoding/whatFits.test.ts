import { describe, expect, it } from 'vitest';
import { WHAT_FITS_VIEW_ID, acceptsOf, whatFits } from './index.js';
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
      x: ['cases', 'ytd', 't', 'mystery'],
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
