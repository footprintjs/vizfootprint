/**
 * THE DASHBOARD PAGE — one HTML file, one lens, and a desk inside it.
 *
 * This is {@link StoryPage}'s sibling and deliberately its smaller half. Both
 * open the same way — the payload block, the host's `open`, then the ONE boot
 * sequence in `boot.ts` (pictures, log, bookmarks) — and both have the same
 * three honest states. They differ in exactly two things:
 *
 *   • **which lens mounts.** A story page has two (the scroll lens and the
 *     cockpit) and a door between them, because a story is something a reader
 *     walks through before they act. A dashboard page has one: the desk. There
 *     is nothing to fork FROM, so there is no door and no path line.
 *   • **whether there are bookmarks.** A story IS its beats — a page with none
 *     is a story with nothing in it. A dashboard published straight out of an
 *     authoring wizard may honestly have none yet, so this page says how many
 *     came back and does not treat zero as a fault.
 *
 * What it does NOT know is what the other page does not know either: how to
 * build a dashboard (`open` is the host's — its def may carry analysis modules,
 * which are code) and what a chart looks like (`desk` is the host's, because
 * that is the one thing the host actually knows).
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { bootSession, type PageLens, type SessionBoot, type StoryFront, type StoryPageOpen } from './boot.js';
import { frontMatterLine } from './front.js';
import { readStoryPayload } from './payload.js';

export interface DashboardPageProps<Data = unknown> {
  /** Turn this page's payload into a live session. The host's, because its def is code — or, when the def is data, because only the host knows how to read the slot it rode in. */
  readonly open: StoryPageOpen<Data>;
  /** The desk, over the session this page booted. */
  readonly desk: (lens: PageLens) => ReactNode;
  readonly className?: string;
}

export function DashboardPage<Data = unknown>({ open, desk, className }: DashboardPageProps<Data>): JSX.Element {
  const [boot, setBoot] = useState<SessionBoot | null>(null);
  // the props the boot runs with, read once — a re-render must not re-open a session
  const opened = useRef(open);
  opened.current = open;

  useEffect(() => {
    let live = true;
    void (async () => {
      const found = await readStoryPayload<Data>(document);
      // all-or-nothing, here too: a payload that cannot be read never reaches
      // `open`, so no session is built for a desk nobody can draw
      const result: SessionBoot = found.ok ? await bootSession<Data>(found.payload, opened.current, { payloadBytes: found.bytes }) : { ok: false, sentence: found.sentence };
      if (live) setBoot(result);
    })();
    return () => {
      live = false;
    };
  }, []);

  const wrap = (body: ReactNode): JSX.Element => (
    <div className={`vzf vzf-story-page${className === undefined ? '' : ' ' + className}`} data-vzf="dashboard-page">
      {body}
    </div>
  );

  if (boot === null) {
    return wrap(
      <p className="vzf-story-page-status" role="status" data-vzf="dashboard-page-reading">
        Replaying this page's acts onto its own charts — the desk appears when the last one has landed.
      </p>,
    );
  }
  if (!boot.ok) {
    return wrap(
      <p className="vzf-story-page-refusal" role="alert" data-vzf="dashboard-page-refused">
        {boot.sentence}
      </p>,
    );
  }
  return wrap(
    <>
      <DashboardFrontMatter front={boot.front} />
      <div className="vzf-story-page-explore" data-vzf="dashboard-page-desk">
        {desk({ view: boot.view, session: boot.session })}
      </div>
    </>,
  );
}

/**
 * THE FRONT MATTER — what this file is, measured rather than written down.
 *
 * The same line the story page prints, in the same words, from the same
 * function; the title is the one the payload was published WITH, because a
 * dashboard page has no post to take one from and inventing a headline here
 * would be this component naming somebody else's dashboard.
 */
function DashboardFrontMatter({ front }: { readonly front: StoryFront }): JSX.Element {
  return (
    <header className="vzf-story-front" data-vzf="dashboard-front">
      {front.title === undefined ? null : (
        <div className="vzf-story-front-row">
          <h1 className="vzf-story-front-title">{front.title}</h1>
        </div>
      )}
      <p className="vzf-story-front-line" data-vzf="dashboard-front-data">
        {frontMatterLine(front, 'bookmarks')}
      </p>
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
    </header>
  );
}
