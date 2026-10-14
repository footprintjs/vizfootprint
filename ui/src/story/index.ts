/**
 * vizfootprint-ui/story — the story bridge: one lineage of a session told as
 * a storydeck post (Read / Scroll / Watch from one export). See ./README.md.
 */
export { toStory } from './toStory.js';
export type { StoryPost, StoryOptions, StoryBookmark, StoryStep, StoryWords, StorySection, StorySlide, StoryMeta, StoryRef, StoryRefAt, StoryDroppedRef, StoryDroppedReason } from './toStory.js';
// The one quiet line under a section: what its words cited and the story could not show.
// Pure data, so it stays on THIS door; the stage that renders a post (`vizfootprint-studio/story`) is
// the app's, and this library imports no renderer for it (src/storydeckBoundary.test.ts).
export { storyDroppedNote } from './droppedNote.js';
export type { StoryDroppedLike } from './droppedNote.js';
// The beat coordinates a scroll lens runs on — exported because a host that draws its own
// navigation (a jump list, a table of contents) needs the same translation, and a second
// spelling of it is a second answer to "which commit is that beat". See ./spine.ts.
export { firstBeatIndexes, landRef, refName, refusalOf, replayPath, sectionIndexOf } from './spine.js';
export type { RefLanding } from './spine.js';
