// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { mapPollState, type RawPollState, type SessionView } from '../adapter/sessionView.js';
import type { SessionViewState } from '../adapter/types.js';
import { TimeTravelBar } from './TimeTravelBar.js';
import { timeTravelModel } from './model.js';
import { useTimeTravel, type TimeTravel } from './useTimeTravel.js';

afterEach(cleanup);

const RAW: RawPollState = {
  records: [
    { id: 'r', parent: null, viewId: 'scatter', kind: 'interval', field: 'price', value: [0, 100], cause: { requestedBy: 'user' } },
    { id: 'a', parent: 'r', viewId: 'bar', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'agent' } },
  ],
  bookmarks: [],
  branches: [{ tip: 'a', length: 2, actor: 'user', active: true }],
  cursor: 'r',
  head: 'a',
};

/** A session view reduced to what the door touches: a state, a subscription and the five actions. */
function fakeView(initial: SessionViewState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const calls: unknown[][] = [];
  const act1 = (name: string) => vi.fn(async (...args: unknown[]) => void calls.push([name, ...args]));
  const view = {
    getState: () => state,
    subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
    seek: act1('seek'),
    stepBack: act1('stepBack'),
    stepForward: act1('stepForward'),
    bookmark: act1('bookmark'),
    returnToNow: act1('returnToNow'),
  } as unknown as SessionView;
  return { view, calls, set: (next: SessionViewState) => ((state = next), listeners.forEach((l) => l())) };
}

function Bar({ view, seen }: { view: SessionView; seen: TimeTravel[] }): JSX.Element {
  const time = useTimeTravel(view);
  seen.push(time);
  return <TimeTravelBar {...time} />;
}

describe('useTimeTravel — the door over a session view', () => {
  it('hands the bar a model of the state and the view’s own actions', () => {
    const state = { ...mapPollState(RAW), viewingPast: true };
    const { view, calls } = fakeView(state);
    const seen: TimeTravel[] = [];
    const { container } = render(<Bar view={view} seen={seen} />);

    expect(seen[0]!.model).toEqual(timeTravelModel({ commits: state.commits, cursor: 'r', head: 'a', bookmarks: [], pathCount: 1 }));
    expect(seen[0]!.viewingPast).toBe(true);
    expect(container.querySelectorAll('.vzf-tl-dot')).toHaveLength(2);

    fireEvent.click(container.querySelector('[data-commit="a"]')!);
    fireEvent.click(container.querySelector('[data-step="forward"]')!);
    fireEvent.click(container.querySelector('[data-vzf="return-now"]')!);
    seen[0]!.onStepBack();
    seen[0]!.onNameBookmark('here');
    expect(calls).toEqual([['seek', 'a'], ['stepForward'], ['returnToNow'], ['stepBack'], ['bookmark', 'here']]);
  });

  it('follows the view: a new state is a new model, the same state is the same model, the actions never change', () => {
    const first = mapPollState(RAW);
    const { view, set } = fakeView(first);
    const seen: TimeTravel[] = [];
    const { rerender } = render(<Bar view={view} seen={seen} />);
    rerender(<Bar view={view} seen={seen} />);
    expect(seen[1]!.model).toBe(seen[0]!.model);

    act(() => set(mapPollState({ ...RAW, cursor: 'a' })));
    const last = seen[seen.length - 1]!;
    expect(last.model.cursor).toBe('a');
    expect(last.model).not.toBe(seen[0]!.model);
    expect(last.onSeek).toBe(seen[0]!.onSeek);
    expect(screen.queryByText(/Return to now/)).toBeNull();
  });
});

describe('TimeTravelBar — renders the model it is given', () => {
  const commits = mapPollState(RAW).commits;

  it('an empty log says there are no commits yet', () => {
    const { container } = render(<TimeTravelBar model={timeTravelModel({ commits: [], cursor: null, head: null })} />);
    expect(container.querySelector('.vzf-tl-empty')!.textContent).toContain('no commits yet');
  });

  it('a log with steps and no lineage to draw does not claim it is empty', () => {
    const { container } = render(<TimeTravelBar model={timeTravelModel({ commits, cursor: null, head: null })} />);
    expect(container.querySelector('.vzf-tl-empty')!.textContent).toBe('none of the 2 recorded steps is on a path that can be drawn here');
  });

  it('a cursor that is not in the log leaves no bar marked and says so beside the rail', () => {
    const { container } = render(<TimeTravelBar model={timeTravelModel({ commits, cursor: 'gone', head: 'a' })} />);
    expect(container.querySelectorAll('.vzf-tl-dot')).toHaveLength(2);
    expect(container.querySelector('.vzf-cursor')).toBeNull();
    expect(container.querySelector('[data-vzf="rail-scope"]')!.textContent).toBe('2 of 2 steps · this path · the cursor is not among the recorded steps');
  });

  it('draws only what the model says: a hand-made model is rendered as given', () => {
    const model = timeTravelModel({ commits, cursor: 'r', head: 'a' });
    const edited = { ...model, explore: { ...model.explore, back: 'elsewhere', bars: model.explore.bars.slice(0, 1) } };
    const { container } = render(<TimeTravelBar model={edited} />);
    expect(container.querySelectorAll('.vzf-tl-dot')).toHaveLength(1);
    expect((container.querySelector('[data-step="back"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
