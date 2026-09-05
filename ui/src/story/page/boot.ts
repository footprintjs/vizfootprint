/**
 * THE BOOT — a payload becomes a session, or nothing at all.
 *
 * A story page opens with no server behind it. Everything the dashboard was is
 * in the file, so the page has to put it back together in the right order and
 * in front of the reader: restore the saved pictures, replay the log, restore
 * the bookmarks, then tell the story from what came back.
 *
 * **The order is not a preference.** Saved pictures come FIRST because a
 * commit's words may cite one (`@[the coastal states]`), and the session judges
 * a citation against the pictures it holds — replay a log that cites a picture
 * that is not there yet and the replay refuses, correctly. Bookmarks come LAST
 * because a bookmark names a commit, and the session refuses to name one its
 * log does not hold.
 *
 * **All-or-nothing (`src/session/README.md`, law 1) governs the boot itself.**
 * A payload whose replay is refused leaves NO session on screen: the session
 * this boot opened is dropped unmounted, and the reader is shown the session's
 * own refusal sentence and no story. There is no half-built desk, and no empty
 * stage that looks like a story with no acts.
 *
 * What a restore REFUSED is not fatal and is not silent either: it rides out on
 * {@link StoryFront.refused}, in the library's own words, for the page to print
 * under its front matter. A bookmark that could not come back is a beat the
 * story does not tell, and a reader is owed the reason.
 *
 * Nothing here draws. Given a payload and a session, the answer is the same
 * every time — which is what lets it be tested without a screen.
 */
import type { CommitRecord } from 'vizfootprint/log';
import type { RestorableBookmark, RestorableSaved, ReplayResult, RestoreResult, NewPathResult } from 'vizfootprint/session';
import { createSessionView, sessionSource, type SessionLike, type SessionView } from '../../adapter/sessionView.js';
import { toStory, type StoryOptions, type StoryPost } from '../toStory.js';
import { formatBytes, type StoryPayload, type StoryDataNote } from './payload.js';

/**
 * The session a page boots — {@link SessionLike} (what the cockpit's adapter
 * drives) plus the three doors a page walks through on the way in.
 *
 * It is spelled as a port rather than as `InteractionSession` for the reason
 * the stage's own port is: a page is handed a session by its host, and the
 * narrowest true statement of what it does with one is the one that cannot go
 * stale. A real session satisfies it by construction.
 */
export interface StoryPageSession extends SessionLike {
  /** Law 6: replay a whole log into this session. A refusal moves nothing at all. */
  replay(log: readonly CommitRecord[] | string): Promise<ReplayResult>;
  /** Put the saved pictures back, whole records, before the log that cites them. */
  restoreSaved(list: readonly RestorableSaved[]): RestoreResult;
  /** Put the bookmarks back, whole records, after the log they name. */
  restoreBookmarks(list: readonly RestorableBookmark[]): RestoreResult;
  /** The door "explore from here" walks through, and the one that answers for it. */
  newPathAt(commitId: string, name?: string): NewPathResult;
}

/** What the page says about itself above the story — every number of it measured, none written down. */
export interface StoryFront {
  /** Where the data came from, as the payload states it. */
  readonly data: StoryDataNote;
  /** What the payload's data unpacks to, in a person's units — absent when the page carries none. */
  readonly size?: string;
  /** What the whole payload costs IN the file, in a person's units. */
  readonly payload: string;
  /** How many commits the replay landed. */
  readonly landed: number;
  /** How many bookmarks came back — the beats the story has. */
  readonly bookmarks: number;
  /** What a restore REFUSED, in the library's own words. Never empty by omission: a refusal is printed. */
  readonly refused: readonly string[];
  /** What the host said it could not vouch for, verbatim. */
  readonly notes: readonly string[];
  /** When the file was built. */
  readonly builtAt: string;
}

/** The boot's answer: a session and a story, or a sentence and nothing. */
export type StoryBoot =
  | { readonly ok: true; readonly session: StoryPageSession; readonly view: SessionView; readonly post: StoryPost; readonly front: StoryFront }
  | { readonly ok: false; readonly sentence: string };

/** How a host turns its payload's data into a live session — its def is code, so only it can. */
export type StoryPageOpen<Data> = (payload: StoryPayload<Data>) => StoryPageSession | Promise<StoryPageSession>;

/** What the boot needs beyond the payload and the door: how to tell the story, and what the page already measured about itself. */
export interface StoryBootOptions {
  /**
   * The payload's own byte count where it was read from — what this story costs
   * in the file.
   *
   * Required, and not defaulted: the front matter's whole job is to say what
   * this file is and what it costs, and a boot that was not told cannot say.
   * Nothing here can measure it either — only the reader of the block can — so
   * it is asked for rather than guessed at.
   */
  readonly payloadBytes: number;
  /** Passed to `toStory` — the DECLARED words, the author, the date, a named path. */
  readonly story?: StoryOptions;
}

/** One line per record a restore refused — what was named, and why it could not come back. */
const refusalLines = (what: string, result: RestoreResult): readonly string[] =>
  result.refused.map((r) => `${what} “${r.name}” did not come back: ${r.rejected}`);

/**
 * Open the payload into a live session and tell its story.
 *
 * The session is the host's to build (its def carries analysis modules, which
 * are code); everything after that is this function, in the one order that
 * works.
 */
export async function bootStory<Data>(payload: StoryPayload<Data>, open: StoryPageOpen<Data>, options: StoryBootOptions): Promise<StoryBoot> {
  let session: StoryPageSession;
  try {
    session = await open(payload);
  } catch (error) {
    return { ok: false, sentence: `this page could not build its dashboard — ${error instanceof Error ? error.message : String(error)}` };
  }

  // the pictures first: a commit's words may cite one, and the session judges that citation
  const pictures = session.restoreSaved(payload.saved ?? []);

  const replayed = await session.replay([...payload.log]);
  if (!replayed.ok) {
    // nothing is mounted: the session this boot opened is dropped here, unreferenced
    return { ok: false, sentence: `this page's story could not be replayed — ${replayed.gap.detail ?? replayed.gap.code}` };
  }

  // the bookmarks last: each names a commit, and the log now holds them
  const bookmarks = session.restoreBookmarks(payload.bookmarks);

  const view = createSessionView(sessionSource(session), { as: 'user' });
  await view.refresh();
  const post = toStory(view.getState(), options.story ?? {});

  return {
    ok: true,
    session,
    view,
    post,
    front: {
      data: payload.meta.data,
      ...(payload.data === undefined ? {} : { size: formatBytes(new TextEncoder().encode(JSON.stringify(payload.data)).length) }),
      payload: formatBytes(options.payloadBytes),
      landed: replayed.landed,
      bookmarks: bookmarks.restored.length,
      refused: [...refusalLines('the picture', pictures), ...refusalLines('the bookmark', bookmarks)],
      notes: payload.meta.notes ?? [],
      builtAt: payload.meta.builtAt,
    },
  };
}
