/** A stack may share only a folded domain; a missing span is not an omitted declaration. */
import type { ResolvedChannel } from 'vizfootprint/def';

type Frame = Readonly<Record<string, ResolvedChannel>> | undefined;
export interface StackLayerAxes {
  readonly layerId: string;
  readonly encodings: Readonly<Record<string, string>>;
  /** Actual axis channels from the renderer's existing mark-binding owner. */
  readonly channels: readonly string[];
}
export type StackSpan = { readonly frame: Frame } | { readonly refused: string };

/** Decide before removing unbound unfolded entries; never guess why the fold has no domain. */
export function stackSpan(frame: Frame, layers: readonly StackLayerAxes[]): StackSpan {
  for (const layer of layers) {
    for (const channel of layer.channels) {
      if (layer.encodings[channel] === undefined) continue;
      const domain = frame?.[channel];
      if (domain?.mode !== 'shared' || domain.scale !== undefined) continue;
      return { refused: 'channel ' + JSON.stringify(channel) + ' on layer ' + JSON.stringify(layer.layerId) + ' is declared shared, but no shared domain was folded. A stack cannot draw one shared scale from separate layer extents. Supply a folded shared domain for ' + JSON.stringify(channel) + ', or draw the layers as plain views.' };
    }
  }
  return { frame: foldedOnly(frame) };
}

/**
 * Unbound entries cannot affect a layer's picture. Keep the former filter for
 * those entries only, after the bound channels were assessed; independent and
 * folded channels retain their exact original values.
 */
function foldedOnly(frame: Readonly<Record<string, ResolvedChannel>> | undefined): Readonly<Record<string, ResolvedChannel>> | undefined {
  if (frame === undefined) return undefined;
  return Object.fromEntries(Object.entries(frame).filter(([, channel]) => channel.mode !== 'shared' || channel.scale !== undefined));
}
