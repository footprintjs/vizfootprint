// @vitest-environment jsdom
/**
 * THE LAST ARMS — the alternatives, the fallbacks, and the older wire.
 *
 * Nothing here is exotic. Each one is a branch a real desk takes on some
 * ordinary Tuesday: a dashboard with two paths, a caption written by a person
 * rather than the analyst, a server that predates a field, a menu opened on a
 * desk with no cells on it at all. They are here because the ones nobody
 * exercises are the ones that are wrong.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SessionView, SessionViewState } from 'vizfootprint-ui';
import { Desk } from './Desk.js';
import { DataPanel } from './panels/DataPanel.js';
import { DashboardSummary } from './prose.js';
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
async function pickMenu(id: string): Promise<void> {
  const item = openMenu().get(id)!;
  await act(async () => {
    fireEvent.click(item);
  });
}

/**
 * A view over a doctored state — how a desk meets a server that predates a
 * field. The doctored snapshot is computed ONCE: `useSyncExternalStore` compares
 * snapshots by identity, and a `getState` that answered with a fresh object
 * every call would re-render for ever.
 */
function olderWire(view: SessionView, drop: (s: SessionViewState) => SessionViewState): SessionView {
  const frozen = drop(view.getState());
  return { ...view, getState: () => frozen };
}

describe('the menu, in its other arms', () => {
  it('counts the paths once there is more than one', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'letters', cause });
      await view.newPathAt(view.getState().commits[0]!.id);
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} />);
    expect(openMenu().get('paths')!.textContent).toContain('Paths (2)');
  });

  it('Present needs no hint once there is a beat to present', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      session.bookmark('one');
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} />);
    expect(openMenu().get('present')!.querySelector('.vzf-menu-hint')).toBeNull();
  });

  it('opens the editor on nothing at all, on a desk that has no cells', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={() => []} />);
    await pickMenu('edit');
    const aside = await waitFor(() => document.querySelector('aside') as HTMLElement);
    expect(within(aside).getAllByRole('combobox')[0]!.querySelectorAll('option')).toHaveLength(0);
  });

  it('says what a reset door THREW even when it threw something that is not an Error', async () => {
    const { view } = openLibrary();
    await view.refresh();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Desk view={view} charts={twoCells} onReset={() => Promise.reject('a string, not an Error')} />);
    await pickMenu('reset');
    expect(await screen.findByText(/the reset did not run: a string, not an Error/)).toBeTruthy();
  });
});

describe('the slideshow, from off the story', () => {
  it('begins at the first beat when the cursor reaches none, and carries the dashboard’s words', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'letters', cause });
      await view.describe('dashboard', 'caption', { text: 'a desk about books', author: { kind: 'human', by: 'ana' } });
      session.bookmark('the last beat');
      await view.seek(view.getState().commits[0]!.id); // before every beat
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} />);
    await pickMenu('present');
    const bar = await waitFor(() => document.querySelector('.vzf-slide-bar') as HTMLElement);
    expect(bar.textContent).toContain('the last beat');
    expect(bar.textContent).toContain('a desk about books');
  });
});

describe('the strips, in their other arms', () => {
  it('flips a chip to exclude and back to KEEP, in those words', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
      await view.refresh();
    });
    render(<Desk view={view} charts={twoCells} />);
    const chips = (): ReturnType<typeof within> => within(document.querySelector('[data-vzf="selection-chips"]') as HTMLElement);
    await act(async () => {
      fireEvent.click(chips().getByRole('button', { name: /exclude these/ }));
    });
    await waitFor(() => expect(chips().queryByRole('button', { name: /keep these/ })).toBeTruthy());
    await act(async () => {
      fireEvent.click(chips().getByRole('button', { name: /keep these/ }));
    });
    await waitFor(() => expect(view.getState().commits.map((c) => c.intent)).toContain('keep the Shelves selection'));
  });

  it('a person’s own caption is not badged as the analyst’s', () => {
    render(
      <DashboardSummary
        dashboard={{ prose: [{ slot: 'caption', text: 'a desk about books', status: 'current', changed: [], author: { kind: 'human', by: 'ana' }, levels: [] }], proposals: [] }}
        readOnly={false}
        anchors={{}}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );
    expect(screen.getByText('a desk about books')).toBeTruthy();
    expect(screen.queryByText('by the analyst')).toBeNull();
  });
});

describe('the host’s own report strip', () => {
  it('takes the desk’s panels and puts its own first', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} reports={(_desk, own) => [{ id: 'grammar', title: 'Grammar', icon: '✍', badge: 3, content: <p>the verbs</p> }, ...own]} />);
    const chips = [...document.querySelectorAll('.vzf-report-chip')].map((c) => c.textContent);
    expect(chips[0]).toContain('Grammar');
    expect(chips.some((c) => c?.includes('Commit log'))).toBe(true);
  });
});

describe('an older wire', () => {
  it('a state with no tables badges the Data chip zero rather than falling over', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const older = olderWire(view, (s) => ({ ...s, tables: undefined as never }));
    render(
      <Desk
        view={older}
        charts={twoCells}
        data={{ table: 'books', sheet: () => ({ capabilities: { sort: true, countKnown: true, edit: false }, columns: () => Promise.resolve([]), rows: () => Promise.resolve({ ok: true, columns: [], rows: [], rowIds: [], positional: true, count: 0, start: 0, version: null, cursor: null }) }) as never }}
      />,
    );
    expect(screen.getByRole('button', { name: /Data 0/ })).toBeTruthy();
  });
});

describe('the drawer, when a tab goes away', () => {
  it('falls back to the editor rather than showing nothing', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const tab = { id: 'analyst', label: 'Analyst', render: () => <p>the analyst</p> };
    const { rerender } = render(<Desk view={view} charts={twoCells} aside={[tab]} menu={(desk, own) => [{ id: 'analyst', label: 'Analyst', onSelect: () => desk.openAside('analyst') }, ...own]} />);
    await pickMenu('analyst');
    expect(await screen.findByText('the analyst')).toBeTruthy();
    rerender(<Desk view={view} charts={twoCells} menu={(desk, own) => [{ id: 'analyst', label: 'Analyst', onSelect: () => desk.openAside('analyst') }, ...own]} />);
    expect(screen.queryByText('the analyst')).toBeNull();
    expect(within(document.querySelector('aside') as HTMLElement).getAllByRole('combobox')[0]).toBeTruthy();
  });
});

describe('the editor’s link, back to the rule', () => {
  it('names the response "back" when the edit returns the edge to the rule', async () => {
    const { view } = openLibrary();
    await view.refresh();
    render(<Desk view={view} charts={twoCells} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit shelves' }));
    const aside = await waitFor(() => document.querySelector('aside') as HTMLElement);
    const links = (): HTMLElement => {
      const all = within(aside).getAllByRole('combobox');
      return all[all.length - 1]!;
    };
    // an edge only offers "back to the rule" once it has been edited off it
    await act(async () => {
      fireEvent.change(links(), { target: { value: 'highlight' } });
    });
    await waitFor(() => expect([...links().querySelectorAll('option')].some((o) => o.getAttribute('value') === 'rule')).toBe(true));
    await act(async () => {
      fireEvent.change(links(), { target: { value: 'rule' } });
    });
    await waitFor(() => expect(view.getState().commits.map((c) => c.intent).some((i) => i?.endsWith(': back'))).toBe(true));
  });
});

describe('notes, cleared', () => {
  it('clearing a note’s words files the act in the words of a clearing', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const said: (string | undefined)[] = [];
    const spy = { ...view, describe: (id: string, slot: string, record: unknown, intent?: string) => { said.push(intent); return view.describe(id as never, slot as never, record as never, intent); } };
    render(<Desk view={spy as typeof view} charts={twoCells} />);
    await pickMenu('text');
    const cell = await waitFor(() => document.querySelector('[data-chart^="note:"]') as HTMLElement);
    fireEvent.change(within(cell).getByPlaceholderText(/Write here/), { target: { value: 'a line' } });
    await act(async () => {
      fireEvent.click(within(cell).getByRole('button', { name: /save/i }));
    });
    expect(said.some((s) => s?.startsWith('write note'))).toBe(true);

    // Remove takes the words off the dashboard — the commits stay — and the act
    // says CLEAR rather than write
    const saved = await waitFor(() => within(document.querySelector('[data-chart^="note:"]') as HTMLElement).getByRole('button', { name: /remove note/ }));
    await act(async () => {
      fireEvent.click(saved);
    });
    await waitFor(() => expect(said.some((s) => s?.startsWith('clear the'))).toBe(true));
  });
});

describe('the projection’s last catch', () => {
  it('says what a save door threw when it threw an Error', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const throwing = { ...view, saveSelection: () => Promise.reject(new Error('the wire is down')) };
    render(<Desk view={throwing as typeof view} charts={twoCells} menu={(desk, own) => [{ id: 'keep', label: 'keep', onSelect: () => desk.savePicture('a picture') }, ...own]} />);
    await pickMenu('keep');
    expect(await screen.findByText(/the picture was not saved: the wire is down/)).toBeTruthy();
  });
});

describe('the sheet, with a role and a clause', () => {
  const port = () =>
    ({
      capabilities: { sort: true, countKnown: true, edit: false },
      columns: () => Promise.resolve([{ name: 'shelf', type: 'string' }]),
      rows: () => Promise.resolve({ ok: true, columns: ['shelf'], rows: [{ shelf: 'poetry' }], rowIds: ['poetry'], positional: false, key: 'shelf', count: 1, start: 0, version: 'inline:1', cursor: null }),
    }) as never;

  it('carries a declared ROLE to the header, and marks the row the session’s clause holds', async () => {
    const { session, view } = openLibrary();
    await act(async () => {
      await session.dispatch({ verb: 'select', viewId: 'sheet', field: 'shelf', value: 'poetry', cause });
      await view.refresh();
    });
    const state = view.getState();
    const withRole: SessionViewState = { ...state, columns: { ...state.columns, books: (state.columns['books'] ?? []).map((c) => ({ ...c, role: 'dimension' })) } };
    render(<DataPanel data={{ table: 'books', sheet: port }} state={withRole} view={view} readOnly={false} />);
    fireEvent.click(screen.getByRole('tab', { name: /Sheet/ }));
    await waitFor(() => expect(document.querySelector('[data-row="0"]')).toBeTruthy());
    expect(document.querySelector('.vzf-sheet-body')?.textContent).toContain('poetry');
  });

  it('a state with no tables at all still draws the Sources view', async () => {
    const { view } = openLibrary();
    await view.refresh();
    const state = view.getState();
    render(<DataPanel data={{ table: 'books', sheet: port }} state={{ ...state, tables: undefined as never }} view={view} readOnly={false} />);
    expect(screen.getByRole('tab', { name: /Sources/ })).toBeTruthy();
  });
});
