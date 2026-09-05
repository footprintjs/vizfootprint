/**
 * THE SPINE, IN BEAT COORDINATES — the pure half of the stage.
 *
 * `toStory` lands every citation in the post's own coordinates (a section key,
 * a step within it). The scroll lens counts in BEATS: one flattened sequence
 * over every section's steps, which is what the reader scrolls through and what
 * an IntersectionObserver reports. These functions are the whole translation
 * between the two, and they are here rather than inside the component because
 * they are about the story and not about the screen — a component that computes
 * them inline is a component whose rules can only be tested by rendering.
 *
 * Nothing here reaches a session, a DOM node or a clock. Given a post, the
 * answers are the same every time.
 */
import type { StoryBookmark, StoryPost, StoryRef, StoryRefAt } from '../toStory.js';

/** Which section of the post carries this key, or -1 — the join `toStory` guarantees is unique on the spine. */
export function sectionIndexOf(post: StoryPost, sectionKey: string): number {
  return post.sections.findIndex((s) => s.key === sectionKey);
}

/**
 * The first beat of each section, given how many steps each section flattens
 * into. A section's beats are contiguous, so the first one is all a caller
 * needs to scroll to a section — and it is where a citation that names a
 * section (a bookmark, or the act of naming one) lands.
 */
export function firstBeatIndexes(stepCounts: readonly number[]): readonly number[] {
  const out: number[] = [];
  let at = 0;
  for (const count of stepCounts) {
    out.push(at);
    at += count;
  }
  return out;
}

/**
 * The commits a FORWARD step replays, in order, ending on the position the
 * bookmark names: the acts since the previous bookmark, then that position.
 *
 * There is nothing to tween — **the transition is the record**. The reader
 * watches the acts land one at a time because they are the acts that happened,
 * seeked one after another.
 *
 * The last step usually IS the named position (the bookmark's stretch ends
 * there), so the tail is deduplicated rather than seeked twice; a bookmark
 * whose position is the act of naming something has a step list that stops
 * short of it, and then the position is a real extra hop.
 */
export function replayPath(bookmark: StoryBookmark): readonly string[] {
  const out: string[] = [];
  for (const step of bookmark.steps) if (!out.includes(step.commitId)) out.push(step.commitId);
  if (!out.includes(bookmark.at)) out.push(bookmark.at);
  return out;
}

/** Where a citation puts the stage: the commit to seek and the beat to scroll to. */
export interface RefLanding {
  readonly commitId: string;
  readonly beat: number;
}

/**
 * Land a citation in beat coordinates — the commit it names (the step it landed
 * on, else the section's own position) and the beat that tells it.
 *
 * `undefined` is the honest answer whenever the post cannot place it: a section
 * it does not tell, a step it does not have, a beat map that does not reach
 * that section. A post read off a wire is data, and data can be wrong; the
 * caller's job is then to say so, not to send a reader somewhere arbitrary.
 *
 * Both halves are answered TOGETHER on purpose: a caller that resolved the
 * commit and the beat separately would have two ways to fail and one branch to
 * test them with.
 */
export function landRef(post: StoryPost, at: StoryRefAt, firstBeat: readonly number[]): RefLanding | undefined {
  const index = sectionIndexOf(post, at.section);
  const bookmark = post.bookmarks[index];
  const beat = firstBeat[index];
  if (bookmark === undefined || beat === undefined) return undefined;
  const commitId = at.step === undefined ? bookmark.at : bookmark.steps[at.step]?.commitId;
  return commitId === undefined ? undefined : { commitId, beat };
}

/**
 * What an anchor calls the thing it cites: the words the writer typed, else the
 * id itself. Never nothing — a ref that names no target at all is data this
 * story cannot read, and an anchor that says "" is at least honest about that.
 */
export function refName(ref: StoryRef): string {
  return ref.label ?? ref.commit ?? ref.bookmark ?? ref.saved ?? '';
}

/**
 * The sentence a seek was REFUSED with, or null when it landed.
 *
 * The stage does not judge a position before it asks. The session judges, and
 * moves nothing when it refuses (`src/session/README.md`, law 1); the adapter
 * carries that answer out; this only reads it. A door that came back with
 * something these words cannot read is NOT a refusal — inventing one would put
 * words in the session's mouth, and the port's type already says what a seek
 * answers with.
 */
export function refusalOf(answer: unknown): string | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const said = answer as { readonly ok?: unknown; readonly sentence?: unknown };
  if (said.ok !== false) return null;
  return typeof said.sentence === 'string' ? said.sentence : 'the seek was refused and the session gave no reason';
}
