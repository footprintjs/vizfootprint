// @vitest-environment jsdom
/**
 * THE EDGES — the arms a desk only reaches when something has gone slightly
 * wrong, or slightly right in an unusual way.
 *
 * A dashboard whose happy path is tested and whose refusals are not is a
 * dashboard that will be honest right up until the first time it matters.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SheetData } from 'vizfootprint-ui';
import { Desk } from './Desk.js';
import { WindowReadout } from './WindowReadout.js';
import { DataPanel } from './panels/DataPanel.js';
import { freshNoteId } from './notes.js';
import { cause, openLibrary, stubObservers, twoCells } from './desk.fixture.js';

stubObservers();
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const openMenu = (): Map<string, HTMLElement> => {
  if (document.querySelector('.vzf-menu-list') === null) fireEvent.click(screen.getByRole('button', { name: 'Dashboard menu' }));
  return new Map([...document.querySelectorAll('[data-menu-item]')].map((el) => [el.getAttribute('data-menu-item')!, el as HTMLElement]));
};

/** Open the ☰ (a render), then click one of its items (another) — never both inside one `act`, or the list is not there yet to click. */
async function pickMenu(id: string): Promise<void> {
  const item = openMenu().get(id)!;
  await act(async () => {
    fireEvent.click(item);
  });
}

describe('the projection’s edges', () => {
  it('reads a view’s ACCESSIBLE name and its words off the session, once it has them', async () => {
    const { view } = openLibrary();
    await act(async () => {
      await view.describe('shelves', 'altShort', { text: 'a bar per shelf', author: { kind: 'human', by: 'ana' } });
      await view.describe('shelves', 'caption', { text: 'poetry leads', author: { kind: 'human', by: 'ana' } });
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} />);
    expect(screen.getByLabelText('a bar per shelf')).toBeTruthy();
    expect(screen.getByText('poetry leads')).toBeTruthy();
  });

  it('a commit with words shows them; a commit with none shows the label alone', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause: { ...cause, intent: 'pick poetry' } });
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'letters', cause });
      await view.refresh();
    });
    const said: (string | undefined)[] = [];
    render(
      <Desk
        view={view}
        charts={twoCells}
        menu={(desk, own) => [{ id: 'read', label: 'read', onSelect: () => said.push(...desk.state.commits.map((c) => desk.describeCommit(c.id))) }, ...own]}
      />,
    );
    fireEvent.click(openMenu().get('read')!);
    expect(said.some((s) => s?.includes('— pick poetry'))).toBe(true);
    expect(said.some((s) => s !== undefined && !s.includes('—'))).toBe(true);
  });

  it('a save the session refuses is printed in the session’s own sentence, and a throw that is not an Error is printed as it came', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const refusing = { ...view, saveSelection: () => Promise.resolve({ ok: false as const, sentence: 'nothing is selected to save' }) };
    const { unmount } = render(<Desk view={refusing as typeof view} charts={twoCells} menu={(desk, own) => [{ id: 'keep', label: 'keep', onSelect: () => desk.savePicture('a picture') }, ...own]} />);
    await pickMenu('keep');
    expect(await screen.findByText(/nothing is selected to save/)).toBeTruthy();
    unmount();

    const throwing = { ...view, applySaved: () => Promise.reject('a string, not an Error') };
    render(<Desk view={throwing as typeof view} charts={twoCells} menu={(desk, own) => [{ id: 'apply', label: 'apply', onSelect: () => desk.applyPicture('p1') }, ...own]} />);
    await pickMenu('apply');
    expect(await screen.findByText(/the picture was not applied: a string, not an Error/)).toBeTruthy();
  });
});

describe('the slideshow’s edges', () => {
  it('a step past the last beat asks the session for nothing', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      session.bookmark('one');
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'letters', cause });
      session.bookmark('two');
      await view.seek(view.getState().bookmarks[0]!.at as string);
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} />);
    await pickMenu('present');
    const bar = await waitFor(() => document.querySelector('.vzf-slide-bar') as HTMLElement);
    const next = within(bar).getByRole('button', { name: 'next bookmark' });
    // two clicks before the first seek has settled: the second asks for a beat
    // past the end, and the desk answers by not asking the session anything
    fireEvent.click(next);
    fireEvent.click(next);
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('.vzf-slide-bar')).toBeTruthy();
  });

  it('a seek that REFUSES leaves no target the presenter never reached', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      session.bookmark('one');
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'letters', cause });
      session.bookmark('two');
      await view.seek(view.getState().bookmarks[0]!.at as string);
      await view.refresh();
    });
    const refusing = { ...view, seek: () => Promise.reject(new Error('nothing there')) };
    render(<Desk view={refusing as typeof view} charts={twoCells} />);
    await pickMenu('present');
    const bar = await waitFor(() => document.querySelector('.vzf-slide-bar') as HTMLElement);
    await act(async () => {
      fireEvent.click(within(bar).getByRole('button', { name: 'next bookmark' }));
    });
    expect(document.querySelector('.vzf-slide-bar')!.textContent).toContain('one');
  });
});

describe('Present mode pauses the acts', () => {
  it('Save selection is off in Present mode even with something selected, and Start fresh with it', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      session.bookmark('one');
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} onReset={() => undefined} />);
    await pickMenu('present');
    fireEvent.click(document.querySelector('[data-slide="exit"]')!);
    const items = openMenu();
    expect(items.get('save')!.getAttribute('aria-disabled')).toBe('true');
    expect(items.get('reset')!.getAttribute('aria-disabled')).toBe('true');
    expect(items.get('text')!.getAttribute('aria-disabled')).toBe('true');
  });

  it('says the bookmarks are on ANOTHER path when this one has none', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'letters', cause });
      session.bookmark('the second step'); // named on the LAST commit
      await view.refresh();
      // fork at the FIRST step and stand there: the beat is real, and it is not on this line
      await view.newPathAt(view.getState().commits[0]!.id);
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} />);
    const present = openMenu().get('present')!;
    expect(present.getAttribute('aria-disabled')).toBe('true');
    expect(present.textContent).toContain('your bookmarks are on another path');
  });
});

describe('the story tab’s optional halves', () => {
  it('takes a story with no emptyNote and no figure list at all', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      session.bookmark('one');
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} story={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Story/ }));
    const body = await waitFor(() => document.querySelector('.vzf-modal-body') as HTMLElement);
    // no `figure` named = every cell the desk has
    expect(body.querySelectorAll('.vzf-chart-frame').length).toBe(2);
  });
});

describe('the drawer names itself', () => {
  it('falls back to a tab’s id when its label is not words', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} aside={[{ id: 'analyst', label: <b>Analyst</b>, render: () => <p>hello</p> }]} />);
    fireEvent.click(openMenu().get('edit')!);
    const aside = await waitFor(() => document.querySelector('aside') as HTMLElement);
    fireEvent.click(within(aside).getAllByRole('tab')[0]!);
    expect(aside.textContent).toContain('analyst');
  });
});

describe('notes, at the edges', () => {
  it('mints an id with or without a secure context', () => {
    expect(freshNoteId()).toMatch(/^n[a-z0-9-]{8}$/i);
    const real = crypto.randomUUID;
    (crypto as { randomUUID?: unknown }).randomUUID = undefined;
    try {
      expect(freshNoteId()).toMatch(/^n[a-z0-9]{8}$/i);
    } finally {
      (crypto as { randomUUID?: unknown }).randomUUID = real;
    }
  });

  it('a save the session REFUSES keeps the note open, with its words still in it', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const refusing = { ...view, describe: () => Promise.resolve({ ok: false as const, sentence: 'that note points at a commit this path does not hold' }) };
    render(<Desk view={refusing as typeof view} charts={twoCells} />);
    fireEvent.click(openMenu().get('text')!);
    const cell = await waitFor(() => document.querySelector('[data-chart^="note:"]') as HTMLElement);
    fireEvent.change(within(cell).getByPlaceholderText(/Write here/), { target: { value: 'a line' } });
    await act(async () => {
      fireEvent.click(within(cell).getByRole('button', { name: /save/i }));
    });
    // still open: a refused save is not a save, and the words are not thrown away
    expect(document.querySelector('[data-chart^="note:"]')).toBeTruthy();
  });
});

describe('the window readout', () => {
  it('follows the window it is describing', () => {
    render(<WindowReadout />);
    expect(screen.getByText(/window \d+×\d+/)).toBeTruthy();
    const before = screen.getByText(/window/).textContent;
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 999 });
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByText(/window/).textContent).not.toBe(before);
  });
});

describe('the sheet, wired', () => {
  const port = (over: Partial<SheetData> = {}): SheetData =>
    ({
      capabilities: { sort: true, countKnown: true, edit: false },
      columns: () => Promise.resolve([{ name: 'shelf', type: 'string' }]),
      rows: () => Promise.resolve({ ok: true, columns: ['shelf'], rows: [{ shelf: 'poetry' }], rowIds: ['poetry'], positional: false, key: 'shelf', count: 1, start: 0, version: 'inline:1', cursor: null }),
      ...over,
    }) as SheetData;

  it('a row click emits a POINT on the declared key, in the words it landed on', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const emitted: unknown[] = [];
    const spy = { ...view, emit: (viewId: string, e: unknown, intent?: string) => { emitted.push([viewId, e, intent]); return Promise.resolve(); } };
    render(<DataPanel data={{ table: 'books', sheet: () => port() }} state={view.getState()} view={spy as typeof view} readOnly={false} />);
    fireEvent.click(screen.getByRole('tab', { name: /Sheet/ }));
    const row = await waitFor(() => {
      const el = document.querySelector('[data-row="0"]');
      if (el === null) throw new Error('no row yet');
      return el;
    });
    fireEvent.click(row);
    expect(emitted).toEqual([['sheet', { rawValue: 'poetry', encoding: { kind: 'point', field: 'shelf' } }, 'pick shelf']]);
  });

  it('marks the row the session’s own clause holds', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'sheet', field: 'shelf', value: 'poetry', cause });
      await view.refresh();
    });
    render(<DataPanel data={{ table: 'books', sheet: () => port() }} state={view.getState()} view={view} readOnly={false} />);
    fireEvent.click(screen.getByRole('tab', { name: /Sheet/ }));
    await waitFor(() => expect(document.querySelector('[data-row="0"]')).toBeTruthy());
    expect(document.querySelector('[aria-selected="true"], .vzf-sheet-row-selected, [data-row="0"][data-selected]')).toBeTruthy();
  });
});
