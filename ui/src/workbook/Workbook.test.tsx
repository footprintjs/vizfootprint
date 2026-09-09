// @vitest-environment jsdom
/**
 * The Workbook's one job: the tabs, walked by the arrow keys, with only the
 * chosen panel mounted — so a Sheet asks the engine for windows when it is on
 * screen and not while it sits behind a tab. Beside the two fixed tabs, one per
 * table an act cut: named for the table, and gone when the cursor cannot see it.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { Workbook, derivedSheetTab } from './index.js';

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

  it('a table an ACT cut gets its own tab, under its own name, after the Sheet', () => {
    const cut = [
      { table: 'by_region', panel: <p>one row per region</p> },
      { table: 'by_year', panel: <p>one row per year</p> },
    ];
    const { container } = render(<Workbook {...panels} sheets={cut} />);
    expect(tabs(container).map((t) => t.textContent)).toEqual(['Sources', 'Sheet', 'by_region', 'by_year']);
    fireEvent.click(tabs(container)[2]!);
    expect(chosen(container)).toBe('by_region');
    expect(container.textContent).toContain('one row per region');
    expect(container.textContent).not.toContain('one row per year'); // only the chosen sheet asks for windows
    // the panel is pointed at positionally: a table name is never asked to be an html id
    expect(container.querySelector('[role="tabpanel"]')!.getAttribute('id')).toBe('vzf-workbook-panel-sheet-1');
    expect(container.querySelector('[role="tab"][aria-selected="true"]')!.getAttribute('aria-controls')).toBe('vzf-workbook-panel-sheet-1');
  });

  it('a host may open on a cut table by name, and the arrows walk the whole strip', () => {
    const cut = [{ table: 'by_region', panel: <p>one row per region</p> }];
    const { container } = render(<Workbook {...panels} sheets={cut} initialTab={derivedSheetTab('by_region')} />);
    expect(chosen(container)).toBe('by_region');
    const strip = container.querySelector('[role="tablist"]')!;
    fireEvent.keyDown(strip, { key: 'ArrowRight' }); // wraps past the last cut table
    expect(chosen(container)).toBe('Sources');
    fireEvent.keyDown(strip, { key: 'ArrowLeft' });
    expect(chosen(container)).toBe('by_region');
  });

  it('a cut table that is no longer HERE falls back to the tab that would explain the absence', () => {
    // seek before the act and the table stops being one of the tables: the host
    // hands over a shorter list, and the strip must not be left with nothing chosen
    const cut = [{ table: 'by_region', panel: <p>one row per region</p> }];
    const { container, rerender } = render(<Workbook {...panels} sheets={cut} initialTab={derivedSheetTab('by_region')} />);
    expect(chosen(container)).toBe('by_region');
    rerender(<Workbook {...panels} sheets={[]} />);
    expect(tabs(container).map((t) => t.textContent)).toEqual(['Sources', 'Sheet']);
    expect(chosen(container)).toBe('Sources');
    expect(container.textContent).toContain('where the rows came from');
    expect(tabs(container).map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1']);
  });
});
