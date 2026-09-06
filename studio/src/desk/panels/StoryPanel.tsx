/**
 * THE STORY TAB — not a report ABOUT the story; the story, told over the live
 * desk.
 *
 * `toStory` turns the named beats along the head's lineage into a post; the
 * stage pins the desk's own charts in place of the post's HTML figures and moves
 * the session from beat to beat as the reader scrolls. There is no `figure`
 * option on the post on purpose: a still of the same beat would only be a
 * second, staler answer to a question the live charts are already answering.
 *
 * The fallback words are the def's DECLARED ones, never the live caption — the
 * live words would misdate every earlier bookmark.
 */
import { useMemo, type ReactNode } from 'react';
import type { SessionViewState } from 'vizfootprint-ui';
import { toStory, type StoryPost } from 'vizfootprint-ui/story';
import { StoryStage } from 'vizfootprint-ui/story/stage';
import { FigureGrid, pickFigureCells } from '../figure.js';
import type { DeskChart, DeskStory } from '../types.js';

/** The post for this state — memoized, because a poll that changed nothing must not retell the story. */
export function useStoryPost(state: SessionViewState, story: DeskStory): StoryPost {
  const { declared, author, date } = story;
  return useMemo(
    () => toStory(state, { declared: declared ?? {}, author: author ?? 'the desk', date: date ?? new Date().toISOString().slice(0, 10) }),
    [state, declared, author, date],
  );
}

export function StoryPanel(props: {
  readonly post: StoryPost;
  /** The session the beats move — the same one the cockpit is bound to. */
  readonly session: React.ComponentProps<typeof StoryStage>['session'];
  readonly cells: readonly DeskChart[];
  readonly story: DeskStory;
}): ReactNode {
  const { post, session, cells, story } = props;
  const picked = pickFigureCells(cells, story.figure);
  return (
    <StoryStage post={post} session={session} {...(story.emptyNote !== undefined ? { emptyNote: story.emptyNote } : {})}>
      <FigureGrid {...picked} />
    </StoryStage>
  );
}
