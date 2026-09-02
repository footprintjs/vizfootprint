/**
 * The DISPATCH door of the encoding plane: a reencode that breaks the law is
 * a gap with the sentence (never an exception), a lawful one lands, a named
 * coercer may take a misfit under the coerce policy, and the overview serves
 * what fits where plus the rules as sentences.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, discreteCoercer } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const fresh = (def: DashboardDef = makeDashboardDef(), ports?: Parameters<typeof buildDashboard>[1]) => buildDashboard(def, ports).createSession();

describe('reencode through the one validator', () => {
  it('a misfit is refused with the sentence, nothing lands, and the gap is filed', async () => {
    const s = fresh();
    const before = (await s.overview()).gaps;
    const res = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'id', cause: userCause() });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.rejection.code).toBe('guard-failed');
      expect(res.rejection.detail).toBe('"id" is string; the x channel of a point needs a number or a date');
      expect(res.rejection.target).toBe('id');
    }
    expect(s.viewEncodings('scatter')).toEqual({ x: 'price', y: 'rating' });
    expect((await s.overview()).gaps).toBe(before + 1);
  });
  it('a business rule refuses at dispatch with its own sentence; a lawful rebind lands', async () => {
    const def = makeDashboardDef();
    const s = fresh({ ...def, encodingRules: { rules: [{ rule: 'never-on', column: 'rating', channels: ['color'], sentence: 'a rating is never a hue' }] } });
    const no = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'rating', cause: userCause() });
    expect(!no.ok && no.rejection.detail).toBe('a rating is never a hue');
    const yes = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'category', cause: userCause() });
    expect(yes.ok).toBe(true);
    if (yes.ok) expect(yes.coerced).toBeUndefined();
    expect(s.viewEncodings('scatter')).toEqual({ x: 'price', y: 'rating', color: 'category' });
  });
  it('dashboard scope reads the other views: a never-together pair across two charts', async () => {
    const def = makeDashboardDef();
    // the fixture starts with price on the scatter and category on the bar, so a page-wide pair of the two is refused at BUILD
    expect(() => fresh({ ...def, encodingRules: { rules: [{ rule: 'never-together', columns: ['price', 'category'] }] } })).toThrow(/never share the page/);
    // a pair of price and rating is fine page-wide only if they never meet on one chart — they do (the scatter), so the view scope refuses too
    expect(() => fresh({ ...def, encodingRules: { rules: [{ rule: 'never-together', columns: ['price', 'rating'], scope: 'view' }] } })).toThrow(/never share a chart/);
    // a pair that holds at the start, then broken by an act: id and category page-wide
    const s = fresh({ ...def, encodingRules: { rules: [{ rule: 'never-together', columns: ['id', 'category'] }] } });
    const res = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'id', cause: userCause() });
    expect(!res.ok && res.rejection.detail).toBe('"id" and "category" never share the page');
    // the same pair with view scope: the bar's category is on another chart, so the scatter may take id on color
    const v = fresh({ ...def, encodingRules: { ruleScope: 'view', rules: [{ rule: 'never-together', columns: ['id', 'category'] }] } });
    expect((await v.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'id', cause: userCause() })).ok).toBe(true);
  });
  it('the coerce policy: a named coercer passed at build takes a misfit and the coercion rides the result; without the port it is refused', async () => {
    const def: DashboardDef = { ...makeDashboardDef(), encodingRules: { onInvalid: 'discrete' } };
    const withPort = fresh(def, { encoding: { coercers: [discreteCoercer] } });
    const res = await withPort.dispatch({ verb: 'reencode', viewId: 'bar', channel: 'x', field: 'price', cause: userCause() });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.coerced).toHaveLength(1);
      expect(res.coerced![0]).toMatchObject({ severity: 'coerced', field: 'price', channel: 'x', coercedTo: { field: 'price', scale: 'discrete' } });
      expect(res.coerced![0]!.sentence).toBe('"price" is continuous; the x channel of a bar needs a discrete column');
    }
    expect(withPort.viewEncodings('bar')).toEqual({ x: 'price' });
    const withoutPort = fresh(def);
    const refused = await withoutPort.dispatch({ verb: 'reencode', viewId: 'bar', channel: 'x', field: 'price', cause: userCause() });
    expect(refused.ok).toBe(false);
  });
  it('an explainer port adds prose and the gap carries it; the overview serves fits, rules and the policy', async () => {
    // rating is only meaningful beside price — true on the scatter from the start, so the def builds
    const def: DashboardDef = { ...makeDashboardDef(), encodingRules: { rules: [{ rule: 'only-with', column: 'rating', companion: 'price' }] } };
    const s = fresh(def, { encoding: { explainer: { explain: (p) => `${p.sentence} (rule ${p.rule})` } } });
    const res = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'y', field: 'id', cause: userCause() });
    expect(!res.ok && res.rejection.detail).toBe('"id" is string; the y channel of a point needs a number or a date (rule channel:point.y)');
    // the rule at dispatch: rating on the bar's color has no price beside it
    const lonely = await s.dispatch({ verb: 'reencode', viewId: 'bar', channel: 'color', field: 'rating', cause: userCause() });
    expect(!lonely.ok && lonely.rejection.detail).toBe('"rating" is only meaningful with "price" on the same chart — bind "price" first (rule only-with#0)');

    const o = await s.overview();
    expect(o.encodingPolicy).toEqual({ onInvalid: 'refuse', ruleScope: 'dashboard' });
    expect(o.rules.map((r) => [r.id, r.builtIn])).toEqual([
      ['absence-never-magnitude', true],
      ['only-with#0', false],
    ]);
    expect(o.rules[1]!.sentence).toBe('"rating" is only meaningful with "price" on the same chart — bind "price" first');
    const scatter = o.views.find((v) => v.viewId === 'scatter')!;
    expect(Object.keys(scatter.fits!)).toEqual(['x', 'y', 'color']);
    // rating cannot take x: it would REPLACE price there, and rating is only meaningful beside price — fits judges the resulting chart
    expect(scatter.fits!['x']!.filter((f) => f.ok).map((f) => f.field)).toEqual(['price']);
    expect(scatter.fits!['x']!.find((f) => f.field === 'rating')!.because).toContain('bind "price" first');
    expect(scatter.fits!['color']!.filter((f) => f.ok).map((f) => f.field)).toEqual(['id', 'category', 'price', 'rating']);
    // the law comes first: id on x would replace price, orphaning rating — the only-with sentence, before the type mismatch
    expect(scatter.fits!['x']!.find((f) => f.field === 'id')!.because).toBe('"rating" is only meaningful with "price" on the same chart — bind "price" first (rule only-with#0)');
    expect(scatter.fits!['color']!.find((f) => f.field === 'id')!.ok).toBe(true);
    const bar = o.views.find((v) => v.viewId === 'bar')!;
    expect(bar.fits!['color']!.find((f) => f.field === 'rating')).toEqual({ field: 'rating', ok: false, because: '"rating" is only meaningful with "price" on the same chart — bind "price" first (rule only-with#0)' });
    expect(bar.fits!['color']!.find((f) => f.field === 'price')!.ok).toBe(true);
    // a view with no encoding surface has no fits
    expect(o.views.find((v) => v.viewId === 'cluster')!.fits).toBeUndefined();
    // facets carry the plane's words
    expect(o.columns['data']!.find((c) => c.field === 'price')).toEqual({ field: 'price', type: 'number', scale: 'continuous' });
  });
});
