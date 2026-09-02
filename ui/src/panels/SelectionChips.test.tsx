// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SelectionChips, chipWords } from './SelectionChips.js';
import type { SelectionView } from '../adapter/types.js';

afterEach(cleanup);

const point: SelectionView = { viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' };
const match: SelectionView = { viewId: 'map', field: 'region', kind: 'match', value: { values: ['North', 'South'], exclude: true } };
const interval: SelectionView = { viewId: 'scatter', field: 'price', kind: 'interval', value: [100, 150] };
const cell: SelectionView = { viewId: 'heat', field: 'price × category', kind: 'cell', value: [[100, 150], 'Formal'], fields: ['price', 'category'] };
const cleared: SelectionView = { viewId: 'line', field: 'date', kind: 'interval', value: null };

describe('SelectionChips — every live selection in words, removable, flippable', () => {
  it('speaks each kind the way the commit log does, and hides a cleared clause', () => {
    expect(chipWords(point)).toBe('category = Formal');
    expect(chipWords(match)).toBe('region not in {North, South}');
    expect(chipWords(interval)).toBe('price 100 – 150');
    expect(chipWords(cell)).toBe('price 100 – 150 and category = Formal');
    render(<SelectionChips selections={[point, match, interval, cell, cleared]} labels={{ bar: 'Categories' }} />);
    expect(screen.getAllByText(/Categories|map|scatter|heat/)).toHaveLength(4);
    expect(screen.queryByText(/line/)).toBeNull();
    expect(screen.getByText('region not in {North, South}').closest('.vzf-selchip')?.className).toContain('vzf-selchip-exclude');
  });
  it('✕ clears one view; flip sends the OPPOSITE polarity; clear all appears only with more than one; read-only disables all', () => {
    const onClear = vi.fn();
    const onSetPolarity = vi.fn();
    const onClearAll = vi.fn();
    render(<SelectionChips selections={[point, match, interval]} onClear={onClear} onSetPolarity={onSetPolarity} onClearAll={onClearAll} />);
    fireEvent.click(screen.getByRole('button', { name: 'clear the bar selection' }));
    expect(onClear).toHaveBeenCalledWith('bar');
    fireEvent.click(screen.getByRole('button', { name: 'exclude these category values instead' }));
    expect(onSetPolarity).toHaveBeenCalledWith('bar', true);
    fireEvent.click(screen.getByRole('button', { name: 'keep these region values instead' }));
    expect(onSetPolarity).toHaveBeenCalledWith('map', false);
    expect(screen.queryByRole('button', { name: /these price values/ })).toBeNull(); // an interval has no polarity
    fireEvent.click(screen.getByRole('button', { name: 'clear all selections' }));
    expect(onClearAll).toHaveBeenCalled();
    cleanup();
    render(<SelectionChips selections={[point]} onClear={onClear} onClearAll={onClearAll} onSetPolarity={onSetPolarity} readOnly />);
    expect(screen.queryByRole('button', { name: 'clear all selections' })).toBeNull();
    expect((screen.getByRole('button', { name: 'clear the bar selection' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('with nothing live it says how to start', () => {
    const { container } = render(<SelectionChips selections={[cleared]} className="extra" />);
    expect(screen.getByText(/no selection/)).toBeTruthy();
    expect(container.querySelector('.vzf-selchips')?.className).toContain('extra');
  });
});
