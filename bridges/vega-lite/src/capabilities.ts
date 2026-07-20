/**
 * Capability derivation — the hello's capabilities are READ OFF THE SPEC,
 * never guessed (D27 §4: the one point every panel lens endorsed intact).
 *
 * | capability     | derived from                                             |
 * |----------------|----------------------------------------------------------|
 * | canBrush       | an interval param on one positional axis (the gated brush)|
 * | canPointSelect | a point param naming one field (the gated point)          |
 * | canHighlight   | always true — the bridge injects the `__vzfKeep` opacity  |
 * |                | encode; every host selection dims the marks               |
 * | canReencode    | always false in v1 — re-encode means the HOST regenerates |
 * |                | the spec (a future bridge revision)                       |
 * | canPanZoom     | a `bind: 'scales'` interval param (the gated navigate)    |
 * | emissionKinds  | 'point' iff canPointSelect · 'interval' iff canBrush —    |
 * |                | NEVER 'cell' (D29): the gate admits only one-axis interval|
 * |                | and one-field point params, so a VL spec has no compound  |
 * |                | two-field gesture to derive; the bridge honestly does not |
 * |                | declare what it cannot emit                               |
 */

import type { EmissionKind, RendererCapabilities } from 'vizfootprint-ui';
import type { GatedSpec } from './specGate.js';

export function deriveCapabilities(gated: GatedSpec): RendererCapabilities {
  const emissionKinds: EmissionKind[] = [];
  if (gated.point !== null) emissionKinds.push('point');
  if (gated.brush !== null) emissionKinds.push('interval');
  return {
    canBrush: gated.brush !== null,
    canPointSelect: gated.point !== null,
    canHighlight: true,
    canReencode: false,
    canPanZoom: gated.navigate !== null,
    emissionKinds,
  };
}
