/**
 * THE CONFORMANCE LAW — folding as you WALK equals folding a REPLAY.
 *
 * The whole claim of this library is that what is on screen is DERIVED from
 * the trace. That claim is only true if the derivation has one answer: the
 * fold a session builds incrementally while a person walks through a dashboard
 * (each door writing its own bit of state as an act lands) must equal the fold
 * rebuilt from nothing but the commit log. If those two can disagree, then
 * "the dashboard explains itself" is a story about the walk, not about the
 * record — and a replay, a seek, a shared link and a saved session all show
 * something the trace does not account for.
 *
 * WHAT THIS TEST DOES. It drives one session through a varied sequence — a
 * point select, an interval filter, a match select, a cell select, a clear, a
 * re-encode, a link edit, an analysis, prose, a layout move, a fork and a seek
 * — and captures the fold. Then it serializes the log, replays it into a fresh
 * session on a fresh dashboard built from an identical def, seeks that session
 * to the same cursor, and asserts the two folds are equal.
 *
 * ── WHAT "EQUAL" MEANS HERE ──────────────────────────────────────────────────
 *
 * EQUAL means: every surface the fold produces is deep-equal. That is the fold
 * as `rebuildFold` defines it — the live selections and the commits they came
 * from, the cleared selections a link's `onClear` still honours, the filters
 * as a prose basis states them, each view's own encodings and its effective
 * encodings under the link graph, the link graph itself, the layout
 * arrangement, and every view's prose and open proposals — plus the cursor
 * they are all folded at.
 *
 * WHAT MAY LEGITIMATELY DIFFER, and why each one is not a fold:
 *
 *  - TIMESTAMPS and wall-clock stamps. `ts` is positional and survives, but a
 *    bookmark's `at` and a journal entry's `at` are real clock readings taken
 *    when the act happened; a replay happens later, by definition.
 *  - `cause.replayed`. A replay ADDS `replayed: true` and touches nothing else
 *    (R2). That marker is the honest difference between the two runs, so the
 *    comparison reads the fold, not the causes that produced it.
 *  - HEAD. The cursor is where the fold is taken; the head is where the walker
 *    was standing. After a fork the walked session's head is the old tip and
 *    the replayed session's head is the last record it committed. Neither is a
 *    claim about the data.
 *  - THE AUDIT TRAILS beside the log: the FDR ledger and the gap ledger. Both
 *    are session-local records of what this walker asked for and was refused;
 *    neither is derived from the log and neither is on screen.
 *  - THE STORES beside the log: saved pictures, bookmarks, the data journal.
 *    They live on the DASHBOARD, not in the log, which is the whole reason they
 *    have their own persistence doors (`restoreSaved` / `restoreBookmarks`).
 *  - MATERIALIZED COLUMNS, and therefore `columns` and the per-channel `fits`
 *    computed from them — on the L1 replay (`replayLog`), which rebuilds a log
 *    into a LOG and runs nobody's code. `session.replay`, the door this test
 *    walks through, DOES re-perform the acts that wrote a column, so on that
 *    door a column-producing analysis folds identically too and the honest
 *    difference shrinks to the acts it could not re-perform — each one a gap,
 *    never a silence. The analysis in the sequence below produces a STATISTIC,
 *    not columns, so it lands in the log and folds identically either way.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import { deserializeLog, serializeLog, type CommitRecord } from '../log/index.js';
import { type Cause } from '../cause/index.js';
import type { DashboardDef } from '../def/index.js';
import type { InteractionSession } from './session.js';
import type { Overview } from './types.js';

const LAYOUT = 'layout:dashboard';
const user = (intent: string): Cause => ({ requestedBy: 'user', computedBy: 'user', intent });
const agent = (intent: string): Cause => ({ requestedBy: 'agent', computedBy: 'agent', intent });

/** The fixture plus a heatmap view that honestly emits cells, so the walk can use every selection kind. */
function conformanceDef(): DashboardDef {
  const base = makeDashboardDef();
  return {
    ...base,
    actors: { ...base.actors, heatmap: { actor: 'user', label: 'Price × category heatmap' } },
    capabilities: [...(base.capabilities ?? []), { viewId: 'heatmap', canProbe: true, encodings: ['cell'] }],
  };
}

/**
 * THE FOLD, named explicitly — everything `rebuildFold` derives from the log,
 * and nothing else. If a new folded surface is added to the session, add it
 * here: a fold nobody compares is a fold nobody has checked.
 */
function foldOf(ov: Overview, cursor: string | null): unknown {
  return {
    cursor,
    activeSelections: ov.activeSelections,
    clearedSelections: ov.clearedSelections,
    filters: ov.filters,
    encodings: ov.encodings,
    effectiveEncodings: ov.effectiveEncodings,
    links: ov.links,
    layouts: ov.layouts,
    dashboardProse: ov.dashboard,
    notes: ov.notes,
    views: ov.views.map((v) => ({ viewId: v.viewId, encodings: v.encodings, effective: v.effective, prose: v.prose, proposals: v.proposals })),
  };
}

/**
 * Replay a serialized log into a fresh session, THROUGH THE DOOR.
 *
 * This used to re-commit every record through `session.log` by hand and then
 * seek — the session had no public "replay this log into me" of its own, and
 * the workaround was the evidence that it needed one. `session.replay` is that
 * door now, and this test is its first consumer: what the law asserts is
 * unchanged, and the fifteen lines that used to stand in for the door are gone.
 */
async function replayInto(session: InteractionSession, records: readonly CommitRecord[], cursor: string | null): Promise<void> {
  const res = await session.replay(records);
  expect(res.ok).toBe(true);
  if (cursor !== null) expect(session.seek(cursor).ok).toBe(true);
}

/** One moment of the walk: where the cursor was, and what the fold said there. */
interface Moment {
  readonly cursor: string | null;
  readonly fold: unknown;
}

/**
 * One varied walk, capturing the INCREMENTAL fold after every act.
 *
 * This is the half of the law that is easy to get wrong in a test: the fold
 * captured here is the one the DOORS maintained as each act landed — no seek
 * has rebuilt it. (A fold read after a seek is already a rebuild, so comparing
 * that to a replay would compare `rebuildFold` with itself and prove nothing.)
 */
async function walk(session: InteractionSession): Promise<{ moments: Moment[]; tip: Moment; forkPoint: string }> {
  const moments: Moment[] = [];
  const capture = async (): Promise<void> => {
    moments.push({ cursor: session.cursor(), fold: foldOf(await session.overview(), session.cursor()) });
  };
  const landed = async (action: Parameters<InteractionSession['dispatch']>[0]): Promise<string> => {
    const res = await session.dispatch(action);
    expect(res.ok).toBe(true);
    await capture();
    return res.ok ? res.commit!.id : '';
  };

  //  1. a point select
  const first = await landed({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: user('pick Casual') });
  //  2. an interval filter
  await landed({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 120], cause: user('the mid band') });
  //  3. a match select — the plural of a point
  await landed({ verb: 'select', viewId: 'bar', field: 'category', values: ['Formal', 'Party'], cause: user('two categories') });
  //  4. a cell select — one gesture on two fields
  await landed({ verb: 'select', viewId: 'heatmap', fields: ['price', 'category'], values: [[100, 150], 'Formal'], cause: user('one cell') });
  //  5. a CLEAR — the fold must remember what was cleared, not just forget it
  await landed({ verb: 'filter', viewId: 'scatter', field: 'price', range: null, cause: user('clear the band') });
  //  6. a re-encode
  await landed({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'category', cause: user('colour by category') });
  //  7. a link edit
  await landed({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'none', cause: user('mute bar → scatter') });
  //  8. an analysis (a statistic, not columns — see the header). `analyze`
  //     answers with the analysis, not a bare commit, so it is dispatched on
  //     its own rather than through `landed`.
  const analyzed = await session.dispatch({ verb: 'analyze', analysisId: 'correlation', cause: agent('is price related to rating?') });
  expect(analyzed.ok).toBe(true);
  await capture();
  //  9. prose
  await landed({ verb: 'describe', viewId: 'scatter', slot: 'title', record: { text: 'Rating by price', author: { kind: 'human', by: 'sanjay' } }, cause: user('retitle') });
  // 10. a layout move — and this is the TIP of the main line: the richest
  //     incremental fold, with all ten acts folded into it and no seek yet.
  await landed({ verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'grid', cause: user('layout = grid') });
  const tip = moments[moments.length - 1]!;
  // 11. a FORK back to the first act, then a sibling on the new lineage — so the
  //     replayed log is a branching history, not a straight line
  const forked = await session.dispatch({ verb: 'fork', fromCommitId: first, cause: user('try another reading') });
  expect(forked.ok).toBe(true);
  await landed({ verb: 'select', viewId: 'bar', field: 'category', value: 'Summer', cause: user('Summer instead') });
  // 12. a SEEK back to a moment on the original lineage — the walker moves, and
  //     the fold that comes back is compared against the replay like any other
  expect(session.seek(first).ok).toBe(true);
  await capture();

  return { moments, tip, forkPoint: first };
}

describe('conformance: folding as you walk equals folding a replay', () => {
  it('the fold at the end of a varied walk equals the fold of its replayed log', async () => {
    const walked = buildDashboard(conformanceDef()).createSession();
    // the TIP of the main line: every act folded in, and built by the DOORS as
    // it happened. (A fold read after a seek is already a rebuild, so comparing
    // that to a replay would be comparing `rebuildFold` with itself.)
    const { tip } = await walk(walked);

    // the wire: the trace, and nothing else
    const wire = serializeLog(walked.log.records);
    const records = deserializeLog(wire); // re-judged on the way back in

    const replayed = buildDashboard(conformanceDef()).createSession();
    await replayInto(replayed, records, tip.cursor);

    expect(foldOf(await replayed.overview(), replayed.cursor())).toEqual(tip.fold);
  });

  it('…and at EVERY moment of the walk, against the fold the doors built as it happened', async () => {
    const walked = buildDashboard(conformanceDef()).createSession();
    const { moments } = await walk(walked);
    expect(moments.length).toBe(12);

    const replayed = buildDashboard(conformanceDef()).createSession();
    await replayInto(replayed, deserializeLog(serializeLog(walked.log.records)), null);

    for (const [index, moment] of moments.entries()) {
      expect(replayed.seek(moment.cursor!).ok).toBe(true);
      expect({ at: index, fold: foldOf(await replayed.overview(), replayed.cursor()) })
        .toEqual({ at: index, fold: moment.fold });
    }
  });

  it('the replay is a MODE, not a rewrite: same acts, same ids, only `replayed` added', async () => {
    const walked = buildDashboard(conformanceDef()).createSession();
    await walk(walked);
    const replayed = buildDashboard(conformanceDef()).createSession();
    await replayInto(replayed, deserializeLog(serializeLog(walked.log.records)), null);

    expect(replayed.log.records.map((r) => r.id)).toEqual(walked.log.records.map((r) => r.id));
    expect(replayed.log.records.every((r) => r.cause.replayed === true)).toBe(true);
    // the two slots survive verbatim — the replay never rewrites who asked or who computed
    expect(replayed.log.records.map((r) => [r.cause.requestedBy, r.cause.computedBy]))
      .toEqual(walked.log.records.map((r) => [r.cause.requestedBy, r.cause.computedBy]));
    // and the predicate each commit rebuilds is byte-identical
    expect(replayed.log.records.map((r) => r.predicateSQL)).toEqual(walked.log.records.map((r) => r.predicateSQL));
  });
});
