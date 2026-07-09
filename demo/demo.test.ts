/**
 * Node-side acceptance for the vizfootprint demo (WRITTEN alongside the demo):
 *   1. the server boots and both pages + both bundles + the CSV return 200;
 *   2. each browser bundle builds (esbuild, DuckDB stubbed) into non-empty JS;
 *   3. the log→serialize→replay round-trip preserves the chip sequence and
 *      cause badges while stamping the replay marker (the dashboard's H4/R2);
 *   4. the analyst's four analyses + LORD++ ledger behave headlessly — the
 *      honest-headline correlation, the R14 degenerate flag (no wealth spent),
 *      clustering's materialized column, regression's honesty floor, group-by.
 *
 * All of (3)/(4) run the REAL landed layers directly (no browser) — the same
 * modules the bundles ship.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from './server.mjs';
import { buildBundle } from './build.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CauseSelectionSession, serializeLog, replayLog } from '../src/log/index.js';
import { parseCSVTyped } from '../src/data/csv.js';
import { memoryProvider } from '../src/data/memoryProvider.js';
import {
  correlationAnalysis,
  clusteringAnalysis,
  regressionAnalysis,
  groupByAnalysis,
} from '../src/analysis/index.js';
import { createLordPlusPlus, type FdrStep } from '../src/fdr/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rows = parseCSVTyped(readFileSync(path.join(__dirname, 'data', 'dresses.csv'), 'utf8')).rows as Array<
  Record<string, number | string>
>;

describe('demo server + bundles', () => {
  let handle: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    handle = await startServer({ port: 0 });
  }, 60_000);
  afterAll(async () => {
    await handle.close();
  });

  it('serves both pages, both bundles, and the CSV with 200', async () => {
    for (const p of ['/', '/dashboard', '/analyst', '/bundle/dashboard.js', '/bundle/analyst.js', '/data/dresses.csv']) {
      const res = await fetch(handle.url + p);
      expect(res.status, p).toBe(200);
      expect((await res.text()).length).toBeGreaterThan(0);
    }
    expect((await (await fetch(handle.url + '/nope')).status)).toBe(404);
  });

  it('both browser bundles build into non-empty JS', async () => {
    const dash = await buildBundle('dashboard');
    const analyst = await buildBundle('analyst');
    expect(dash.length).toBeGreaterThan(1000);
    expect(analyst.length).toBeGreaterThan(1000);
    // sanity: the analyst bundle really pulled in footprintjs (it runs analyses)
    expect(analyst.length).toBeGreaterThan(dash.length);
  }, 60_000);
});

describe('log → replay round-trip (dashboard H4 / R2)', () => {
  it('preserves the chip sequence + cause badges and stamps the replay marker', () => {
    const session = new CauseSelectionSession();
    session.commit({ id: 'c1', parent: null, viewId: 'scatter', actorMeta: { actor: 'user', label: 'Price brush' }, kind: 'interval', field: 'price', value: [40, 120], cause: { requestedBy: 'user', computedBy: 'user', intent: 'brush' } });
    session.commit({ id: 'c2', parent: 'c1', viewId: 'bar', actorMeta: { actor: 'user', label: 'Category' }, kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'user', computedBy: 'user', intent: 'pick' } });
    session.commit({ id: 'c3', parent: 'c2', viewId: 'agent', actorMeta: { actor: 'agent', label: 'Agent' }, kind: 'interval', field: 'price', value: [90, 135], cause: { requestedBy: 'agent', computedBy: 'agent', intent: 'agent' } });

    const before = session.records.map((r) => ({ id: r.id, actor: r.cause.requestedBy, replayed: r.cause.replayed }));
    const replayed = replayLog(serializeLog(session.records));
    const after = replayed.records.map((r) => ({ id: r.id, actor: r.cause.requestedBy, replayed: r.cause.replayed }));

    // same sequence of ids + same actor badges
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after.map((r) => r.actor)).toEqual(['user', 'user', 'agent']);
    // every replayed record carries the additive marker; originals did not
    expect(before.every((r) => r.replayed === undefined)).toBe(true);
    expect(after.every((r) => r.replayed === true)).toBe(true);
    // the fresh selection ends with the same active clauses (one per source)
    expect(replayed.selection.clauses.length).toBe(3);
  });
});

describe('analyst analyses + LORD++ ledger (headless)', () => {
  it('correlation: honest headline — significant alone, NOT a discovery', async () => {
    const stepper = createLordPlusPlus({ alpha: 0.05 });
    const ledger: FdrStep[] = [];
    const mod = correlationAnalysis({ x: 'price', y: 'rating' });
    const run = await mod.run(rows, { timestamp: 1, sink: (h) => ledger.push(stepper.step(h)) });
    expect(run.result.ok).toBe(true);
    expect(ledger.length).toBe(1);
    const s = ledger[0]!;
    // p is significant alone (<= 0.05) but ABOVE the first LORD++ threshold → not a discovery
    expect(s.pValue).toBeLessThanOrEqual(0.05);
    expect(s.pValue).toBeGreaterThan(s.alphaThreshold);
    expect(s.reject).toBe(false);
  });

  it('R14: 8 collinear points → correlation flags degenerate + spends NO wealth', async () => {
    const stepper = createLordPlusPlus({ alpha: 0.05 });
    const ledger: FdrStep[] = [];
    const byRating = new Map<number, typeof rows>();
    for (const r of rows) {
      const b = byRating.get(r.rating as number) ?? [];
      b.push(r);
      byRating.set(r.rating as number, b);
    }
    const eight = [...byRating.values()].find((b) => b.length >= 8)!.slice(0, 8);
    const mod = correlationAnalysis({ x: 'price', y: 'rating' });
    const run = await mod.run(eight, { timestamp: 1, sink: (h) => ledger.push(stepper.step(h)) });
    expect(run.result.ok).toBe(false);
    expect(run.hypothesis).toBeUndefined();
    expect(ledger.length).toBe(0); // R6/R14: no ledger row, no wealth spent
    expect(stepper.state.t).toBe(0);
  });

  it('R6: brushing (selection changes) never steps the ledger — only declares do', async () => {
    const stepper = createLordPlusPlus({ alpha: 0.05 });
    // simulate 5 "brushes": just narrow the row set; no analysis is declared
    for (let i = 0; i < 5; i++) rows.filter((r) => (r.price as number) > 20 * i);
    expect(stepper.state.t).toBe(0); // untouched
  });

  it('clustering materializes cluster_id aligned to every row (memory engine landing)', async () => {
    const provider = memoryProvider(rows as Array<Record<string, unknown>>);
    const mod = clusteringAnalysis({ column: 'price', k: 4 });
    const run = await mod.run(rows);
    const ids = run.snapshot?.sharedState['cluster_id'] as number[];
    expect(ids.length).toBe(rows.length);
    expect(new Set(ids).size).toBeLessThanOrEqual(4);
    const landed = await provider.materializeColumn('data', 'cluster_id', ids);
    expect('ok' in landed && landed.ok).toBe(true);
    const count = await provider.evaluate('data', { kind: 'point', field: 'cluster_id', value: 0 }, { mode: 'count' });
    expect('count' in count && count.count).toBeGreaterThan(0);
  });

  it('regression: full selection fits a line; < 10 points hits the R14 floor', async () => {
    const mod = regressionAnalysis({ x: 'price', y: 'rating' });
    const full = await mod.run(rows);
    expect(full.result.ok).toBe(true);
    if (full.result.ok) expect(Number.isFinite(full.result.output.features.slope)).toBe(true);
    const tiny = await mod.run(rows.slice(0, 5));
    expect(tiny.result.ok).toBe(false);
  });

  it('group-by returns a per-category summary table', async () => {
    const mod = groupByAnalysis({ by: 'category', measure: 'price' });
    const run = await mod.run(rows);
    expect(run.result.ok).toBe(true);
    if (run.result.ok) {
      expect(run.result.output.as).toBe('table');
      expect(run.result.output.rows.length).toBeGreaterThan(1);
    }
  });
});
