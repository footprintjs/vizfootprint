export {
  createSessionView,
  sessionSource,
  pollingSource,
  mapPollState,
  mapSaved,
  summarizeAdopt,
  LAYOUT_DASHBOARD_VIEW_ID,
} from './sessionView.js';
export type {
  SessionView,
  DescribeOutcome,
  ApplySavedOutcome,
  SessionViewSource,
  SessionSourceInput,
  PollSourceInput,
  PollEndpoints,
  SessionViewOptions,
  SessionLike,
  RawPollState,
  RawPollPaths,
  RawPath,
  RawAdoptResult,
  RawChart, LinkEdit } from './sessionView.js';

export { mapCompareResult, entryLabel, entryDetail } from './compareView.js';
export type { RawCompareResult } from './compareView.js';

export { useSessionView } from './useSessionView.js';

// Layers (protocol 1.2): the ONE door for a layer's rows — a host never hand-rolls the query
export { layerRowsFor } from './layerRows.js';
export type { LayerRowsSessionLike, LayerRowsWindow } from './layerRows.js';

export {
  pathToRoot,
  activePath,
  stepBackTarget,
  stepForwardTarget,
  layoutBranches,
} from './stepNav.js';
export type { StepNode, BranchLayout, LaidOutNode, LaidOutEdge } from './stepNav.js';

export { HONESTY_LINE, HIDDEN_NOT_ERASED, emptyState, emptyPaths, defaultLayout, parseLayout } from './types.js';
export type {
  AdoptSummaryView,
  SessionViewState,
  CommitView,
  ViewView,
  LayerView,
  ColumnView,
  SelectionView,
  BranchView,
  PathView,
  PathEventView,
  PathsView,
  CompareView,
  CompareSideView,
  CompareEntryView,
  CompareChangeView,
  BookmarkView,
  LedgerView,
  LedgerStep,
  GapView,
  ReadinessView,
  ViewEncoding,
  ChartCellView,
  LayoutPreset,
  LayoutView,
  LayoutChange,
  Actor,
  SavedSelectionView,
  SavedClauseView,
  LinkGraphView, LinkEdgeView, FitView, RuleLineView, EffectiveEncodingView, ProseStatusView, ProseRefView, ProposalView,
  // The two RECORDS that hold the prose views above: the dashboard's own words and one note's.
  // A consumer drawing either had `ProseStatusView` and no name for the thing carrying it, and
  // reached around the barrel for it (PACKAGING.md, Law 2 — widen the barrel the symbol belongs to).
  DashboardWordsView, NoteView } from './types.js';
