/**
 * THE PAGE — one HTML file, two lenses, and a door on every beat.
 *
 * A host builds this into a single file: the engine, the charts and the scroll
 * lens are code and are bundled; the def is code too (its analyses have a
 * `run()`), so the host's own entry imports it; and everything else — the log,
 * the bookmarks, the saved pictures, the data — rides in a script block this
 * component reads back on load. Nothing is fetched, so it opens from `file://`.
 *
 * Three states, and only one of them shows a story. The shape is the demo's
 * front door's, for the same reason: **a page about a dashboard that says what
 * it knows must not itself imply something it does not know yet.** While the
 * replay is running it says so; when it is done it shows the story; and when
 * the payload cannot be replayed it shows the SESSION'S OWN refusal sentence
 * and no story at all — never an empty stage, which a reader would read as a
 * story with nothing in it rather than as a page that failed to open.
 *
 * ## Two lenses over ONE session
 *
 * The story lens is {@link StoryStage}: the reader scrolls, the session seeks,
 * the charts move, and every gesture on those charts is swallowed. The explore
 * lens is the host's cockpit over the same session, where gestures land.
 *
 * The door between them is **explore from here**, on every beat. It is one act
 * — `newPathAt(<the commit that beat names>)` — and that is what makes the two
 * lenses safe to put in one page: the reader's own acts extend a NEW named
 * path from the moment they were reading, so the author's lineage is never
 * added to. Switch back and the story is exactly the story that was published.
 * The session judges the door like every other act; a refusal is printed and
 * the lens does not change, because a page that switched anyway would be
 * showing a cockpit standing somewhere nobody agreed to.
 *
 * ## What this component does NOT know
 *
 * How to build a dashboard, and what a chart looks like. `open` is the host's
 * (only it can turn its own payload into a session), and `figure` and
 * `explore` are the host's too. A page component that guessed at either would
 * be guessing about the one thing the host actually knows.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSessionView } from '../../adapter/useSessionView.js';
import type { SessionView } from '../../adapter/sessionView.js';
import type { StoryOptions, StoryBookmark } from '../toStory.js';
import { StoryStage } from '../stage/StoryStage.js';
import { bootStory, type StoryBoot, type StoryFront, type StoryPageOpen, type StoryPageSession } from './boot.js';
import { readStoryPayload } from './payload.js';

/** Which lens the reader is looking through. */
export type StoryLensName = 'story' | 'explore';

/** What a host's renderer is handed: the live session, and the store every component reads. */
export interface StoryLens {
  readonly view: SessionView;
  readonly session: StoryPageSession;
  /** Which named path the reader is standing on — `null` before any act, and the author's until they open a door. */
  readonly path: string | null;
}

export interface StoryPageProps<Data = unknown> {
  /** Turn this page's payload into a live session. The host's, because its def is code. */
  readonly open: StoryPageOpen<Data>;
  /** The story lens's charts, bound to the session. */
  readonly figure: (lens: StoryLens) => ReactNode;
  /** The explore lens — the host's cockpit over the same session. */
  readonly explore: (lens: StoryLens) => ReactNode;
  /** How to tell the story: the DECLARED words, the author, the date, a named path. */
  readonly story?: StoryOptions;
  /** The stage's dwell between the acts of a forward step. */
  readonly dwellMs?: number;
  readonly className?: string;
}

export function StoryPage<Data = unknown>({ open, figure, explore, story, dwellMs, className }: StoryPageProps<Data>): JSX.Element {
  const [boot, setBoot] = useState<StoryBoot | null>(null);
  // the props the boot runs with, read once — a re-render must not re-open a session
  const opened = useRef({ open, story });
  opened.current = { open, story };

  useEffect(() => {
    let live = true;
    void (async () => {
      const { open: door, story: how } = opened.current;
      const found = await readStoryPayload<Data>(document);
      // the boot is all-or-nothing, and so is this: a payload that cannot be read
      // never reaches `open`, so no session is built for a story nobody can tell
      const result: StoryBoot = found.ok ? await bootStory<Data>(found.payload, door, { story: how, payloadBytes: found.bytes }) : { ok: false, sentence: found.sentence };
      if (live) setBoot(result);
    })();
    return () => {
      live = false;
    };
  }, []);

  const wrap = (body: ReactNode): JSX.Element => (
    <div className={`vzf vzf-story-page${className === undefined ? '' : ' ' + className}`} data-vzf="story-page">
      {body}
    </div>
  );

  if (boot === null) {
    return wrap(
      <p className="vzf-story-page-status" role="status" data-vzf="story-page-reading">
        Replaying this page's story onto its own charts — the way in appears when the last act has landed.
      </p>,
    );
  }
  if (!boot.ok) {
    return wrap(
      <p className="vzf-story-page-refusal" role="alert" data-vzf="story-page-refused">
        {boot.sentence}
      </p>,
    );
  }
  return wrap(<StoryPageDesk boot={boot} figure={figure} explore={explore} {...(dwellMs === undefined ? {} : { dwellMs })} />);
}

interface StoryPageDeskProps {
  readonly boot: StoryBoot & { readonly ok: true };
  readonly figure: (lens: StoryLens) => ReactNode;
  readonly explore: (lens: StoryLens) => ReactNode;
  readonly dwellMs?: number;
}

/**
 * The page once it has opened: the front matter, the lens toggle, and whichever
 * lens the reader chose — the charts mounted ONCE inside the story lens for the
 * same reason the stage mounts them once, and the cockpit mounted only while it
 * is being looked through.
 */
function StoryPageDesk({ boot, figure, explore, dwellMs }: StoryPageDeskProps): JSX.Element {
  const { view, session, post, front } = boot;
  const state = useSessionView(view);
  const [lens, setLens] = useState<StoryLensName>('story');
  const [refusal, setRefusal] = useState<string | null>(null);
  const lensProps: StoryLens = { view, session, path: state.paths.current };

  /**
   * The door. ONE act — a new named path at the moment the beat names — and the
   * session's answer decides whether the lens moves. A refused fork leaves the
   * reader in the story with the reason printed in the front matter, because a
   * cockpit opened anyway would be a desk standing somewhere nobody agreed to.
   */
  const exploreFrom = useCallback(
    (bookmark: StoryBookmark): void => {
      const forked = session.newPathAt(bookmark.at);
      if (!forked.ok) {
        setRefusal(forked.gap.detail ?? forked.gap.code);
        return;
      }
      setRefusal(null);
      setLens('explore');
      void view.refresh();
    },
    [session, view],
  );

  const beatDoor = useCallback(
    (bookmark: StoryBookmark): ReactNode => (
      <button type="button" className="vzf-story-explore" data-vzf="story-explore" onClick={() => exploreFrom(bookmark)} title={`fork a path of your own at “${bookmark.label}” and open the desk there`}>
        explore from here →
      </button>
    ),
    [exploreFrom],
  );

  return (
    <>
      <StoryFrontMatter front={front} title={post.meta.title} lens={lens} onLens={setLens} path={state.paths.current} refusal={refusal} />
      {lens === 'story' ? (
        <StoryStage post={post} session={view} beatDoor={beatDoor} {...(dwellMs === undefined ? {} : { dwellMs })}>
          {figure(lensProps)}
        </StoryStage>
      ) : (
        <div className="vzf-story-page-explore" data-vzf="story-page-explore">
          {explore(lensProps)}
        </div>
      )}
    </>
  );
}

interface StoryFrontMatterProps {
  readonly front: StoryFront;
  /** The story's own title — the dashboard's words, never a headline written here. */
  readonly title: string;
  readonly lens: StoryLensName;
  readonly onLens: (lens: StoryLensName) => void;
  readonly path: string | null;
  readonly refusal: string | null;
}

/**
 * THE FRONT MATTER — what this file is, measured rather than written down.
 *
 * Whether the data is in the file or fetched from somewhere; what it cost
 * either way; how many acts replayed and how many beats came back; what a
 * restore refused; and anything the host said it could not vouch for. A reader
 * who wants to know whether the page is self-contained can read it off the page.
 */
function StoryFrontMatter({ front, title, lens, onLens, path, refusal }: StoryFrontMatterProps): JSX.Element {
  const inline = front.data.via === 'inline';
  return (
    <header className="vzf-story-front" data-vzf="story-front">
      <div className="vzf-story-front-row">
        <h1 className="vzf-story-front-title">{title}</h1>
        <div className="vzf-story-lenses" role="group" aria-label="lens">
          {(['story', 'explore'] as const).map((name) => (
            <button key={name} type="button" className="vzf-story-lens" data-vzf={`story-lens-${name}`} aria-pressed={lens === name} onClick={() => onLens(name)}>
              {name === 'story' ? '📖 Story' : '🧭 Explore'}
            </button>
          ))}
        </div>
      </div>
      <p className="vzf-story-front-line" data-vzf="story-front-data">
        {inline ? 'This page carries its data' : `This page fetches its data from ${front.data.at ?? 'where the definition says'}`}
        {front.data.label === undefined ? '' : ` — ${front.data.label}`}
        {front.size === undefined ? '' : `, ${front.size} unpacked`}. Its payload is {front.payload} of this file. {String(front.landed)} acts replayed, {String(front.bookmarks)} beats
        named. Built {front.builtAt}.
      </p>
      {/* WHOSE lineage the reader's next act extends — printed only in the lens where a reader can
          act, because in the story lens the answer is always the same and always the author's. */}
      {lens === 'explore' ? (
        <p className="vzf-story-front-line" data-vzf="story-front-path">
          {path === null ? (
            'You are standing off any named path — the next act you make starts one of your own, never the author’s.'
          ) : (
            <>
              Your acts land on the path <b>{path}</b>, never on the author’s.
            </>
          )}
        </p>
      ) : null}
      {front.notes.map((note) => (
        <p className="vzf-story-front-note" key={note}>
          {note}
        </p>
      ))}
      {front.refused.map((line) => (
        <p className="vzf-story-front-refused" role="status" key={line}>
          {line}
        </p>
      ))}
      {refusal === null ? null : (
        <p className="vzf-story-front-refused" role="alert" data-vzf="story-front-refusal">
          {refusal}
        </p>
      )}
    </header>
  );
}
