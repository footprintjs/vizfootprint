/**
 * ANNOUNCE — the library's ONE polite live region.
 *
 * Some acts change the dashboard without changing anything the keyboard is
 * standing on. Re-encoding a channel is the plainest case: the picker closes,
 * the axis label and the marks both move, and a sighted user sees it happen —
 * a screen-reader user is told nothing at all, because no focused element
 * changed and no alert fired.
 *
 * A live region fixes exactly that. `announce(message)` writes into a single
 * `role="status" aria-live="polite"` element parked on `document.body`:
 *
 *   - POLITE, never assertive — it waits for the reader to finish its
 *     sentence; a re-encode is news, not an emergency;
 *   - SILENT for sighted users — the region is visually hidden (the same
 *     clip-rect the stylesheet gives `.vzf-sr-only`, under the standalone
 *     `.vzf-live-region` rule so it works parked outside the `.vzf` root);
 *   - ONE region for the whole library, created on first use. Live regions
 *     must exist in the DOM *before* their text changes to be announced, and
 *     a region that unmounts with the surface that wrote it (the picker
 *     closes on the very act it would announce) says nothing at all — which
 *     is why this is a body-level singleton rather than a React node;
 *   - REPEATABLE — assistive tech announces a live region when its text
 *     CHANGES, so the same message twice in a row would be silent the second
 *     time. A repeat gets a trailing no-break space: a different text node,
 *     the same sentence read out.
 *
 * It is a browser-only helper, called from event handlers (never at import
 * time, never during render), so it does not guard for a missing `document`.
 */

/** The class the stylesheet hides (a standalone rule — the region lives outside `.vzf`). */
const REGION_CLASS = 'vzf-live-region';

let region: HTMLElement | null = null;

/** The singleton live region, created (and parked on `document.body`) on first use. */
function liveRegion(): HTMLElement {
  if (region !== null && region.isConnected) return region;
  const el = document.createElement('div');
  el.className = REGION_CLASS;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  document.body.appendChild(el);
  region = el;
  return el;
}

/**
 * Say `message` politely, to assistive tech only. The same message twice in a
 * row is still read twice (see the header).
 */
export function announce(message: string): void {
  const el = liveRegion();
  el.textContent = el.textContent === message ? `${message}\u00a0` : message;
}
