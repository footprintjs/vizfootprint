import type { DateOrderConflict } from './dateOrder.js';

/**
 * The domain, with the SCALE KIND it was folded as — a consumer branches on
 * `scale` before it reads `domain`, because the three are three different
 * things: a pair of numbers, a pair of ISO strings, an ordered category list.
 */
export type ResolvedDomain =
  | {
      readonly scale: 'quantitative';
      readonly domain: readonly [number, number];
      /**
       * HOW MANY CELLS THE TRANSFORM COULD NOT PLACE — a zero or a negative
       * number on a LOGARITHMIC axis (`ChannelResolution.transform`), which a
       * logarithm has no answer for. Set only when something was excluded, so a
       * linear fold is byte-identical to the one that existed before.
       *
       * WHY it is counted and not dropped: which cells those are is DATA, not
       * declaration, so the door cannot refuse them — and a picture that
       * silently draws 300 of 1000 planets is worse than one that says so
       * ("exclude and count, never silently drop", the law the absence work set
       * in `../data/silence.ts`). It is a SEPARATE fact from a silence: a
       * silence is a cell the data says nothing about, and this is a cell the
       * data speaks plainly about but a logarithm cannot place. The adapter has
       * already dropped the silences before this fold sees a value.
       */
      readonly excluded?: number;
    }
  | { readonly scale: 'temporal'; readonly domain: readonly [string, string]; readonly dateOrder?: DateOrderConflict }
  | { readonly scale: 'categorical'; readonly domain: readonly string[] };
