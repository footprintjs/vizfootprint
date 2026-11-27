import type { RenderRow, RenderEncodings, RenderSelection, RendererCallbacks, ResolvedChannel } from './types.js';
import type { ChartDomain, AxisSide } from '../primitives/scales.js';

/**
 * WHAT ONE MARK IS DRAWN FROM. A plain view's mark reads the view's own rows
 * and speaks with the view's callbacks; a LAYER of a frame reads its own rows,
 * on the frame's scales, in the box the frame sized for it, and speaks with its
 * own bundle. Everything else about drawing a bar is the same either way — so
 * each kind below is ONE function over this, used by the single-mark renderer
 * and by `layeredRenderer` alike. Two spellings of "how a bar is drawn from
 * rows" is the one that goes stale.
 */
export interface MarkDraw {
  readonly viewId: string;
  readonly rows: readonly RenderRow[];
  readonly encodings: RenderEncodings;
  readonly selection: RenderSelection;
  readonly width: number;
  readonly height: number;
  /** Whose voice a gesture on this mark is — the view's, or the layer's own bundle (the 1.2 law). */
  readonly callbacks: RendererCallbacks;
  /** The frame's scales, or `{}` for a mark on its own extents (which is byte-identical to the chart before frames existed). */
  readonly domain: ChartDomain;
  /** `false` while the FRAME draws one merged guide for the stack; `'y'` when this mark draws only its own y, on `axisSide`, and the frame draws x once (the two-axis figure). */
  readonly axes: boolean | 'y';
  /** The edge this mark's own y axis stands on — set exactly when `axes` is `'y'`. Only a line or a point ever READS it: a bar draws its own y on the left edge and no other (law 2). */
  readonly axisSide?: AxisSide;
  /** The hue this mark draws its own y axis (and its unsplit marks) in — set exactly when the frame draws TWO y scales and this mark is one of them (law 4, `VizFrame` its one owner). */
  readonly scaleHue?: string;
  /**
   * PROTOCOL 1.5's fold, PASSED THROUGH RAW — `RenderState.frame`, unread by
   * every mark but `lineMark`, which asks it whether its x is a band (the
   * stack asks `xBinding`/`bandX`; a plain view's scales now come the stack's
   * way too, `plainView`, and this stays the line's own question). A host can fold ONE
   * channel's scale for a plain view through the adapter's door for a view
   * with no layers (`viewFrameFor`, `ui/src/adapter/frame.ts`), and when it does, this is where that answer rides to the mark
   * that needs it, unread by the ones that don't.
   */
  readonly frame?: Readonly<Record<string, ResolvedChannel>>;
  /** The frame has reserved space for every date-order note, including independent layers. */
  readonly dateOrderOnFrame?: boolean;
}

