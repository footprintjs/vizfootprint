// @vitest-environment jsdom
/**
 * THE DESK'S CONTRACT, from a SECOND definition's side.
 *
 * The NNDSS demo proves the desk can carry the dashboard it was lifted out of.
 * That is the weaker claim, and it is not the one this file makes. Everything
 * here runs over a small library-of-books def that shares nothing with that
 * demo — different table, different columns, different views, two cells instead
 * of seven — because a shell that is only ever exercised by the host it was
 * extracted from is a shell that has not yet been proven to be one.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SessionView } from 'vizfootprint-ui';
import { Desk } from './Desk.js';
import { DeskFigure } from './figure.js';
import { DESK_TOKENS, deskTokenVar } from './tokens.js';
import { cause, openLibrary, stubObservers, twoCells } from './desk.fixture.js';

stubObservers();

afterEach(cleanup);

describe('a second definition, two cells', () => {
  it('renders both cells, their captions read off the projection, and the desk brings its own panels', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} />);

    // the host's captions — proof the projection reached the cells with the session's own answers
    expect(screen.getByText('Books by shelf')).toBeTruthy();
    // the count is not pinned: what is being proven is that the SESSION's own
    // column list reached the cell, not how many columns an engine derived
    expect(screen.getByText(/^Pages per year · [1-9]\d* columns declared$/)).toBeTruthy();

    // the desk's own furniture, with no host configuration at all
    expect(screen.getByRole('button', { name: /Commit log/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Paths/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dashboard menu' })).toBeTruthy();
    expect(screen.getByLabelText('commit number')).toBeTruthy();

    // …and nothing whose input it was not given: no Data tab, no Story tab,
    // no silences, no proposals. An empty panel is furniture, not information.
    expect(screen.queryByRole('button', { name: /Data/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Story/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /silences/ })).toBeNull();
  });

  it('gives every cell the ✕ and the ✎ without the host asking, and the ✕ names the view the def named', async () => {
    const { session, view } = openLibrary();
    await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
    await view.refresh();
    render(<Desk view={view} charts={twoCells} />);

    expect(screen.getByRole('button', { name: 'Edit shelves' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit years' })).toBeTruthy();
    // the clear affordance appears ONLY on the view holding a live clause —
    // derived from the session's fold, never from anything the host set
    expect(screen.getByRole('button', { name: 'Clear the shelves selection' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear the years selection' })).toBeNull();
  });

  it('the projection answers with the SESSION, not with a constant: a re-encode moves the caption', async () => {
    const { view } = openLibrary();
    await view.reencode('shelves', 'category', 'binding');
    render(<Desk view={view} charts={twoCells} />);
    expect(screen.getByText('Books by binding')).toBeTruthy();
  });
});

describe('the story figure', () => {
  it('refuses a cell id this desk has not got, in a sentence, and draws the rest', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<DeskFigure view={view} charts={twoCells} show={['years', 'sales']} />);
    expect(screen.getByText('this figure names "sales", which is not a cell on this desk — the rest are drawn')).toBeTruthy();
    // the one it could find is still drawn — refusing the whole figure over one
    // bad name would lose the beats that were fine
    expect(document.querySelectorAll('.vzf-chart-frame').length).toBe(1);
  });

  it('says two names in the plural, and says nothing at all when it could show everything', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const { unmount } = render(<DeskFigure view={view} charts={twoCells} show={['sales', 'stock']} />);
    expect(screen.getByText('this figure names "sales", "stock", which are not cells on this desk — the rest are drawn')).toBeTruthy();
    unmount();

    render(<DeskFigure view={view} charts={twoCells} />);
    expect(screen.queryByText(/is not a cell|are not cells/)).toBeNull();
    expect(document.querySelectorAll('.vzf-chart-frame').length).toBe(2);
  });
});

describe('tokens', () => {
  it('writes every default onto the desk root, so a host that styles nothing still gets the look', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const { container } = render(<Desk view={view} charts={twoCells} />);
    const root = container.querySelector('.vzfs') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.style.getPropertyValue(deskTokenVar('stale'))).toBe(DESK_TOKENS.stale);
    expect(root.style.getPropertyValue(deskTokenVar('mono'))).toBe(DESK_TOKENS.mono);
  });

  it('takes a host override for one token and leaves the rest alone', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const { container } = render(<Desk view={view} charts={twoCells} tokens={{ stale: '#123456', danger: 'rebeccapurple' }} />);
    const root = container.querySelector('.vzfs') as HTMLElement;
    expect(root.style.getPropertyValue(deskTokenVar('stale'))).toBe('#123456');
    expect(root.style.getPropertyValue(deskTokenVar('danger'))).toBe('rebeccapurple');
    expect(root.style.getPropertyValue(deskTokenVar('ok'))).toBe(DESK_TOKENS.ok);
  });
});

describe('the front door', () => {
  it('mounts NOTHING of the desk until the reader goes in — a landing page must not have a session running behind it', async () => {
    let opened = 0;
    const factory = (): SessionView => {
      opened += 1;
      const { view } = openLibrary();
      return view;
    };
    render(
      <Desk
        view={factory}
        charts={twoCells}
        front={(enter) => (
          <button type="button" onClick={enter}>
            Open the dashboard
          </button>
        )}
      />,
    );
    expect(opened).toBe(0);
    expect(screen.queryByRole('button', { name: 'Dashboard menu' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open the dashboard' }));
    expect(opened).toBe(1);
  });
});
