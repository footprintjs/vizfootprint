/**
 * vizfootprint-ui/story/stage — the scroll lens over a LIVE session.
 *
 * Its own door, not part of `vizfootprint-ui/story`: that one is pure data (a
 * post a host can serialize anywhere) and this one is React plus storydeck.
 * Folding them together would make every host that exports a story pay for a
 * renderer it may never mount. See ./README.md.
 */
export { StoryStage } from './StoryStage.js';
export type { StoryStageProps, StoryStageSession } from './StoryStage.js';
// The beat coordinates the stage runs on — exported because a host that draws its own
// navigation (a jump list, a table of contents) needs the same translation, and a second
// spelling of it is a second answer to "which commit is that beat".
export { firstBeatIndexes, landRef, refName, refusalOf, replayPath, sectionIndexOf } from './spine.js';
export type { RefLanding } from './spine.js';
