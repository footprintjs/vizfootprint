/**
 * THE STAGE — a story's bookmarks as a scroll lens over ONE live session.
 *
 * `toStory` hands you a post whose figures are HTML strings; StoryDeck puts
 * those in a scaled canvas and the reader looks at a picture. This mounts the
 * REAL dashboard there instead — one session, the host's own charts bound to
 * it — and moves the session as the reader scrolls. A beat is a position on the
 * spine; when the active beat changes the stage seeks there.
 *
 * It is the JOIN, and the only place the two meet. StoryDeck (the scroll lens)
 * and vizfootprint (the session) never import each other: they meet through
 * StoryDeck's framework-neutral `StoryFigure` (`./storyFigure.ts`). The session
 * side is `sessionAsStoryFigure` (`./sessionAsStoryFigure.ts`) — the stage's
 * clock, its laws written there: `seek` is the only door, the session judges
 * and the figure carries the answer, only the latest move speaks. This file
 * adds what is React: the charts, drawn ONCE into the element the lens mounts
 * the figure into (a portal, so they keep the host's context), and the strip
 * under them.
 *
 * **The stage is read-only.** A reader's gesture on the figure must land no
 * commit. Every pointer and activation event is swallowed in the CAPTURE
 * phase, before the chart under it ever sees one, so the guarantee is in the
 * code rather than in a stylesheet a host can override. The cockpit's present
 * mode does NOT give this — it is CSS `pointer-events` plus a click/key pause,
 * which a pointer-driven brush can outrun — so this guard may not be
 * "simplified" away in favour of it. Hover is left alone on purpose: the
 * library does not record transient state, so a crosshair costs the trace
 * nothing.
 */
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ScrollyView, assemblePost } from 'storydeck';
import type { Section } from 'storydeck';
import { firstBeatIndexes, refName, sectionIndexOf, storyDroppedNote } from 'vizfootprint-ui/story';
import type { StoryBookmark, StoryPost, StoryRef, StoryRefAt, StorySection } from 'vizfootprint-ui/story';
import { sessionAsStoryFigure } from './sessionAsStoryFigure.js';
import type { StoryStageSession } from './sessionAsStoryFigure.js';
import { asScrollyFigure } from './scrollyFigure.js';
import type { StoryFigureBeat } from './storyFigure.js';

/** Enter and Space are the only keys that ACT; Tab, the arrows and Escape must keep working or the stage is a keyboard trap. */
const ACTIVATION_KEYS = new Set([' ', 'Enter']);

/** How long each intermediate commit is held while a forward step replays. */
const DEFAULT_DWELL_MS = 420;

export type { StoryStageSession };

export interface StoryStageProps {
  /** The story to tell — `toStory(state)`'s answer, plain data. */
  readonly post: StoryPost;
  /** The session it is told over. */
  readonly session: StoryStageSession;
  /**
   * The dashboard's real charts, bound to that session. Rendered ONCE and left
   * mounted for the whole scroll — the beats move the session under them, and a
   * chart that remounted every beat would lose its scales and flash.
   */
  readonly children: ReactNode;
  /** The dwell between the intermediate commits of a forward step, in ms (default 420). `0` lands on the beat with no replay. */
  readonly dwellMs?: number;
  /**
   * A DOOR on every beat — the host's own way out of the story at that moment
   * ("explore from here"), drawn in the strip under the figure.
   *
   * It sits OUTSIDE the read-only guard on purpose, and the two are not in
   * tension: the guard swallows gestures on the CHARTS, because a brush there
   * would author the story a reader came to read. A door is not a gesture on
   * the charts — it is the reader saying they would like to stop reading, and
   * where that leads is the host's to decide. A beat whose bookmark this story
   * does not carry gets no door rather than a broken one.
   */
  readonly beatDoor?: (bookmark: StoryBookmark) => ReactNode;
  /** What the stage says when a story has no bookmarks yet. */
  readonly emptyNote?: ReactNode;
  readonly className?: string;
}

export function StoryStage({ post, session, children, dwellMs = DEFAULT_DWELL_MS, beatDoor, emptyNote, className }: StoryStageProps): JSX.Element {
  // The assembled post: StoryDeck turns the body Markdown into per-section prose and joins the
  // slides by key. Rebuilt only when the post itself changes — a 1 Hz poll re-renders the host,
  // and re-rendering Markdown every second would be a new story every second.
  const assembled = useMemo(() => assemblePost({ meta: post.meta, sections: post.sections, bodyMd: post.bodyMd, deckSlides: post.deckSlides }), [post]);
  const firstBeats = useMemo(() => firstBeatIndexes(assembled.sections.map((s) => s.steps.length)), [assembled]);
  const root = useRef<HTMLDivElement | null>(null);
  /** The element the lens mounted the figure into — where the charts are drawn, once. */
  const [host, setHost] = useState<HTMLElement | null>(null);
  // ONE figure for the stage's life: a re-render retells it (the latest post and dwell) and it reads
  // the LATEST session through `current`, so a host that hands over a new session object (a poll that
  // rebuilds its view) moves the same figure rather than remounting the charts and losing the replay.
  const current = useRef(session);
  current.current = session;
  const figure = useMemo(
    () =>
      sessionAsStoryFigure(
        { getState: () => current.current.getState(), seek: (commitId) => current.current.seek(commitId) },
        (el) => {
          setHost(el);
          return () => setHost(null);
        },
        { post, firstBeats, dwellMs },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the telling is retold below on every render
    [],
  );
  figure.retell({ post, firstBeats, dwellMs });
  const now = useSyncExternalStore(figure.subscribe, figure.now);

  /** Put the reader's narrative on a beat, so the words follow the figure the citation just moved. */
  const scrollToBeat = useCallback((beatIndex: number): void => {
    const el = root.current?.querySelector(`.scrolly-beat[data-beat="${beatIndex}"]`);
    /* v8 ignore next -- the stage is mounted (the click came from inside it) and the beat exists (it was landed); this is the arm neither can produce */
    if (el === null || el === undefined) return;
    // jsdom has no scroller, and neither has a page that has not laid out yet — the seek still happened
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  /** A citation was clicked: go to the moment it names, and take the narrative with you. */
  const goToRef = useCallback(
    (ref: StoryRef, at: StoryRefAt): void => {
      const beat = figure.goToRef(ref, at);
      if (beat !== undefined) scrollToBeat(beat);
    },
    [figure, scrollToBeat],
  );

  // every section carries the SAME figure, so the lens mounts it once for the whole scroll
  const live = useMemo(() => asScrollyFigure(figure), [figure]);
  const sections: Section[] = useMemo(() => assembled.sections.map((section) => ({ ...section, figure: live })), [assembled, live]);

  if (sections.length === 0) {
    return (
      <div className={`vzf vzf-story-stage${className ? ' ' + className : ''}`} data-vzf="story-stage" ref={root}>
        <p className="vzf-story-empty" role="status">
          {emptyNote ?? 'No bookmarks named on this lineage yet — a story is the beats a person named, so there is nothing to scroll through.'}
        </p>
      </div>
    );
  }
  const index = now.beat === null ? -1 : sectionIndexOf(post, now.beat.sectionKey);
  const bookmark = post.bookmarks[index];
  return (
    <div className={`vzf vzf-story-stage${className ? ' ' + className : ''}`} data-vzf="story-stage" ref={root}>
      <ScrollyView sections={sections} />
      {host === null
        ? null
        : createPortal(
            <StageBeat
              beat={now.beat}
              section={post.sections[index]}
              door={beatDoor === undefined || bookmark === undefined ? null : beatDoor(bookmark)}
              said={now.said}
              onGoToRef={goToRef}
            >
              {children}
            </StageBeat>,
            host,
          )}
    </div>
  );
}

interface StageBeatProps {
  /** The beat the lens last asked the figure for — null in the moment between the mount and the first seek. */
  readonly beat: StoryFigureBeat | null;
  /** That beat's section, or undefined when there is no beat yet (or the post does not tell it). */
  readonly section: StorySection | undefined;
  /** The host's way out of the story at this beat, already drawn — `null` when there is none. */
  readonly door: ReactNode;
  /** The figure's answer to the latest citation the reader clicked — `null` when it landed or none was clicked. */
  readonly said: string | null;
  readonly onGoToRef: (ref: StoryRef, at: StoryRefAt) => void;
  readonly children: ReactNode;
}

/**
 * What the lens's element holds: the charts, inside the read-only guard, and
 * the strip under them. Drawn into ONE element for the whole scroll, so the
 * charts stay mounted while the beat changes under them.
 *
 * Under the charts goes the CITATION STRIP, and never the words themselves.
 * The scroll lens's own logic is that the prose lives in the flow and the
 * figure stays pinned, so the sentence belongs in the flow, once. What belongs
 * under the figure is what that sentence RESTS ON: each citation numbered and
 * named, each one an anchor that moves the story — and, in the same strip, what
 * the words cited and this story could not show. That is the honesty made
 * visible, and it costs the reader no repetition. A beat that cites nothing
 * shows nothing. (What a BEAT's seek answered is the lens's to print, under
 * all of this: the figure hands it back as the seek's answer.)
 */
function StageBeat({ beat, section, door, said, onGoToRef, children }: StageBeatProps): JSX.Element {
  const pause = (e: ReactPointerEvent | ReactMouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  const pauseKey = (e: ReactKeyboardEvent): void => {
    if (!ACTIVATION_KEYS.has(e.key)) return; // Tab / Shift+Tab / Escape / the arrows are never an act
    e.preventDefault();
    e.stopPropagation();
  };
  const cites = section?.refs ?? [];
  const dropped = storyDroppedNote(section?.dropped);
  const strip = [cites.length > 0, dropped !== undefined, said !== null, door !== null].some(Boolean);
  return (
    <figure className="vzf-story-figure" data-vzf="story-figure" data-beat={beat?.index}>
      <div
        className="vzf-story-charts"
        data-vzf="story-charts"
        data-readonly="true"
        onPointerDownCapture={pause}
        onMouseDownCapture={pause}
        onClickCapture={pause}
        onKeyDownCapture={pauseKey}
      >
        {children}
      </div>
      {strip ? (
        <figcaption className="vzf-story-caption" data-vzf="story-caption">
          {cites.length > 0 ? (
            <span className="vzf-story-cites" data-vzf="story-cites">
              <span className="vzf-story-cites-lead">this beat cites:</span>
              {cites.map((cite, i) => (
                <StoryCite key={i} n={i + 1} cite={cite} onGoToRef={onGoToRef} />
              ))}
            </span>
          ) : null}
          {dropped === undefined ? null : (
            <span className="vzf-story-dropped" title="citations these words made that this story could not show — carried on the post, never faked">
              {dropped}
            </span>
          )}
          {said === null ? null : (
            <span className="vzf-story-refusal" role="status">
              {said}
            </span>
          )}
          {door === null ? null : (
            <span className="vzf-story-door" data-vzf="story-door">
              {door}
            </span>
          )}
        </figcaption>
      ) : null}
    </figure>
  );
}

interface StoryCiteProps {
  readonly n: number;
  readonly cite: StoryRef;
  readonly onGoToRef: (ref: StoryRef, at: StoryRefAt) => void;
}

/**
 * One citation in the strip: its number, the words the library already names it
 * by (`refName` — the writer's own label, else the id), and, when the story
 * landed it, a click that moves the stage to where the claim stands.
 *
 * A citation the story landed NOWHERE keeps its name and gets no anchor. That
 * is a saved picture: dashboard-wide logic, standing at no moment on the spine,
 * so there is nowhere honest to send anyone and a link would only pretend.
 */
function StoryCite({ n, cite, onGoToRef }: StoryCiteProps): JSX.Element {
  const named = refName(cite);
  const at = cite.at;
  if (at === undefined) {
    return (
      <span className="vzf-story-cite vzf-story-cite-nowhere" title="cited, and it stands at no moment on this spine — a saved picture is logic, not a step">
        <span className="vzf-story-cite-n">{n}</span>
        {named}
      </span>
    );
  }
  const words = `go to where "${named}" stands in this story`;
  return (
    <button
      type="button"
      className="vzf-story-cite vzf-story-anchor"
      data-vzf-seek=""
      data-ref-commit={cite.commit}
      data-ref-bookmark={cite.bookmark}
      title={words}
      aria-label={words}
      onClick={() => onGoToRef(cite, at)}
    >
      <span className="vzf-story-cite-n">{n}</span>
      {named}
    </button>
  );
}
