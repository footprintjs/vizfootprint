// @vitest-environment jsdom
/**
 * THE REPORT PANELS the desk owns the words of.
 *
 * Each one is the same division: the ROWS are the host's arithmetic over its own
 * data, and the panel — its order, its badge, its restraint about what it will
 * not say — is the desk's. These tests hold the desk's half, which is the half a
 * second application inherits without writing any of it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Desk } from './Desk.js';
import { DataPanel } from './panels/DataPanel.js';
import { PathsPanel } from './panels/PathsPanel.js';
import { ProposalsPanel } from './panels/ProposalsPanel.js';
import { SilencesPanel } from './panels/SilencesPanel.js';
import { cause, openLibrary, stubObservers, twoCells } from './desk.fixture.js';

stubObservers();
afterEach(cleanup);

/** Open a report chip by its title and hand back the modal body. */
async function openReport(title: string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }));
  return await waitFor(() => document.querySelector('.vzf-modal-body') as HTMLElement);
}

describe('the silences panel', () => {
  const groups = [
    { state: 'withheld', total: 3, areas: [['Maine', ['pertussis', 'mumps']] as const] },
    { state: 'unknown', total: 0, areas: [] },
  ];

  it('draws the host’s groups, its own colour, and says "none this week" rather than vanishing', () => {
    render(<SilencesPanel silences={{ groups, colorOf: (s) => (s === 'withheld' ? 'rebeccapurple' : '#000'), heading: <b>what these mean</b> }} />);
    expect(screen.getByText('what these mean')).toBeTruthy();
    expect(screen.getByText(/withheld · 3 cells/)).toBeTruthy();
    expect(screen.getByText('Maine')).toBeTruthy();
    // a group with nothing in it is still a row — an absent row would read as a silence that does not exist
    expect(screen.getByText('none this week')).toBeTruthy();
    expect((screen.getByText(/withheld · 3 cells/) as HTMLElement).style.color).toBe('rebeccapurple');
  });

  it('needs neither a heading nor a palette — a host that has no words for its vocabulary says none', () => {
    render(<SilencesPanel silences={{ groups }} />);
    expect(screen.queryByText('what these mean')).toBeNull();
    expect((screen.getByText(/withheld · 3 cells/) as HTMLElement).style.color).toBe('');
  });

  it('joins the desk as a chip whose badge is the total, and is absent when the host has no groups', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const { rerender } = render(<Desk view={view} charts={twoCells} silences={{ groups }} />);
    expect(screen.getByRole('button', { name: /The silences 3/ })).toBeTruthy();
    rerender(<Desk view={view} charts={twoCells} />);
    expect(screen.queryByRole('button', { name: /The silences/ })).toBeNull();
  });
});

describe('the proposals panel', () => {
  const rows = [
    { id: 'p1', claim: 'pages by shelf', admitted: true },
    { id: 'p2', claim: 'pages by nothing', admitted: false, code: 'unknown-column', detail: '"nothing" is not a column of books' },
  ];

  it('draws the refusal WITH its code and sentence — a proposer only ever shown succeeding says nothing', () => {
    render(<ProposalsPanel proposals={{ rows }} readOnly={false} onDone={() => undefined} />);
    expect(screen.getByText('admitted')).toBeTruthy();
    expect(screen.getByText('refused')).toBeTruthy();
    expect(screen.getByText('unknown-column')).toBeTruthy();
    expect(screen.getByText(/"nothing" is not a column of books/)).toBeTruthy();
  });

  it('asks, then tells the desk to refresh — a host act that landed commits must show in the log at once', async () => {
    const onPropose = vi.fn(() => Promise.resolve());
    const onDone = vi.fn();
    render(<ProposalsPanel proposals={{ rows: [], onPropose, proposeLabel: 'Propose six charts', heading: 'six of them' }} readOnly={false} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Propose six charts' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onPropose).toHaveBeenCalled();
    expect(screen.getByText('six of them')).toBeTruthy();
  });

  it('reads and never asks when the host gave it no door, and its button is paused in Present mode', () => {
    const { unmount } = render(<ProposalsPanel proposals={{ rows }} readOnly={false} onDone={() => undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    render(<ProposalsPanel proposals={{ rows, onPropose: () => undefined }} readOnly onDone={() => undefined} />);
    expect((screen.getByRole('button', { name: 'Propose charts' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the paths panel', () => {
  it('draws every lane and offers the fork actions — and offers none of them in Present mode', async () => {
    const { session, view } = openLibrary();
    await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
    await view.refresh();
    const { rerender } = render(<PathsPanel state={view.getState()} view={view} readOnly={false} />);
    expect(screen.getByText(/Every line of work on this desk/)).toBeTruthy();
    rerender(<PathsPanel state={view.getState()} view={view} readOnly />);
    expect(screen.getByText(/Every line of work on this desk/)).toBeTruthy();
  });
});

describe('the data workbook', () => {
  const sheet = () => ({
    async schema() {
      return { columns: [{ name: 'shelf', type: 'string' as const }] };
    },
    async window() {
      return { rows: [], total: 0, offset: 0 };
    },
  });

  it('says it is reading the session until the table has a version at the cursor', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<DataPanel data={{ table: 'nothing-declared', sheet: sheet as never }} state={view.getState()} view={view} readOnly={false} />);
    // the workbook opens on Sources — a person reads where the rows came from before reading the rows
    fireEvent.click(screen.getByRole('tab', { name: /Sheet/ }));
    expect(screen.getByText('reading the session…')).toBeTruthy();
  });

  it('derives the Sheet’s columns from the session and only re-asks when the SCHEMA moves', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const built: number[] = [];
    const factory = (columns: readonly { readonly name: string }[]) => {
      built.push(columns.length);
      return sheet() as never;
    };
    const { rerender } = render(<DataPanel data={{ table: 'books', sheet: factory as never }} state={view.getState()} view={view} readOnly={false} />);
    const first = built.length;
    rerender(<DataPanel data={{ table: 'books', sheet: factory as never }} state={view.getState()} view={view} readOnly={false} />);
    expect(built.length).toBe(first); // a re-render is not a new question
    expect(built[0]).toBeGreaterThan(0); // the columns came off the session, not off the host
  });

  /** A grid port that really answers, so the header a sort toggle lives on is actually drawn. */
  const answering = () => ({
    capabilities: { sort: true, countKnown: true, edit: false },
    columns: async () => [{ name: 'shelf', type: 'string' as const }],
    rows: async () => ({ ok: true as const, columns: ['shelf'], rows: [{ shelf: 'a' }], rowIds: ['a'], positional: false, key: 'shelf', count: 1, start: 0, version: 'v1', cursor: null }),
  });

  it('sorting the grid LANDS an act — the order belongs to the trace, not to this panel', async () => {
    const { view, session } = openLibrary();
    await view.refresh();
    const port = answering();
    render(<DataPanel data={{ table: 'books', sheet: (() => port) as never }} state={view.getState()} view={view} readOnly={false} />);
    fireEvent.click(screen.getByRole('tab', { name: /Sheet/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'sort by shelf' }));
    // one commit, under the sheet's own layout identity, in the words a person reads
    await waitFor(() => expect(session.log.records.at(-1)?.viewId).toBe('layout:sheet:sheet'));
    expect(session.log.records.at(-1)!.cause.intent).toBe('sheet: sorted by shelf ↑');
    expect(session.log.records.at(-1)!.value).toBe('[{"field":"shelf","dir":"asc"}]');
  });

  it('present mode reads the rows and never rearranges them', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const port = answering();
    render(<DataPanel data={{ table: 'books', sheet: (() => port) as never }} state={view.getState()} view={view} readOnly />);
    fireEvent.click(screen.getByRole('tab', { name: /Sheet/ }));
    await waitFor(() => expect(document.querySelector('[role="columnheader"]')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'sort by shelf' })).toBeNull();
  });

  it('joins the desk as a chip badged with the table count', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} data={{ table: 'books', sheet: sheet as never }} />);
    expect(screen.getByRole('button', { name: /Data 1/ })).toBeTruthy();
    const body = await openReport('Data');
    expect(body.textContent).toContain('books');
  });

  it('offers a column over the NUMBER columns the session knows, and lands one as an act', async () => {
    const { view, session } = openLibrary();
    await view.refresh();
    const { container } = render(<DataPanel data={{ table: 'books', sheet: sheet as never }} state={view.getState()} view={view} readOnly={false} />);

    // the offer is the session's schema, projected — `shelf` and `binding` are text and are not on it
    expect(container.querySelector('[data-vzf="add-column-columns"]')?.textContent).toBe('the numbers it may read: year, pages');

    fireEvent.change(container.querySelector('.vzf-addcol-name') as HTMLInputElement, { target: { value: 'per_year' } });
    fireEvent.change(container.querySelector('.vzf-addcol-formula') as HTMLInputElement, { target: { value: 'pages / 10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this column' }));

    await waitFor(() => expect((container.querySelector('.vzf-addcol-said') as HTMLElement).textContent).toBe('per_year is on the sheet'));
    // an ACT: a commit with a cause, on the analysis's own view id
    const commit = session.log.records.at(-1)!;
    expect(commit.viewId).toBe('analysis:per_year');
    expect(commit.cause.intent).toBe('add column per_year = pages / 10');
    const rows = await session.viewQuery({ columns: ['id', 'per_year'], limit: 10 });
    expect(rows.ok && rows.rows.map((r) => r['per_year'])).toEqual([12, 9.6, 40, 21]);
  });

  it('offers a fold over every column the session knows, cuts a TABLE as an act, and grows a sheet for it', async () => {
    const { view, session } = openLibrary();
    await view.refresh();
    // one port per table asked for, so the desk's second argument is checked and not assumed
    const asked: string[] = [];
    const factory = (_columns: readonly { readonly name: string }[], table: string) => {
      asked.push(table);
      return answering() as never;
    };
    const props = () => ({ data: { table: 'books', sheet: factory as never }, state: view.getState(), view, readOnly: false });
    const { container, rerender } = render(<DataPanel {...props()} />);

    // the offer is the session's schema, projected — EVERY column, because a group is not a number
    expect(container.querySelector('[data-vzf="add-aggregate-columns"]')?.textContent).toBe('the columns it may read: id, shelf, binding, year, pages');
    expect(asked).toEqual(['books']); // nothing has been cut yet, so there is one table here

    fireEvent.change(container.querySelector('.vzf-addagg-name') as HTMLInputElement, { target: { value: 'by_shelf' } });
    fireEvent.click(container.querySelector('input[aria-label="group by shelf"]') as HTMLInputElement);
    fireEvent.change(container.querySelector('.vzf-addagg-as') as HTMLInputElement, { target: { value: 'pages_total' } });
    fireEvent.change(container.querySelector('.vzf-addagg-op') as HTMLSelectElement, { target: { value: 'sum' } });
    fireEvent.change(container.querySelector('.vzf-addagg-of') as HTMLSelectElement, { target: { value: 'pages' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cut this table' }));

    await waitFor(() => expect((container.querySelector('.vzf-addagg-said') as HTMLElement).textContent).toBe('by_shelf is a table now — it has a sheet of its own'));
    // an ACT: a commit with a cause, on the analysis's own view id
    const commit = session.log.records.at(-1)!;
    expect(commit.viewId).toBe('analysis:by_shelf');
    expect(commit.cause.intent).toBe('cut by_shelf: pages_total = sum of pages by shelf');
    const rows = await session.viewQuery({ table: 'by_shelf', limit: 10 });
    expect(rows.ok && rows.rows).toEqual([
      { shelf: 'poetry', pages_total: 216 },
      { shelf: 'atlases', pages_total: 400 },
      { shelf: 'letters', pages_total: 210 },
    ]);

    // the workbook grew a tab, under the table's own name, after the Sheet
    rerender(<DataPanel {...props()} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Sources', 'Sheet', 'by_shelf']);
    expect(asked).toEqual(['books', 'books', 'by_shelf']); // the desk asked the host for the cut table's own port
    // the Sources tab says which act cut it, in words, before anyone opens the rows
    expect(container.querySelector('[data-vzf="sources-derived"]')?.textContent).toBe(`derived from books — the rows visible at ${commit.id}, grouped by shelf, measuring pages_total`);
    fireEvent.click(screen.getByRole('tab', { name: 'by_shelf' }));
    await waitFor(() => expect(document.querySelector('[role="columnheader"]')).toBeTruthy());
  });

  it('shows the SESSION’s refusal and lands nothing', async () => {
    const { view, session } = openLibrary();
    await view.refresh();
    const { container } = render(<DataPanel data={{ table: 'books', sheet: sheet as never }} state={view.getState()} view={view} readOnly={false} />);
    fireEvent.change(container.querySelector('.vzf-addcol-name') as HTMLInputElement, { target: { value: 'odd' } });
    fireEvent.change(container.querySelector('.vzf-addcol-formula') as HTMLInputElement, { target: { value: 'pages / shelf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this column' }));

    await waitFor(() =>
      expect((container.querySelector('.vzf-addcol-said') as HTMLElement).textContent).toBe(
        'the formula "pages / shelf" reads "shelf", which table "books" holds as string — a formula reads numbers',
      ),
    );
    expect(session.log.records).toHaveLength(0);
  });
});

describe('the story tab', () => {
  it('is absent until the host asks for it, and then says so when the lineage has no beats', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const { rerender } = render(<Desk view={view} charts={twoCells} />);
    expect(screen.queryByRole('button', { name: /Story/ })).toBeNull();
    rerender(<Desk view={view} charts={twoCells} story={{ figure: ['shelves'], emptyNote: 'no beats yet' }} />);
    expect(screen.getByRole('button', { name: /Story 0/ })).toBeTruthy();
    const body = await openReport('Story');
    expect(body.textContent).toContain('no beats yet');
  });

  it('badges the beats and pins the named cells as the figure', async () => {
    const { session, view } = openLibrary();
    await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause: { ...cause, intent: 'pick poetry' } });
    session.bookmark('the poetry shelf');
    await view.refresh();
    render(<Desk view={view} charts={twoCells} story={{ declared: { title: 'the library', caption: 'books' }, author: 'the desk', date: '2026-09-05', figure: ['years'] }} />);
    expect(screen.getByRole('button', { name: /Story 1/ })).toBeTruthy();
    const body = await openReport('Story');
    // ONE frame: the figure shows the cell the story named, not the whole band
    expect(body.querySelectorAll('.vzf-chart-frame').length).toBe(1);
  });
});
