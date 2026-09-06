/**
 * `vizfootprint-studio/desk` — the installable cockpit.
 *
 * One component and its contract: hand it a session view and a function that
 * builds the cells, and you have a whole provenance dashboard — time travel,
 * named paths, the editor, notes, the honesty panels and the story — with your
 * own charts in it and no shell code of your own.
 *
 * See `../../README.md` for what a desk is and the law it keeps.
 */
export { Desk } from './Desk.js';
export { DeskFigure, FigureGrid, pickFigureCells, figureRefusal } from './figure.js';
export type { DeskFigureProps, FigureGridProps, FigurePick } from './figure.js';
export { DESK_TOKENS, deskTokenStyle, deskTokenVar, T as deskToken } from './tokens.js';
export type { DeskTokenName, DeskTokens } from './tokens.js';
export type {
  DeskAsideTab,
  DeskChart,
  DeskCharts,
  DeskData,
  DeskProjection,
  DeskProposal,
  DeskProposals,
  DeskProps,
  DeskSilence,
  DeskSilences,
  DeskStory,
} from './types.js';
