// @vitest-environment jsdom
/**
 * Saved selections: the library's store, PROJECTED. The panel lists each named
 * picture with every condition it carries, applies one by its ID (never by a
 * commit), and marks a picture that is wholly on screen as live.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { SavedSelections } from './SavedSelections.js';
import { SelectionChips } from './SelectionChips.js';
import { mapPollState, mapSaved } from '../adapter/sessionView.js';

afterEach(cleanup);

const STORE = [
  { id: 'p1', name: 'Formal wear', conditions: [{ viewId: 'bar', kind: 'point', field: 'category', value: 'Formal' }], by: 'user', at: '2026-01-01T00:00:00.000Z', on: { table: 'data', version: 'v1' } },
  { id: 'p2', name: 'The Midwest pair', conditions: [{ viewId: 'map', kind: 'match', field: 'region', value: { values: ['Ohio', 'Iowa'] } }], by: 'user', at: '2026-01-02T00:00:00.000Z' },
  { id: 'p3', name: 'Pricey formal', conditions: [{ viewId: 'heat', kind: 'cell', field: 'price × category', fields: ['price', 'category'], value: [[100, 200], 'Formal'] }, { viewId: 'bar', kind: 'point', field: 'category', value: 'Formal' }], by: 'agent', at: '2026-01-03T00:00:00.000Z', from: ['s3'], editedBy: 'user', editedAt: '2026-01-04T00:00:00.000Z' },
];

const state = mapPollState({
  records: [{ id: 's1', parent: null, viewId: 'map', kind: 'match', field: 'region', value: { values: ['Ohio', 'Iowa'] }, cause: { requestedBy: 'user' } }],
  activeSelections: [{ viewId: 'map', field: 'region', kind: 'match', value: { values: ['Ohio', 'Iowa'] }, commitId: 's1' }],
  saved: STORE,
});
const saved = state.saved;

describe('mapSaved', () => {
  it('projects the store field for field — the id, the conditions, who and when, the edit stamp and the provenance', () => {
    expect(saved.map((s) => [s.id, s.name, s.by, s.conditions.length])).toEqual([
      ['p1', 'Formal wear', 'user', 1],
      ['p2', 'The Midwest pair', 'user', 1],
      ['p3', 'Pricey formal', 'agent', 2],
    ]);
    expect(saved[2]?.conditions[0]?.fields).toEqual(['price', 'category']); // a cell keeps its pair
    expect(saved[0]?.on).toEqual({ table: 'data', version: 'v1' });
    expect(saved[2]?.from).toEqual(['s3']); // provenance rides along, and is never the identity
    expect(saved[2]?.editedAt).toBe('2026-01-04T00:00:00.000Z');
    expect(mapSaved(undefined)).toEqual([]);
  });

  it('the log is not a source of pictures: an annotation naming a selection commit is NOT a saved selection', () => {
    const annotated = mapPollState({
      records: [
        { id: 's1', parent: null, viewId: 'bar', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'user' } },
        { id: 'n1', parent: 's1', viewId: 'annotation:user', kind: 'point', field: 's1', value: 'Formal wear', cause: { requestedBy: 'user' } },
      ],
    });
    expect(annotated.saved).toEqual([]);
  });

  it('a record the store could not have minted (no id, no conditions) is dropped, never guessed at', () => {
    expect(mapSaved([{ name: 'no id', conditions: [] }, { id: 'p9' }, null, 'nonsense'])).toEqual([]);
  });
});

describe('<SavedSelections>', () => {
  it('lists each picture with its conditions; the one wholly on screen is marked, the others apply by ID with one click', () => {
    const onApply = vi.fn();
    render(<SavedSelections saved={saved} selections={state.selections} labels={{ bar: 'Category' }} onApply={onApply} />);
    expect(screen.getByText('Formal wear')).toBeDefined();
    expect(screen.getByText('The Midwest pair').closest('li')!.className).toContain('vzf-saved-live');
    expect(screen.getByText('live')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'apply the saved selection Formal wear' }));
    expect(onApply).toHaveBeenCalledWith('p1'); // the PICTURE's id — never a commit
    expect(screen.getAllByText('Category').length).toBe(2); // the def's label, on every condition that names that view
    // a two-condition picture shows both, and is not live while only one of them is
    const rows = document.querySelectorAll('[data-saved="p3"] .vzf-saved-condition');
    expect(rows.length).toBe(2);
    expect(document.querySelector('[data-saved="p3"]')!.className).not.toContain('vzf-saved-live');
  });
  it('empty and read-only states', () => {
    render(<SavedSelections saved={[]} />);
    expect(screen.getByText(/no saved selection/)).toBeDefined();
    cleanup();
    render(<SavedSelections saved={saved} onApply={() => {}} readOnly />);
    expect((screen.getAllByRole('button')[0] as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(<SavedSelections saved={saved} className="mine" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('.vzf-saved.mine')).not.toBeNull();
  });
});

describe('the save affordance on a live chip', () => {
  it('a chip whose selection names its commit offers save; the host gets the view id', () => {
    const onSave = vi.fn();
    render(<SelectionChips selections={state.selections} onSave={onSave} labels={{ map: 'Map' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'save the Map selection under a name' }));
    expect(onSave).toHaveBeenCalledWith('map');
    cleanup();
    render(<SelectionChips selections={[{ viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' }]} onSave={onSave} />);
    expect(screen.queryByRole('button', { name: /save the/ })).toBeNull(); // no commit id (an older server) = nothing to name
    cleanup();
    render(<SelectionChips selections={[{ viewId: 'bar', field: 'category', kind: 'point', value: 'Formal', commitId: 's9' }]} onSave={onSave} />);
    expect(screen.getByRole('button', { name: 'save the bar selection under a name' })).toBeDefined(); // no label: the view id speaks
  });
});
