// @vitest-environment jsdom
/**
 * EVERY AXIS KEY A PLAIN VIEW MAY DECLARE, WALKED FROM THE DEFINITION TO THE
 * PICTURE.
 *
 * A definition declares a key on the axis of a view with no layers. The
 * definition door accepts it, the store projects it, the adapter's door folds
 * it (`viewFrameFor`) and the renderer draws it. Each of those four steps has
 * dropped a key in silence at some point. This test takes the list of keys
 * from its one owner (`AXIS_KEYS`, `src/def/layers.ts`) and fails if any key
 * has no case here, so a key added to the definition cannot be forgotten on
 * the way to the picture.
 *
 * One mark, a scatter, and its y: the walk is about the path. What each mark
 * does with a key is held by `plainViewAxes.test.tsx`.
 *
 * | the key       | declared as          | in the picture                                                    |
 * |---------------|----------------------|-------------------------------------------------------------------|
 * | (none)        |                      | the chart's own extent, with its margin: the baseline             |
 * | `transform`   | `'log'`              | a logarithmic axis: decades                                       |
 * | `zero`        | `true`               | the axis starts at zero                                           |
 * | `zeroGuide`   | `true`               | one zero line across the plot                                     |
 * | `bounds`      | `[0, 10000]`         | the axis is drawn on the bounds                                   |
 * | `basis`       | `'rows'`             | the axis is measured over the rows the view draws, not the table  |
 * | `domain`      | `'union'`            | the only word there is: the folded span, as any entry gives       |
 * | `guide`       | `'per-layer'`        | nothing to change: a view alone always draws its own guide        |
 *
 * "As any entry gives" is compared with an entry that changes nothing else,
 * `{ transform: 'linear' }`. An EMPTY entry, `y: {}`, declares nothing: the
 * picture is the chart on its own extent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDashboard } from 'vizfootprint/agent';
import { AXIS_KEYS } from 'vizfootprint/def';
import type { Row } from 'vizfootprint/data';
import { createSessionView, sessionSource } from '../adapter/sessionView.js';
import { viewFrameFor, type ViewFrameRequest } from '../adapter/frame.js';
import { scatterRenderer } from './renderers.js';
import { emptySelection } from './selection.js';
import { RENDERER_PROTOCOL_VERSION, type RenderRow } from './types.js';

afterEach(() => {
  document.body.innerHTML = '';
});

// period spans three decades and never reaches zero, so each key has something to show
const PLANETS: readonly Row[] = [
  { id: 'a', kind: 'rock', mass: 2, period: 30 },
  { id: 'b', kind: 'rock', mass: 20, period: 300 },
  { id: 'c', kind: 'gas', mass: 200, period: 3000 },
];

/** A plain scatter whose definition declares `y` as given, drawn the way a host draws it. `lightOnly`: another view filters the table to the two light planets, so this view draws two rows. */
async function drawn(y: Readonly<Record<string, unknown>> | undefined, lightOnly = false): Promise<HTMLElement> {
  const dashboard = buildDashboard({
    meta: { title: 'planets' },
    data: { planets: { rows: PLANETS, key: 'id' } },
    actors: { dots: { actor: 'user', label: 'Planets' }, pick: { actor: 'user', label: 'Kind' } },
    encodings: [
      { viewId: 'dots', chartKind: 'scatter', channels: ['x', 'y'], initial: { x: 'mass', y: 'period' }, ...(y === undefined ? {} : { frame: { y } }) },
      { viewId: 'pick', chartKind: 'bar', channels: ['category'], initial: { category: 'kind' } },
    ],
    defaultTable: 'planets',
  } as never);
  const session = dashboard.createSession({ as: 'user' });
  if (lightOnly) {
    const done = await session.dispatch({ verb: 'filter', viewId: 'pick', field: 'mass', range: [1, 50], cause: { requestedBy: 'user', computedBy: 'user', intent: 'the light planets' } } as never);
    expect((done as { ok: boolean }).ok).toBe(true);
  }
  const store = createSessionView(sessionSource(session), { as: 'user' });
  await store.refresh();
  const view = store.getState().views.find((v) => v.viewId === 'dots')!;
  const encodings = { x: 'mass', y: 'period' };
  const frame = await viewFrameFor(session, { viewId: 'dots', table: 'planets', chartKind: 'scatter', encodings, columns: store.getState().columns as ViewFrameRequest['columns'], ...(view.frame !== undefined ? { frame: view.frame } : {}) });
  const answer = await session.viewQuery({ viewId: 'dots' });
  const rows = (answer.ok ? answer.rows : []).map((row) => ({ ...row })) as RenderRow[];
  const el = document.createElement('div');
  document.body.appendChild(el);
  const mounted = scatterRenderer().mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'dots', callbacks: { emit: vi.fn(), hover: vi.fn(), reencodeRequest: vi.fn(), navigate: vi.fn() } });
  mounted.update({ rows, encodings, selection: emptySelection('dots'), hover: null, theme: {}, size: { width: 400, height: 300 }, ...(Object.keys(frame).length > 0 ? { frame } : {}) });
  return el;
}

const yTicks = (el: HTMLElement): string[] => [...el.querySelectorAll('[data-axis-orient="left"] text.vzf-tick')].map((t) => t.textContent ?? '');
const refusal = (el: HTMLElement): string => el.querySelector('p.vzf-chart-refusal')?.textContent ?? '';

/** An entry that changes nothing but being one: the axis is on the folded span and every other key is at its default. */
const PLAIN_ENTRY = { transform: 'linear' } as const;

/** One case per key: how it is declared, and what the picture must then show. */
const CASES: Readonly<Record<string, { readonly declare: unknown; readonly shows: (el: HTMLElement, own: HTMLElement, entry: HTMLElement) => Promise<void> | void }>> = {
  transform: {
    declare: 'log',
    shows: (el) => expect(yTicks(el)).toEqual(['100', '1000']),
  },
  zero: {
    declare: true,
    shows: (el, own) => {
      expect(yTicks(el)[0]).toBe('0');
      // the lowest point stands above the floor of an axis that starts at zero; on the folded span it stands on it
      const low = (root: HTMLElement): number => Math.max(...[...root.querySelectorAll('circle.vzf-dot')].map((c) => Number(c.getAttribute('cy'))));
      const floor = (root: HTMLElement): number => Math.max(...[...root.querySelectorAll('[data-axis-orient="left"] line')].flatMap((l) => [Number(l.getAttribute('y1')), Number(l.getAttribute('y2'))]));
      expect(low(el)).toBeLessThan(floor(el));
    },
  },
  zeroGuide: {
    declare: true,
    // period never reaches zero, so the chart says in words that the line has no place, where it used to say nothing
    shows: (el, own) => {
      expect([...el.querySelectorAll('text.vzf-zero-note')].map((t) => t.textContent ?? '').join(' ')).toContain('zero');
      expect(own.querySelectorAll('text.vzf-zero-note')).toHaveLength(0);
    },
  },
  bounds: {
    declare: [0, 10000],
    shows: (el) => expect(yTicks(el)).toEqual(['0', '2k', '4k', '6k', '8k', '10k']),
  },
  basis: {
    declare: 'rows',
    // with the view narrowed to the two light planets, an axis measured over the view's rows ends at 300; over the table, at 3000
    shows: async () => {
      const overRows = await drawn({ basis: 'rows' }, true);
      expect(overRows.querySelectorAll('circle.vzf-dot')).toHaveLength(2);
      const top = Number(yTicks(overRows).at(-1));
      document.body.innerHTML = '';
      const overTable = await drawn({ basis: 'table' }, true);
      expect(top).toBeLessThanOrEqual(300);
      expect(Number(yTicks(overTable).at(-1))).toBeGreaterThan(300);
    },
  },
  domain: {
    declare: 'union',
    shows: (el, _own, entry) => expect(el.innerHTML).toBe(entry.innerHTML),
  },
  guide: {
    declare: 'per-layer',
    shows: (el, _own, entry) => expect(el.innerHTML).toBe(entry.innerHTML),
  },
};

describe('every axis key a plain view may declare reaches the picture', () => {
  it('has a case for every key the definition door accepts, and for no other', () => {
    expect(Object.keys(CASES).sort()).toEqual([...AXIS_KEYS].sort());
  });

  it('declaring nothing, or an empty entry, is the chart on its own extent; any key puts the axis on the folded span', async () => {
    const own = (await drawn(undefined)).innerHTML;
    document.body.innerHTML = '';
    expect((await drawn({})).innerHTML).toBe(own);
    document.body.innerHTML = '';
    const entry = await drawn(PLAIN_ENTRY);
    expect(refusal(entry)).toBe('');
    expect(entry.innerHTML).not.toBe(own);
    // the folded span is the data's own, 30…3000: the lowest point stands on the floor of the axis, with no margin under it
    const low = Math.max(...[...entry.querySelectorAll('circle.vzf-dot')].map((c) => Number(c.getAttribute('cy'))));
    const floor = Math.max(...[...entry.querySelectorAll('[data-axis-orient="left"] line')].flatMap((l) => [Number(l.getAttribute('y1')), Number(l.getAttribute('y2'))]));
    expect(low).toBe(floor);
  });

  for (const key of AXIS_KEYS) {
    it(`${key}: accepted by the definition door, folded by the adapter's door, drawn`, async () => {
      const own = await drawn(undefined);
      const entry = await drawn(PLAIN_ENTRY);
      const el = await drawn({ [key]: CASES[key]!.declare });
      expect(refusal(el)).toBe('');
      await CASES[key]!.shows(el, own, entry);
    });
  }
});
