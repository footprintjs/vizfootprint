/**
 * StoryDeck's thin host for a `StoryFigure`, as this app needs it TODAY.
 *
 * The installed StoryDeck (0.5.0) takes a section's live `figure` only as a
 * React render function. Its next minor takes a `StoryFigure` itself and
 * adapts it with this same host: mounted ONCE into a plain element (0.5.0
 * renders the live figure without a key, so a beat change re-renders this
 * rather than remounting it), asked to seek on every beat change, and the
 * sentence a seek resolves to printed under it until a later seek answers —
 * only the latest seek's answer, and a rejected seek in the lens's own words.
 * Same behaviour, same class names, so the swap changes nothing on the page.
 *
 * Temporary by design (see `./storyFigure.ts`): when StoryDeck with
 * `StoryFigure` is installed, pass the figure as the section's `figure` and
 * delete this file.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ScrollyBeat } from 'storydeck';
import type { StoryFigure } from './storyFigure.js';

/** What the lens says when a seek rejected instead of answering — the figure said nothing, so the words are the lens's own. */
export const UNREACHED = 'this figure could not move to this beat';

/** A `StoryFigure` as StoryDeck 0.5.0's render-function `figure`. */
export function asScrollyFigure(figure: StoryFigure): (beat: ScrollyBeat) => ReactNode {
  return (beat) => <FigureHost figure={figure} beat={beat} />;
}

function FigureHost({ figure, beat }: { readonly figure: StoryFigure; readonly beat: ScrollyBeat }): JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  // mounted in the LAYOUT phase, so the figure has drawn before the stage first paints (no empty
  // frame); the seek below is a passive effect and always comes after it
  useLayoutEffect(() => {
    figure.mount(host.current!);
    return () => figure.dispose();
  }, [figure]);

  const { key, index, sectionKey, step } = beat;
  useEffect(() => {
    let current = true; // only the latest seek's answer is shown
    new Promise<string | void>((resolve) => resolve(figure.seek({ key, index, sectionKey, step }))).then(
      (answer) => {
        if (current) setSaid(typeof answer === 'string' && answer !== '' ? answer : null);
      },
      () => {
        if (current) setSaid(UNREACHED);
      },
    );
    return () => {
      current = false;
    };
  }, [figure, key, index, sectionKey, step]);

  return (
    <>
      {/* the figure's own element: React renders nothing inside it */}
      <div className="scrolly-figure" ref={host} />
      {said === null ? null : (
        <p className="scrolly-figure-said" role="status">
          {said}
        </p>
      )}
    </>
  );
}
