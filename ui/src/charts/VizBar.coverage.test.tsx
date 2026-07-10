// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { VizBar } from './VizBar.js';
import type { ColumnView } from '../adapter/types.js';

afterEach(cleanup);

const data = [
  { category: 'Casual', count: 4 },
  { category: 'Formal', count: 9 },
  { category: 'Party', count: 2 },
];

const COLS: ColumnView[] = [
  { field: 'price', type: 'number' },
  { field: 'category', type: 'string' },
];

describe('VizBar', () => {
  it('emits a point on Enter and on Space, preventing default', () => {
    const onEmit = vi.fn();
    render(<VizBar data={data} field="category" onEmit={onEmit} />);
    const rect = screen.getByRole('button', { name: /select Casual/ });
    const enterOk = fireEvent.keyDown(rect, { key: 'Enter' });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'Casual', encoding: { kind: 'point', field: 'category' } });
    expect(enterOk).toBe(false);

    onEmit.mockClear();
    const spaceOk = fireEvent.keyDown(rect, { key: ' ' });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'Casual', encoding: { kind: 'point', field: 'category' } });
    expect(spaceOk).toBe(false);
  });

  it('ignores non-activation keys on a bar', () => {
    const onEmit = vi.fn();
    render(<VizBar data={data} field="category" onEmit={onEmit} />);
    const rect = screen.getByRole('button', { name: /select Casual/ });
    const ok = fireEvent.keyDown(rect, { key: 'a' });
    expect(onEmit).not.toHaveBeenCalled();
    expect(ok).toBe(true);
  });

  it('appends the className prop to the chart svg', () => {
    const { container } = render(<VizBar data={data} className="my-extra" />);
    const svg = container.querySelector('svg.vzf-bar')!;
    expect(svg.getAttribute('class')).toBe('vzf-chart vzf-bar my-extra');
  });

  it('uses colorOf for bar fill when provided', () => {
    const colorOf = vi.fn((c: string) => (c === 'Formal' ? '#ff0000' : '#00ff00'));
    const { container } = render(<VizBar data={data} colorOf={colorOf} />);
    const rects = container.querySelectorAll('rect.vzf-barrect');
    expect(colorOf).toHaveBeenCalledWith('Casual');
    expect(colorOf).toHaveBeenCalledWith('Formal');
    const formalRect = Array.from(rects).find((r) => r.getAttribute('aria-label')?.includes('Formal'))!;
    expect(formalRect.getAttribute('fill')).toBe('#ff0000');
  });

  it('picking a column in the encoding picker fires onReencode and closes the picker', () => {
    const onReencode = vi.fn();
    render(<VizBar viewId="mybar" data={data} field="category" columns={COLS} onReencode={onReencode} />);
    fireEvent.click(screen.getByRole('button', { name: /Encode the category axis/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /price/ }));
    expect(onReencode).toHaveBeenCalledWith('mybar', 'category', 'price');
    // the picker's own onClose (setPickerChannel(null)) fired too
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
