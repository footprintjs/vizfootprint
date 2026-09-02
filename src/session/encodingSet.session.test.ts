/**
 * A binding SET (encoding plane): several channels in one act — judged as a
 * whole, landed as ONE commit, undone as one, brought over as one, replayed
 * on seek — and a swap of the axes never passes through an illegal middle
 * state.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { vizAsTools } from '../agent/vizAsTools.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const fresh = (def: DashboardDef = makeDashboardDef()) => buildDashboard(def).createSession();

describe('reencode with bindings', () => {
  it('a swap lands as ONE commit whose field is the marker and whose value is the map; the fold reads both channels', async () => {
    const s = fresh();
    const before = s.log.records.length;
    const res = await s.dispatch({ verb: 'reencode', viewId: 'scatter', bindings: { x: 'rating', y: 'price' }, cause: userCause('swap axes'), correlationId: 'turn-3' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.commit).toMatchObject({ viewId: 'encoding:scatter', field: '*', value: { x: 'rating', y: 'price' }, correlationId: 'turn-3' });
      expect(res.reencoded).toEqual({ viewId: 'scatter', bindings: { x: 'rating', y: 'price' } });
      expect(res.commit!.cause.intent).toBe('swap axes');
    }
    expect(s.log.records.length).toBe(before + 1);
    expect(s.viewEncodings('scatter')).toEqual({ x: 'rating', y: 'price' });
    expect((await s.overview()).encodings['scatter']).toEqual({ x: 'rating', y: 'price' });
  });
  it('a set is judged as a whole: one misfit refuses the entire act and nothing lands', async () => {
    const s = fresh();
    const before = s.log.records.length;
    const res = await s.dispatch({ verb: 'reencode', viewId: 'scatter', bindings: { x: 'rating', y: 'id' }, cause: userCause() });
    expect(!res.ok && res.rejection.detail).toBe('"id" is string; the y channel of a point needs a number or a date');
    expect(s.log.records.length).toBe(before);
    expect(s.viewEncodings('scatter')).toEqual({ x: 'price', y: 'rating' });
  });
  it('the guards apply to every pair: an unknown channel, an unknown column, an empty set, a view without a surface', async () => {
    const s = fresh();
    const ch = await s.dispatch({ verb: 'reencode', viewId: 'scatter', bindings: { x: 'rating', size: 'price' }, cause: userCause() });
    expect(!ch.ok && ch.rejection.detail).toContain('has no "size" channel');
    const col = await s.dispatch({ verb: 'reencode', viewId: 'scatter', bindings: { x: 'rating', y: 'nope' }, cause: userCause() });
    expect(!col.ok && col.rejection.code).toBe('needs-column');
    const empty = await s.dispatch({ verb: 'reencode', viewId: 'scatter', bindings: {}, cause: userCause() });
    expect(!empty.ok && empty.rejection.detail).toBe('a binding set for "scatter" names no channel');
    const none = await s.dispatch({ verb: 'reencode', viewId: 'cluster', bindings: { x: 'price' }, cause: userCause() });
    expect(!none.ok && none.rejection.detail).toBe('view "cluster" declares no encoding surface');
    const ghost = await s.dispatch({ verb: 'reencode', viewId: 'ghost', bindings: { x: 'price' }, cause: userCause() });
    expect(!ghost.ok && ghost.rejection.code).toBe('needs-view');
    const shape = await s.dispatch({ verb: 'reencode', viewId: 'scatter', bindings: { x: 1 } as unknown as Record<string, string>, cause: userCause() });
    expect(!shape.ok && shape.rejection.detail).toBe('a binding set maps every channel to a column name');
  });
  it('a two-column rule sees the whole chart: the pair that would be illegal one channel at a time is legal as a set', async () => {
    // the scatter starts as x=price, y=rating and the rule forbids price beside rating — so the def builds only with the view scope stated on a pair that holds at start:
    const def: DashboardDef = { ...makeDashboardDef(), encodingRules: { rules: [{ rule: 'only-with', column: 'rating', companion: 'price' }] } };
    const s = fresh(def);
    // one channel at a time: moving rating to x would drop price — refused
    const one = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'rating', cause: userCause() });
    expect(one.ok).toBe(false);
    // as a set, the swap keeps both on the chart — allowed
    const swap = await s.dispatch({ verb: 'reencode', viewId: 'scatter', bindings: { x: 'rating', y: 'price' }, cause: userCause() });
    expect(swap.ok).toBe(true);
  });
  it('undo of a set restores EVERY channel to its prior; undo of a set with no prior restores the declared initial; seek replays the set', async () => {
    const s = fresh();
    const c1 = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'category', cause: userCause() });
    const swap = await s.dispatch({ verb: 'reencode', viewId: 'scatter', bindings: { x: 'rating', y: 'price', color: 'id' }, cause: userCause() });
    const swapId = swap.ok ? swap.commit!.id : '';
    expect(s.viewEncodings('scatter')).toEqual({ x: 'rating', y: 'price', color: 'id' });
    const res = await s.undo(swapId);
    expect(res.ok && res.recipe).toEqual({ apply: 'encoding-set', viewId: 'scatter', bindings: { x: null, y: null, color: 'category' } });
    expect(s.viewEncodings('scatter')).toEqual({ x: 'price', y: 'rating', color: 'category' });
    if (res.ok) expect(res.commit).toMatchObject({ field: '*', value: { x: 'price', y: 'rating', color: 'category' } });
    // seek back to the swap: the fold rebuild reads the set
    s.seek(swapId);
    expect(s.viewEncodings('scatter')).toEqual({ x: 'rating', y: 'price', color: 'id' });
    void c1;
  });
  it('undo of a set whose channel has no prior AND no declared initial is an honest gap', async () => {
    const s = fresh();
    const set = await s.dispatch({ verb: 'reencode', viewId: 'scatter', bindings: { color: 'category' }, cause: userCause() });
    const res = await s.undo(set.ok ? set.commit!.id : '');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.gap.detail).toContain('declares no initial "color" binding to restore');
  });
  it('bring-over re-lands the set as one commit on the other path, naming a conflict on any channel it touched', async () => {
    const s = fresh();
    const base = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const baseId = base.ok ? base.commit!.id : '';
    const a = await s.dispatch({ verb: 'reencode', viewId: 'scatter', bindings: { x: 'rating', y: 'price' }, cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    // a sibling path from the base commit: a single-channel reencode of x there
    s.seek(baseId);
    const b = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'rating', cause: userCause() });
    const bId = b.ok ? b.commit!.id : '';
    const res = await s.bringOver(aId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.recipe).toEqual({ apply: 'encoding-set', viewId: 'scatter', bindings: { x: 'rating', y: 'price' } });
      expect(res.conflicts).toEqual([bId]);
      expect(res.commit).toMatchObject({ field: '*', value: { x: 'rating', y: 'price' } });
      expect(res.commit!.cause.conflicts).toEqual([bId]);
    }
    expect(s.viewEncodings('scatter')).toEqual({ x: 'rating', y: 'price' });
  });
  it('the agent tool accepts bindings, refuses a malformed set, and still takes channel+field', async () => {
    const s = fresh();
    const port = vizAsTools(s);
    expect(port.tools().some((t) => t.name === 'viz.dispatch')).toBe(true);
    const dispatchName = 'viz.dispatch';
    const swap = await port.call(dispatchName, { verb: 'reencode', viewId: 'scatter', bindings: { x: 'rating', y: 'price' }, intent: 'swap' });
    expect(swap.ok).toBe(true);
    expect(s.viewEncodings('scatter')).toEqual({ x: 'rating', y: 'price' });
    const bad = await port.call(dispatchName, { verb: 'reencode', viewId: 'scatter', bindings: { x: 1 } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(String(bad.detail)).toContain('bindings must be an object');
    const missing = await port.call(dispatchName, { verb: 'reencode', viewId: 'scatter' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(String(missing.detail)).toContain('or bindings');
    const noView = await port.call(dispatchName, { verb: 'reencode', bindings: { x: 'rating' } });
    expect(noView.ok).toBe(false);
    const one = await port.call(dispatchName, { verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'category' });
    expect(one.ok).toBe(true);
    // whats_here projects fits to the names that fit
    const here = (await port.call('viz.whats_here')) as { ok: boolean; views: { viewId: string; accepts?: Record<string, string[]>; fits?: unknown }[] };
    const scatter = here.views.find((v) => v.viewId === 'scatter')!;
    expect(scatter.fits).toBeUndefined();
    expect(scatter.accepts!['x']).toEqual(['price', 'rating']);
    expect(here.views.find((v) => v.viewId === 'cluster')!.accepts).toBeUndefined();
  });
});

describe('a set under the coerce policy', () => {
  it('lands and reports the coercion on the result', async () => {
    const { discreteCoercer } = await import('../def/index.js');
    const s = buildDashboard({ ...makeDashboardDef(), encodingRules: { onInvalid: 'discrete' } }, { encoding: { coercers: [discreteCoercer] } }).createSession();
    const res = await s.dispatch({ verb: 'reencode', viewId: 'bar', bindings: { x: 'price', color: 'category' }, cause: userCause() });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.coerced!.map((p) => [p.channel, p.severity])).toEqual([['x', 'coerced']]);
  });
});
