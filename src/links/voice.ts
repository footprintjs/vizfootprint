/**
 * VOICE — which emission kinds a view can produce, from its declared
 * capability. ONE helper, used by the session's guard, the overview's
 * `selectionKinds`, and the link graph, so what an agent is told matches
 * what the guard accepts (SET-1 ruling: a set is a point's plural — a view
 * that declares `point` emits `match` too).
 */
import { EMISSION_KINDS, ENCODING_KIND, type EmissionKind, type LinkKind } from './types.js';

/**
 * The kinds a view is ASSUMED to speak when it declares no capability — every
 * emission kind but the walk.
 *
 * WHY `neighbourhood` is not assumed: it is the one kind that cannot exist
 * without a DECLARED relation (`../def/relations.ts`, law 7). Assuming it would
 * put an offer on every chart in the cockpit that no gesture could ever answer,
 * write a default crossfilter edge out of every view for a voice almost none of
 * them have, and tell an agent a bar chart can be walked from. A view that CAN
 * be walked says so: `encodings: ['point', 'neighbourhood']`.
 */
const ASSUMED_KINDS: readonly EmissionKind[] = EMISSION_KINDS.filter((k) => k !== 'neighbourhood');

/**
 * A declared list with `match` implied by `point`; unchanged otherwise.
 *
 * `neighbourhood` is implied by NOTHING and implies nothing: a set is a
 * point's plural, but a walk is not a point's anything — it reads a declared
 * relation and lands a set the chart never named. A view that can be walked
 * from says so (`encodings: ['point', 'neighbourhood']`).
 */
export function impliedKinds(encodings: readonly EmissionKind[]): readonly EmissionKind[] {
  return encodings.includes('point') && !encodings.includes('match') ? [...encodings, 'match'] : encodings;
}

/**
 * The voice of a view given its capability envelope: the declared kinds (with
 * the implied one), the ASSUMED kinds when nothing is declared, and NOTHING
 * when the view declares it cannot probe at all.
 */
export function voiceOf(
  capability: { readonly canProbe: boolean; readonly encodings?: readonly EmissionKind[] } | undefined,
  opts: { readonly hasEncodingSurface?: boolean } = {},
): readonly LinkKind[] {
  const emitted = emittedKinds(capability);
  // a view with an encoding surface can drive another chart's binding even when nobody can brush it
  return opts.hasEncodingSurface ? [...emitted, ENCODING_KIND] : emitted;
}

/** The SELECTION kinds a view emits (what the probe guard and `selectionKinds` read). */
function emittedKinds(capability: { readonly canProbe: boolean; readonly encodings?: readonly EmissionKind[] } | undefined): readonly EmissionKind[] {
  if (capability === undefined) return ASSUMED_KINDS;
  if (!capability.canProbe) return [];
  return capability.encodings === undefined ? ASSUMED_KINDS : impliedKinds(capability.encodings);
}
