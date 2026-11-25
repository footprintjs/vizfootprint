/**
 * THE TIME-TRAVEL DOOR — the one place a component gets time travel from.
 *
 * `TimeTravel` is the interface: a model to draw and the five things a reader
 * can do. `useTimeTravel` is the adapter that fills it from a session view.
 * Its result spreads straight onto `<TimeTravelBar>`. A host with a different
 * store builds the same interface from `timeTravelModel` and its own actions,
 * and every component that takes a `TimeTravel` works unchanged.
 */
import { useMemo } from 'react';
import type { SessionView } from '../adapter/sessionView.js';
import type { SessionViewState } from '../adapter/types.js';
import { useSessionView } from '../adapter/useSessionView.js';
import { timeTravelModel, type TimeTravelModel } from './model.js';

/** What a time-travel component needs: what to draw, and what a reader can do. */
export interface TimeTravel {
  readonly model: TimeTravelModel;
  /** The cursor is behind the head: acting now starts a new path. */
  readonly viewingPast: boolean;
  readonly onSeek: (commitId: string) => void;
  readonly onStepBack: () => void;
  readonly onStepForward: () => void;
  readonly onNameBookmark: (label: string) => void;
  readonly onReturnToNow: () => void;
}

/** The model of one session state. Pure; `useTimeTravel` is this plus the actions. */
export function timeTravelOf(state: SessionViewState): TimeTravelModel {
  return timeTravelModel({
    commits: state.commits,
    cursor: state.cursor,
    head: state.head,
    bookmarks: state.bookmarks,
    pathCount: state.branches.length,
    // the name belongs to the path the story is ON; detached (null) has none to print
    ...(state.paths.current !== null ? { pathName: state.paths.current } : {}),
  });
}

/** Time travel over a session view. Each action is the view's own; what the session answers is on the next state. */
export function useTimeTravel(view: SessionView): TimeTravel {
  const state = useSessionView(view);
  const model = useMemo(() => timeTravelOf(state), [state]);
  const actions = useMemo(
    () => ({
      onSeek: (commitId: string): void => void view.seek(commitId),
      onStepBack: (): void => void view.stepBack(),
      onStepForward: (): void => void view.stepForward(),
      onNameBookmark: (label: string): void => void view.bookmark(label),
      onReturnToNow: (): void => void view.returnToNow(),
    }),
    [view],
  );
  return { model, viewingPast: state.viewingPast, ...actions };
}
