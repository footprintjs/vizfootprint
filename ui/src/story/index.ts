/**
 * vizfootprint-ui/story — the story bridge: one lineage of a session told as
 * a storydeck post (Read / Scroll / Watch from one export). See ./README.md.
 */
export { toStory } from './toStory.js';
export type { StoryPost, StoryOptions, StoryBookmark, StoryStep, StoryWords, StorySection, StorySlide, StoryMeta, StoryRef, StoryRefAt, StoryDroppedRef, StoryDroppedReason } from './toStory.js';
// The one quiet line under a section: what its words cited and the story could not show.
// Pure data, so it stays on THIS door; the stage (`vizfootprint-ui/story/stage`) is the React half.
export { storyDroppedNote } from './droppedNote.js';
export type { StoryDroppedLike } from './droppedNote.js';
