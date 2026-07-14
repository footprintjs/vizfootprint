// @vitest-environment jsdom
/**
 * The synthesized gesture-completion signal — N interim updates in, exactly
 * ONE flush out, whichever trigger (pointer-up / debounce) lands first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGestureCompletion } from './completion.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const up = (): boolean => window.dispatchEvent(new Event('pointerup'));

describe('createGestureCompletion', () => {
  it('N interim updates + pointer-up → exactly one flush', () => {
    const flush = vi.fn();
    const c = createGestureCompletion({ flush, debounceMs: 250, win: window });
    for (let i = 0; i < 7; i += 1) c.noteUpdate();
    up();
    expect(flush).toHaveBeenCalledTimes(1);
    // the pending debounce timer was cancelled — no second flush later
    vi.advanceTimersByTime(1000);
    expect(flush).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('no pointer at all → the debounce fallback flushes once (agent-driven gestures complete too)', () => {
    const flush = vi.fn();
    const c = createGestureCompletion({ flush, debounceMs: 250, win: window });
    c.noteUpdate();
    c.noteUpdate();
    vi.advanceTimersByTime(249);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(flush).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('each interim update RESTARTS the debounce window (mid-gesture never flushes)', () => {
    const flush = vi.fn();
    const c = createGestureCompletion({ flush, debounceMs: 250, win: window });
    c.noteUpdate();
    vi.advanceTimersByTime(200);
    c.noteUpdate(); // still dragging
    vi.advanceTimersByTime(200);
    expect(flush).not.toHaveBeenCalled(); // 400ms elapsed, but never 250 quiet ones
    vi.advanceTimersByTime(50);
    expect(flush).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('a pointer-up with nothing pending flushes nothing (unrelated clicks are inert)', () => {
    const flush = vi.fn();
    const c = createGestureCompletion({ flush, debounceMs: 250, win: window });
    up();
    expect(flush).not.toHaveBeenCalled();
    // and after a completed gesture, the NEXT unrelated pointer-up is inert too
    c.noteUpdate();
    up();
    up();
    expect(flush).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('pointercancel completes a gesture like pointer-up', () => {
    const flush = vi.fn();
    const c = createGestureCompletion({ flush, debounceMs: 250, win: window });
    c.noteUpdate();
    window.dispatchEvent(new Event('pointercancel'));
    expect(flush).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('dispose cancels the pending gesture and unhooks the window (no flush ever)', () => {
    const flush = vi.fn();
    const c = createGestureCompletion({ flush, debounceMs: 250, win: window });
    c.noteUpdate();
    c.dispose();
    vi.advanceTimersByTime(1000);
    up();
    expect(flush).not.toHaveBeenCalled();
  });
});
