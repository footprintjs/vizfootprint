// @vitest-environment jsdom
/**
 * THE TEXT TOOL — a note as a cell, and the one rule that makes it safe.
 *
 * **A new note is OPENED, not committed.** Nothing lands until its first Save,
 * so the log never holds words nobody wrote — and once it HAS been saved it is
 * the session's note rather than a local id, which is what stops a seek back
 * before its first commit from re-opening a blank editor beside words that are
 * simply not there yet.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Desk } from './Desk.js';
import { cause, openLibrary, stubObservers, twoCells } from './desk.fixture.js';

stubObservers();
afterEach(cleanup);

const menu = (): Map<string, HTMLElement> => {
  if (document.querySelector('.vzf-menu-list') === null) fireEvent.click(screen.getByRole('button', { name: 'Dashboard menu' }));
  return new Map([...document.querySelectorAll('[data-menu-item]')].map((el) => [el.getAttribute('data-menu-item')!, el as HTMLElement]));
};

const noteCells = (): Element[] => [...document.querySelectorAll('[data-chart^="note:"]')];

describe('notes', () => {
  it('opens blank and commits nothing until it is saved', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} />);
    fireEvent.click(menu().get('text')!);
    await waitFor(() => expect(noteCells()).toHaveLength(1));
    expect(view.getState().commits).toHaveLength(0);
  });

  it('a note the person cancelled leaves the desk, and leaves no trace on the log', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} />);
    fireEvent.click(menu().get('text')!);
    await waitFor(() => expect(noteCells()).toHaveLength(1));
    const cancel = within(noteCells()[0] as HTMLElement).getByRole('button', { name: /cancel/i });
    fireEvent.click(cancel);
    await waitFor(() => expect(noteCells()).toHaveLength(0));
    expect(view.getState().commits).toHaveLength(0);
  });

  it('a saved note becomes the SESSION’s note — the fresh cell is dropped, not doubled', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} />);
    fireEvent.click(menu().get('text')!);
    await waitFor(() => expect(noteCells()).toHaveLength(1));

    const cell = noteCells()[0] as HTMLElement;
    const field = within(cell).getByPlaceholderText(/Write here/);
    fireEvent.change(field, { target: { value: 'the poetry shelf is the one to watch' } });
    await act(async () => {
      fireEvent.click(within(cell).getByRole('button', { name: /save/i }));
    });

    await waitFor(() => expect(view.getState().notes ?? []).toHaveLength(1));
    // ONE cell: the session's, not the session's plus the local one it was written in
    await waitFor(() => expect(noteCells()).toHaveLength(1));
    // the words landed as a real commit, on the same log as every other act
    expect(view.getState().commits.length).toBeGreaterThan(0);
    expect(screen.getByText(/the poetry shelf is the one to watch/)).toBeTruthy();
  });

  it('a second Text tool opens a second note, and both are drawn AFTER the charts', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} />);
    fireEvent.click(menu().get('text')!);
    await waitFor(() => expect(noteCells()).toHaveLength(1));
    fireEvent.click(menu().get('text')!);
    await waitFor(() => expect(noteCells()).toHaveLength(2));
    const ids = [...document.querySelectorAll('[data-chart]')].map((e) => e.getAttribute('data-chart')!);
    expect(ids.slice(0, 2)).toEqual(['shelves', 'years']);
  });

  it('Start fresh drops the notes nobody saved — they were opened against a log that no longer exists', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const confirmed = { value: true };
    const realConfirm = window.confirm;
    window.confirm = () => confirmed.value;
    try {
      render(<Desk view={view} charts={twoCells} onReset={() => undefined} />);
      fireEvent.click(menu().get('text')!);
      await waitFor(() => expect(noteCells()).toHaveLength(1));
      const reset = menu().get('reset')!;
      await act(async () => {
        fireEvent.click(reset);
      });
      await waitFor(() => expect(noteCells()).toHaveLength(0));
    } finally {
      window.confirm = realConfirm;
    }
  });
});
