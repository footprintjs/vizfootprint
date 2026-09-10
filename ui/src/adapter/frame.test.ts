// @vitest-environment node
/**
 * THE FRAME DOOR — `frameFor` fills `RenderState.frame` from the same rows the
 * host is about to draw. Over a REAL two-layer session: the union per channel,
 * the zero policy the marks imply, and an absence row that never enters a
 * domain. Against a recording session: WHICH question each basis asks — the
 * layer's own window for `rows`, nobody's clause for `table` — because that
 * difference is the whole meaning of a fixed axis.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from 'vizfootprint/agent';
import { layerAddress } from 'vizfootprint/def';
import type { Row } from 'vizfootprint/data';
import type { ViewQuery, ViewQueryResult } from 'vizfootprint/session';
import { frameFor, FRAME_ROW_LIMIT, type FrameLayerRef, type FrameRequest, type FrameSessionLike } from './frame.js';
import { createSessionView, sessionSource } from './sessionView.js';

// ── a real two-layer session over one table: bars with a fitted line over them ──

const WEEKLY: readonly Row[] = [
  { week: 'w1', cases: 40, fitted: 55, state: 'present' },
  { week: 'w2', cases: 90, fitted: 70, state: 'present' },
  // the SILENCE: the source reported nothing this week. Its 999 is not a number anybody may read off an axis.
  { week: 'w3', cases: 999, fitted: 999, state: 'unavailable' },
];

const BARS: FrameLayerRef = { layerId: 'bars', table: 'weekly', chartKind: 'bar', encodings: { x: 'week', y: 'cases' } };
const TREND: FrameLayerRef = { layerId: 'trend', table: 'weekly', chartKind: 'line', encodings: { x: 'week', y: 'fitted' } };

/** The def: one view, two layers on one frame, x and y shared. `cases` declares a UNIT, which is what lets the two layers share y. */
function weeklyDef(frame: unknown = { x: { mode: 'shared', basis: 'table' }, y: { mode: 'shared' } }) {
  return {
    meta: { title: 'weekly cases' },
    data: { weekly: { rows: WEEKLY, columns: { cases: { unit: 'cases' }, fitted: { unit: 'cases' } }, absence: { field: 'state', states: ['present', 'unavailable', 'unknown'] } } },
    actors: { trend: { actor: 'user' as const, label: 'Weekly cases' } },
    encodings: [
      {
        viewId: 'trend',
        chartKind: 'bar',
        channels: ['x', 'y'],
        layers: [
          { layerId: 'bars', table: 'weekly', chartKind: 'bar', channels: ['x', 'y'], initial: { x: 'week', y: 'cases' } },
          { layerId: 'trend', table: 'weekly', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'week', y: 'fitted' } },
        ],
        frame,
      },
    ],
    defaultTable: 'weekly',
  };
}

async function liveFrame(frame?: unknown): Promise<{ answer: Readonly<Record<string, unknown>>; columns: FrameRequest['columns']; declared: unknown }> {
  const dashboard = buildDashboard(weeklyDef(frame) as never);
  const session = dashboard.createSession({ as: 'user' });
  const store = createSessionView(sessionSource(session), { as: 'user' });
  await store.refresh();
  const view = store.getState().views.find((v) => v.viewId === 'trend')!;
  const columns = store.getState().columns as FrameRequest['columns'];
  const answer = await frameFor(session, { viewId: 'trend', layers: [BARS, TREND], columns, ...(view.frame !== undefined ? { frame: view.frame } : {}) });
  return { answer, columns, declared: view.frame };
}

describe('frameFor — over a real session', () => {
  it('folds one domain per shared channel, and the store hands the DECLARATION through unchanged', async () => {
    const { answer, declared } = await liveFrame();
    expect(declared).toEqual({ x: { mode: 'shared', basis: 'table' }, y: { mode: 'shared' } });
    // x is a plain string column: the categories in row order, both layers walked in declaration order
    expect(answer['x']).toEqual({ mode: 'shared', basis: 'table', guide: 'merged', scale: 'categorical', domain: ['w1', 'w2'] });
    // y is the union of `cases` and `fitted`, anchored at zero because a BAR is on the channel — one stack, one baseline
    expect(answer['y']).toEqual({ mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain: [0, 90] });
  });

  it('an ABSENCE row never enters a domain — its 999 is a silence, not a maximum', async () => {
    const { answer } = await liveFrame();
    // the third row says `unavailable`; had it been folded, y would reach 999 and x would carry 'w3'
    expect(answer['y']).toMatchObject({ domain: [0, 90] });
    expect(answer['x']).toMatchObject({ domain: ['w1', 'w2'] });
  });

  it('a declared INDEPENDENT channel comes back with no domain at all, and the union is not folded for it', async () => {
    // no bar here: the def door refuses an independent magnitude channel to a bar, which is law 9 and is pinned in the def suite
    const def = {
      ...weeklyDef({ y: { mode: 'independent' } }),
      encodings: [
        {
          viewId: 'trend',
          chartKind: 'point',
          channels: ['y'],
          layers: [
            { layerId: 'bars', table: 'weekly', chartKind: 'point', channels: ['y'], initial: { y: 'cases' } },
            { layerId: 'trend', table: 'weekly', chartKind: 'point', channels: ['y'], initial: { y: 'fitted' } },
          ],
          frame: { y: { mode: 'independent' } },
        },
      ],
    };
    const session = buildDashboard(def as never).createSession({ as: 'user' });
    const store = createSessionView(sessionSource(session), { as: 'user' });
    await store.refresh();
    const answer = await frameFor(session, {
      viewId: 'trend',
      layers: [{ layerId: 'bars', table: 'weekly', chartKind: 'point', encodings: { y: 'cases' } }, { layerId: 'trend', table: 'weekly', chartKind: 'point', encodings: { y: 'fitted' } }],
      columns: store.getState().columns as FrameRequest['columns'],
      frame: store.getState().views[0]!.frame!,
    });
    expect(answer['y']).toEqual({ mode: 'independent', guide: 'per-layer' });
  });

  it('a view that declares no frame folds every channel on the default — the answer is never empty for want of a declaration', async () => {
    const { answer } = await liveFrame(undefined);
    expect(answer['y']).toMatchObject({ mode: 'shared', basis: 'table', guide: 'merged', domain: [0, 90] });
  });
});

// ── which question each basis asks ────────────────────────────────────────────

/** A session that records what it was asked and answers per question — the only way to see the DIFFERENCE between the two bases. */
function recording(answers: Readonly<Record<string, readonly Row[]>>): { asked: ViewQuery[]; session: FrameSessionLike } {
  const asked: ViewQuery[] = [];
  const answer = (rows: readonly Row[]): ViewQueryResult => ({ ok: true, columns: ['v'], rows, rowIds: rows.map((_, i) => String(i)), positional: true, count: rows.length, start: 0, version: null, cursor: null, clauses: [] });
  return {
    asked,
    session: {
      viewQuery(query: ViewQuery = {}): ViewQueryResult {
        asked.push(query);
        const key = query.viewId === null ? `table:${query.table}` : `view:${query.viewId}`;
        return answer(answers[key] ?? []);
      },
    },
  };
}

const ONE = { layerId: 'a', table: 't', chartKind: 'line', encodings: { y: 'v' } } as const;
const COLUMNS = { t: [{ field: 'v', type: 'number' }] };

describe('frameFor — the basis decides which rows, and says which it read', () => {
  it("basis 'rows' asks for the LAYER's window, under its address, so the axis narrows with the marks", async () => {
    const { asked, session } = recording({ 'view:trend~a': [{ v: 2 }, { v: 3 }], 'table:t': [{ v: 1 }, { v: 9 }] });
    const answer = await frameFor(session, { viewId: 'trend', layers: [ONE], columns: COLUMNS, frame: { y: { mode: 'shared', basis: 'rows' } } });
    expect(answer['y']).toEqual({ mode: 'shared', basis: 'rows', guide: 'merged', scale: 'quantitative', domain: [2, 3] });
    expect(asked).toEqual([{ viewId: layerAddress('trend', 'a'), limit: FRAME_ROW_LIMIT }]);
  });

  it("basis 'table' asks for NOBODY's clause (`viewId: null`), so a filter elsewhere leaves the axis where it was", async () => {
    const { asked, session } = recording({ 'view:trend~a': [{ v: 2 }, { v: 3 }], 'table:t': [{ v: 1 }, { v: 9 }] });
    const answer = await frameFor(session, { viewId: 'trend', layers: [ONE], columns: COLUMNS, frame: { y: { mode: 'shared', basis: 'table' } } });
    expect(answer['y']).toEqual({ mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain: [1, 9] });
    expect(asked).toEqual([{ viewId: null, table: 't', limit: FRAME_ROW_LIMIT }]);
  });

  it('two channels on the same basis are ONE read, and two bases are two — never one window per channel', async () => {
    const two = { layerId: 'a', table: 't', chartKind: 'line', encodings: { x: 'v', y: 'v' } } as const;
    const same = recording({ 'table:t': [{ v: 4 }] });
    await frameFor(same.session, { viewId: 'trend', layers: [two], columns: COLUMNS, frame: { x: { mode: 'shared', basis: 'table' }, y: { mode: 'shared', basis: 'table' } } });
    expect(same.asked).toHaveLength(1);
    const split = recording({ 'table:t': [{ v: 4 }], 'view:trend~a': [{ v: 4 }] });
    await frameFor(split.session, { viewId: 'trend', layers: [two], columns: COLUMNS, frame: { x: { mode: 'shared', basis: 'table' }, y: { mode: 'shared', basis: 'rows' } } });
    expect(split.asked).toHaveLength(2);
  });

  it('an INDEPENDENT channel asks for no rows at all — it has no domain, so a read for it would be thrown away', async () => {
    const both = { layerId: 'a', table: 't', chartKind: 'line', encodings: { y: 'v', g: 'v' } } as const;
    const { asked, session } = recording({ 'view:trend~a': [{ v: 2 }, { v: 3 }], 'table:t': [{ v: 1 }, { v: 9 }] });
    const answer = await frameFor(session, { viewId: 'trend', layers: [both], columns: COLUMNS, frame: { y: { mode: 'shared', basis: 'rows' }, g: { mode: 'independent' } } });
    // ONE question: the layer's own window, for the one channel that has a domain
    expect(asked).toEqual([{ viewId: layerAddress('trend', 'a'), limit: FRAME_ROW_LIMIT }]);
    // …and the independent channel is still IN the frame, because that is how a renderer knows who draws its guide
    expect(answer).toEqual({ y: { mode: 'shared', basis: 'rows', guide: 'merged', scale: 'quantitative', domain: [2, 3] }, g: { mode: 'independent', guide: 'per-layer' } });
  });

  it('a window the caller sizes is honoured, and a REFUSED read contributes no values rather than stale ones', async () => {
    const { asked, session } = recording({ 'table:t': [{ v: 4 }] });
    await frameFor(session, { viewId: 'trend', layers: [ONE], columns: COLUMNS, limit: 12 });
    expect(asked).toEqual([{ viewId: null, table: 't', limit: 12 }]);
    const refusing: FrameSessionLike = { viewQuery: () => ({ ok: false, reason: 'unknown-table', rejected: 'no table "t" here' }) };
    expect(await frameFor(refusing, { viewId: 'trend', layers: [ONE], columns: COLUMNS })).toEqual({});
  });

  it("a table whose absence vocabulary declares a state that CARRIES a value keeps those rows — passed in, because `columns` cannot say `carries`", async () => {
    const rows = [{ v: 1, state: 'present' }, { v: 5, state: 'estimated' }, { v: 900, state: 'unavailable' }];
    const columns = { t: [{ field: 'v', type: 'number' }, { field: 'state', type: 'string', absence: ['present', 'estimated', 'unavailable'] }] };
    // read off `columns` alone, an estimate reads as a silence…
    expect(await frameFor(recording({ 'table:t': rows }).session, { viewId: 'trend', layers: [ONE], columns })).toMatchObject({ y: { domain: [1, 1] } });
    // …and the declaration that says an estimate carries a figure puts it back, with the true silence still out
    const declared = { t: { field: 'state', states: ['present', 'estimated', 'unavailable'], carries: ['estimated'] } };
    expect(await frameFor(recording({ 'table:t': rows }).session, { viewId: 'trend', layers: [ONE], columns, absence: declared })).toMatchObject({ y: { domain: [1, 5] } });
  });

  it('drops the silences PER COLUMN: a row with no radius still lends its mass and its period to their domains', async () => {
    // The exoplanet demo's shape. Before this the door dropped the whole ROW on one state column, so
    // the 43 planets with a mass and no radius were missing from every axis but their own.
    const rows = [
      { pl_rade: 1, radius_state: 'present', pl_masse: 1, mass_state: 'present', pl_orbper: 10, period_state: 'present' },
      { pl_rade: 999, radius_state: 'not-measured', pl_masse: 6, mass_state: 'present', pl_orbper: 88, period_state: 'present' },
    ];
    const columns = {
      t: [
        { field: 'pl_rade', type: 'number' },
        { field: 'pl_masse', type: 'number' },
        { field: 'pl_orbper', type: 'number' },
        { field: 'radius_state', type: 'string', absence: ['present', 'not-measured', 'unknown'] },
        { field: 'mass_state', type: 'string', absence: ['present', 'not-measured', 'unknown'] },
        { field: 'period_state', type: 'string', absence: ['present', 'not-measured', 'unknown'] },
      ],
    };
    const absence = {
      t: [
        { field: 'radius_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_rade'] },
        { field: 'mass_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_masse'] },
        { field: 'period_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_orbper'] },
      ],
    };
    const layer: FrameLayerRef = { layerId: 'a', table: 't', chartKind: 'point', encodings: { x: 'pl_masse', y: 'pl_rade', size: 'pl_orbper' } };
    const frame = await frameFor(recording({ 'table:t': rows }).session, { viewId: 'trend', layers: [layer], columns, absence });
    // the radius axis sees only the measured one; the mass and period axes see both rows
    expect(frame).toMatchObject({ y: { domain: [1, 1] }, x: { domain: [1, 6] }, size: { domain: [10, 88] } });
  });

  it('read off `columns` alone, EVERY state column still governs every other column — the projection cannot say `governs`', async () => {
    const rows = [{ v: 1, a_state: 'present', b_state: 'present' }, { v: 900, a_state: 'present', b_state: 'unavailable' }];
    const columns = {
      t: [
        { field: 'v', type: 'number' },
        { field: 'a_state', type: 'string', absence: ['present', 'unavailable', 'unknown'] },
        { field: 'b_state', type: 'string', absence: ['present', 'unavailable', 'unknown'] },
      ],
    };
    // `v` is governed by the FIRST state column the projection lists, and the second row's silence in
    // `b_state` does not reach it — which is exactly why a def with `governs` passes its declaration in.
    expect(await frameFor(recording({ 'table:t': rows }).session, { viewId: 'trend', layers: [ONE], columns })).toMatchObject({ y: { domain: [1, 900] } });
  });

  it('a state column bound to its OWN channel shows its silences — it is never governed, not even by itself', async () => {
    // Before per-column dropping this door filtered whole ROWS on the ONE declared state column, so a
    // channel bound to that same column could never show the word that made a row silent — a legend for
    // it would never carry "unavailable". `silenceOfDecl`'s state-column check (`vizfootprint/data`)
    // answers `undefined` for a state column, so this door reads it as it is; PINNED, either way.
    const rows = [{ v: 1, state: 'present' }, { v: 2, state: 'unavailable' }];
    const columns = { t: [{ field: 'v', type: 'number' }, { field: 'state', type: 'string', absence: ['present', 'unavailable', 'unknown'] }] };
    const layer: FrameLayerRef = { layerId: 'a', table: 't', chartKind: 'point', encodings: { x: 'state', y: 'v' } };
    const frame = await frameFor(recording({ 'table:t': rows }).session, { viewId: 'trend', layers: [layer], columns });
    // the state axis carries both words; `v`, which the bare declaration governs, sees only the present row
    expect(frame).toMatchObject({ x: { domain: ['present', 'unavailable'] }, y: { domain: [1, 1] } });
  });

  it('a table the columns map does not list, and a layer with no mark, still fold — as `unknown`, which is no domain at all', async () => {
    const { session } = recording({ 'table:t': [{ v: 4 }] });
    // no columns for table `t`: the type is unknown, and an unknown type folds to nothing rather than a guess
    expect(await frameFor(session, { viewId: 'trend', layers: [ONE], columns: {} })).toEqual({});
    // a layer with no chartKind carries none into the fold — the zero default then rests on the other layers
    const noKind = { layerId: 'a', table: 't', encodings: { y: 'v' } };
    expect(await frameFor(recording({ 'table:t': [{ v: 4 }] }).session, { viewId: 'trend', layers: [noKind], columns: COLUMNS })).toMatchObject({ y: { domain: [4, 4] } });
  });

  it('no layers is an empty frame — a plain view has no scales to share', async () => {
    const { asked, session } = recording({});
    expect(await frameFor(session, { viewId: 'trend', layers: [], columns: COLUMNS })).toEqual({});
    expect(asked).toEqual([]);
  });
});
