/**
 * A deferred focus return belongs to the interaction that requested it, not
 * to whichever UI happens to be visible when its asynchronous work finishes.
 * This demo-local owner is shared by chat opening and turn completion. A
 * newer claim, close/reset, or focus/pointer interaction outside the panel
 * revokes the old claim immediately; no knowledge of report/modals is needed.
 */
export function createDeferredFocus(scope: HTMLElement, input: HTMLInputElement): {
  claim(): () => void;
  cancel(): void;
} {
  const document = scope.ownerDocument;
  let cancel = (): void => {};
  return {
    claim() {
      cancel();
      let active = true;
      const finish = (restore: boolean): void => {
        if (!active) return;
        active = false;
        document.removeEventListener('focusin', onInteraction, true);
        document.removeEventListener('pointerdown', onInteraction, true);
        if (restore && scope.isConnected && !scope.hidden && scope.contains(input) && !input.disabled) input.focus();
      };
      const onInteraction = (event: Event): void => {
        if (!event.composedPath().includes(scope)) finish(false);
      };
      cancel = () => finish(false);
      document.addEventListener('focusin', onInteraction, true);
      document.addEventListener('pointerdown', onInteraction, true);
      return () => finish(true);
    },
    cancel: () => cancel(),
  };
}
