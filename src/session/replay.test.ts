/**
 * REPLAY — a session rebuilt from nothing but its log.
 *
 * `replayLog` (L1) rebuilds a log into a LOG. This is the door that rebuilds
 * one into a SESSION: the fold, the refs, the cursor, the dashboard's commit-id
 * counter, and the columns an analysis wrote — which are the one thing no log
 * carries, because a log records that an ACT happened and never the values it
 * produced (`src/data/README.md`).
 *
 * The law it is written to, with its worked example, is `./README.md`, law 6.
 * `conformance.test.ts` is the other half: it proves that what comes back
 * through this door folds identically to the walk that produced it.
 */

import { describe, expect, it } from 'vitest';
import { flowChart } from 'footprintjs';
import { buildDashboard } from '../def/index.js';
import { defineAnalysis } from '../analysis/index.js';
import type { AnalysisModule, ColumnsOutput, DataRow } from '../analysis/index.js';
import { foldOnce, numbers } from '../data/fold.js';
import { quantileBins } from '../analysis/stats.js';
import { reject, type DataProvider } from '../data/index.js';
import { serializeLog, type CommitRecord } from '../log/index.js';
import { analysisActOf } from './namespaces.js';
import type { Cause } from '../cause/index.js';
import type { DashboardDef } from '../def/index.js';
import type { InteractionSession } from './session.js';
import { makeDashboardDef, SAMPLE_ROWS } from './dashboard.fixture.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };
type Session = ReturnType<ReturnType<typeof buildDashboard>['createSession']>;

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

/** Reached the way the sibling suites reach it — there is no provider-injection seam. */
const providerOf = (s: unknown): DataProvider =>
  (s as { runtime: { providerFor(t: string): DataProvider } }).runtime.providerFor('data');

/** One column, as a reader at the cursor sees it. */
async function columnAt(s: InteractionSession, name: string, table?: string): Promise<unknown[]> {
  const res = await s.viewQuery({ columns: ['id', name], limit: 40, ...(table !== undefined ? { table } : {}) });
  return res.ok ? res.rows.map((r) => r[name]) : [`REJECTED: ${res.rejected}`];
}

/**
 * A short walk every test below can replay: a pick, a brush, a fork back to
 * the pick, and a sibling on the new lineage — so the log is a branching
 * history, not a straight line. THREE commits: a `fork` moves the cursor and
 * lands nothing, which is why the sibling parents from `first`.
 */
async function walk(s: Session): Promise<{ first: string; tip: string }> {
  const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
  expect(a.ok).toBe(true);
  const first = a.ok ? a.commit!.id : '';
  expect((await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 120], cause })).ok).toBe(true);
  expect((await s.dispatch({ verb: 'fork', fromCommitId: first, cause })).ok).toBe(true);
  const b = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause });
  expect(b.ok).toBe(true);
  return { first, tip: b.ok ? b.commit!.id : '' };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('a replay is a beginning, not a merge', () => {
  it('refuses a session that already holds commits, and moves nothing', async () => {
    const source = buildDashboard(makeDashboardDef()).createSession();
    await walk(source);
    const wire = source.log.records;

    const used = buildDashboard(makeDashboardDef()).createSession();
    expect((await used.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause })).ok).toBe(true);
    const before = { ids: used.log.records.map((r) => r.id), head: used.head, cursor: used.cursor() };

    const res = await used.replay(wire);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.gap).toMatchObject({ code: 'guard-failed', op: 'replay' });
    expect(res.gap.detail).toContain('1 commit —');
    expect(res.gap.detail).toContain('a replay is a beginning, not a merge');
    // nothing moved
    expect({ ids: used.log.records.map((r) => r.id), head: used.head, cursor: used.cursor() }).toEqual(before);
  });

  it('says how many commits are in the way, in the plural', async () => {
    const used = buildDashboard(makeDashboardDef()).createSession();
    await walk(used);
    const res = await used.replay([]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.gap.detail).toContain('3 commits —');
  });
});

describe('judge first: a refusal lands nothing at all', () => {
  it('refuses a payload that is not JSON', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const res = await s.replay('{not json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.gap.detail).toContain('the log is not JSON:');
    expect(s.log.records).toHaveLength(0);
  });

  it('refuses a malformed log, naming the FIRST bad record', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const res = await s.replay('[{"anything":"at all"}]');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap.detail).toContain('commit #0 (no id)');
      expect(res.gap.detail).toContain('unknown key "anything"');
    }
    expect(s.log.records).toHaveLength(0);
  });

  it('refuses a record that PARSES but cannot be landed — and lands none of the log', async () => {
    const source = buildDashboard(makeDashboardDef()).createSession();
    await walk(source);
    // a well-formed log whose second commit names a cross-filter client no
    // earlier commit ever registered: `parseCommitLog` has no view world to
    // judge that against, and `log.commit` throws on it
    const wire = JSON.parse(serializeLog(source.log.records)) as { clientViewIds: string[] }[];
    wire[1]!.clientViewIds = ['scatter', 'ghost'];

    const s = buildDashboard(makeDashboardDef()).createSession();
    const res = await s.replay(JSON.stringify(wire));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap.detail).toContain('commit #1 "s2" cannot be landed');
      expect(res.gap.detail).toContain('ghost');
    }
    // the FIRST record was landable and is still not on the log — all or nothing
    expect(s.log.records).toHaveLength(0);
    expect(s.head).toBeNull();
    expect(s.cursor()).toBeNull();
  });

  it('an empty log into an empty session is a legal no-op', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const res = await s.replay([]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect({ landed: res.landed, reran: res.reran, filed: res.filed }).toEqual({ landed: 0, reran: 0, filed: 0 });
    expect(s.cursor()).toBeNull();
    expect(res.overview.activeSelections).toEqual([]);
  });
});

describe('the records land verbatim, and the ids they carry stay spent', () => {
  it('same ids, same predicates, `replayed` added and nothing else', async () => {
    const source = buildDashboard(makeDashboardDef()).createSession();
    await walk(source);

    const s = buildDashboard(makeDashboardDef()).createSession();
    const res = await s.replay(serializeLog(source.log.records));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.landed).toBe(3);

    expect(s.log.records.map((r) => r.id)).toEqual(source.log.records.map((r) => r.id));
    expect(s.log.records.map((r) => r.parent)).toEqual(source.log.records.map((r) => r.parent));
    expect(s.log.records.map((r) => r.predicateSQL)).toEqual(source.log.records.map((r) => r.predicateSQL));
    expect(s.log.records.every((r) => r.cause.replayed === true)).toBe(true);
    expect(s.log.records.map((r) => [r.cause.requestedBy, r.cause.computedBy]))
      .toEqual(source.log.records.map((r) => [r.cause.requestedBy, r.cause.computedBy]));
  });

  it('the dashboard cannot mint an id a replayed record already names', async () => {
    const source = buildDashboard(makeDashboardDef()).createSession();
    const { tip } = await walk(source);
    expect(tip).toBe('s3');

    const dash = buildDashboard(makeDashboardDef());
    const s = dash.createSession();
    expect((await s.replay(source.log.records)).ok).toBe(true);

    const next = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Work', cause });
    expect(next.ok && next.commit!.id).toBe('s4'); // never s1…s3 again
    // and a session opened later on the same dashboard keeps counting past them
    const other = dash.createSession();
    const alongside = await other.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Summer', cause });
    expect(alongside.ok && alongside.commit!.id).toBe('s5');
  });

  it('a bookmark restored before the replay still names the same act', async () => {
    const source = buildDashboard(makeDashboardDef()).createSession();
    const { first } = await walk(source);
    expect(source.bookmark('the Formal pick', first).ok).toBe(true);
    const kept = source.bookmarks().map((b) => ({ name: b.name, commitId: b.commitId, by: b.by, at: b.at, id: b.id }));

    const dash = buildDashboard(makeDashboardDef());
    expect(dash.restoreBookmarks(kept).restored).toEqual(['the Formal pick']);
    const s = dash.createSession();
    expect((await s.replay(source.log.records)).ok).toBe(true);

    const back = s.bookmarks()[0]!;
    expect(back.commitId).toBe(first);
    expect(s.seek(back.commitId).ok).toBe(true); // the name still finds the moment
    const here = await s.overview();
    expect(here.activeSelections.map((sel) => sel.value)).toEqual(['Formal']);
  });

  it('the cursor, the head and the named paths come back as the walk left them', async () => {
    const source = buildDashboard(makeDashboardDef()).createSession();
    const { tip } = await walk(source);

    const s = buildDashboard(makeDashboardDef()).createSession();
    expect((await s.replay(source.log.records)).ok).toBe(true);
    expect(s.cursor()).toBe(tip);
    expect(s.head).toBe(tip);
    // the fork made a second lineage on the walk, and it is a second lineage here
    expect(s.branches()).toHaveLength(source.branches().length);
    expect(s.paths().map((p) => p.steps).sort()).toEqual(source.paths().map((p) => p.steps).sort());
  });

  it('a replay STAMPS NOTHING: a record that claimed no data version still claims none', async () => {
    const source = buildDashboard(makeDashboardDef()).createSession();
    await walk(source);
    expect(source.log.records.every((r) => r.data === undefined)).toBe(true);

    const s = buildDashboard(makeDashboardDef()).createSession();
    expect((await s.replay(source.log.records)).ok).toBe(true);
    expect(s.log.records.every((r) => r.data === undefined)).toBe(true);
    // …and the hook is put back, so the next real act stamps as it always did
    const next = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Work', cause });
    expect(next.ok).toBe(true);
    expect((s as unknown as { log: { stampData?: unknown } }).log.stampData).toBeTypeOf('function');
  });
});

describe('a replay re-performs the acts it can', () => {
  it('rebuilds a derived column into the very slot the act gave it', async () => {
    const def = defWith({ byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }) });
    const source = buildDashboard(def).createSession();
    await source.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    const made = await source.declareAnalysis('byPrice');
    expect(made.materialized).toEqual(['risk']);
    const walked = await columnAt(source, 'risk');

    const s = buildDashboard(def).createSession();
    const res = await s.replay(source.log.records);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect({ reran: res.reran, filed: res.filed }).toEqual({ reran: 1, filed: 0 });
    expect(await columnAt(s, 'risk')).toEqual(walked);
    expect(res.overview.columns['data']!.map((c) => c.field)).toContain('risk');
    // the provenance came back beside the values
    const why = s.why({ kind: 'column', column: 'risk' });
    expect(why.ok).toBe(true);
    if (why.ok) expect({ key: why.key, commitId: why.viz.commitId }).toEqual({ key: 'risk', commitId: made.commit!.id });
  });

  it('re-performs each act AT ITS OWN POSITION, so two branches keep their own numbers', async () => {
    const def = defWith({
      byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }),
      byRating: columnAnalysis({ id: 'byRating', from: 'rating', k: 2, out: 'risk' }),
    });
    const source = buildDashboard(def).createSession();
    const root = await source.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    const rootId = root.ok ? root.commit!.id : '';
    const a = await source.declareAnalysis('byPrice');
    const onA = await columnAt(source, 'risk');
    source.seek(rootId);
    const b = await source.declareAnalysis('byRating');
    const onB = await columnAt(source, 'risk');
    expect(onA).not.toEqual(onB);

    const s = buildDashboard(def).createSession();
    const res = await s.replay(source.log.records);
    expect(res.ok && res.reran).toBe(2);
    s.seek(a.commit!.id);
    expect(await columnAt(s, 'risk')).toEqual(onA);
    s.seek(b.commit!.id);
    expect(await columnAt(s, 'risk')).toEqual(onB);
  });

  it('an analysis that made no column is never re-run — the log carries the whole of it', async () => {
    const source = buildDashboard(makeDashboardDef()).createSession();
    await source.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    const stat = await source.dispatch({ verb: 'analyze', analysisId: 'correlation', cause });
    expect(stat.ok).toBe(true);

    const s = buildDashboard(makeDashboardDef()).createSession();
    const res = await s.replay(source.log.records);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect({ reran: res.reran, filed: res.filed }).toEqual({ reran: 0, filed: 0 });
    // and no alpha was re-spent by walking the log
    expect(res.overview.fdr.tests).toBe(0);
    expect(s.ledger()).toEqual([]);
  });

  it('carries a commit’s correlationId onto the rebuilt column’s provenance', async () => {
    const def = defWith({ byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }) });
    const source = buildDashboard(def).createSession();
    await source.declareAnalysis('byPrice', { correlationId: 'tool-call-7' });

    const s = buildDashboard(def).createSession();
    expect((await s.replay(source.log.records)).ok).toBe(true);
    const why = s.why({ kind: 'column', column: 'risk' });
    expect(why.ok).toBe(true);
    if (why.ok) expect(why.correlationId).toBe('tool-call-7');
  });
});

describe('what a replay could not rebuild, it says', () => {
  it('an analysis this session does not declare is a gap, and the column is honestly absent', async () => {
    const def = defWith({ byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }) });
    const source = buildDashboard(def).createSession();
    await source.declareAnalysis('byPrice');

    // the same dashboard, minus the module that made the column
    const s = buildDashboard(makeDashboardDef()).createSession();
    const res = await s.replay(source.log.records);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect({ landed: res.landed, reran: res.reran, filed: res.filed }).toEqual({ landed: 1, reran: 0, filed: 1 });
    expect(s.gaps().at(-1)).toMatchObject({ code: 'needs-analysis-kind', op: 'replay', target: 'byPrice' });
    expect(s.gaps().at(-1)!.detail).toContain('any column it wrote could not be rebuilt');
    // the honest consequence: the column is not here, and a select on it says so
    expect(res.overview.columns['data']!.map((c) => c.field)).not.toContain('risk');
    const probe = await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'risk', value: 1, cause });
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.rejection.code).toBe('needs-column');
  });

  it('an input the engine cannot read back is a gap, and the replay keeps going', async () => {
    const def = defWith({ byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }) });
    const source = buildDashboard(def).createSession();
    await source.declareAnalysis('byPrice');
    await source.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });

    const s = buildDashboard(def).createSession();
    providerOf(s).evaluate = async () => reject('memory', 'evaluate', 'no-backend-connection', 'the reader is offline');
    const res = await s.replay(source.log.records);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.landed).toBe(2); // every record still landed
    expect(res.reran).toBe(0);
    expect(s.gaps().some((g) => g.op === 'replay' && g.code === 'needs-backend-data' && g.detail.includes('could not be read back'))).toBe(true);
  });

  it('an analysis that THROWS on re-run is an outbound gap, and the rest still replays', async () => {
    const def = defWith({
      boom: columnAnalysis({ id: 'boom', from: 'price', k: 2, out: 'risk' }),
      byRating: columnAnalysis({ id: 'byRating', from: 'rating', k: 2, out: 'grade' }),
    });
    const source = buildDashboard(def).createSession();
    await source.declareAnalysis('boom');
    await source.declareAnalysis('byRating');

    const s = buildDashboard(def).createSession();
    s.registerAnalysis('boom', {
      ...columnAnalysis({ id: 'boom', from: 'price', k: 2, out: 'risk' }),
      run: async () => { throw new Error('the kernel fell over'); },
    });
    const res = await s.replay(source.log.records);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect({ reran: res.reran, filed: res.filed }).toEqual({ reran: 1, filed: 1 });
    expect(s.gaps().at(-1)).toMatchObject({ code: 'effect-failed', op: 'replay', target: 'boom' });
    expect(s.gaps().at(-1)!.detail).toContain('the kernel fell over');
    expect(await columnAt(s, 'grade')).not.toContain('REJECTED'); // the other act came back
  });

  it('a re-run that produces no columns on this data is a gap, both ways it can happen', async () => {
    const def = defWith({ shrinks: columnAnalysis({ id: 'shrinks', from: 'price', k: 2, out: 'risk' }) });
    const source = buildDashboard(def).createSession();
    await source.declareAnalysis('shrinks');
    const wire = source.log.records;

    // (a) the re-run is DEGENERATE — the honesty gate fires on this data
    const degenerate = buildDashboard(def).createSession();
    degenerate.registerAnalysis('shrinks', {
      ...columnAnalysis({ id: 'shrinks', from: 'price', k: 2, out: 'risk' }),
      run: async () => ({ result: { ok: false, reason: 'degenerate-fit', n: 0, fitDegenerate: true } }),
    });
    const first = await degenerate.replay(wire);
    expect(first.ok && first.reran).toBe(0);
    expect(degenerate.gaps().at(-1)).toMatchObject({ code: 'guard-failed', op: 'replay', target: 'shrinks' });
    expect(degenerate.gaps().at(-1)!.detail).toContain('produced no columns on this data');

    // (b) the re-run answers on ANOTHER channel than the one it declares
    const wrongChannel = buildDashboard(def).createSession();
    wrongChannel.registerAnalysis('shrinks', {
      ...columnAnalysis({ id: 'shrinks', from: 'price', k: 2, out: 'risk' }),
      run: async () => ({ result: { ok: true, output: { as: 'scalar', name: 'risk', value: 1 } } }),
    });
    const second = await wrongChannel.replay(wire);
    expect(second.ok && second.reran).toBe(0);
    expect(wrongChannel.gaps().at(-1)).toMatchObject({ code: 'guard-failed', op: 'replay', target: 'shrinks' });
  });

  it('a run that answers columns with no snapshot lands nothing, and says which column', async () => {
    const def = defWith({ hollow: columnAnalysis({ id: 'hollow', from: 'price', k: 2, out: 'risk' }) });
    const source = buildDashboard(def).createSession();
    await source.declareAnalysis('hollow');

    const s = buildDashboard(def).createSession();
    s.registerAnalysis('hollow', {
      ...columnAnalysis({ id: 'hollow', from: 'price', k: 2, out: 'risk' }),
      // ok, and columns — but no snapshot, so there are no VALUES to write
      run: async () => ({ result: { ok: true, output: { as: 'columns', table: 'data', columns: { risk: { type: 'int' } } } } }),
    });
    const res = await s.replay(source.log.records);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect({ reran: res.reran, filed: res.filed }).toEqual({ reran: 1, filed: 1 });
    expect(s.gaps().at(-1)).toMatchObject({ code: 'guard-failed', op: 'replay', target: 'risk' });
    expect(s.gaps().at(-1)!.detail).toContain('produced no values for column "risk"');
    expect(res.overview.columns['data']!.map((c) => c.field)).not.toContain('risk');
  });

  it('a provider that refuses the write is the same gap it is on a first run — with the replay’s op', async () => {
    const def = defWith({ byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }) });
    const source = buildDashboard(def).createSession();
    await source.declareAnalysis('byPrice');

    const s = buildDashboard(def).createSession();
    providerOf(s).materializeColumn = async () => reject('memory', 'materializeColumn', 'row-count-mismatch', 'got 39 values for 40 rows');
    const res = await s.replay(source.log.records);
    expect(res.ok).toBe(true);
    expect(s.gaps().at(-1)).toMatchObject({ code: 'guard-failed', op: 'replay', target: 'risk' });
  });
});

describe('the wire and the array are the same door', () => {
  it('replaying the JSON `serializeLog` produced equals replaying the records', async () => {
    const def = defWith({ byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }) });
    const source = buildDashboard(def).createSession();
    await walk(source);
    await source.declareAnalysis('byPrice');

    const fromArray = buildDashboard(def).createSession();
    const fromWire = buildDashboard(def).createSession();
    const a = await fromArray.replay(source.log.records as readonly CommitRecord[]);
    const b = await fromWire.replay(serializeLog(source.log.records));

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect({ landed: b.landed, reran: b.reran, filed: b.filed }).toEqual({ landed: a.landed, reran: a.reran, filed: a.filed });
    expect(fromWire.log.records.map((r) => r.id)).toEqual(fromArray.log.records.map((r) => r.id));
    expect(await columnAt(fromWire, 'risk')).toEqual(await columnAt(fromArray, 'risk'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ACT'S OWN TABLE — a commit records enough of an act to perform it again.

/** Two tables with the SAME row count and DIFFERENT prices: reading the wrong one is silent, not loud. */
function twoTableDef(analyses: DashboardDef['analyses']): DashboardDef {
  const base = makeDashboardDef();
  const other = SAMPLE_ROWS.map((r, i) => ({ ...r, price: 1000 - 3 * i }));
  return {
    ...base,
    data: { ...base.data, other: { rows: other } },
    defaultTable: 'data',
    analyses: { ...base.analyses, ...analyses },
  };
}

describe('an analysis commit records the table it read', () => {
  it('the value slot carries the act — the id AND the table', async () => {
    const def = defWith({ byPrice: columnAnalysis({ id: 'byPrice', from: 'price', k: 4, out: 'risk' }) });
    const s = buildDashboard(def).createSession();
    const made = await s.declareAnalysis('byPrice');
    expect(made.commit!.field).toBe('__analysis__');
    expect(made.commit!.value).toEqual({ id: 'byPrice', table: 'data' }); // the default, named
  });

  it('…and the table a caller NAMED, not the default one', async () => {
    const def = twoTableDef({ onOther: columnAnalysis({ id: 'onOther', from: 'price', k: 4, out: 'risk', table: 'other' }) });
    const s = buildDashboard(def).createSession();
    const made = await s.declareAnalysis('onOther', { table: 'other' });
    expect(made.commit!.value).toEqual({ id: 'onOther', table: 'other' });
  });

  it('a replay re-performs it over THAT table — the numbers are the act’s, not the default table’s', async () => {
    const def = twoTableDef({
      onOther: columnAnalysis({ id: 'onOther', from: 'price', k: 4, out: 'risk', table: 'other' }),
      onData: columnAnalysis({ id: 'onData', from: 'price', k: 4, out: 'risk' }),
    });
    const source = buildDashboard(def).createSession();
    const made = await source.declareAnalysis('onOther', { table: 'other' });
    expect(made.materialized).toEqual(['risk']);
    const walked = await columnAt(source, 'risk', 'other');

    // what the DEFAULT table would have produced — the answer a replay that
    // assumed `defaultTable` used to land, silently, under this act's own id
    const wrong = buildDashboard(def).createSession();
    await wrong.declareAnalysis('onData');
    const fromDefaultTable = await columnAt(wrong, 'risk');
    expect(fromDefaultTable).not.toEqual(walked); // the premise: the two tables disagree

    const s = buildDashboard(def).createSession();
    const res = await s.replay(source.log.records);
    expect(res.ok && res.reran).toBe(1);
    expect(await columnAt(s, 'risk', 'other')).toEqual(walked);
    expect(await columnAt(s, 'risk', 'other')).not.toEqual(fromDefaultTable);
  });
});

describe('a record whose act cannot be performed again is refused at judge time', () => {
  it('a table this dashboard does not declare is a refusal, not a gap — nothing lands', async () => {
    const def = twoTableDef({ onOther: columnAnalysis({ id: 'onOther', from: 'price', k: 4, out: 'risk', table: 'other' }) });
    const source = buildDashboard(def).createSession();
    await source.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    await source.declareAnalysis('onOther', { table: 'other' });

    // the same def, minus the table the act read
    const narrower = defWith({ onOther: columnAnalysis({ id: 'onOther', from: 'price', k: 4, out: 'risk', table: 'other' }) });
    const s = buildDashboard(narrower).createSession();
    const res = await s.replay(source.log.records);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.gap).toMatchObject({ code: 'guard-failed', op: 'replay' });
    expect(res.gap.detail).toContain('commit #1 "s2" cannot be re-performed');
    expect(res.gap.detail).toContain('read table "other", which this dashboard does not declare');
    // the FIRST record was landable and did not land either — all or nothing
    expect(s.log.records).toHaveLength(0);
    expect(s.cursor()).toBeNull();
  });

  it('a columns analysis whose record names no table is refused — the pValue lane cannot carry one', async () => {
    // a kind:'test' analysis that ALSO writes columns: its value slot is the
    // p-value (the L1↔L4 convention), so the act records no table at all
    const testWithColumns = defineAnalysis<readonly DataRow[], ColumnsOutput>({
      id: 'tested', kind: 'test', produces: 'columns', inputs: [{ column: 'price', role: 'value' }],
      build: () => flowChart<Record<string, unknown>>('load', (scope) => {
          scope.$setValue('vals', scope.$getArgs<{ values: number[] }>().values);
        }, 'load').addFunction('bin', (scope) => {
          scope.$setValue('risk', quantileBins(scope.$getValue('vals') as number[], 2));
        }, 'cluster').build(),
      toRunInput: (rows) => ({ values: foldOnce(rows, { v: numbers('price') }).v.values }),
      readOutput: () => ({ ok: true, output: { as: 'columns', table: 'data', columns: { risk: { type: 'int' } } } }),
      test: { statistic: 'made-up', pValue: () => 0.01 },
    });
    const def = defWith({ tested: testWithColumns });
    const source = buildDashboard(def).createSession();
    const made = await source.declareAnalysis('tested');
    expect(made.commit!.field).toBe('pValue');        // the lane that is spoken for
    expect(made.commit!.value).toBe(0.01);
    expect(made.materialized).toEqual(['risk']);      // it really did write a column

    const s = buildDashboard(def).createSession();
    const res = await s.replay(source.log.records);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.gap.detail).toContain('cannot be re-performed');
    expect(res.gap.detail).toContain('does not say which table it read');
    expect(s.log.records).toHaveLength(0);
  });

  it('an analysis this session does not declare is NOT this refusal — nothing is attempted, so the gap is honest', async () => {
    // the line: an act nobody will perform cannot be performed WRONGLY
    const def = twoTableDef({ onOther: columnAnalysis({ id: 'onOther', from: 'price', k: 4, out: 'risk', table: 'other' }) });
    const source = buildDashboard(def).createSession();
    await source.declareAnalysis('onOther', { table: 'other' });

    const s = buildDashboard(twoTableDef({})).createSession(); // the module is gone
    const res = await s.replay(source.log.records);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect({ landed: res.landed, reran: res.reran, filed: res.filed }).toEqual({ landed: 1, reran: 0, filed: 1 });
    expect(s.gaps().at(-1)).toMatchObject({ code: 'needs-analysis-kind', op: 'replay' });
  });
});

describe('analysisActOf — the reader of the act slot, on everything it can be handed', () => {
  it('reads an act, and refuses everything that is not one', () => {
    expect(analysisActOf({ id: 'byPrice', table: 'data' })).toEqual({ id: 'byPrice', table: 'data' });
    // a foreign or hand-built log can put anything in an inert value slot
    expect(analysisActOf(null)).toBeUndefined();
    expect(analysisActOf(0.03)).toBeUndefined();          // the pValue lane
    expect(analysisActOf('byPrice')).toBeUndefined();     // the shape before this law
    expect(analysisActOf(['byPrice', 'data'])).toBeUndefined();
    expect(analysisActOf({ table: 'data' })).toBeUndefined();
    expect(analysisActOf({ id: '', table: 'data' })).toBeUndefined();
    expect(analysisActOf({ id: 'byPrice' })).toBeUndefined();
    expect(analysisActOf({ id: 'byPrice', table: 7 })).toBeUndefined();
    expect(analysisActOf({ id: 'byPrice', table: '' })).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The case that found the rule. On the live desk an act called "let the whole
 * country back in" landed `map · point · jurisdiction · null`, meaning a clear
 * — and the fold did not recognise it, so a clause matching no cell stood as a
 * live selection and every chart downstream of it went empty.
 *
 * The fix is one spelling of cleared for every kind, and the REASON is this
 * law: `undefined` does not survive `serializeLog`, so a point clear only ever
 * round-tripped because JSON drops the key and an absent key reads back as
 * `undefined`. A replayed log must MEAN what the walk meant, not happen to.
 */
describe('a cleared point means the same thing on both sides of the wire', () => {
  it('lands as null, serializes as null, replays as a clear — and the two folds agree', async () => {
    const walked = buildDashboard(makeDashboardDef()).createSession();
    await walked.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    const cleared = await walked.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: null, cause: { ...cause, intent: 'let the whole country back in' } });
    expect(cleared.ok).toBe(true);

    // the WALK: a clear, not a clause that matches nothing
    const before = await walked.overview();
    expect(before.activeSelections).toEqual([]);
    expect(before.clearedSelections.map((c) => [c.viewId, c.kind])).toEqual([['bar', 'point']]);
    expect(before.selectedRowCount).toBe(SAMPLE_ROWS.length);

    // the WIRE: the value really is on the record, spelled the one way
    const wire = serializeLog(walked.log.records);
    expect(JSON.parse(wire)[1]).toMatchObject({ kind: 'point', field: 'category', value: null });
    expect(walked.log.records[1]!.predicateSQL).toBe('null'); // the live clause cleared too — both doors of one act

    // the REPLAY: the same fold, from nothing but the log
    const replayed = buildDashboard(makeDashboardDef()).createSession();
    const res = await replayed.replay(wire);
    expect(res.ok).toBe(true);
    const after = await replayed.overview();
    expect(after.activeSelections).toEqual(before.activeSelections);
    expect(after.clearedSelections.map((c) => [c.viewId, c.kind])).toEqual([['bar', 'point']]);
    expect(after.selectedRowCount).toBe(before.selectedRowCount);
  });

  it('a MISSING value is refused at the door, so no log can carry the spelling that does not survive JSON', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: undefined, cause });
    expect(res).toMatchObject({ ok: false, rejection: { code: 'guard-failed', op: 'select' } });
    expect(s.log.records).toHaveLength(0);
  });
});
