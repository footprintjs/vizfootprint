// @vitest-environment node
/**
 * THE FRAME DOOR FOR A VIEW WITH NO LAYERS — `viewFrameFor` folds the axes a
 * plain view's definition declared something about, and nothing else.
 *
 * `frameFor` folds layers, and with none it answers `{}`: a plain view's
 * declared axis settings never reached its renderer.
 *
 * | the view declares                          | it binds   | the answer                                              |
 * |--------------------------------------------|------------|---------------------------------------------------------|
 * | nothing                                    | x, y       | `{}`, and no read                                       |
 * | `y: { transform: 'log' }`                  | x, y       | y only: its span, and the curve echoed                  |
 * | `y: { zeroGuide: true }`, `x: { bounds }`  | x, y       | both, each with its key                                 |
 * | `y: { zero: true }`                        | x, y       | y reaching zero                                         |
 * | `y: { basis: 'rows' }`                     | x, y       | read at the VIEW's own address                          |
 * | `y: {}` (basis by default)                 | x, y       | read from the table with nobody's clause                |
 * | `color: { … }`                             | x, y       | `{}`: a channel the view does not bind is not folded    |
 * | a silence in the column                    |            | dropped before the fold, as for a layer                 |
 * | a refused read, or no cell a logarithm can place |      | no span, never a stale or invented one; the declared curve, zero line and bounds still ride on the entry |
 * | `y: {}` on a bar or a box plot             | y          | the span reaches zero: the mark is read from zero       |
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from 'vizfootprint/agent';
import type { ChannelResolution } from 'vizfootprint/def';
import type { Row } from 'vizfootprint/data';
import type { ViewQuery, ViewQueryResult } from 'vizfootprint/session';
import { frameFor, viewFrameFor, FRAME_ROW_LIMIT, type FrameSessionLike, type ViewFrameRequest } from './frame.js';
import { createSessionView, sessionSource } from './sessionView.js';

/** A session that records what it was asked and answers per question. */
function recording(answers: Readonly<Record<string, readonly Row[] | 'refused'>>): { asked: ViewQuery[]; session: FrameSessionLike } {
  const asked: ViewQuery[] = [];
  const ok = (rows: readonly Row[]): ViewQueryResult => ({ ok: true, columns: ['v'], rows, rowIds: rows.map((_, i) => String(i)), positional: true, count: rows.length, start: 0, version: null, cursor: null, clauses: [] });
  return {
    asked,
    session: {
      viewQuery(query: ViewQuery = {}): ViewQueryResult {
        asked.push(query);
        const found = answers[query.viewId === null ? `table:${String(query.table)}` : `view:${String(query.viewId)}`] ?? [];
        return found === 'refused' ? ({ ok: false, reason: 'unknown-view', rejected: 'no such view' } as unknown as ViewQueryResult) : ok(found);
      },
    },
  };
}

/** An axis as a definition declares it on a view with no layers: the axis keys, and no `mode`. */
const axis = (keys: object): ChannelResolution => keys as ChannelResolution;
const COLUMNS = { t: [{ field: 'p', type: 'number' }, { field: 'v', type: 'number' }, { field: 'g', type: 'string' }] };
const VIEW: Omit<ViewFrameRequest, 'frame'> = { viewId: 'dots', table: 't', chartKind: 'point', encodings: { x: 'p', y: 'v' }, columns: COLUMNS };
const TABLE: readonly Row[] = [{ p: 1, v: 5 }, { p: 9, v: 40 }];

describe('viewFrameFor — only what was declared is folded', () => {
  it('a view that declared nothing gets an empty frame, and nothing is read', async () => {
    const { asked, session } = recording({ 'table:t': TABLE });
    expect(await viewFrameFor(session, VIEW)).toEqual({});
    expect(await viewFrameFor(session, { ...VIEW, frame: {} })).toEqual({});
    expect(asked).toEqual([]);
  });

  it('folds the one axis the definition named and leaves the other to the chart', async () => {
    const { asked, session } = recording({ 'table:t': TABLE });
    const answer = await viewFrameFor(session, { ...VIEW, frame: { y: axis({ transform: 'log' }) } });
    expect(answer).toEqual({ y: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain: [5, 40], transform: 'log' } });
    expect(Object.keys(answer)).toEqual(['y']);
    expect(asked).toEqual([{ viewId: null, table: 't', limit: FRAME_ROW_LIMIT }]);
  });

  it('echoes each declared key: a zero line, bounds, and a span that reaches zero', async () => {
    const { session } = recording({ 'table:t': TABLE });
    const answer = await viewFrameFor(session, { ...VIEW, frame: { x: axis({ bounds: [0, 100] }), y: axis({ zeroGuide: true, zero: true }) } });
    expect(answer['x']).toMatchObject({ domain: [1, 9], bounds: [0, 100] });
    expect(answer['y']).toMatchObject({ domain: [0, 40], zeroGuide: true });
  });

  it('a channel the view does not bind is not folded, declared or not', async () => {
    const { asked, session } = recording({ 'table:t': TABLE });
    expect(await viewFrameFor(session, { ...VIEW, frame: { color: axis({ transform: 'log' }) } })).toEqual({});
    expect(asked).toEqual([]);
  });

  it('is not `frameFor` with one layer: that door folds every channel the layer binds', async () => {
    const { session } = recording({ 'table:t': TABLE });
    const layered = await frameFor(session, { viewId: 'dots', layers: [{ layerId: 'a', table: 't', chartKind: 'point', encodings: VIEW.encodings }], columns: COLUMNS, frame: { y: { mode: 'shared', transform: 'log' } } });
    expect(Object.keys(layered).sort()).toEqual(['x', 'y']);
  });
});

describe('viewFrameFor — which rows', () => {
  it("basis 'rows' reads the rows the view draws, at the view's own address", async () => {
    const { asked, session } = recording({ 'view:dots': [{ p: 2, v: 7 }, { p: 3, v: 8 }], 'table:t': TABLE });
    const answer = await viewFrameFor(session, { ...VIEW, frame: { y: axis({ basis: 'rows' }) } });
    expect(answer['y']).toMatchObject({ basis: 'rows', domain: [7, 8] });
    expect(asked).toEqual([{ viewId: 'dots', limit: FRAME_ROW_LIMIT }]);
  });

  it("two axes on two bases are two reads, and a window the caller sizes is honoured", async () => {
    const { asked, session } = recording({ 'view:dots': [{ p: 2, v: 7 }], 'table:t': TABLE });
    const answer = await viewFrameFor(session, { ...VIEW, limit: 10, frame: { x: axis({ basis: 'table' }), y: axis({ basis: 'rows' }) } });
    expect(answer['x']).toMatchObject({ domain: [1, 9] });
    expect(answer['y']).toMatchObject({ domain: [7, 7] });
    expect(asked).toHaveLength(2);
    expect(asked.every((query) => query.limit === 10)).toBe(true);
  });

  it('a refused read folds no span, never a stale one: the axis keeps what was declared on it, and an axis that declared no key gets no entry', async () => {
    const { session } = recording({ 'view:dots': 'refused', 'table:t': TABLE });
    const answer = await viewFrameFor(session, { ...VIEW, frame: { x: axis({}), y: axis({ basis: 'rows', zeroGuide: true }) } });
    expect(answer['x']).toMatchObject({ domain: [1, 9] });
    expect(answer['y']).toEqual({ mode: 'shared', basis: 'rows', guide: 'merged', zeroGuide: true, unfolded: true, kind: 'quantitative' });
    // `basis` alone is a word about which rows; with no rows read there is nothing for a picture to answer to
    expect(await viewFrameFor(session, { ...VIEW, frame: { y: axis({ basis: 'rows' }) } })).toEqual({});
  });

  it('a silence never enters the span, as for a layer', async () => {
    const rows: readonly Row[] = [{ p: 1, v: 5, state: 'present' }, { p: 2, v: 999, state: 'unavailable' }];
    const { session } = recording({ 'table:t': rows });
    const columns = { t: [...COLUMNS.t, { field: 'state', type: 'string', absence: ['present', 'unavailable'] }] };
    const answer = await viewFrameFor(session, { ...VIEW, columns, frame: { y: axis({}) } });
    expect(answer['y']).toMatchObject({ domain: [5, 5] });
  });

  it('the mark decides the zero default: a bar and a box plot are read from zero, a scatter is not', async () => {
    const { session } = recording({ 'table:t': TABLE });
    const folded = async (chartKind: string, keys: object = {}): Promise<unknown> => (await viewFrameFor(session, { ...VIEW, chartKind, frame: { y: axis(keys) } }) as Readonly<Record<string, { domain?: unknown }>>)['y']?.domain;
    expect(await folded('bar')).toEqual([0, 40]);
    expect(await folded('boxplot')).toEqual([0, 40]);
    expect(await folded('histogram')).toEqual([5, 40]); // a histogram's bound channel is its bin axis, a position
    expect(await folded('scatter')).toEqual([5, 40]);
    expect(await folded('point')).toEqual([5, 40]);
    expect(await folded('line')).toEqual([5, 40]);
    // …and a declaration still wins over the default
    expect(await folded('scatter', { zero: true })).toEqual([0, 40]);
  });

  it('a logarithm that can place no cell folds no span, and the declared curve and bounds still reach the picture', async () => {
    const { session } = recording({ 'table:t': [{ p: 1, v: -3 }, { p: 2, v: 0 }] });
    expect(await viewFrameFor(session, { ...VIEW, frame: { y: axis({ transform: 'log', bounds: [0.1, 5000] }) } })).toEqual({
      y: { mode: 'shared', basis: 'table', guide: 'merged', transform: 'log', bounds: [0.1, 5000], unfolded: true, kind: 'quantitative' },
    });
  });
});

describe('viewFrameFor — over a real session, from a real definition', () => {
  const ROWS: readonly Row[] = [
    { id: 'a', mass: 2, period: 30 },
    { id: 'b', mass: 200, period: 4000 },
  ];
  const def = (frame: unknown) => ({
    meta: { title: 'planets' },
    data: { planets: { rows: ROWS, key: 'id' } },
    actors: { dots: { actor: 'user' as const, label: 'Planets' } },
    encodings: [{ viewId: 'dots', chartKind: 'scatter', channels: ['x', 'y'], initial: { x: 'mass', y: 'period' }, ...(frame === undefined ? {} : { frame }) }],
    defaultTable: 'planets',
  });

  async function live(frame: unknown): Promise<Readonly<Record<string, unknown>>> {
    const dashboard = buildDashboard(def(frame) as never);
    const session = dashboard.createSession({ as: 'user' });
    const store = createSessionView(sessionSource(session), { as: 'user' });
    await store.refresh();
    const view = store.getState().views.find((v) => v.viewId === 'dots')!;
    return viewFrameFor(session, { viewId: 'dots', table: 'planets', chartKind: 'point', encodings: { x: 'mass', y: 'period' }, columns: store.getState().columns as ViewFrameRequest['columns'], ...(view.frame !== undefined ? { frame: view.frame } : {}) });
  }

  it('the definition door accepts the axis keys with no `mode`, the store hands them through, and the door folds them', async () => {
    const answer = await live({ x: { transform: 'log' }, y: { bounds: [0, 5000], zeroGuide: true } });
    expect(answer['x']).toMatchObject({ scale: 'quantitative', domain: [2, 200], transform: 'log' });
    expect(answer['y']).toMatchObject({ scale: 'quantitative', domain: [30, 4000], bounds: [0, 5000], zeroGuide: true });
  });

  it('a definition that declares no axis folds nothing', async () => {
    expect(await live(undefined)).toEqual({});
  });
});
