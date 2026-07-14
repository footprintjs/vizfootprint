/**
 * vizfootprint-vega-lite — the ONE first-party renderer bridge (D27 §2):
 * a single-view Vega-Lite spec, mounted as a vizfootprint-ui contract
 * Renderer. Version-pinned to exact vega/vega-lite releases (the pinning
 * policy in README.md; a test asserts the installed versions match).
 *
 *   • `vegaLiteRenderer(spec, opts)` — the bridge itself.
 *   • `validateVegaLiteSpec(spec)`   — the pure spec gate (agents pre-flight
 *                                      proposed specs with this exact call).
 *   • emission.ts                    — THE key/datum translation seam,
 *                                      documented once.
 *   • completion.ts                  — the synthesized gesture-completion
 *                                      signal (one emission per gesture).
 */

export {
  vegaLiteRenderer,
  foldKeep,
  VEGA_LITE_BRIDGE_PROTOCOL,
  VEGA_LITE_DATA_NAME,
  VEGA_LITE_KEEP_FIELD,
} from './vegaLiteRenderer.js';
export type { VegaLiteRendererOptions } from './vegaLiteRenderer.js';

export { validateVegaLiteSpec, VegaLiteSpecError } from './specGate.js';
export type {
  SpecGateIssue,
  SpecGateResult,
  GatedSpec,
  GatedBrush,
  GatedPoint,
  GatedNavigate,
  GatedNavigateChannel,
} from './specGate.js';

export { deriveCapabilities } from './capabilities.js';

export { msToIso, intervalRawValue, pointRawValue, navigateViewState } from './emission.js';
export type { DateFormat } from './emission.js';

export { createGestureCompletion } from './completion.js';
export type { GestureCompletion, GestureCompletionOptions } from './completion.js';
