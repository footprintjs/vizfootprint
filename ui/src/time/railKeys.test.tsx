// @vitest-environment jsdom
/**
 * A RAIL IS ONE STOP IN THE TAB ORDER.
 *
 * Every bar on the rail was a tab stop. A history of two hundred steps put two
 * hundred stops between the mode switch and the bookmark button, and a screen
 * reader heard "#s14 select" with no word on where in the history that was.
 *
 * | the case                                    | what happens                                           |
 * |---------------------------------------------|--------------------------------------------------------|
 * | Tab into the rail                           | lands on the cursor's bar: the only bar in tab order   |
 * | the cursor is not on the rail               | the head's bar; with no head on it, the last bar       |
 * | an empty rail                               | no stop                                                |
 * | ArrowRight / ArrowLeft                      | focus moves one bar; nothing is sought                 |
 * | at either end                               | focus stays: the rail does not wrap                    |
 * | Home / End                                  | first bar / last bar                                   |
 * | Enter or Space on a bar (a button press)    | seeks to that bar                                      |
 * | any other key                               | not the rail's: not prevented                          |
 * | what a bar says                             | "step 3 of 40: #c2 select c2", plus bookmarked, now    |
 * | the cursor's bar                            | aria-current="step"                                    |
 * | present mode                                | the same, over the bookmarks                           |
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { RawBar } from './rawBar.test.helper.js';
import { timeTravelModel } from './model.js';
import { railKeyTarget } from './railKeys.js';
import type { BookmarkView, CommitView } from '../adapter/types.js';

afterEach(cleanup);

const commit = (id: string, parent: string | null): CommitView => ({ id, parent, viewId: 'bar', kind: 'point', field: 'category', value: id, actor: 'user', label: `select ${id}`, onBranch: true, isCursor: false, isHead: false });
const LINE: CommitView[] = Array.from({ length: 40 }, (_, i) => commit(`c${i}`, i === 0 ? null : `c${i - 1}`));
const at = { by: 'user' as const, madeAt: '2026-01-01T00:00:00.000Z' };
const BOOKMARKS: BookmarkView[] = [
  { label: 'start', commitId: 'c2', at: 'c2', ...at },
  { label: 'middle', commitId: 'c20', at: 'c20', ...at },
  { label: 'end', commitId: 'c39', at: 'c39', ...at },
] as unknown as BookmarkView[];

const dots = (root: HTMLElement): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('.vzf-tl-dot'));
const inTabOrder = (root: HTMLElement): string[] => dots(root).filter((d) => d.tabIndex === 0).map((d) => d.getAttribute('data-commit') ?? d.getAttribute('data-bookmark-dot') ?? '');

describe('railKeyTarget — an index in, an index out', () => {
  it.each([
    [5, 2, 'ArrowRight', 3],
    [5, 2, 'ArrowLeft', 1],
    [5, 4, 'ArrowRight', 4],
    [5, 0, 'ArrowLeft', 0],
    [5, 2, 'Home', 0],
    [5, 2, 'End', 4],
    [1, 0, 'ArrowRight', 0],
    [5, 2, 'Enter', null],
    [5, 2, 'a', null],
    [5, 2, 'ArrowUp', null],
    [0, 0, 'ArrowRight', null],
    [5, -1, 'ArrowRight', null],
    [5, 5, 'ArrowLeft', null],
    [5, 1.5, 'End', null],
    [Number.NaN, 0, 'End', null],
  ] as const)('%i bars, at %d, %s → %s', (count, from, key, to) => {
    expect(railKeyTarget(count, from, key)).toBe(to);
  });
});

describe('the model names the one bar the keyboard enters on', () => {
  const line = LINE.slice(0, 4);
  it('the cursor’s bar', () => {
    expect(timeTravelModel({ commits: line, cursor: 'c1', head: 'c3' }).explore.stop).toBe('c1');
  });
  it('no cursor: the head’s bar', () => {
    expect(timeTravelModel({ commits: line, cursor: null, head: 'c3' }).explore.stop).toBe('c3');
  });
  it('a cursor that is not in the log: the head’s bar', () => {
    expect(timeTravelModel({ commits: line, cursor: 'gone', head: 'c2' }).explore.stop).toBe('c2');
  });
  it('nothing to draw: no stop', () => {
    expect(timeTravelModel({ commits: [], cursor: null, head: null }).explore.stop).toBeNull();
    expect(timeTravelModel({ commits: line, cursor: null, head: null }).explore.stop).toBeNull();
  });
  it('every bar knows where it stands, counted from 1', () => {
    expect(timeTravelModel({ commits: line, cursor: 'c1', head: 'c3' }).explore.bars.map((b) => b.position)).toEqual([1, 2, 3, 4]);
  });
});

describe('the rail in explore mode', () => {
  it('forty bars are one stop in the tab order: the cursor’s', () => {
    const { container } = render(<RawBar commits={LINE} cursor="c7" head="c39" bookmarks={BOOKMARKS} />);
    expect(dots(container)).toHaveLength(40);
    expect(inTabOrder(container)).toEqual(['c7']);
  });

  it('the rail is a named group, the cursor’s bar is the current step, and each bar says where it stands', () => {
    const { container } = render(<RawBar commits={LINE} cursor="c2" head="c39" bookmarks={BOOKMARKS} />);
    const rail = container.querySelector('[data-vzf="timeline"]')!;
    expect(rail.getAttribute('role')).toBe('group');
    expect(rail.getAttribute('aria-label')).toContain('arrow keys');
    const bar = (id: string): HTMLElement => container.querySelector(`[data-commit="${id}"]`)!;
    expect(bar('c2').getAttribute('aria-label')).toBe('step 3 of 40: #c2 select c2, bookmarked');
    expect(bar('c39').getAttribute('aria-label')).toBe('step 40 of 40: #c39 select c39, bookmarked, now');
    expect(bar('c5').getAttribute('aria-label')).toBe('step 6 of 40: #c5 select c5');
    expect(dots(container).filter((d) => d.getAttribute('aria-current') === 'step').map((d) => d.getAttribute('data-commit'))).toEqual(['c2']);
  });

  it('arrow keys, Home and End move the focus along the rail and seek nothing', () => {
    const onSeek = vi.fn();
    const { container } = render(<RawBar commits={LINE} cursor="c7" head="c39" onSeek={onSeek} />);
    const bar = (id: string): HTMLElement => container.querySelector(`[data-commit="${id}"]`)!;
    bar('c7').focus();
    const press = (key: string): boolean => fireEvent.keyDown(document.activeElement!, { key });
    expect(press('ArrowRight')).toBe(false); // the rail took the key
    expect(document.activeElement).toBe(bar('c8'));
    press('ArrowLeft');
    press('ArrowLeft');
    expect(document.activeElement).toBe(bar('c6'));
    press('End');
    expect(document.activeElement).toBe(bar('c39'));
    press('ArrowRight'); // the end does not wrap
    expect(document.activeElement).toBe(bar('c39'));
    press('Home');
    expect(document.activeElement).toBe(bar('c0'));
    press('ArrowLeft');
    expect(document.activeElement).toBe(bar('c0'));
    expect(onSeek).not.toHaveBeenCalled();
    // …and the tab stop has not moved: leaving the rail and coming back lands on the cursor again
    expect(inTabOrder(container)).toEqual(['c7']);
  });

  it('pressing the bar the keyboard is on seeks to it', () => {
    const onSeek = vi.fn();
    const { container } = render(<RawBar commits={LINE} cursor="c7" head="c39" onSeek={onSeek} />);
    const c7: HTMLElement = container.querySelector('[data-commit="c7"]')!;
    c7.focus();
    fireEvent.keyDown(c7, { key: 'ArrowRight' });
    fireEvent.click(document.activeElement!); // what Enter and Space do on a button
    expect(onSeek).toHaveBeenCalledWith('c8');
  });

  it('a key that is not the rail’s is left alone', () => {
    const { container } = render(<RawBar commits={LINE} cursor="c7" head="c39" />);
    const c7: HTMLElement = container.querySelector('[data-commit="c7"]')!;
    c7.focus();
    expect(fireEvent.keyDown(c7, { key: 'Tab' })).toBe(true); // not prevented
    expect(fireEvent.keyDown(c7, { key: 'Enter' })).toBe(true);
    expect(document.activeElement).toBe(c7);
  });

  it('a key pressed on the rail itself, off any bar, moves nothing', () => {
    const { container } = render(<RawBar commits={LINE} cursor="c7" head="c39" />);
    const rail: HTMLElement = container.querySelector('[data-vzf="timeline"]')!;
    expect(fireEvent.keyDown(rail, { key: 'ArrowRight' })).toBe(true);
  });

  it('a cursor that is on no bar: the head’s bar takes the stop', () => {
    const { container } = render(<RawBar commits={LINE} cursor="gone" head="c39" />);
    expect(inTabOrder(container)).toEqual(['c39']);
  });
});

describe('the rail in present mode', () => {
  it('the bookmarks are one stop, the current one; they say where they stand; arrows walk them', () => {
    const onSeek = vi.fn();
    const { container } = render(<RawBar mode="present" commits={LINE} cursor="c20" head="c39" bookmarks={BOOKMARKS} onSeek={onSeek} />);
    const rail = container.querySelector('[data-vzf="bookmark-rail"]')!;
    expect(rail.getAttribute('role')).toBe('group');
    expect(inTabOrder(container)).toEqual(['c20']);
    const dot = (id: string): HTMLElement => container.querySelector(`[data-bookmark-dot="${id}"]`)!;
    expect(dot('c20').getAttribute('aria-label')).toBe('bookmark 2 of 3: middle');
    expect(dot('c20').getAttribute('aria-current')).toBe('step');
    expect(dot('c2').getAttribute('aria-current')).toBeNull();
    dot('c20').focus();
    fireEvent.keyDown(dot('c20'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(dot('c39'));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(dot('c2'));
    expect(onSeek).not.toHaveBeenCalled();
  });
});
