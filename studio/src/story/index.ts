/**
 * `vizfootprint-studio/story` — a story told over a LIVE session, in StoryDeck's
 * scroll lens.
 *
 * The app layer is where the two meet, and the only place: the component
 * library (`vizfootprint-ui`) imports no StoryDeck, StoryDeck imports no
 * vizfootprint, and they meet through StoryDeck's framework-neutral
 * `StoryFigure`. `sessionAsStoryFigure` is the session's side of that seam;
 * `StoryStage` joins it to the lens; `StoryPage` is the one-file page with the
 * stage and the cockpit over one session. See ./README.md.
 */
export { StoryStage } from './StoryStage.js';
export type { StoryStageProps } from './StoryStage.js';
export { StoryPage } from './StoryPage.js';
export type { StoryPageProps, StoryLens, StoryLensName } from './StoryPage.js';
export { sessionAsStoryFigure, SEEK_UNREACHED } from './sessionAsStoryFigure.js';
export type { SessionStoryFigure, StoryCharts, StoryFigureNow, StoryStageSession, StoryTelling } from './sessionAsStoryFigure.js';
