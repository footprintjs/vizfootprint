/**
 * THE SEAM — StoryDeck's `StoryFigure`, the one contract the story stage and
 * the scroll lens meet through.
 *
 * Three plain methods, no framework: the lens mounts a figure into an element,
 * asks it to seek on every beat, and takes it down; a seek resolves nothing
 * when it moved and a SENTENCE when it could not, which the lens prints under
 * the figure. StoryDeck declares it (`footprint-storydeck` · `StoryFigure`)
 * from its next minor. The installed StoryDeck (0.5.0) does not know it yet,
 * so the shape is written here, and `./scrollyFigure.tsx` adapts a figure to
 * 0.5.0's render-function `figure` with the same host the next minor ships.
 *
 * When StoryDeck with `StoryFigure` is installed: import these two types from
 * `storydeck`, pass the figure as the section's `figure`, and delete this file
 * and `./scrollyFigure.tsx`.
 */

/** Which beat a figure is asked to stand on — plain data; `index` is the flow's `data-beat`. */
export interface StoryFigureBeat {
  readonly key: string;
  readonly index: number;
  readonly sectionKey: string;
  readonly step: number;
}

/** A figure the scroll lens drives without knowing how it draws. */
export interface StoryFigure {
  mount(el: HTMLElement): void;
  seek(beat: StoryFigureBeat): Promise<string | void>;
  dispose(): void;
}
