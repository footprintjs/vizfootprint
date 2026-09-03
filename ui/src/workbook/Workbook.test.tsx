// @vitest-environment jsdom
/**
 * The Workbook's one job: two tabs, walked by the arrow keys, with only the
 * chosen panel mounted — so the Sheet asks the engine for windows when it is
 * on screen and not while it sits behind a tab.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { Workbook } from './index.js';

afterEach(cleanup);

const panels = { sources: <p>where the rows came from</p>, sheet: <p>the rows themselves</p> };
const tabs = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('[role="tab"]')];
const chosen = (c: HTMLElement): string => c.querySelector('[aria-selected="true"]')?.textContent ?? '';

describe('<Workbook>', () => {
  it('shows Sources first, mounts only the chosen panel, and points each tab at it', () => {
    const { container } = render(<Workbook {...panels} className="wide" />);
    expect(tabs(container).map((t) => t.textContent)).toEqual(['Sources', 'Sheet']);
    expect(chosen(container)).toBe('Sources');
    expect(container.textContent).toContain('where the rows came from');
    expect(container.textContent).not.toContain('the rows themselves'); // the Sheet is not asking for windows behind a tab
    expect(container.querySelector('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe('vzf-workbook-tab-sources');
    expect(container.querySelector('[role="tab"][aria-selected="true"]')!.getAttribute('aria-controls')).toBe('vzf-workbook-panel-sources');
    expect(container.querySelector('.vzf-workbook')!.classList.contains('wide')).toBe(true);
  });

  it('one tab is in the page\'s tab order; a click chooses the other', () => {
    const { container } = render(<Workbook {...panels} />);
    expect(tabs(container).map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1']);
    fireEvent.click(tabs(container)[1]!);
    expect(chosen(container)).toBe('Sheet');
    expect(container.textContent).toContain('the rows themselves');
    expect(tabs(container).map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0']);
  });

  it('the arrow keys walk the strip and select as they go, wrapping at each end', () => {
    const { container } = render(<Workbook {...panels} />);
    const strip = container.querySelector('[role="tablist"]')!;
    fireEvent.keyDown(strip, { key: 'ArrowRight' });
    expect(chosen(container)).toBe('Sheet');
    fireEvent.keyDown(strip, { key: 'ArrowRight' }); // wraps
    expect(chosen(container)).toBe('Sources');
    fireEvent.keyDown(strip, { key: 'ArrowLeft' }); // wraps the other way
    expect(chosen(container)).toBe('Sheet');
    fireEvent.keyDown(strip, { key: 'Enter' }); // a key the strip does not own is left alone
    expect(chosen(container)).toBe('Sheet');
  });

  it('a host may open on the Sheet instead', () => {
    const { container } = render(<Workbook {...panels} initialTab="sheet" />);
    expect(chosen(container)).toBe('Sheet');
    expect(container.textContent).toContain('the rows themselves');
  });
});
