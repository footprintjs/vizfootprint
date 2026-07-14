/**
 * The SYNTHESIZED gesture-completion signal — the one wrinkle the panel said
 * must be engineered around, not argued around (docs/proposals/
 * renderer-protocol.md §2): Vega-Lite has no native "brush finished" signal
 * (vega/vega-lite#5341, open — "listening to the brush signal alone does not
 * suffice because there is no indication of completion"), but a commit-log
 * architecture cannot accept per-frame interval spam. This module inverts
 * the stream: N interim signal updates in, EXACTLY ONE flush out per
 * completed gesture.
 *
 * Two completion triggers, first one wins:
 *   - POINTER-UP (or pointercancel), captured at the window so a drag that
 *     ends outside the chart still completes;
 *   - a DEBOUNCE fallback (`debounceMs` after the last interim update) for
 *     gestures with no pointer at all — an agent driving the view's signals
 *     programmatically completes too.
 *
 * A flush clears the dirty flag and cancels the timer, so the *other*
 * trigger firing later cannot double-flush; a pointer-up with nothing
 * pending (any unrelated click) flushes nothing.
 */

export interface GestureCompletion {
  /** Note one interim signal update — arms both completion triggers. */
  noteUpdate(): void;
  /** Remove the window listeners and cancel any pending timer. */
  dispose(): void;
}

export interface GestureCompletionOptions {
  /** Called exactly once per completed gesture. */
  flush(): void;
  /** The debounce fallback window, ms. */
  readonly debounceMs: number;
  /** Where pointer-up is heard (the mount's window; injectable for tests). */
  readonly win: Window;
}

export function createGestureCompletion(options: GestureCompletionOptions): GestureCompletion {
  const { flush, debounceMs, win } = options;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const complete = (): void => {
    dirty = false;
    cancelTimer();
    flush();
  };
  const onPointerUp = (): void => {
    if (dirty) complete();
  };

  win.addEventListener('pointerup', onPointerUp, true);
  win.addEventListener('pointercancel', onPointerUp, true);

  return {
    noteUpdate() {
      dirty = true;
      cancelTimer();
      timer = setTimeout(complete, debounceMs);
    },
    dispose() {
      cancelTimer();
      dirty = false;
      win.removeEventListener('pointerup', onPointerUp, true);
      win.removeEventListener('pointercancel', onPointerUp, true);
    },
  };
}
