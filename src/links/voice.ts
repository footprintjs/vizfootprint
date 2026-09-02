/**
 * VOICE — which emission kinds a view can produce, from its declared
 * capability. ONE helper, used by the session's guard, the overview's
 * `selectionKinds`, and the link graph, so what an agent is told matches
 * what the guard accepts (SET-1 ruling: a set is a point's plural — a view
 * that declares `point` emits `match` too).
 */
import { EMISSION_KINDS, ENCODING_KIND, type EmissionKind, type LinkKind } from './types.js';

/** A declared list with `match` implied by `point`; unchanged otherwise. */
export function impliedKinds(encodings: readonly EmissionKind[]): readonly EmissionKind[] {
  return encodings.includes('point') && !encodings.includes('match') ? [...encodings, 'match'] : encodings;
}

/**
 * The voice of a view given its capability envelope: the declared kinds (with
 * the implied one), every kind when nothing is declared, and NOTHING when the
 * view declares it cannot probe at all.
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
  if (capability === undefined) return EMISSION_KINDS;
  if (!capability.canProbe) return [];
  return capability.encodings === undefined ? EMISSION_KINDS : impliedKinds(capability.encodings);
}
