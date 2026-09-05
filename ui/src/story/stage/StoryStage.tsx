/**
 * THE STAGE — a story's bookmarks as a scroll lens over ONE live session.
 *
 * `toStory` hands you a post whose figures are HTML strings; storydeck puts
 * those in a scaled canvas and the reader looks at a picture. This mounts the
 * REAL dashboard there instead — one session, the host's own charts bound to
 * it — and moves the session as the reader scrolls. A beat is a position on the
 * spine; when the active beat changes the stage seeks there.
 *
 * **The transition is the record.** Moving forward one beat seeks through each
 * intermediate commit in order with a short dwell, so the acts land one at a
 * time in front of the reader — the brush appears, the filter narrows, the
 * encoding changes — because those are the acts that happened. Moving
 * backwards, or jumping, is one seek to the target: there is nothing to tween,
 * and replaying a story backwards would be a story nobody told.
 *
 * Three rules the code is written to, each with its own reason:
 *
 *   • **The session is the state owner, and `seek` is the only door.** The stage
 *     never touches the log, never rebuilds a fold, and never keeps a shadow
 *     copy of where the session is. It asks the session to move, and shows what
 *     the session said.
 *   • **The session judges; the stage carries the answer.** A beat this session
 *     cannot reach is a REFUSAL, in the session's own sentence, under the
 *     figure, with nothing moved — because `seek` judges before it moves
 *     (`src/session/README.md`, law 1) and the adapter carries that answer out.
 *     The stage checks nothing beforehand: a check here would be a second
 *     implementation of a rule the library owns, and the two would drift.
 *   • **The stage is read-only.** A reader's gesture on the figure must land no
 *     commit. Every pointer and activation event is swallowed in the CAPTURE
 *     phase, before the chart under it ever sees one, so the guarantee is in
 *     the code rather than in a stylesheet a host can override. The cockpit's
 *     present mode does NOT give this — it is CSS `pointer-events` plus a
 *     click/key pause, which a pointer-driven brush can outrun — so this guard
 *     may not be "simplified" away in favour of it. Hover is left alone on
 *     purpose: this library does not record transient state, so a crosshair
 *     costs the trace nothing (`../../contract/README.md`, law 2).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { ScrollyView, assemblePost } from 'storydeck';
import type { ScrollyBeat, Section } from 'storydeck';
import type { DescribeOutcome } from '../../adapter/sessionView.js';
import { storyDroppedNote } from '../droppedNote.js';
import type { StoryPost, StoryRef, StoryRefAt, StorySection } from '../toStory.js';
import { firstBeatIndexes, landRef, refName, refusalOf, replayPath, sectionIndexOf } from './spine.js';

/** Enter and Space are the only keys that ACT; Tab, the arrows and Escape must keep working or the stage is a keyboard trap. */
const ACTIVATION_KEYS = new Set([' ', 'Enter']);

/** How long each intermediate commit is held while a forward step replays. */
const DEFAULT_DWELL_MS = 420;

/**
 * The session the stage tells the story over — narrowed to what it actually
 * uses, which is two things and no more.
 *
 * `seek` is the ONE door it drives: every move the stage makes is a seek, and
 * there is no second way it changes anything. It answers, and that answer is
 * the only judgement in this module — the session refuses a position it cannot
 * reach and moves nothing, and the stage prints what it said.
 *
 * `getState` is read for exactly one thing: PLANNING a replay. A forward step
 * walks the waypoints between two bookmarks, and a waypoint the session no
 * longer holds is left out of the plan rather than asked for. That is a plan,
 * not a judgement — it produces no sentence and refuses nothing.
 *
 * It is deliberately NOT `SessionLike` or an `InteractionSession`. The stage's
 * first real host has neither: its session lives in a server and the cockpit
 * holds a POLLED `SessionView`. A `SessionView` — over either source, in-process
 * or polled — satisfies this port by construction, which is the whole argument
 * for its shape: two doors, and the adapter's own normalization behind them.
 */
export interface StoryStageSession {
  /** The normalized snapshot, for the one thing the stage reads off it: which commits are still there to replay through. */
  getState(): { readonly commits: readonly { readonly id: string }[] };
  /** Move the session to a commit, and say what it said — landed, or refused with the session's own sentence. */
  seek(commitId: string): Promise<DescribeOutcome> | DescribeOutcome;
}

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
  /** What the stage says when a story has no bookmarks yet. */
  readonly emptyNote?: ReactNode;
  readonly className?: string;
}

export function StoryStage({ post, session, children, dwellMs = DEFAULT_DWELL_MS, emptyNote, className }: StoryStageProps): JSX.Element {
  // The assembled post: storydeck turns the body Markdown into per-section prose and joins the
  // slides by key. Rebuilt only when the post itself changes — a 1 Hz poll re-renders the host,
  // and re-rendering Markdown every second would be a new story every second.
  const assembled = useMemo(() => assemblePost({ meta: post.meta, sections: post.sections, bodyMd: post.bodyMd, deckSlides: post.deckSlides }), [post]);
  const beatOfSection = useMemo(() => firstBeatIndexes(assembled.sections.map((s) => s.steps.length)), [assembled]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  /** The beat the stage has moved to — the stage's own memory of where it put the session, never a second copy of the session's state. */
  const beatNow = useRef<number | null>(null);
  /** A beat whose arrival a citation has already satisfied: the anchor seeked, so the scroll that follows must not seek again. */
  const settled = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Which move is current. A seek is asynchronous, so an older move's answer must never write a sentence over a newer one's — the poll's own stale-response guard, one tier up. */
  const move = useRef(0);
  // Props, readable from the stable callbacks below without making them churn.
  const latest = useRef({ post, session, dwellMs, beatOfSection });
  latest.current = { post, session, dwellMs, beatOfSection };

  const stopReplay = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stopReplay, [stopReplay]);

  /**
   * Seek the plan, one commit at a time, holding each for the dwell — the acts
   * as they happened. Only the LAST hop's answer is shown: it is the beat the
   * reader is standing on, and a sentence about a waypoint would flash and be
   * overwritten by the next hop a moment later.
   */
  const play = useCallback(
    (plan: readonly string[]): void => {
      stopReplay();
      const mine = ++move.current;
      const hop = (i: number): void => {
        const answer = latest.current.session.seek(plan[i]!);
        if (i + 1 < plan.length) {
          timer.current = setTimeout(() => hop(i + 1), latest.current.dwellMs);
          return;
        }
        timer.current = null;
        void Promise.resolve(answer).then(
          (said) => { if (move.current === mine) setRefusal(refusalOf(said)); },
          () => { if (move.current === mine) setRefusal('the seek did not reach the session'); },
        );
      };
      hop(0);
    },
    [stopReplay],
  );

  /** Is that commit still on the session? Asked only to PLAN a replay — never to judge a beat. */
  const stillHeld = useCallback((commitId: string): boolean => latest.current.session.getState().commits.some((c) => c.id === commitId), []);

  /**
   * The reader arrived at a beat. A forward step of one replays its acts;
   * anything else is one seek to the position the beat names. Whether that
   * position can be reached is the session's answer, not a question asked here.
   */
  const arrive = useCallback(
    (beatIndex: number, sectionKey: string): void => {
      const { post: told } = latest.current;
      const from = beatNow.current;
      beatNow.current = beatIndex;
      if (settled.current === beatIndex) {
        settled.current = null; // a citation put us here already
        return;
      }
      settled.current = null;
      const bookmark = told.bookmarks[sectionIndexOf(told, sectionKey)];
      if (bookmark === undefined) {
        // a fact about the POST, not about the session — so it is the stage's to say
        setRefusal(`this beat names a section ("${sectionKey}") the story does not tell — nothing moved`);
        return;
      }
      const forward = from !== null && beatIndex === from + 1 && latest.current.dwellMs > 0;
      // the waypoints are the story's to plan (a moment the session has lost is left out rather
      // than asked for); the destination is always the last hop, and always the session's to judge
      const waypoints = forward ? replayPath(bookmark).slice(0, -1).filter(stillHeld) : [];
      play([...waypoints, bookmark.at]);
    },
    [play, stillHeld],
  );

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
      const { post: told, beatOfSection: firstBeat } = latest.current;
      const landing = landRef(told, at, firstBeat);
      if (landing === undefined) {
        // again a fact about the POST: this story does not tell the place the citation names
        setRefusal(`"${refName(ref)}" is cited at a part of this story that is not here — nothing moved`);
        return;
      }
      if (landing.beat !== beatNow.current) settled.current = landing.beat; // the scroll below will arrive there; it must not seek again
      play([landing.commitId]);
      scrollToBeat(landing.beat);
    },
    [play, scrollToBeat],
  );

  const sections: Section[] = useMemo(
    () =>
      assembled.sections.map((section, index) => ({
        ...section,
        figure: (beat: ScrollyBeat) => (
          <StageBeat beat={beat} section={post.sections[index]!} refusal={refusal} onArrive={arrive} onGoToRef={goToRef}>
            {children}
          </StageBeat>
        ),
      })),
    [assembled, post, refusal, arrive, goToRef, children],
  );

  if (sections.length === 0) {
    return (
      <div className={`vzf vzf-story-stage${className ? ' ' + className : ''}`} data-vzf="story-stage" ref={root}>
        <p className="vzf-story-empty" role="status">
          {emptyNote ?? 'No bookmarks named on this lineage yet — a story is the beats a person named, so there is nothing to scroll through.'}
        </p>
      </div>
    );
  }
  return (
    <div className={`vzf vzf-story-stage${className ? ' ' + className : ''}`} data-vzf="story-stage" ref={root}>
      <ScrollyView sections={sections} />
    </div>
  );
}

interface StageBeatProps {
  readonly beat: ScrollyBeat;
  readonly section: StorySection;
  readonly refusal: string | null;
  readonly onArrive: (beatIndex: number, sectionKey: string) => void;
  readonly onGoToRef: (ref: StoryRef, at: StoryRefAt) => void;
  readonly children: ReactNode;
}

/**
 * ONE mount for the whole scroll: storydeck renders the live figure without a
 * key, so this component stays put while the beat prop changes under it. The
 * effect is therefore the stage's clock — it fires on a beat change and on
 * nothing else, which is exactly when the session should move.
 *
 * Under the charts goes the CITATION STRIP, and never the words themselves.
 * The scroll lens's own logic is that the prose lives in the flow and the
 * figure stays pinned, so the sentence belongs in the flow, once. What belongs
 * under the figure is what that sentence RESTS ON: each citation numbered and
 * named, each one an anchor that moves the story — and, in the same strip, what
 * the words cited and this story could not show. That is the honesty made
 * visible, and it costs the reader no repetition. A beat that cites nothing
 * shows nothing.
 */
function StageBeat({ beat, section, refusal, onArrive, onGoToRef, children }: StageBeatProps): JSX.Element {
  useEffect(() => {
    onArrive(beat.index, beat.sectionKey);
  }, [beat.index, beat.sectionKey, onArrive]);

  const pause = (e: ReactPointerEvent | ReactMouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  const pauseKey = (e: ReactKeyboardEvent): void => {
    if (!ACTIVATION_KEYS.has(e.key)) return; // Tab / Shift+Tab / Escape / the arrows are never an act
    e.preventDefault();
    e.stopPropagation();
  };
  const cites = section.refs ?? [];
  const dropped = storyDroppedNote(section.dropped);
  const said = [cites.length > 0, dropped !== undefined, refusal !== null].some(Boolean);
  return (
    <figure className="vzf-story-figure" data-vzf="story-figure" data-beat={beat.index}>
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
      {said ? (
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
          {refusal === null ? null : (
            <span className="vzf-story-refusal" role="status">
              {refusal}
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
