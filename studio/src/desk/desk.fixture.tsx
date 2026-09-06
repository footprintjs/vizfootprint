/**
 * The suite's SECOND definition — a small library of books.
 *
 * It shares nothing with the NNDSS demo the desk was lifted out of, which is the
 * point: a shell exercised only by the host it came from is a shell nobody has
 * yet proven to be one. Everything here is used by the tests beside it; there is
 * no unexercised convenience in this file, on purpose (this workspace's coverage
 * gate is the library's, and a fixture is not exempt from it).
 */
import type { ReactNode } from 'react';
import { buildDashboard } from 'vizfootprint/def';
import { createSessionView, sessionSource, type SessionView } from 'vizfootprint-ui';
import type { DeskCharts } from './types.js';

export const cause = { requestedBy: 'user', computedBy: 'user' } as const;

export const BOOKS = [
  { id: 'b1', shelf: 'poetry', binding: 'paperback', year: 1955, pages: 120 },
  { id: 'b2', shelf: 'poetry', binding: 'hardback', year: 1971, pages: 96 },
  { id: 'b3', shelf: 'atlases', binding: 'hardback', year: 1971, pages: 400 },
  { id: 'b4', shelf: 'letters', binding: 'paperback', year: 1988, pages: 210 },
];

export type LibrarySession = ReturnType<ReturnType<typeof buildDashboard>['createSession']>;

/** A live session over the books, and the cockpit's view of it. */
export function openLibrary(): { readonly view: SessionView; readonly session: LibrarySession } {
  const dash = buildDashboard({
    meta: { title: 'the library' },
    data: { books: { source: { format: 'rows', via: 'inline', at: BOOKS } } },
    // `readout` carries no label on purpose: a view the def did not name is called by its id
    // `readout` carries no label on purpose: a view the def did not name is called by its id.
    // `sheet` is the data workbook's own view — a desk that shows its rows declares it, like the NNDSS desk does.
    actors: { shelves: { actor: 'user', label: 'Shelves' }, years: { actor: 'user', label: 'Years' }, readout: { actor: 'user' }, sheet: { actor: 'user', label: 'The rows' } },
    encodings: [
      { viewId: 'shelves', chartKind: 'bar', channels: ['category'], initial: { category: 'shelf' } },
      { viewId: 'years', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'year', y: 'pages' } },
    ],
    defaultTable: 'books',
  });
  const session = dash.createSession();
  return { session, view: createSessionView(sessionSource(session), { as: 'user' }) };
}

/**
 * The host's cells. Each reads its own field off the PROJECTION rather than
 * naming a column here — the whole point of the callback: re-encode the bar and
 * the caption and the mark move together.
 */
export const twoCells: DeskCharts = (desk) => [
  {
    id: 'shelves',
    weight: 2,
    caption: (
      <>
        {`Books by ${desk.bound('shelves', 'category', 'shelf')}`}
        {desk.words('shelves')}
      </>
    ),
    render: ({ width, height }): ReactNode => (
      <div data-testid="shelves-mark" aria-label={desk.altShort('shelves')} data-clauses={desk.selFor('shelves').clauses.size} data-fits={desk.fitsOf('shelves') === undefined ? 'none' : 'judged'}>
        {width}×{height}
      </div>
    ),
  },
  {
    id: 'years',
    caption: `Pages per ${desk.bound('years', 'x', 'year')} · ${String(desk.columns.length)} columns declared`,
    render: (): ReactNode => <div data-testid="years-mark" data-prose={desk.proseOf('years').length} />,
  },
];

/** A cell list with no weights and no captions — the optional halves of `DeskChart`, left off. */
export const bareCells: DeskCharts = () => [{ id: 'shelves', render: (): ReactNode => <div data-testid="bare-mark" /> }];

/** jsdom has neither observer; the frames measure and the story stage watches its beats. */
export function stubObservers(): void {
  class Noop {
    observe(): void {}
    disconnect(): void {}
  }
  (globalThis as Record<string, unknown>)['ResizeObserver'] = Noop;
  (globalThis as Record<string, unknown>)['IntersectionObserver'] = Noop;
  // `<ChartFrame>` renders NOTHING until it measures a non-zero layout box, and
  // jsdom does no layout — so without this every cell in every test would be an
  // empty frame and the render props would never be called at all.
  for (const prop of ['offsetWidth', 'offsetHeight']) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value: 300 });
  }
}
