// @vitest-environment jsdom
/**
 * THE CHROME — every affordance in the strips, driven the way a person drives
 * it.
 *
 * These are the small callbacks a host used to write for itself: clear this
 * chip, flip it to exclude, save it as a picture, switch the arrangement, open
 * the paths, accept the analyst's line. Each one lands a COMMIT with words, and
 * the words are the reason to test them: a chip whose ✕ filed "clear undefined"
 * would look fine and read wrong in the log forever.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Desk } from './Desk.js';
import { DeskFigure } from './figure.js';
import { cause, openLibrary, stubObservers, twoCells } from './desk.fixture.js';

stubObservers();
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const intents = (view: { getState: () => { commits: readonly { intent?: string }[] } }): (string | undefined)[] => view.getState().commits.map((c) => c.intent);

/** A desk with one live clause on it, ready to be cleared, flipped or kept. */
async function deskWithAClause() {
  const { session, view } = openLibrary();
  await act(async () => {
    await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause: { ...cause, intent: 'pick poetry' } });
    await view.refresh();
  });
  const ui = render(<Desk view={view} charts={twoCells} />);
  return { session, view, ui };
}

describe('the selection chips', () => {
  it('the ✕ files a commit that names the view the DEF named', async () => {
    const { view } = await deskWithAClause();
    const chip = within(screen.getByRole('group', { name: 'live selections' }));
    await act(async () => {
      fireEvent.click(chip.getByRole('button', { name: /clear/i }));
    });
    await waitFor(() => expect(intents(view)).toContain('clear Shelves'));
  });

  it('flipping a chip to exclude says which way it was flipped', async () => {
    const { view } = await deskWithAClause();
    const chip = within(screen.getByRole('group', { name: 'live selections' }));
    await act(async () => {
      fireEvent.click(chip.getByRole('button', { name: /exclude/i }));
    });
    await waitFor(() => expect(intents(view)).toContain('exclude the Shelves selection'));
  });

  it('saving ONE chip keeps that view’s clause, and a cancelled name keeps nothing', async () => {
    const { view } = await deskWithAClause();
    const chip = within(screen.getByRole('group', { name: 'live selections' }));
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    fireEvent.click(chip.getByRole('button', { name: /save/i }));
    expect(view.getState().saved).toHaveLength(0);

    vi.spyOn(window, 'prompt').mockReturnValue('the poetry shelf');
    await act(async () => {
      fireEvent.click(chip.getByRole('button', { name: /save/i }));
    });
    await waitFor(() => expect(view.getState().saved.map((s) => s.name)).toEqual(['the poetry shelf']));
  });

  it('clear all empties every live clause at once — it appears only once there are two', async () => {
    const { session, view } = await deskWithAClause();
    const chips = (): ReturnType<typeof within> => within(screen.getByRole('group', { name: 'live selections' }));
    expect(chips().queryByRole('button', { name: 'clear all selections' })).toBeNull();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'years', field: 'year', value: 1971, cause });
      await view.refresh();
    });
    await act(async () => {
      fireEvent.click(chips().getByRole('button', { name: 'clear all selections' }));
    });
    await waitFor(() => expect(view.getState().selections.every((s) => s.value === null)).toBe(true));
  });
});

describe('the arrangement', () => {
  it('a layout pick lands as a recorded commit, like every other act', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Focus' }));
    });
    await waitFor(() => expect(view.getState().commits.length).toBeGreaterThan(0));
    expect(view.getState().layout.preset).toBe('focus');
  });
});

describe('the paths door', () => {
  it('the ⎇ pill opens the modal, and the modal closes', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} />);
    fireEvent.click(screen.getByRole('button', { name: /main/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('the dashboard summary, on a live desk', () => {
  it('accepts the analyst’s line, and declines one with the reason the person gave', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      await view.propose('dashboard', 'caption', { text: 'poetry outsells atlases', author: { kind: 'agent', model: 'a-model' }, basis: { columns: ['shelf'] } });
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} />);
    expect(await screen.findByText('poetry outsells atlases')).toBeTruthy();

    vi.spyOn(window, 'prompt').mockReturnValue('it says more than it knows');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'decline' }));
    });
    await waitFor(() => expect(view.getState().dashboard?.proposals.some((p) => p.status === 'declined')).toBe(true));

    await act(async () => {
      await view.propose('dashboard', 'caption', { text: 'a second try', author: { kind: 'agent' }, basis: { columns: ['shelf'] } });
      await view.refresh();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'accept' }));
    });
    await waitFor(() => expect(view.getState().dashboard?.prose.some((p) => p.text === 'a second try')).toBe(true));
  });
});

describe('the proposals chip, on a live desk', () => {
  it('refreshes the session once the host’s door settles', async () => {
    const { view } = openLibrary();
    await view.refresh();
    let asked = 0;
    render(<Desk view={view} charts={twoCells} proposals={{ rows: [], onPropose: () => { asked += 1; } }} />);
    fireEvent.click(screen.getByRole('button', { name: /Agent proposals/ }));
    const propose = await screen.findByRole('button', { name: 'Propose charts' });
    await act(async () => {
      fireEvent.click(propose);
    });
    expect(asked).toBe(1);
  });
});

describe('the editor’s links', () => {
  it('lands a link edit as a commit whose words name both ends', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit shelves' }));
    const drawer = await waitFor(() => document.querySelector('aside') as HTMLElement);
    const selects = within(drawer).getAllByRole('combobox');
    // the first is the chart picker; the rest are the link responses this view can set
    const link = selects[selects.length - 1]!;
    await act(async () => {
      fireEvent.change(link, { target: { value: 'highlight' } });
    });
    await waitFor(() => expect(intents(view).some((i) => i?.includes('→'))).toBe(true));
  });
});

describe('the slideshow, step by step', () => {
  it('walks forward and back, and a seek that fails leaves no target the presenter never reached', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      session.bookmark('one');
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'letters', cause });
      session.bookmark('two');
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard menu' }));
    const present = document.querySelector('[data-menu-item="present"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(present);
    });
    const bar = await waitFor(() => document.querySelector('.vzf-slide-bar') as HTMLElement);
    // the show starts where the cursor already stands — the last beat named
    expect(bar.textContent).toContain('two');

    await act(async () => {
      fireEvent.click(within(bar).getByRole('button', { name: 'previous bookmark' }));
    });
    await waitFor(() => expect(document.querySelector('.vzf-slide-bar')!.textContent).toContain('one'));

    await act(async () => {
      fireEvent.click(within(document.querySelector('.vzf-slide-bar') as HTMLElement).getByRole('button', { name: 'next bookmark' }));
    });
    await waitFor(() => expect(document.querySelector('.vzf-slide-bar')!.textContent).toContain('two'));

    await act(async () => {
      fireEvent.click(within(document.querySelector('.vzf-slide-bar') as HTMLElement).getByRole('button', { name: 'leave the slideshow' }));
    });
    await waitFor(() => expect(document.querySelector('.vzf-slide-bar')).toBeNull());
  });

  it('a step past the last beat asks for nothing, and a seek that refuses leaves the presenter where they were', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      session.bookmark('one');
      await view.refresh();
    });
    const refusing = { ...view, seek: () => Promise.reject(new Error('nothing there')) };
    render(<Desk view={refusing as typeof view} charts={twoCells} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard menu' }));
    await act(async () => {
      fireEvent.click(document.querySelector('[data-menu-item="present"]') as HTMLElement);
    });
    const bar = await waitFor(() => document.querySelector('.vzf-slide-bar') as HTMLElement);
    // with one beat both steps are off the end; the bar is still standing on it
    expect(bar.textContent).toContain('one');
  });
});

describe('the figure’s two dead acts', () => {
  it('a cell that asks a pinned figure for a drawer or an editor gets nothing, and nothing breaks', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(
      <DeskFigure
        view={view}
        columns={1}
        cellHeight={120}
        charts={(desk) => {
          desk.openAside('nowhere');
          desk.editChart('nowhere');
          return [{ id: 'only', render: () => <div data-testid="only" /> }];
        }}
      />,
    );
    expect(await screen.findByTestId('only')).toBeTruthy();
    expect((document.querySelector('.vzfs-figure > div:last-child') as HTMLElement).style.gridTemplateColumns).toBe('repeat(1, 1fr)');
  });
});
