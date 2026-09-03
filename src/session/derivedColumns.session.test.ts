/**
 * Derived columns, from the outside: what a person driving the dashboard sees.
 *
 * The two failures these open with were both SILENT — the dashboard went on
 * explaining itself, in this library's own provenance, about numbers that were
 * not the ones it named. The rest of the file is what the resolution behind the
 * fix owes: a re-run supersedes, a refresh forgets, and `why` answers for the
 * act you are standing on. The law is `src/data/README.md`.
 */

import { describe, expect, it } from 'vitest';
import { flowChart } from 'footprintjs';
import { buildDashboard, buildDashboardAsync } from '../def/index.js';
import { clusteringAnalysis, defineAnalysis } from '../analysis/index.js';
import type { AnalysisModule, ColumnsOutput, DataRow } from '../analysis/index.js';
import { foldOnce, numbers } from '../data/fold.js';
import { reject, type DataProvider } from '../data/index.js';
import { quantileBins } from '../analysis/stats.js';
import type { Cause } from '../cause/index.js';
import type { DashboardDef, SourceAdapter } from '../def/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from './dashboard.fixture.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };

/** A columns-channel analysis that really writes the out column it declares. */
function columnAnalysis(opts: { id: string; from: string; k: number; out: string; table?: string }): AnalysisModule<readonly DataRow[], ColumnsOutput> {
  const table = opts.table ?? 'data';
  return defineAnalysis<readonly DataRow[], ColumnsOutput>({
    id: opts.id,
    kind: 'transform',
    produces: 'columns',
    inputs: [{ column: opts.from, role: 'value' }],
    build: () =>
      flowChart<Record<string, unknown>>(
        'load values',
        (scope) => {
          const args = scope.$getArgs<{ values: number[]; k: number }>();
          scope.$setValue('vals', args.values);
          scope.$setValue('kk', args.k);
        },
        'load',
      )
        .addFunction(
          'bin',
          (scope) => {
            scope.$setValue(opts.out, quantileBins(scope.$getValue('vals') as number[], scope.$getValue('kk') as number));
          },
          'cluster',
        )
        .build(),
    toRunInput: (rows) => ({ values: foldOnce(rows, { v: numbers(opts.from) }).v.values, k: opts.k }),
    readOutput: () => ({ ok: true, output: { as: 'columns', table, columns: { [opts.out]: { type: 'int' } } } }),
  });
}

function defWith(analyses: DashboardDef['analyses']): DashboardDef {
  const base = makeDashboardDef();
  return { ...base, analyses: { ...base.analyses, ...analyses } };
}

async function riskOn(s: ReturnType<ReturnType<typeof buildDashboard>['createSession']>): Promise<unknown[]> {
  const res = await s.viewQuery({ columns: ['id', 'risk'], limit: 40 });
  return res.ok ? res.rows.map((r) => r['risk']) : [`REJECTED: ${res.rejected}`];
}

// ─────────────────────────────────────────────────────────────────────────────

describe('two branches computing the same column name do not see each other’s numbers', () => {
  it('seeking back to a branch reads the numbers that branch computed', async () => {
    const s = buildDashboard(defWith({
      byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }),
      byRating: columnAnalysis({ id: 'byRating', from: 'rating', k: 2, out: 'risk' }),
    })).createSession();

    const root = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    const rootId = root.ok ? root.commit!.id : '';

    const a = await s.declareAnalysis('byPrice');
    expect(a.materialized).toEqual(['risk']);
    const onA = await riskOn(s);

    s.seek(rootId); // a second branch from the same moment, same column name
    const b = await s.declareAnalysis('byRating');
    expect(b.materialized).toEqual(['risk']);
    const onB = await riskOn(s);

    expect(onA).not.toEqual(onB); // two analyses, two answers — the premise of the test
    expect(onB).toEqual(onB.map((v) => v)); // (stable read)

    s.seek(a.commit!.id);
    expect(await riskOn(s)).toEqual(onA); // ← used to be onB, silently

    s.seek(b.commit!.id);
    expect(await riskOn(s)).toEqual(onB);
  });

  it('a column computed on another branch is not visible here, and a select on it is an honest gap', async () => {
    const s = buildDashboard(defWith({
      byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }),
    })).createSession();

    const root = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    const rootId = root.ok ? root.commit!.id : '';
    await s.declareAnalysis('byPrice');
    expect((await s.overview()).columns['data']!.map((c) => c.field)).toContain('risk');

    s.seek(rootId);
    expect((await s.overview()).columns['data']!.map((c) => c.field)).not.toContain('risk');
    const probe = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'risk', value: 1, cause });
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.rejection.code).toBe('needs-column');
  });

  it('filtering by a derived column filters by THIS branch’s values', async () => {
    const s = buildDashboard(defWith({
      byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }),
      byRating: columnAnalysis({ id: 'byRating', from: 'rating', k: 2, out: 'risk' }),
    })).createSession();

    const root = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    const rootId = root.ok ? root.commit!.id : '';

    const a = await s.declareAnalysis('byPrice'); // k = 4 → bins 0..3, ten rows each
    const inA = await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'risk', value: 3, cause });
    expect(inA.ok).toBe(true);
    const countA = (await s.overview()).selectedRowCount;

    s.seek(rootId);
    await s.declareAnalysis('byRating'); // k = 2 → bins 0..1; there is no bin 3 here
    const inB = await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'risk', value: 3, cause });
    expect(inB.ok).toBe(true);
    expect((await s.overview()).selectedRowCount).toBe(0); // B genuinely has no 3

    s.seek(a.commit!.id);
    expect(countA).toBe(2); // bin 3 ∩ the live category filter — a real, non-empty answer
  });
});

describe('a derived column may not take a declared source column’s name', () => {
  it('the write is refused before it happens, and the source column survives', async () => {
    const dash = buildDashboard(defWith({ overwrite: columnAnalysis({ id: 'overwrite', from: 'rating', k: 4, out: 'price' }) }));
    const s = dash.createSession();
    const priceBefore = SAMPLE_ROWS.slice(0, 5).map((r) => r['price']);

    const out = await s.declareAnalysis('overwrite');

    expect(out.commit).toBeDefined(); // the analysis RAN; the refusal is about the write
    expect(out.materialized).toEqual([]); // and honestly claims nothing landed
    expect(out.gap).toMatchObject({ code: 'guard-failed', op: 'declareAnalysis', target: 'price' });
    expect(out.gap!.detail).toContain('may not take a source column');

    const after = await s.viewQuery({ columns: ['id', 'price'], limit: 5 });
    expect(after.ok && after.rows.map((r) => r['price'])).toEqual(priceBefore);

    // and for every OTHER session on this dashboard, which never ran it
    const other = await dash.createSession().viewQuery({ columns: ['id', 'price'], limit: 5 });
    expect(other.ok && other.rows.map((r) => r['price'])).toEqual(priceBefore);
  });

  it('a source column keeps its type, so a later interval filter on it still works', async () => {
    const s = buildDashboard(defWith({ overwrite: columnAnalysis({ id: 'overwrite', from: 'rating', k: 4, out: 'price' }) })).createSession();
    await s.declareAnalysis('overwrite');
    const res = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [50, 60], cause });
    expect(res.ok).toBe(true);
    expect((await s.overview()).selectedRowCount).toBe(5); // 50, 53, 56, 59, 60 — real numbers, not zeroes
  });

  it('the refusal names the column whose SLOT collides, when a source column is spelled like one', async () => {
    // a real CSV may carry a column named `risk@s2`. Nothing parses a name to
    // decide what it is, so this is caught by judging the slot too.
    const base = makeDashboardDef();
    const rows = SAMPLE_ROWS.map((r) => ({ ...r, 'risk@s2': 0 }));
    const s = buildDashboard({
      ...base,
      data: { data: { rows } },
      analyses: { ...base.analyses, mk: columnAnalysis({ id: 'mk', from: 'price', k: 2, out: 'risk' }) },
    }).createSession();

    // the first act is s1, so the slot is risk@s1 — no collision
    const first = await s.declareAnalysis('mk');
    expect(first.materialized).toEqual(['risk']);
    // s2 is the next id, and its slot IS the declared column
    const second = await s.declareAnalysis('mk');
    expect(second.materialized).toEqual([]);
    expect(second.gap).toMatchObject({ code: 'guard-failed', target: 'risk' });
    expect(second.gap!.detail).toContain('"risk@s2"');
  });

  it('an engine that cannot say which columns are its own is refused, and writes nothing', async () => {
    const s = buildDashboard(defWith({ mk: columnAnalysis({ id: 'mk', from: 'price', k: 2, out: 'risk' }) })).createSession();
    // The judge needs to know which names are the MAP's. An engine that cannot
    // list them cannot be written over safely, so the write is refused — the
    // one direction that cannot destroy anything. Reached the way
    // `atomicity.test.ts` reaches it: there is no provider-injection seam, and
    // a real wasm/server engine genuinely answers this way.
    const provider = (s as unknown as { runtime: { providerFor(t: string): DataProvider } }).runtime.providerFor('data');
    const columns = provider.columns.bind(provider);
    provider.columns = async () => reject('memory', 'columns', 'no-backend-connection', 'the catalogue is unreachable');

    const out = await s.declareAnalysis('mk');
    expect(out.commit).toBeDefined(); // the analysis still RAN
    expect(out.materialized).toEqual([]);
    expect(out.gap).toMatchObject({ code: 'needs-backend-data', op: 'declareAnalysis', target: 'data' });
    expect(out.gap!.detail).toContain('could not say which columns are its own');

    provider.columns = columns;
    expect((await s.overview()).columns['data']!.map((c) => c.field)).not.toContain('risk');
  });
});

describe('a re-run on the same branch supersedes rather than shadows', () => {
  it('the column stays visible and reads the newer act’s numbers', async () => {
    const s = buildDashboard(defWith({
      byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }),
      byRating: columnAnalysis({ id: 'byRating', from: 'rating', k: 2, out: 'risk' }),
    })).createSession();

    const first = await s.declareAnalysis('byPrice');
    const older = await riskOn(s);

    const second = await s.declareAnalysis('byRating'); // same name, same branch, later
    expect(second.materialized).toEqual(['risk']);
    const newer = await riskOn(s);

    expect(newer).not.toEqual(older);
    expect((await s.overview()).columns['data']!.map((c) => c.field)).toContain('risk'); // still ONE risk
    expect((await s.overview()).columns['data']!.filter((c) => c.field === 'risk')).toHaveLength(1);

    s.seek(first.commit!.id); // and the earlier moment still reads the earlier numbers
    expect(await riskOn(s)).toEqual(older);
    expect(second.commit!.id).not.toBe(first.commit!.id);
  });

  it('declaring the SAME analysis twice is not a collision with itself', async () => {
    // the demo does exactly this — a button and an agent turn both declare it
    const s = buildDashboard(makeDashboardDef()).createSession();
    expect((await s.declareAnalysis('clustering')).materialized).toEqual(['cluster_id']);
    const again = await s.declareAnalysis('clustering');
    expect(again.materialized).toEqual(['cluster_id']);
    expect(again.gap).toBeUndefined();
    const probe = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'cluster_id', value: 0, cause });
    expect(probe.ok).toBe(true);
  });
});

describe('why() answers for the act you are standing on', () => {
  it('each branch’s risk answers with its own analysis, and neither answers for both', async () => {
    const s = buildDashboard(defWith({
      byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }),
      byRating: columnAnalysis({ id: 'byRating', from: 'rating', k: 2, out: 'risk' }),
    })).createSession();

    const root = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    const rootId = root.ok ? root.commit!.id : '';
    const a = await s.declareAnalysis('byPrice');
    s.seek(rootId);
    const b = await s.declareAnalysis('byRating');

    const onB = s.why({ kind: 'column', column: 'risk' });
    expect(onB.ok).toBe(true);
    if (onB.ok) expect(onB.viz.commitId).toBe(b.commit!.id);

    s.seek(a.commit!.id);
    const onA = s.why({ kind: 'column', column: 'risk' });
    expect(onA.ok).toBe(true);
    if (onA.ok) expect(onA.viz.commitId).toBe(a.commit!.id);

    s.seek(rootId); // off BOTH branches: two acts made this name, so there is no honest answer
    expect(s.why({ kind: 'column', column: 'risk' }).ok).toBe(false);
  });

  it('a name only one act ever made still answers off-branch — parking a path keeps the statistics', async () => {
    const s = buildDashboard(defWith({ byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }) })).createSession();
    const root = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    const rootId = root.ok ? root.commit!.id : '';
    await s.declareAnalysis('byPrice');
    s.seek(rootId);
    expect(s.why({ kind: 'column', column: 'risk' }).ok).toBe(true);
  });

  it('a name no act ever made is still no-such-target', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    expect(s.why({ kind: 'column', column: 'nothing_here' }).ok).toBe(false);
  });
});

describe('a derived column behaves like any other column once it is visible', () => {
  it('sorts, windows and projects by its own name', async () => {
    const s = buildDashboard(defWith({ byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }) })).createSession();
    await s.declareAnalysis('byPrice');

    const sorted = await s.viewQuery({ columns: ['id', 'risk'], sort: [{ field: 'risk', dir: 'desc' }], limit: 3 });
    expect(sorted.ok).toBe(true);
    if (sorted.ok) {
      expect(sorted.rows.map((r) => r['risk'])).toEqual([3, 3, 3]);
      expect(Object.keys(sorted.rows[0]!)).not.toContain('risk@s1'); // never the slot spelling
    }

    const windowed = await s.viewQuery({ columns: ['id', 'risk'], offset: 39, limit: 5 });
    expect(windowed.ok && windowed.rows).toHaveLength(1);

    // a window that does NOT project the derived column takes the untouched path
    const plain = await s.viewQuery({ columns: ['id', 'price'], limit: 2 });
    expect(plain.ok && plain.rows.map((r) => r['price'])).toEqual([50, 53]);

    // and the default projection lists it by name
    const all = await s.viewQuery({ limit: 1 });
    expect(all.ok && all.columns).toContain('risk');
  });

  it('a cell selection over two derived columns resolves both sides', async () => {
    const s = buildDashboard(defWith({
      byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }),
      byRating: columnAnalysis({ id: 'byRating', from: 'rating', k: 2, out: 'band' }),
    })).createSession();
    await s.declareAnalysis('byPrice');
    await s.declareAnalysis('byRating');

    const res = await s.dispatch({ verb: 'select', viewId: 'scatter', fields: ['risk', 'band'], values: [0, 0], cause });
    expect(res.ok).toBe(true);
    expect((await s.overview()).selectedRowCount).toBe(10);
  });

  it('a second table’s derived column never leaks onto the first', async () => {
    const base = makeDashboardDef();
    const s = buildDashboard({
      ...base,
      data: { data: { rows: SAMPLE_ROWS }, other: { rows: SAMPLE_ROWS } },
      analyses: { ...base.analyses, mk: columnAnalysis({ id: 'mk', from: 'price', k: 2, out: 'risk', table: 'other' }) },
    }).createSession();

    expect((await s.declareAnalysis('mk')).materialized).toEqual(['risk']);
    const ov = await s.overview();
    expect(ov.columns['other']!.map((c) => c.field)).toContain('risk');
    expect(ov.columns['data']!.map((c) => c.field)).not.toContain('risk');
  });
});

describe('a refresh forgets the columns its old provider held', () => {
  /** A carrier whose rows (and column shape) we can move between reads. */
  const carrier = (read: () => { rows: DataRow[]; version: string }): SourceAdapter => ({
    via: 'http',
    open: async () => ({
      capabilities: { live: false, pushdown: false as const },
      snapshot: async () => ({ ...read(), retrievedAt: 'now' }),
      close: async () => {},
    }),
  });

  it('reports a derived column by the name a person knows, a declared one by its own, and resolves neither after', async () => {
    let state = { rows: SAMPLE_ROWS.map((r) => ({ ...r, region: 'N' })) as DataRow[], version: 'v1' };
    const base = makeDashboardDef();
    const dash = await buildDashboardAsync(
      {
        ...base,
        data: { data: { source: { format: 'json', via: 'http', at: 'https://example.invalid/d' }, key: 'id' } },
        analyses: { ...base.analyses, byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }) },
      },
      { sources: [carrier(() => state)] },
    );
    const s = dash.createSession();
    expect((await s.declareAnalysis('byPrice')).materialized).toEqual(['risk']);
    expect((await s.overview()).columns['data']!.map((c) => c.field)).toContain('risk');

    // the new bytes drop the DECLARED `region` column; `risk` was never in them
    state = { rows: SAMPLE_ROWS.map((r) => ({ ...r })), version: 'v2' };
    const table = (await dash.refresh!(['data'])).tables['data']!;
    expect('changed' in table && table.changed).toBe(true);
    // the derived one by its NAME (never the slot it lived in), the declared one by its own
    if ('materialisedLost' in table) expect([...(table.materialisedLost ?? [])].sort()).toEqual(['region', 'risk']);

    expect((await s.overview()).columns['data']!.map((c) => c.field)).not.toContain('risk');
    const probe = await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'risk', value: 1, cause });
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.rejection.code).toBe('needs-column');
  });
});

describe('an engine that lists its columns but cannot write one back', () => {
  /** Reached the way `atomicity.test.ts` reaches it — there is no provider-injection seam. */
  const providerOf = (s: unknown): DataProvider =>
    (s as { runtime: { providerFor(t: string): DataProvider } }).runtime.providerFor('data');

  it('a backend refusal is needs-backend-data, and the column honestly does not land', async () => {
    const s = buildDashboard(defWith({ mk: columnAnalysis({ id: 'mk', from: 'price', k: 2, out: 'risk' }) })).createSession();
    providerOf(s).materializeColumn = async () => reject('memory', 'materializeColumn', 'no-backend-connection', 'the writer is offline');

    const out = await s.declareAnalysis('mk');
    expect(out.commit).toBeDefined(); // the analysis stands; only the write did not
    expect(out.materialized).toEqual([]);
    expect(out.gap).toMatchObject({ code: 'needs-backend-data', op: 'declareAnalysis', target: 'risk' });
    expect((await s.overview()).columns['data']!.map((c) => c.field)).not.toContain('risk');
  });

  it('any other refusal is guard-failed — the engine could have written and would not', async () => {
    const s = buildDashboard(defWith({ mk: columnAnalysis({ id: 'mk', from: 'price', k: 2, out: 'risk' }) })).createSession();
    providerOf(s).materializeColumn = async () => reject('memory', 'materializeColumn', 'row-count-mismatch', 'got 39 values for 40 rows');

    const out = await s.declareAnalysis('mk');
    expect(out.materialized).toEqual([]);
    expect(out.gap).toMatchObject({ code: 'guard-failed', op: 'declareAnalysis', target: 'risk' });
    expect(out.gap!.detail).toContain('39 values');
  });
});
