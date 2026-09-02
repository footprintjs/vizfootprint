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

  it('slants and clips ticks that are wider than their band, hiding values that would collide', () => {
    const long = Array.from({ length: 12 }, (_, i) => ({ category: `Carbapenemase-producing Enterobacterales ${String(i)}`, count: 6020 + i }));
    const { container } = render(<VizBar data={long} field="disease" width={240} height={300} />);
    const ticks = [...container.querySelectorAll('text.vzf-tick')];
    expect(ticks).toHaveLength(12);
    for (const tick of ticks) {
      expect(tick.getAttribute('transform')).toMatch(/^rotate\(-40 /);
      expect(tick.getAttribute('text-anchor')).toBe('end');
      expect(tick.textContent?.endsWith('…')).toBe(true);
      expect(tick.querySelector('title')?.textContent).toMatch(/^Carbapenemase-producing Enterobacterales/);
    }
    // a 4-digit value needs 24px; twelve bands in 240px minus padding leave ~15px each
    expect(container.querySelectorAll('text.vzf-barval')).toHaveLength(0);
    // the axis moved up to make room: it sits SLANT_PAD higher than the flat layout's
    expect(container.querySelector('line.vzf-axis')?.getAttribute('y1')).toBe(String(300 - 48 - 40));
  });

  it('keeps ticks flat and whole when they fit, and shows the values', () => {
    const { container } = render(<VizBar data={data} field="category" width={360} height={340} />);
    for (const tick of container.querySelectorAll('text.vzf-tick')) {
      expect(tick.getAttribute('transform')).toBeNull();
      expect(tick.querySelector('title')).toBeNull();
    }
    expect(container.querySelectorAll('text.vzf-barval')).toHaveLength(3);
    expect(container.querySelector('line.vzf-axis')?.getAttribute('y1')).toBe(String(340 - 48));
  });

  it('a short chart gives the slant only the room it has — no bar ever gets a negative height', () => {
    const long = Array.from({ length: 10 }, (_, i) => ({ category: `Carbapenemase-producing Enterobacterales ${String(i)}`, count: 10 + i }));
    const { container } = render(<VizBar data={long} field="disease" width={200} height={100} />);
    for (const rect of container.querySelectorAll('rect.vzf-barrect')) expect(Number(rect.getAttribute('height'))).toBeGreaterThanOrEqual(0);
    // the axis sits so that the plot keeps MIN_PLOT (40px): 100 - 20 (top) - 40 = axis at 60 → padB 40 < PAD.b, so PAD.b wins
    expect(container.querySelector('line.vzf-axis')?.getAttribute('y1')).toBe(String(100 - 48));
    expect(container.querySelectorAll('text.vzf-tick[transform]').length).toBe(10);
  });

  it('a slanted label the room can hold stays whole — slanted, but no ellipsis and no title', () => {
    // 'Salmonellosis' is 13 chars = 78px: wider than a ~26px band, narrower than the 56px slant room (~87px)
    const mid = Array.from({ length: 12 }, (_, i) => ({ category: `Salmonellosi${String.fromCharCode(65 + i)}`, count: 5 }));
    const { container } = render(<VizBar data={mid} field="disease" width={360} height={340} />);
    const ticks = [...container.querySelectorAll('text.vzf-tick')];
    expect(ticks).toHaveLength(12);
    for (const tick of ticks) {
      expect(tick.getAttribute('transform')).toMatch(/^rotate\(-40 /);
      expect(tick.textContent?.endsWith('…')).toBe(false);
      expect(tick.querySelector('title')).toBeNull();
    }
  });
});
