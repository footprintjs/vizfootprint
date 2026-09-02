// @vitest-environment jsdom
/**
 * The matrix's encoding row: a `follow` cell shows its channel pairs, the
 * select offers follow | none, and a view with only the encoding voice keeps
 * its row.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LinkMatrix, responsesFor } from './index.js';
import type { LinkGraphView } from '../adapter/types.js';

afterEach(cleanup);

const graph: LinkGraphView = {
  default: 'crossfilter',
  views: [
    { viewId: 'weeks', voice: ['point', 'encoding'], channels: ['x', 'y', 'color'] },
    { viewId: 'trend', voice: ['point', 'encoding'], channels: ['x', 'y', 'color'] },
    { viewId: 'mute', voice: ['encoding'], channels: ['category'] },
  ],
  edges: [
    { id: 'weeks:point→trend', source: 'weeks', kind: 'point', target: 'trend', response: 'filter', origin: 'default' },
    { id: 'weeks:encoding→trend', source: 'weeks', kind: 'encoding', target: 'trend', response: 'follow', origin: 'declared', channels: [{ from: 'x', to: 'x' }, { from: 'color', to: 'y' }] },
    { id: 'mute:encoding→weeks', source: 'mute', kind: 'encoding', target: 'weeks', response: 'follow', origin: 'edited', channels: [] },
  ],
};

describe('the encoding row', () => {
  it('shows the pairs beside a follow cell, keeps a mute view with the encoding voice, and offers follow | none when editable', () => {
    const onChange = vi.fn();
    render(<LinkMatrix graph={graph} onChange={onChange} />);
    expect(screen.getByText('x, color→y')).toBeTruthy();
    expect(screen.getByText('no shared channel')).toBeTruthy();
    const select = screen.getByRole('combobox', { name: 'weeks encoding → trend' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['follow', 'none']);
    fireEvent.change(select, { target: { value: 'none' } });
    expect(onChange).toHaveBeenCalledWith({ source: 'weeks', kind: 'encoding', target: 'trend', response: 'none' });
    expect(responsesFor('point')).toEqual(['filter', 'highlight', 'navigate', 'mirror', 'none']);
    // read-only: the pairs still show, no select
    cleanup();
    render(<LinkMatrix graph={graph} />);
    expect(screen.getByText('x, color→y')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
