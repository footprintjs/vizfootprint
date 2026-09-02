// @vitest-environment jsdom
/**
 * Saved selections: a note on a selection commit names it; the panel lists
 * every named one in words, applies with one click, and marks the live one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { SavedSelections } from './SavedSelections.js';
import { SelectionChips } from './SelectionChips.js';
import { mapPollState, savedSelectionsOf } from '../adapter/sessionView.js';

afterEach(cleanup);

const state = mapPollState({
  records: [
    { id: 's1', parent: null, viewId: 'bar', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'user' } },
    { id: 'n1', parent: 's1', viewId: 'annotation:user', kind: 'point', field: 's1', value: 'Formal wear', cause: { requestedBy: 'user' } },
    { id: 's2', parent: 'n1', viewId: 'map', kind: 'match', field: 'region', value: { values: ['Ohio', 'Iowa'] }, cause: { requestedBy: 'user' } },
    { id: 'n2', parent: 's2', viewId: 'annotation:user', kind: 'point', field: 's2', value: 'Two states', cause: { requestedBy: 'user' } },
    { id: 'n3', parent: 'n2', viewId: 'annotation:user', kind: 'point', field: 's2', value: 'The Midwest pair', cause: { requestedBy: 'agent' } },
    { id: 'c1', parent: 'n3', viewId: 'bar', kind: 'point', field: 'category', value: undefined, cause: { requestedBy: 'user' } },
    { id: 'n4', parent: 'c1', viewId: 'annotation:user', kind: 'point', field: 'c1', value: 'a cleared one is not a selection', cause: { requestedBy: 'user' } },
    { id: 'n5', parent: 'n4', viewId: 'annotation:user', kind: 'point', field: 'ghost', value: 'names nothing', cause: { requestedBy: 'user' } },
    { id: 'n6', parent: 'n5', viewId: 'annotation:user', kind: 'point', field: '__annotation__', value: 'a loose note', cause: { requestedBy: 'user' } },
    { id: 'b1', parent: 'n6', viewId: 'beat:1', kind: 'point', field: '__beat__', value: 'start', cause: { requestedBy: 'user' } },
    { id: 'n7', parent: 'b1', viewId: 'annotation:user', kind: 'point', field: 'b1', value: 'a beat is not a selection', cause: { requestedBy: 'user' } },
    { id: 's3', parent: 'n7', viewId: 'heat', kind: 'cell', field: 'price × category', fields: ['price', 'category'], value: [[100, 200], 'Formal'], cause: { requestedBy: 'user' } },
    { id: 'n8', parent: 's3', viewId: 'annotation:user', kind: 'point', field: 's3', value: 'Pricey formal', cause: { requestedBy: 'user' } },
  ],
  activeSelections: [{ viewId: 'map', field: 'region', kind: 'match', value: { values: ['Ohio', 'Iowa'] }, commitId: 's2' }],
});

describe('savedSelectionsOf', () => {
  it('newest note first, one per selection commit (the latest note names it); cleared, ghost, loose and beat notes are not saved selections', () => {
    expect(state.saved.map((s) => [s.name, s.commitId, s.noteId, s.viewId, s.kind])).toEqual([
      ['Pricey formal', 's3', 'n8', 'heat', 'cell'],
      ['The Midwest pair', 's2', 'n3', 'map', 'match'],
      ['Formal wear', 's1', 'n1', 'bar', 'point'],
    ]);
    expect(state.saved[0]?.fields).toEqual(['price', 'category']); // a cell keeps its pair
    expect(savedSelectionsOf([])).toEqual([]);
    expect(state.selections[0]?.commitId).toBe('s2');
  });
});

describe('<SavedSelections>', () => {
  it('lists each saved selection in words; the live one is marked, the other applies with one click', () => {
    const onApply = vi.fn();
    render(<SavedSelections saved={state.saved} selections={state.selections} labels={{ bar: 'Category' }} onApply={onApply} />);
    expect(screen.getByText('Formal wear')).toBeDefined();
    expect(screen.getByText('The Midwest pair').closest('li')!.className).toContain('vzf-saved-live');
    expect(screen.getByText('live')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'apply the saved selection Formal wear' }));
    expect(onApply).toHaveBeenCalledWith('s1');
    expect(screen.getByText('Category')).toBeDefined();
  });
  it('empty and read-only states', () => {
    render(<SavedSelections saved={[]} />);
    expect(screen.getByText(/no saved selection/)).toBeDefined();
    cleanup();
    render(<SavedSelections saved={state.saved} onApply={() => {}} readOnly />);
    expect((screen.getAllByRole('button')[0] as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(<SavedSelections saved={state.saved} className="mine" />);
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
