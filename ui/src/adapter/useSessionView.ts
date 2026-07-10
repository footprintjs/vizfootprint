/**
 * The React binding over the framework-light store: `useSessionView(view)`
 * subscribes via `useSyncExternalStore` and returns the current
 * {@link SessionViewState}, re-rendering only when the snapshot changes. The
 * store is created OUTSIDE React (from a session or a poll source) and passed
 * in, so the same store can feed React and non-React consumers alike.
 */

import { useSyncExternalStore } from 'react';
import type { SessionView } from './sessionView.js';
import type { SessionViewState } from './types.js';

export function useSessionView(view: SessionView): SessionViewState {
  return useSyncExternalStore(
    (onStoreChange) => view.subscribe(onStoreChange),
    () => view.getState(),
    () => view.getState(),
  );
}
