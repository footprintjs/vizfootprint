/**
 * THE ALL-OR-NOTHING LAW (src/session/README.md) — an act either fully happens
 * or does not happen at all.
 *
 * Everything on screen is derived from the TRACE. There must be no moment at
 * which the live session has moved and no commit records it, and no moment at
 * which a commit is on the log and the session disagrees with it. A
 * half-applied act breaks that claim SILENTLY — with nothing in the log to show
 * for it — which is why each window below is tested by injecting a failure at
 * exactly the point that used to leak, and then asserting that the log length,
 * the head, the cursor, the active filters and the fold all still agree.
 *
 * Two shapes, tested from both sides:
 *
 *   1. a JUDGE-phase failure (a throwing data stamp, an unwritable chart spec)
 *      leaves NOTHING behind — no commit, no moved selection, no spent alpha;
 *   2. an OUTBOUND-effect failure (an adapter that throws, a live selection
 *      whose listener throws, a provider that throws while materializing) does
 *      NOT lose the act — the commit stands, the state agrees with it, and the
 *      failure is a typed `effect-failed` gap naming what did not work.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';
import type { CauseClause } from '../mosaic/index.js';
import type { DataProvider } from '../data/index.js';
import type { InteractionSession } from './session.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });

/** The dresses fixture + a heatmap view that honestly declares cell emissions. */
function heatmapDef(): DashboardDef {
  const base = makeDashboardDef();
  return {
    ...base,
    actors: { ...base.actors, heatmap: { actor: 'user', label: 'Price × category heatmap' } },
    capabilities: [...(base.capabilities ?? []), { viewId: 'heatmap', canProbe: true, encodings: ['cell' as const] }],
  };
}

function freshSession(): InteractionSession {
  return buildDashboard(heatmapDef()).createSession();
}

/**
 * Everything that has to agree, read in one go. Two of these taken either side
 * of a failure say whether the act half-happened.
 */
async function snapshotOf(s: InteractionSession) {
  const ov = await s.overview();
  return {
    commits: s.log.records.length,
    head: s.head,
    cursor: s.cursor(),
    clauses: s.log.selection.clauses.length,
    selections: ov.activeSelections.map((sel) => `${sel.viewId}:${JSON.stringify(sel.value)}@${sel.commitId ?? ''}`),
    rows: ov.selectedRowCount,
  };
}

// ── 1. a JUDGE-phase failure leaves nothing behind ────────────────────────────

describe('the judge phase — a failure before anything moves leaves the session exactly as it was', () => {
  it('a throwing data stamp does not move the live selection (it used to move it, with no commit behind it)', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const before = await snapshotOf(s);

    // The session installs `stampData` to ask the runtime which data version a
    // commit is true of. It is called INSIDE `commit()` — and it used to be
    // called AFTER the selection had already taken the clause.
    s.log.stampData = () => {
      throw new Error('the source registry went away');
    };
    await expect(
      s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause() }),
    ).rejects.toThrow('the source registry went away');

    expect(await snapshotOf(s)).toEqual(before); // nothing on screen moved, and nothing landed
  });

  it('a chart spec that cannot be written to the trace is refused BEFORE the ledger spends a step', async () => {
    const s = freshSession();
    const before = await snapshotOf(s);
    const wealthBefore = (await s.overview()).fdr;

    // A BigInt passes every shape gate (mark, no composition, no transforms)
    // and then makes JSON.stringify throw. That throw used to happen BETWEEN
    // proposeChart's two commits — after the FDR step was spent and the
    // hypothesis commit was already history.
    const res = await s.proposeChart({
      id: 'unwritable',
      spec: { mark: 'point', encoding: { x: { field: 'price' }, y: { field: 'rating' } }, size: 1n as unknown as number },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap.code).toBe('chart-invalid-spec');
      expect(res.gap.detail).toContain('must be plain JSON');
    }
    expect(await snapshotOf(s)).toEqual(before); // no hypothesis commit, no spec commit
    expect((await s.overview()).fdr).toEqual(wealthBefore); // and no alpha spent on a chart that does not exist
    expect(s.charts()).toEqual([]);
  });

  it('a chart spec that CAN be written still lands both commits and the view (the positive)', async () => {
    const s = freshSession();
    const res = await s.proposeChart({
      id: 'fine',
      spec: { mark: 'point', encoding: { x: { field: 'price' }, y: { field: 'rating' } } },
    });
    expect(res.ok).toBe(true);
    expect(s.log.records).toHaveLength(2);
    expect(s.charts().map((c) => c.chartId)).toEqual(['fine']);
  });
});

// ── 2. an outbound effect cannot un-happen the act ────────────────────────────

describe('an adapter that throws does not lose a commit that really happened', () => {
  it('a point select stands: the log, the head, the cursor and the fold all agree, and the failure is a gap', async () => {
    const s = freshSession();
    s.mountView('bar', {
      capabilities: { canProbe: true },
      applyClause: () => {
        throw new Error('renderer blew up');
      },
    });

    const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(res.ok).toBe(true); // the caller is told the truth: it happened
    if (!res.ok) return;

    const after = await snapshotOf(s);
    expect(after.commits).toBe(1);
    expect(after.head).toBe(res.commit!.id);
    expect(after.cursor).toBe(res.commit!.id);
    expect(after.selections).toEqual([`bar:${JSON.stringify('Formal')}@${res.commit!.id}`]);
    expect(after.rows).toBe(8); // the filter really is applied — 8 Formal rows

    const gap = s.gaps().at(-1)!;
    expect(gap).toMatchObject({ code: 'effect-failed', op: 'select', target: 'bar' });
    expect(gap.detail).toContain(res.commit!.id); // WHICH act
    expect(gap.detail).toContain('bar'); // WHICH adapter
    expect(gap.detail).toContain('renderer blew up'); // and what it said
  });

  it('a CELL select stands the same way (the compound door has its own adapter call)', async () => {
    const s = freshSession();
    s.mountView('heatmap', {
      capabilities: { canProbe: true, encodings: ['cell'] },
      applyClause: () => {
        throw new Error('heatmap blew up');
      },
    });

    const res = await s.dispatch({
      verb: 'select',
      viewId: 'heatmap',
      fields: ['price', 'category'],
      values: [[100, 150], 'Formal'],
      cause: userCause(),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(s.log.records).toHaveLength(1);
    expect(s.head).toBe(res.commit!.id);
    expect((await s.overview()).activeSelections.map((sel) => sel.viewId)).toEqual(['heatmap']);
    expect(s.gaps().at(-1)).toMatchObject({ code: 'effect-failed', op: 'select', target: 'heatmap' });
  });

  it('and the act that follows it is unaffected — one bad render does not poison the walk', async () => {
    const s = freshSession();
    s.mountView('bar', {
      capabilities: { canProbe: true },
      applyClause: () => {
        throw new Error('renderer blew up');
      },
    });
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const b = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 130], cause: userCause() });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.commit!.parent).toBe(a.commit!.id); // the second act parented on the first
    expect(s.gaps().filter((g) => g.code === 'effect-failed')).toHaveLength(1);
  });

  it('a mounted adapter with no applyClause at all is simply not told (no gap, no throw)', async () => {
    const s = freshSession();
    s.mountView('bar', { capabilities: { canProbe: true } });
    const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(res.ok).toBe(true);
    expect(s.gaps()).toEqual([]);
  });

  it('an adapter that works still gets the resolved clause (the positive)', async () => {
    const s = freshSession();
    const seen: CauseClause[] = [];
    s.mountView('bar', { capabilities: { canProbe: true }, applyClause: (c) => seen.push(c) });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(seen).toHaveLength(1);
    expect(s.gaps()).toEqual([]);
  });
});

describe("the live selection's own listeners cannot un-land a commit either", () => {
  it('a listener that throws leaves the commit landed, the fold agreeing, and a gap naming the commit', async () => {
    const s = freshSession();
    // A host attaches to the Mosaic Selection (the demo's charts do exactly
    // this). `selection.update` is the commit's one outbound step, and it runs
    // after the record is already history.
    s.log.selection.addEventListener('value', () => {
      throw new Error('a chart listener blew up');
    });

    const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(s.log.records).toHaveLength(1);
    expect(s.head).toBe(res.commit!.id);
    expect((await s.overview()).selectedRowCount).toBe(8);

    const gap = s.gaps().at(-1)!;
    expect(gap).toMatchObject({ code: 'effect-failed', op: 'commit', target: res.commit!.id });
    expect(gap.detail).toContain('a chart listener blew up');
  });
});

describe('a provider that throws while writing a column back does not lose the analysis', () => {
  it('the declaring commit stands, the throw is a typed gap, and the column is honestly not materialized', async () => {
    const s = freshSession();
    // The only way to make a REAL provider throw is to reach the one this
    // dashboard built — there is no injection seam, and the window is real
    // (a wasm engine or an HTTP backend can throw where the memory one cannot).
    // The rest of the test drives the public surface.
    const provider = (s as unknown as { runtime: { providerFor(t: string): DataProvider } }).runtime.providerFor('data');
    provider.materializeColumn = async () => {
      throw new Error('the column store is read-only');
    };

    const before = s.log.records.length;
    const res = await s.declareAnalysis('clustering');
    expect(res.commit).toBeDefined(); // the analysis RAN and its commit landed
    expect(s.log.records).toHaveLength(before + 1);
    expect(s.head).toBe(res.commit!.id);
    expect(res.materialized).toEqual([]); // and honestly claims nothing was written
    expect(res.gap).toMatchObject({ code: 'effect-failed', op: 'declareAnalysis', target: 'cluster_id' });
    expect(res.gap!.detail).toContain('the column store is read-only');

    // the column never became visible: a select on it is still an honest gap
    const probe = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'cluster_id', value: 0, cause: userCause() });
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.rejection.code).toBe('needs-column');
  });
});
