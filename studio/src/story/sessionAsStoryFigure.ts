/**
 * A LIVE SESSION AS A STORY FIGURE — the stage's clock, with no framework and
 * no StoryDeck in it.
 *
 * The scroll lens drives a `StoryFigure` (`./storyFigure.ts`): it mounts it,
 * asks it to seek on every beat, and prints the sentence a seek answers with.
 * This turns a session into one. `mount` hands the element to the host's
 * `charts` (the app draws its real charts there, once); `seek` moves the
 * session to the position the beat names; `dispose` takes the charts down.
 *
 * **The transition is the record.** Moving forward one beat seeks through each
 * intermediate commit in order with a short dwell, so the acts land one at a
 * time in front of the reader, because those are the acts that happened.
 * Moving backwards, or jumping, is one seek to the target.
 *
 * The laws it is written to:
 *
 *   • **`seek` is the only door.** Every move is a `session.seek`; the figure
 *     never touches the log, never rebuilds a fold, and keeps no shadow copy of
 *     where the session is — only where IT put the session (`beatNow`).
 *   • **The session judges; the figure carries the answer.** A beat this
 *     session cannot reach resolves to the session's own sentence, and the lens
 *     prints it with nothing moved. The figure checks nothing beforehand: a
 *     check here would be a second implementation of a rule the library owns.
 *     `getState` is read only to PLAN a replay (a waypoint the session has lost
 *     is left out rather than asked for) — a plan, never a judgement.
 *   • **Only the latest move speaks.** A seek is asynchronous, so an older
 *     move's answer never writes over a newer one's: a superseded move resolves
 *     to nothing.
 *
 * A citation clicked inside the figure is a move of the figure's OWN, not a
 * beat the lens asked for, so its answer is the figure's to show: `now().said`,
 * which the host draws in the figure's caption. The read-only guard and the
 * caption are the host's (React, in `./StoryStage.tsx`); nothing here draws.
 */
import type { DescribeOutcome } from 'vizfootprint-ui';
import { landRef, refName, refusalOf, replayPath, sectionIndexOf } from 'vizfootprint-ui/story';
import type { StoryPost, StoryRef, StoryRefAt } from 'vizfootprint-ui/story';
import type { StoryFigure, StoryFigureBeat } from './storyFigure.js';

/**
 * The session a story is told over — narrowed to what the figure uses, which is
 * two things and no more: `seek`, the one door it drives, and `getState`, read
 * only to plan a replay. A `SessionView` (in-process or polled) satisfies it by
 * construction.
 */
export interface StoryStageSession {
  /** The normalized snapshot, for the one thing read off it: which commits are still there to replay through. */
  getState(): { readonly commits: readonly { readonly id: string }[] };
  /** Move the session to a commit, and say what it said — landed, or refused with the session's own sentence. */
  seek(commitId: string): Promise<DescribeOutcome> | DescribeOutcome;
}

/** What the figure is telling, and how. Replaced whole by `retell` whenever the host renders again. */
export interface StoryTelling {
  readonly post: StoryPost;
  /** The first beat of each section (`firstBeatIndexes` over the lens's step counts). */
  readonly firstBeats: readonly number[];
  /** The dwell between the intermediate commits of a forward step, in ms; `0` lands on the beat with no replay. */
  readonly dwellMs: number;
}

/** Draw the charts into the figure's element, and return how to take them down. */
export type StoryCharts = (el: HTMLElement) => () => void;

/** Where the figure stands — what a host drawing inside it reads. */
export interface StoryFigureNow {
  /** The element the lens mounted the figure into, or null while it is not mounted. */
  readonly host: HTMLElement | null;
  /** The beat the lens last asked for, or null before the first. */
  readonly beat: StoryFigureBeat | null;
  /** The answer to the latest citation the reader clicked (a beat's answer is the lens's to print), or null. */
  readonly said: string | null;
}

export interface SessionStoryFigure extends StoryFigure {
  /** Tell the figure what it is telling now — the latest post and dwell, read by every move after this. */
  retell(telling: StoryTelling): void;
  /** A citation was clicked: move to the moment it names. Answers the beat that tells it (to bring into view), or undefined when nothing moved. */
  goToRef(ref: StoryRef, at: StoryRefAt): number | undefined;
  /** The current {@link StoryFigureNow} — a new object only when something changed. */
  now(): StoryFigureNow;
  /** Be told when {@link now} changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** What the figure says when the session never answered a seek at all. */
export const SEEK_UNREACHED = 'the seek did not reach the session';

export function sessionAsStoryFigure(session: StoryStageSession, charts: StoryCharts, telling: StoryTelling): SessionStoryFigure {
  let told = telling;
  let current: StoryFigureNow = { host: null, beat: null, said: null };
  const listeners = new Set<() => void>();
  const show = (next: Partial<StoryFigureNow>): void => {
    current = { ...current, ...next };
    for (const listener of listeners) listener();
  };

  let takeDown: (() => void) | null = null;
  /** The beat the figure moved the session to — its own memory of where it put the session, never a second copy of the session's state. */
  let beatNow: number | null = null;
  /** A beat whose arrival a citation has already satisfied: the scroll that follows must not seek again. */
  let settled: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Which move is current. */
  let move = 0;
  /** Settles the move in flight with nothing — a move cut short answers nothing, so nobody waits for it forever. */
  let cutShort: (() => void) | null = null;

  const stop = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    cutShort?.();
    cutShort = null;
  };

  /**
   * Seek the plan, one commit at a time, holding each for the dwell — the acts
   * as they happened. Answers the LAST hop's refusal (null when it landed), or
   * `undefined` when a newer move took over: only the beat the reader is
   * standing on gets a sentence.
   */
  const play = (plan: readonly string[]): Promise<string | null | undefined> => {
    stop();
    const mine = ++move;
    return new Promise((resolve) => {
      // a newer move (or dispose) settles this one with nothing, even while its last seek is still
      // unanswered — a session that never answers must not leave a caller waiting forever
      const cut = (): void => resolve(undefined);
      cutShort = cut;
      const settle = (said: string | null | undefined): void => {
        resolve(said); // a no-op when `cut` already settled it
        if (cutShort === cut) cutShort = null;
      };
      const hop = (i: number): void => {
        let answer: ReturnType<StoryStageSession['seek']> | Promise<never>;
        try {
          answer = session.seek(plan[i]!);
        } catch (thrown) {
          answer = Promise.reject(thrown); // a seek that throws is a seek that did not reach the session
        }
        if (i + 1 < plan.length) {
          timer = setTimeout(() => hop(i + 1), told.dwellMs);
          return;
        }
        timer = null;
        void Promise.resolve(answer).then(
          (said) => settle(move === mine ? refusalOf(said) : undefined),
          () => settle(move === mine ? SEEK_UNREACHED : undefined),
        );
      };
      hop(0);
    });
  };

  /** Is that commit still on the session? Asked only to PLAN a replay — never to judge a beat. */
  const stillHeld = (commitId: string): boolean => session.getState().commits.some((c) => c.id === commitId);

  /** A newer move answered: the caption's answer to an older citation no longer stands. */
  const supersedeSaid = (): void => {
    if (current.said !== null) show({ said: null });
  };

  return {
    mount(el) {
      takeDown = charts(el);
      show({ host: el });
    },

    /**
     * The reader arrived at a beat. A forward step of one replays its acts;
     * anything else is one seek to the position the beat names. Whether that
     * position can be reached is the session's answer, not a question asked here.
     */
    async seek(beat) {
      const from = beatNow;
      beatNow = beat.index;
      show({ beat });
      if (settled === beat.index) {
        settled = null; // a citation put us here already
        return;
      }
      settled = null;
      const bookmark = told.post.bookmarks[sectionIndexOf(told.post, beat.sectionKey)];
      if (bookmark === undefined) {
        // a fact about the POST, not about the session — so it is the figure's to say
        supersedeSaid();
        return `this beat names a section ("${beat.sectionKey}") the story does not tell — nothing moved`;
      }
      const forward = from !== null && beat.index === from + 1 && told.dwellMs > 0;
      // the waypoints are the story's to plan; the destination is always the last hop, and always the session's to judge
      const waypoints = forward ? replayPath(bookmark).slice(0, -1).filter(stillHeld) : [];
      const said = await play([...waypoints, bookmark.at]);
      if (said === undefined) return; // a newer move took over; it will speak
      supersedeSaid();
      return said ?? undefined;
    },

    dispose() {
      stop();
      move += 1; // an answer still in flight belongs to a figure that is gone
      takeDown?.();
      takeDown = null;
      beatNow = null;
      settled = null;
      show({ host: null, beat: null, said: null });
    },

    retell(next) {
      told = next;
    },

    goToRef(ref, at) {
      const landing = landRef(told.post, at, told.firstBeats);
      if (landing === undefined) {
        // again a fact about the POST: this story does not tell the place the citation names
        show({ said: `"${refName(ref)}" is cited at a part of this story that is not here — nothing moved` });
        return undefined;
      }
      if (landing.beat !== beatNow) settled = landing.beat; // the scroll that follows will arrive there; it must not seek again
      void play([landing.commitId]).then((said) => {
        if (said !== undefined) show({ said });
      });
      return landing.beat;
    },

    now: () => current,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
