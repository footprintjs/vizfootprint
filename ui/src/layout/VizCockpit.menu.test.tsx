// @vitest-environment jsdom
/**
 * The cockpit's menu, the per-chart edit affordance, and Present mode as a
 * slideshow: the host's acts in one popover, an ✎ on every editable cell
 * (never a floating button), and a slide bar that walks the bookmarks on the
 * keyboard while every other strip is gone.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { VizCockpit, type CockpitChart, type CockpitMenuItem, type CockpitSlideshow } from './VizCockpit.js';

afterEach(cleanup);

const CHARTS: CockpitChart[] = [
  { id: 'a', render: () => <svg data-chart="a" /> },
  { id: 'b', render: () => <svg data-chart="b" /> },
];

describe('the cockpit menu', () => {
  it('opens on the button, lists the host items, runs one and closes; Escape and a click outside close it', () => {
    const save = vi.fn();
    const items: CockpitMenuItem[] = [
      { id: 'save', label: 'Save selection', icon: '💾', onSelect: save, hint: 'name the live selection' },
      { id: 'text', label: 'Text tool', onSelect: vi.fn(), disabled: true },
    ];
    const { container } = render(<VizCockpit charts={CHARTS} menu={items} />);
    const button = container.querySelector('.vzf-menu-button')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="menu"]')).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const list = container.querySelector('[role="menu"]')!;
    expect(list.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    expect(list.textContent).toContain('name the live selection');
    const text = list.querySelector('[data-menu-item="text"]') as HTMLButtonElement;
    expect(text.getAttribute('aria-disabled')).toBe('true'); // focusable and readable, does nothing
    expect(text.disabled).toBe(false);
    expect(document.activeElement).toBe(list.querySelector('[data-menu-item="save"]')); // focus moves into the menu
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(text);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(list.querySelector('[data-menu-item="save"]')); // wraps
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(text);
    fireEvent.click(text);
    expect(container.querySelector('[role="menu"]')).not.toBeNull(); // a disabled item does not close the menu
    fireEvent.click(list.querySelector('[data-menu-item="save"]')!);
    expect(save).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="menu"]')).toBeNull(); // an act closes the menu
    expect(document.activeElement).toBe(button); // and focus comes back to ☰
    fireEvent.click(button);
    fireEvent.keyDown(window, { key: 'a' }); // any other key leaves it open
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(container.querySelector('[role="menu"]')).toBeNull();
    fireEvent.click(button);
    fireEvent.pointerDown(container.querySelector('.vzf-menu-list')!); // inside: stays open
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
  });
  it('without a menu prop, or with an empty one, there is no menu button; a show closes an open menu', () => {
    const { container } = render(<VizCockpit charts={CHARTS} />);
    expect(container.querySelector('.vzf-menu-button')).toBeNull();
    expect(render(<VizCockpit charts={CHARTS} menu={[]} />).container.querySelector('.vzf-menu-button')).toBeNull();
    const items = [{ id: 'x', label: 'X', onSelect: vi.fn() }];
    const live = render(<VizCockpit charts={CHARTS} menu={items} />);
    fireEvent.click(live.container.querySelector('.vzf-menu-button')!);
    expect(live.container.querySelector('[role="menu"]')).not.toBeNull();
    live.rerender(<VizCockpit charts={CHARTS} menu={items} slideshow={{ active: true, title: 't', index: 0, count: 1, onPrev: vi.fn(), onNext: vi.fn(), onExit: vi.fn() }} />);
    expect(live.container.querySelector('[role="menu"]')).toBeNull();
  });
});

describe('the per-chart edit affordance', () => {
  it('an ✎ on every cell that brought onEdit, named for its chart, gone in present mode', () => {
    const edit = vi.fn();
    const { container, rerender } = render(<VizCockpit charts={[{ ...CHARTS[0]!, onEdit: edit }, CHARTS[1]!]} />);
    const buttons = container.querySelectorAll('.vzf-cell-edit');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.getAttribute('aria-label')).toBe('Edit a');
    fireEvent.click(buttons[0]!);
    expect(edit).toHaveBeenCalledTimes(1);
    rerender(<VizCockpit charts={[{ ...CHARTS[0]!, onEdit: edit }, CHARTS[1]!]} readOnly />);
    expect(container.querySelectorAll('.vzf-cell-edit')).toHaveLength(0);
  });
});

describe('the slideshow', () => {
  const show = (over: Partial<CockpitSlideshow> = {}): CockpitSlideshow => ({ active: true, title: 'Start', words: 'Every category.', index: 0, count: 3, onPrev: vi.fn(), onNext: vi.fn(), onExit: vi.fn(), ...over });

  it('takes the screen: the root is marked, the slide bar shows the bookmark and its words, prev/next/exit are wired and the ends are disabled', () => {
    const s = show();
    const { container, rerender } = render(<VizCockpit charts={[{ ...CHARTS[0]!, onEdit: vi.fn() }, CHARTS[1]!]} top={<div>strip</div>} slideshow={s} />);
    expect(container.querySelector('.vzf-cockpit-root')!.classList.contains('vzf-slideshow')).toBe(true);
    // read-only is the show's own law, whatever the host passed: no ✎, the cockpit marked read-only
    expect(container.querySelector('[data-vzf="cockpit"]')!.getAttribute('data-readonly')).toBe('true');
    expect(container.querySelectorAll('.vzf-cell-edit')).toHaveLength(0);
    const bar = container.querySelector('.vzf-slide-bar')!;
    expect(bar.textContent).toContain('1 of 3');
    expect(bar.textContent).toContain('Start');
    expect(bar.textContent).toContain('Every category.');
    expect((bar.querySelector('[data-slide="prev"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(bar.querySelector('[data-slide="next"]')!);
    expect(s.onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(bar.querySelector('[data-slide="exit"]')!);
    expect(s.onExit).toHaveBeenCalledTimes(1);
    const last = show({ index: 2 });
    rerender(<VizCockpit charts={CHARTS} readOnly slideshow={last} />);
    expect((container.querySelector('[data-slide="next"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(container.querySelector('[data-slide="prev"]')!);
    expect(last.onPrev).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.vzf-slide-caption')).not.toBeNull();
    rerender(<VizCockpit charts={CHARTS} readOnly slideshow={show({ words: undefined })} />);
    expect(container.querySelector('.vzf-slide-caption')).toBeNull();
  });

  it('walks the bookmarks on the keyboard and leaves on Escape; an inactive show renders no bar and binds no keys', () => {
    const s = show({ index: 1 });
    const { container, rerender } = render(<VizCockpit charts={CHARTS} readOnly slideshow={s} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: 'PageDown' });
    expect(s.onNext).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'PageUp' });
    expect(s.onPrev).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: 'a' }); // any other key is not the show's
    // a field keeps its keys; a focused button keeps its space
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: ' ' });
    expect(s.onNext).toHaveBeenCalledTimes(3);
    input.remove();
    (container.querySelector('[data-slide="prev"]') as HTMLButtonElement).focus();
    fireEvent.keyDown(window, { key: ' ' });
    expect(s.onNext).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(window, { key: 'ArrowRight' }); // arrows still walk from a button
    expect(s.onNext).toHaveBeenCalledTimes(4);
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(s.onExit).toHaveBeenCalledTimes(1);
    const off = show({ active: false });
    rerender(<VizCockpit charts={CHARTS} slideshow={off} />);
    expect(container.querySelector('.vzf-slide-bar')).toBeNull();
    expect(container.querySelector('.vzf-cockpit-root')!.classList.contains('vzf-slideshow')).toBe(false);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(off.onNext).not.toHaveBeenCalled();
  });

  it('asks the browser for fullscreen when it can, survives a refusal, and leaves fullscreen it entered', async () => {
    const root = document.documentElement as HTMLElement & { requestFullscreen: () => Promise<void> };
    const request = vi.fn(() => Promise.resolve());
    const exit = vi.fn(() => Promise.resolve());
    Object.defineProperty(root, 'requestFullscreen', { value: request, configurable: true });
    Object.defineProperty(document, 'exitFullscreen', { value: exit, configurable: true });
    let element: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { get: () => element, configurable: true });
    const first = render(<VizCockpit charts={CHARTS} readOnly slideshow={show()} />);
    expect(request).toHaveBeenCalledTimes(1);
    element = root; // the browser granted it
    // a host that rebuilds the slideshow object every render (a bookmark step) neither leaves nor re-requests the screen
    first.rerender(<VizCockpit charts={CHARTS} readOnly slideshow={show({ index: 1 })} />);
    expect(exit).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    // the browser taking the screen back (F11, Esc) ends the show
    const ending = show({ index: 1 });
    first.rerender(<VizCockpit charts={CHARTS} readOnly slideshow={ending} />);
    document.dispatchEvent(new Event('fullscreenchange')); // still fullscreen (element set): nothing ends
    expect(ending.onExit).not.toHaveBeenCalled();
    element = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(ending.onExit).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('fullscreenchange')); // already handled: entered is false now
    expect(ending.onExit).toHaveBeenCalledTimes(1);
    element = root;
    first.unmount();
    expect(exit).not.toHaveBeenCalled(); // it had already left: nothing to give back
    element = null; // the browser is windowed again
    const { unmount } = render(<VizCockpit charts={CHARTS} readOnly slideshow={show()} />);
    expect(request).toHaveBeenCalledTimes(2);
    element = root;
    unmount();
    expect(exit).toHaveBeenCalledTimes(1);
    // a refusal: the show still runs, and nothing is exited on the way out
    element = null;
    const refuse = vi.fn(() => Promise.reject(new Error('no gesture')));
    Object.defineProperty(root, 'requestFullscreen', { value: refuse, configurable: true });
    const second = render(<VizCockpit charts={CHARTS} readOnly slideshow={show()} />);
    expect(refuse).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0)); // let the refusal settle
    expect(second.container.querySelector('.vzf-slide-bar')).not.toBeNull();
    second.unmount();
    expect(exit).toHaveBeenCalledTimes(1);
    // already fullscreen (someone else's): not requested again, not exited by us
    element = root;
    const again = vi.fn(() => Promise.resolve());
    Object.defineProperty(root, 'requestFullscreen', { value: again, configurable: true });
    const third = render(<VizCockpit charts={CHARTS} readOnly slideshow={show()} />);
    expect(again).not.toHaveBeenCalled();
    third.unmount();
    expect(exit).toHaveBeenCalledTimes(1);
    // leaving fullscreen can be refused too (the document already left it): the show ends without a throw
    element = null;
    Object.defineProperty(root, 'requestFullscreen', { value: request, configurable: true });
    Object.defineProperty(document, 'exitFullscreen', { value: vi.fn(() => Promise.reject(new Error('not fullscreen'))), configurable: true });
    const fourth = render(<VizCockpit charts={CHARTS} readOnly slideshow={show()} />);
    element = root;
    fourth.unmount();
    await new Promise((r) => setTimeout(r, 0));
  });
});
