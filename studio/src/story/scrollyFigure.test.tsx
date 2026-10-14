// @vitest-environment jsdom
/**
 * StoryDeck's thin host for a `StoryFigure`, as the app carries it until the
 * installed StoryDeck ships one — pinned to the contract's words: mount once,
 * seek every beat, print what a seek answers, and only the latest answer.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import type { ScrollyBeat } from 'storydeck';
import { asScrollyFigure, UNREACHED } from './scrollyFigure.js';
import type { StoryFigure } from './storyFigure.js';

afterEach(cleanup);

const beatAt = (index: number): ScrollyBeat =>
  ({ key: `s-${index}`, index, sectionKey: 's', step: index, html: '', label: '', heading: '', body: '', firstOfSection: index === 0, figure: null }) as ScrollyBeat;

function figureAnswering(answer: (index: number) => Promise<string | void>): StoryFigure & { mount: ReturnType<typeof vi.fn> } {
  return { mount: vi.fn((el: HTMLElement) => (el.textContent = 'drawn')), seek: vi.fn((beat) => answer(beat.index)), dispose: vi.fn() };
}

describe('asScrollyFigure — the host the lens puts a StoryFigure in', () => {
  it('mounts the figure once into its own element and seeks with the beat\'s plain coordinates', async () => {
    const figure = figureAnswering(async () => undefined);
    const live = asScrollyFigure(figure);
    const { container, rerender, unmount } = render(<>{live(beatAt(0))}</>);
    await act(async () => undefined);
    rerender(<>{live(beatAt(1))}</>);
    await act(async () => undefined);
    expect(container.querySelector('.scrolly-figure')?.textContent).toBe('drawn');
    expect(figure.mount).toHaveBeenCalledTimes(1);
    expect(figure.seek).toHaveBeenLastCalledWith({ key: 's-1', index: 1, sectionKey: 's', step: 1 });
    unmount();
    expect(figure.dispose).toHaveBeenCalledTimes(1);
  });

  it('prints a refusal, prints nothing for an empty answer, and says so in its own words when a seek rejects', async () => {
    const figure = figureAnswering(async (index) => {
      if (index === 0) return 'cannot stand here';
      if (index === 1) return '';
      throw new Error('offline');
    });
    const live = asScrollyFigure(figure);
    const { rerender } = render(<>{live(beatAt(0))}</>);
    await act(async () => undefined);
    expect(screen.getByRole('status').textContent).toBe('cannot stand here');
    rerender(<>{live(beatAt(1))}</>);
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<>{live(beatAt(2))}</>);
    await act(async () => undefined);
    expect(screen.getByRole('status').textContent).toBe(UNREACHED);
  });

  it('never lets an older seek\'s answer — or its failure — write over a newer one', async () => {
    const pending: { resolve: (said: string | void) => void; reject: (e: unknown) => void }[] = [];
    const figure = figureAnswering(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
    const live = asScrollyFigure(figure);
    const { rerender } = render(<>{live(beatAt(0))}</>);
    rerender(<>{live(beatAt(1))}</>);
    rerender(<>{live(beatAt(2))}</>);
    await act(async () => pending[0]!.resolve('stale'));
    await act(async () => pending[1]!.reject(new Error('stale failure')));
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => pending[2]!.resolve('current'));
    expect(screen.getByRole('status').textContent).toBe('current');
  });
});
