/**
 * THE INK OF ONE SCALE, on its way from the frame to the stylesheet.
 *
 * A two-scale frame hands each own-y layer a HUE (`VizFrame` · `SIDE_HUES`,
 * the one owner of which hue each edge gets) and the layer draws its own axis
 * — line, ticks, label — and its unsplit marks in it. A mark takes its colour
 * as a presentation attribute, the way a series colour already does; the AXIS
 * cannot, because the stylesheet paints it (`.vzf-axis`, `.vzf-tick`,
 * `.vzf-axis-label` wear ink tokens, and a CSS rule beats a presentation
 * attribute). So the hue travels on ONE inherited custom property and each
 * rule spends it on the property IT paints with — which also leaves the axis
 * label's hover cue to the brand, where an affordance belongs, instead of an
 * inline `fill` overriding it.
 *
 * This is the ONE place that spells the variable's name: the charts say
 * "this part is my scale's" and never which property that means.
 */
import type { CSSProperties } from 'react';

/** The custom property the scale hue is inherited on — read in `styles.css` by the three rules that paint an axis. */
export const SCALE_HUE_VAR = '--vzf-scale-hue';

/**
 * The style that puts a frame's scale hue on an element and everything under
 * it — or NOTHING at all when the frame handed none, so a chart that is not
 * one scale of a two-scale frame renders exactly the markup it always did.
 */
export function scaleHueStyle(hue: string | undefined): CSSProperties | undefined {
  return hue === undefined ? undefined : ({ [SCALE_HUE_VAR]: hue } as CSSProperties);
}
