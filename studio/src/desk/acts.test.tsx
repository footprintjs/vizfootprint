// @vitest-environment jsdom
/**
 * THE DESK'S OWN ACTS — the menu, the drawer, the notes, the slideshow, and the
 * notice line.
 *
 * Every one of these was a demo's private code an hour ago. What these tests
 * hold is the thing that made lifting it worth doing: a SECOND application gets
 * all of it, including the refusals, without writing any of it — and the
 * refusals are the part a host would have got wrong, because they are the part
 * you only find out about by being told.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SessionView } from 'vizfootprint-ui';
import { Desk } from './Desk.js';
import { bareCells, cause, openLibrary, stubObservers, twoCells } from './desk.fixture.js';

stubObservers();
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Open the ☰ (if it is not already) and hand back its items, by id. */
function menu(): Map<string, HTMLElement> {
  if (document.querySelector('.vzf-menu-list') === null) fireEvent.click(screen.getByRole('button', { name: 'Dashboard menu' }));
  return new Map([...document.querySelectorAll('[data-menu-item]')].map((el) => [el.getAttribute('data-menu-item')!, el as HTMLElement]));
}

/** The drawer, once something has opened it. */
const drawer = (): HTMLElement => document.querySelector('aside') as HTMLElement;

describe('the ☰ menu', () => {
  it('brings six acts of its own — and Start fresh only when the host has a door for it', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const { rerender } = render(<Desk view={view} charts={twoCells} />);
    expect([...menu().keys()]).toEqual(['edit', 'save', 'paths', 'present', 'text']);
    fireEvent.keyDown(document, { key: 'Escape' });
    rerender(<Desk view={view} charts={twoCells} onReset={() => undefined} />);
    expect([...menu().keys()]).toEqual(['edit', 'save', 'paths', 'present', 'text', 'reset']);
  });

  it('hands its own list to the host, which decides the ORDER', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} menu={(_desk, own) => [{ id: 'mine', label: 'Mine', onSelect: () => undefined }, ...own]} />);
    expect([...menu().keys()][0]).toBe('mine');
  });

  it('Save selection says WHY it is off when nothing is selected, and prompts when something is', async () => {
    const { session, view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} />);
    expect(menu().get('save')!.getAttribute('aria-disabled')).toBe('true');
    expect(menu().get('save')!.textContent).toContain('nothing is selected');
    fireEvent.keyDown(document, { key: 'Escape' });

    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      await view.refresh();
    });
    vi.spyOn(window, 'prompt').mockReturnValue('  the poetry shelf  ');
    fireEvent.click(menu().get('save')!);
    await waitFor(() => expect(view.getState().saved.map((s) => s.name)).toContain('the poetry shelf'));
  });

  it('a Save the person cancelled saves nothing — an empty name is not a name', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} />);
    vi.spyOn(window, 'prompt').mockReturnValue('   ');
    fireEvent.click(menu().get('save')!);
    expect(view.getState().saved).toHaveLength(0);
  });

  it('Present says which of two true things is true: no bookmarks at all, or none on THIS path', async () => {
    const { session, view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} />);
    expect(menu().get('present')!.textContent).toContain('name a bookmark first');
    fireEvent.keyDown(document, { key: 'Escape' });

    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      session.bookmark('the poetry shelf');
      await view.refresh();
    });
    const present = menu().get('present')!;
    expect(present.getAttribute('aria-disabled')).toBeNull();
    expect(present.textContent).toContain('Present the bookmarks');
  });

  it('the slideshow walks the beats and comes back to Explore', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      session.bookmark('one');
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'letters', cause });
      session.bookmark('two');
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} />);
    const presentItem = menu().get('present')!;
    await act(async () => {
      fireEvent.click(presentItem);
    });
    await waitFor(() => expect(document.querySelector('.vzf-slide-bar')).toBeTruthy());
    expect(document.querySelector('[data-vzf="cockpit"]')!.getAttribute('data-readonly')).toBe('true');

    await act(async () => {
      fireEvent.click(document.querySelector('[data-slide="next"]')!);
    });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-slide="prev"]')!);
    });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-slide="exit"]')!);
    });
    await waitFor(() => expect(document.querySelector('.vzf-slide-bar')).toBeNull());
    const backToExplore = menu().get('present')!;
    await act(async () => {
      fireEvent.click(backToExplore); // Back to Explore
    });
    expect(document.querySelector('[data-vzf="cockpit"]')!.getAttribute('data-readonly')).toBe('false');
  });

  it('entering the show from a cursor that reaches no beat starts at the first one', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      session.bookmark('one');
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'letters', cause });
      await view.seek(view.getState().commits[0]!.id); // off the beat
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} />);
    const presentItem = menu().get('present')!;
    await act(async () => {
      fireEvent.click(presentItem);
    });
    await waitFor(() => expect(document.querySelector('.vzf-slide-bar')).toBeTruthy());
    // the slide bar names the first beat, because that is the one the charts show
    expect(document.querySelector('.vzf-slide-bar')!.textContent).toContain('one');
  });

  it('Start fresh ASKS first — and a "no" changes nothing', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const onReset = vi.fn();
    render(<Desk view={view} charts={twoCells} onReset={onReset} />);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(menu().get('reset')!);
    expect(onReset).not.toHaveBeenCalled();
  });

  it('Start fresh runs the host’s door, and says so in the notice line when the door refuses', async () => {
    const { view } = openLibrary();
    await view.refresh();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { rerender } = render(<Desk view={view} charts={twoCells} onReset={() => Promise.resolve()} />);
    fireEvent.click(menu().get('reset')!);
    await waitFor(() => expect(document.querySelector('.vzf-menu-list')).toBeNull());

    rerender(<Desk view={view} charts={twoCells} onReset={() => Promise.reject(new Error('the server said no'))} />);
    fireEvent.click(menu().get('reset')!);
    expect(await screen.findByText(/the reset did not run: the server said no/)).toBeTruthy();
  });

  it('the Text tool opens a note that is not committed until it is saved', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} />);
    expect(document.querySelectorAll('[data-chart]').length).toBe(2);
    fireEvent.click(menu().get('text')!);
    await waitFor(() => expect(document.querySelectorAll('[data-chart]').length).toBe(3));
    expect(view.getState().commits).toHaveLength(0); // opened, not committed
  });
});

describe('the side drawer', () => {
  it('puts the host’s tabs first and the editor last, and opens on the editor', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} aside={[{ id: 'analyst', label: 'Analyst', title: 'Analyst', render: (d) => <p>on screen: {d.state.selections.length}</p> }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit shelves' }));
    await waitFor(() => expect(drawer()).toBeTruthy());
    const tabs = within(drawer()).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Analyst', '✎ Edit']);
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(tabs[0]!);
    expect(screen.getByText(/on screen:/)).toBeTruthy();
  });

  it('a host menu item can open a host tab by id', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(
      <Desk
        view={view}
        charts={twoCells}
        aside={[{ id: 'analyst', label: 'Analyst', render: () => <p>the analyst</p> }]}
        menu={(desk, own) => [{ id: 'analyst', label: 'Analyst', onSelect: () => desk.openAside('analyst') }, ...own]}
      />,
    );
    fireEvent.click(menu().get('analyst')!);
    expect(await screen.findByText('the analyst')).toBeTruthy();
  });

  it('names itself from a tab that gave no title', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} aside={[{ id: 'notes', label: 'Notes', render: () => <p>notes</p> }]} />);
    fireEvent.click(menu().get('edit')!);
    await waitFor(() => expect(drawer()).toBeTruthy());
    fireEvent.click(within(drawer()).getAllByRole('tab')[0]!);
    expect(drawer().textContent).toContain('Notes');
  });

  it('offers the editor only over cells that are ALSO declared views, and closes', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} />);
    fireEvent.click(menu().get('edit')!);
    await waitFor(() => expect(drawer()).toBeTruthy());
    const select = within(drawer()).getAllByRole('combobox')[0]!;
    expect([...select.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['shelves', 'years']);
    fireEvent.change(select, { target: { value: 'years' } });
    expect(drawer().textContent).toContain('Years');
    fireEvent.click(document.querySelector('.vzf-drawer-close')!);
  });

  it('a desk whose only cell is not a declared view still opens the editor without falling over', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={() => [{ id: 'not-a-view', render: () => <div /> }]} />);
    fireEvent.click(menu().get('edit')!);
    await waitFor(() => expect(drawer()).toBeTruthy());
    expect(within(drawer()).getAllByRole('combobox')[0]!.querySelectorAll('option')).toHaveLength(0);
  });
});

describe('the notice line', () => {
  it('shows the host’s own doors and the desk’s own refusals, in the same words', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} notice="the rows did not arrive" />);
    expect(screen.getByText(/the rows did not arrive/)).toBeTruthy();
  });

  it('prints a saved picture’s refusal verbatim — the session’s sentence, never a rewritten one', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} menu={(desk, own) => [{ id: 'apply', label: 'apply', onSelect: () => desk.applyPicture('p-nope') }, ...own]} />);
    const applyItem = menu().get('apply')!;
    await act(async () => {
      fireEvent.click(applyItem);
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('p-nope'); // the session named the id it could not find
  });

  it('says so when a door THREW rather than refused — a thrown error is not a sentence anybody wrote', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const broken = { ...view, applySaved: () => Promise.reject(new Error('the wire is down')), saveSelection: () => Promise.reject('not even an Error') };
    render(
      <Desk
        view={broken as typeof view}
        charts={twoCells}
        menu={(desk, own) => [
          { id: 'apply', label: 'apply', onSelect: () => desk.applyPicture('p1') },
          { id: 'keep', label: 'keep', onSelect: () => desk.savePicture('a picture') },
          ...own,
        ]}
      />,
    );
    const applyItem = menu().get('apply')!;
    await act(async () => {
      fireEvent.click(applyItem);
    });
    expect(await screen.findByText(/the picture was not applied: the wire is down/)).toBeTruthy();
    const keepItem = menu().get('keep')!;
    await act(async () => {
      fireEvent.click(keepItem);
    });
    expect(await screen.findByText(/the picture was not saved: not even an Error/)).toBeTruthy();
  });

  it('a picture that lands only half of itself says which half did not come', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const half = { ...view, applySaved: () => Promise.resolve({ ok: true as const, name: 'the pair', applied: 1, cleared: 0, refused: [{ viewId: 'years', rejected: '"years" is no longer on the dashboard' }] }) };
    render(<Desk view={half as typeof view} charts={twoCells} menu={(desk, own) => [{ id: 'apply', label: 'apply', onSelect: () => desk.applyPicture('p1') }, ...own]} />);
    const applyItem = menu().get('apply')!;
    await act(async () => {
      fireEvent.click(applyItem);
    });
    expect(await screen.findByText(/"the pair" came back without Years \("years" is no longer on the dashboard\)/)).toBeTruthy();
  });

  it('a picture that lands whole clears the line rather than leaving a stale one', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const whole = { ...view, applySaved: () => Promise.resolve({ ok: true as const, name: 'the pair', applied: 1, cleared: 0, refused: [] }) };
    render(<Desk view={whole as typeof view} charts={twoCells} notice={null} menu={(desk, own) => [{ id: 'apply', label: 'apply', onSelect: () => desk.applyPicture('p1') }, ...own]} />);
    const applyItem = menu().get('apply')!;
    await act(async () => {
      fireEvent.click(applyItem);
    });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('the projection’s resolvers', () => {
  it('a bookmark anchor goes to the moment NAMED, and a name nothing answers moves nothing', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      session.bookmark('the poetry shelf');
      await view.refresh();
    });
    const seen: (string | undefined)[] = [];
    render(
      <Desk
        view={view}
        charts={twoCells}
        menu={(desk, own) => [
          { id: 'hit', label: 'hit', onSelect: () => desk.seekBookmark('the poetry shelf') },
          { id: 'miss', label: 'miss', onSelect: () => desk.seekBookmark('a beat nobody named') },
          { id: 'words', label: 'words', onSelect: () => seen.push(desk.describeCommit(desk.state.commits[0]!.id), desk.describeCommit('nope')) },
          ...own,
        ]}
      />,
    );
    const hitItem = menu().get('hit')!;
    await act(async () => {
      fireEvent.click(hitItem);
    });
    const at = view.getState().cursor;
    const missItem = menu().get('miss')!;
    await act(async () => {
      fireEvent.click(missItem);
    });
    expect(view.getState().cursor).toBe(at); // nothing moved
    fireEvent.click(menu().get('words')!);
    expect(seen[0]).toContain('shelf');
    expect(seen[1]).toBeUndefined(); // a commit this log does not hold has no words
  });
});

describe('the cells', () => {
  it('takes a cell with no weight and no caption', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={bareCells} />);
    expect(document.querySelectorAll('[data-chart]').length).toBe(1);
    expect(document.querySelector('.vzf-chart-caption')).toBeNull();
  });

  it('clears a view’s own selection with a commit that names the view the def named', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear the shelves selection' }));
    });
    await waitFor(() => expect(view.getState().commits.some((c) => c.intent === 'clear Shelves')).toBe(true));
  });
});

describe('who is answerable for the session', () => {
  it('disposes a session it made, and never one it was handed', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const disposed: string[] = [];
    const madeHere: SessionView = { ...view, dispose: () => disposed.push('mine') };
    const handed: SessionView = { ...view, dispose: () => disposed.push('theirs') };

    const own = render(<Desk view={() => madeHere} charts={twoCells} />);
    own.unmount();
    expect(disposed).toEqual(['mine']);

    const theirs = render(<Desk view={handed} charts={twoCells} />);
    theirs.unmount();
    expect(disposed).toEqual(['mine']); // the host's is still the host's
  });
});
