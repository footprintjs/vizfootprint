/**
 * RP-3 — `session.proposeChart`: the governed, ledger-gated pipeline for
 * agent-authored charts (renderer-protocol.md §5 / D28). Every gate arm lands a
 * TYPED gap and renders NOTHING; only a fully-passing proposal registers a
 * hypothesis in the LORD++ ledger (and only then costs alpha), then registers
 * the chart as a session view under `chart:${id}` with agent-authored
 * provenance. The spec + its ledger row + its provenance round-trip.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import { hypothesisRecordsFromLog } from '../fdr/index.js';
import { serializeLog, replayLog } from '../log/index.js';
import { keyOf, foldStateAt } from '../branches/index.js';

function freshSession() {
  return buildDashboard(makeDashboardDef()).createSession({ as: 'agent' });
}

/** A clean single-view VL spec over real columns (price × rating), one brush param. */
function validSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mark: { type: 'circle' },
    params: [{ name: 'b', select: { type: 'interval', encodings: ['x'] } }],
    encoding: {
      x: { field: 'price', type: 'quantitative' },
      y: { field: 'rating', type: 'quantitative' },
    },
    ...overrides,
  };
}

describe('proposeChart — the happy path (ledgered agent-authored chart)', () => {
  it('registers a hypothesis in the LORD++ ledger, then the chart as a chart:${id} view', async () => {
    const s = freshSession();
    const res = await s.proposeChart({ id: 'pr', spec: validSpec(), claim: 'price vs rating relationship' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // (1) ledger row created — an UNTESTED claim entered at p=1, never a discovery.
    expect(res.hypothesis.tested).toBe(false);
    expect(res.hypothesis.pValueUsed).toBe(1);
    expect(res.fdrStep.pValue).toBe(1);
    expect(res.fdrStep.reject).toBe(false);
    expect(s.ledger()).toHaveLength(1);
    expect(s.ledger()[0]).toBe(res.fdrStep);

    // (2) chart registered as a real session view under chart:${id}, agent-authored.
    expect(res.view.viewId).toBe('chart:pr');
    expect(res.view.authoredBy).toBe('agent');
    expect(s.charts()).toHaveLength(1);
    expect(s.charts()[0]!.chartId).toBe('pr');

    // two commits land: the p=1 hypothesis emission + the spec registration.
    expect(s.log.records).toHaveLength(2);
    const hyp = s.log.records[0]!;
    const spec = s.log.records[1]!;
    expect(hyp.field).toBe('pValue');
    expect(hyp.value).toBe(1);
    expect(hyp.cause.requestedBy).toBe('agent');
    expect(hyp.cause.computedBy).toBe('agent'); // agent-authored, NOT system (unlike analyze)
    expect(spec.field).toBe('__chart__');
    expect(res.commit).toBe(spec);

    // the stored spec round-trips (it is a JSON string in the log).
    const payload = JSON.parse(spec.value as string) as { spec: unknown; claim: string; authoredBy: string };
    expect(payload.claim).toBe('price vs rating relationship');
    expect(payload.authoredBy).toBe('agent');
    expect(payload.spec).toEqual(validSpec());
  });

  it('defaults the claim from the encoded fields when none is given', async () => {
    const s = freshSession();
    const res = await s.proposeChart({ id: 'auto', spec: validSpec() });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.view.claim).toBe('price vs rating reveals a relationship');
  });

  it('overview()/whats_here surfaces the chart + ledger status, but NEVER the spec (token-lean)', async () => {
    const s = freshSession();
    await s.proposeChart({ id: 'pr', spec: validSpec(), claim: 'the claim' });
    const ov = await s.overview();
    expect(ov.charts).toEqual([{ chartId: 'pr', viewId: 'chart:pr', claim: 'the claim', authoredBy: 'agent', ledgered: true, ledgerStep: 1 }]);
    expect(JSON.stringify(ov.charts)).not.toContain('circle'); // the spec's mark never rides whats_here
    expect(ov.fdr.tests).toBe(1);
  });

  it('a chart proposal does not pollute the crossfilter fold (no active selection)', async () => {
    const s = freshSession();
    await s.proposeChart({ id: 'pr', spec: validSpec() });
    expect((await s.overview()).activeSelections).toEqual([]);
  });
});

describe('proposeChart — every gate lands a typed gap and renders NOTHING', () => {
  it('a non-object / mark-less spec → chart-invalid-spec', async () => {
    const s = freshSession();
    const bad = await s.proposeChart({ id: 'a', spec: 42 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.gap.code).toBe('chart-invalid-spec');
    const noMark = await s.proposeChart({ id: 'b', spec: { encoding: { x: { field: 'price' } } } });
    if (!noMark.ok) expect(noMark.gap.code).toBe('chart-invalid-spec');
    expect(s.charts()).toHaveLength(0);
    expect(s.ledger()).toHaveLength(0);
  });

  it('an empty / non-string id → chart-invalid-spec', async () => {
    const s = freshSession();
    const res = await s.proposeChart({ id: '   ', spec: validSpec() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.gap.code).toBe('chart-invalid-spec');
    // a non-string id (defensive — the tool pre-validates, the session is public API)
    const nonString = await s.proposeChart({ id: 123 as unknown as string, spec: validSpec() });
    expect(nonString.ok).toBe(false);
    if (!nonString.ok) {
      expect(nonString.gap.code).toBe('chart-invalid-spec');
      expect(nonString.gap.target).toBe('');
    }
  });

  it('multi-view composition → chart-unsupported-composition', async () => {
    const s = freshSession();
    const res = await s.proposeChart({ id: 'a', spec: validSpec({ layer: [] }) });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap.code).toBe('chart-unsupported-composition');
      expect(res.gap.detail).toContain('layer');
    }
    expect(s.charts()).toHaveLength(0);
  });

  it('an internal transform (aggregate) → chart-transforms-not-owned', async () => {
    const s = freshSession();
    const res = await s.proposeChart({
      id: 'a',
      spec: validSpec({ encoding: { x: { field: 'price', type: 'quantitative', aggregate: 'mean' }, y: { field: 'rating', type: 'quantitative' } } }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap.code).toBe('chart-transforms-not-owned');
      expect(res.gap.detail).toContain('host owns');
    }
  });

  it('a claim over a column that does not exist → chart-hypothesis-rejected', async () => {
    const s = freshSession();
    const res = await s.proposeChart({ id: 'a', spec: validSpec({ encoding: { x: { field: 'nope', type: 'quantitative' }, y: { field: 'rating', type: 'quantitative' } } }) });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap.code).toBe('chart-hypothesis-rejected');
      expect(res.gap.detail).toContain('nope');
    }
  });

  it('a backend that cannot serve columns → needs-backend-data (never a silent drop)', async () => {
    // No provider for the default table → effectiveColumnsOf rejects; the
    // grounding check surfaces it honestly rather than pretending the fields exist.
    const s = buildDashboard(makeDashboardDef()).createSession({ defaultTable: 'ghost-table' });
    const res = await s.proposeChart({ id: 'a', spec: validSpec() });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.gap.code).toBe('needs-backend-data');
      expect(res.gap.detail).toBe('no provider for table "ghost-table"');
    }
    expect(s.ledger()).toHaveLength(0); // no alpha spent — the pipeline stopped before the ledger
  });

  it('a spec encoding no field at all → chart-hypothesis-rejected (a claim over nothing)', async () => {
    const s = freshSession();
    const res = await s.proposeChart({ id: 'a', spec: { mark: 'rule', encoding: { size: { value: 5 } } } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.gap.code).toBe('chart-hypothesis-rejected');
  });

  it('a duplicate chart id → chart-hypothesis-rejected (one hypothesis per id)', async () => {
    const s = freshSession();
    await s.proposeChart({ id: 'pr', spec: validSpec() });
    const dup = await s.proposeChart({ id: 'pr', spec: validSpec() });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.gap.code).toBe('chart-hypothesis-rejected');
    expect(s.charts()).toHaveLength(1); // the first one, still the only one
  });

  it('every gap it files is in the session gap ledger, typed', async () => {
    const s = freshSession();
    await s.proposeChart({ id: 'a', spec: 42 });
    await s.proposeChart({ id: 'b', spec: validSpec({ hconcat: [] }) });
    const codes = s.gaps().map((g) => g.code);
    expect(codes).toContain('chart-invalid-spec');
    expect(codes).toContain('chart-unsupported-composition');
    expect(s.gaps().every((g) => g.op === 'proposeChart')).toBe(true);
  });
});

describe('proposeChart — alpha is spent ONLY on a real (fully-passing) claim', () => {
  it('a rejected proposal does NOT advance the FDR wealth; an accepted one does', async () => {
    const s = freshSession();
    const wealth0 = (await s.overview()).fdr.wealth;
    const tests0 = s.ledger().length;

    // a transform-carrying spec is REJECTED — no ledger row, no wealth spent.
    const rejected = await s.proposeChart({
      id: 'bad',
      spec: validSpec({ encoding: { x: { field: 'price', type: 'quantitative', bin: true }, y: { field: 'rating', type: 'quantitative' } } }),
    });
    expect(rejected.ok).toBe(false);
    expect(s.ledger().length).toBe(tests0); // no row created
    expect((await s.overview()).fdr.wealth).toBe(wealth0); // wealth UNCHANGED — no alpha spent

    // a clean spec PASSES — one ledger row, wealth drawn down.
    const ok = await s.proposeChart({ id: 'good', spec: validSpec() });
    expect(ok.ok).toBe(true);
    expect(s.ledger().length).toBe(tests0 + 1);
    expect((await s.overview()).fdr.wealth).toBeLessThan(wealth0);
  });
});

describe('proposeChart — the log round-trips (commit-log discipline)', () => {
  it('the view/hypothesis/commit/fdrStep survive structuredClone + JSON', async () => {
    const s = freshSession();
    const res = await s.proposeChart({ id: 'pr', spec: validSpec(), claim: 'c' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const bundle = { view: res.view, hypothesis: res.hypothesis, commit: res.commit, fdrStep: res.fdrStep };
    expect(structuredClone(bundle)).toEqual(bundle);
    expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundle);
  });

  it('a replayed log re-derives the chart hypothesis (p=1) — live ledger and log-derived ledger agree', async () => {
    const s = freshSession();
    await s.proposeChart({ id: 'pr', spec: validSpec() });
    const derived = hypothesisRecordsFromLog(s.log.records);
    expect(derived).toHaveLength(1);
    expect(derived[0]!.pValue).toBe(1);
    // the whole log round-trips through serialize → replay unchanged in shape.
    const replayed = replayLog(serializeLog(s.log.records));
    expect(hypothesisRecordsFromLog(replayed.records)).toHaveLength(1);
  });
});

describe('proposeChart — the acting principal + cause threading', () => {
  it('respects an explicit { as } and stamps it on both commits + the ledger', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession(); // default actor
    const res = await s.proposeChart({ id: 'pr', spec: validSpec() }, { as: 'user' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.authoredBy).toBe('user');
      expect(s.log.records.every((r) => r.cause.requestedBy === 'user')).toBe(true);
    }
  });

  it('threads a caller cause (with intent) + correlationId, and defaults an empty claim', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession(); // defaultActor = agent
    const res = await s.proposeChart({
      id: 'pr',
      spec: validSpec(),
      claim: '', // empty → the default claim is used
      cause: { requestedBy: 'user', computedBy: 'agent', intent: 'look at price/rating' },
      correlationId: 'turn-7',
    }); // no { as } → the cause's own actors stand
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.view.claim).toBe('price vs rating reveals a relationship'); // default
    expect(res.view.authoredBy).toBe('agent'); // computedBy from the cause
    expect(s.log.records.every((r) => r.correlationId === 'turn-7')).toBe(true); // stamped on both commits
    expect(s.log.records[0]!.cause.intent).toBe('look at price/rating'); // inert intent rides
    expect(s.log.records[0]!.cause.requestedBy).toBe('user');
    // the re-derived hypothesis uses the correlationId as its cross-tier id (L1 rail).
    expect(hypothesisRecordsFromLog(s.log.records)[0]!.hypothesisId).toBe('turn-7');
  });
});

describe('proposeChart — the chart commits are inert in the branches fold', () => {
  it('both chart commits have a null fold key (not selection/encoding/analysis) and are not undoable', async () => {
    const s = freshSession();
    const res = await s.proposeChart({ id: 'pr', spec: validSpec() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const rec of s.log.records) expect(keyOf(rec)).toBeNull(); // fold.ts CHART_VIEW_PREFIX arm
    expect(foldStateAt(s.log.records, s.head).size).toBe(0); // no chart entry in the state fold
    // a chart registration is inert — there is no prior state to restore.
    const undo = await s.undo(res.commit.id);
    expect(undo.ok).toBe(false);
    if (!undo.ok) expect(undo.gap.op).toBe('undo');
  });
});
