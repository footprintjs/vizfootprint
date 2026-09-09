/**
 * `vizfootprint-studio/make` — the wizard, and the pure logic under it.
 *
 * Mount `Make` and a person with a spreadsheet ends, in four steps, with a desk
 * whose first commit is theirs — and one HTML file they can send. That is the
 * whole product of this door.
 *
 * Everything else here is exported for the reason the desk exports its
 * projection: the four steps are a FLOW, and a flow that can only be driven by
 * a screen is a flow nobody can test, script or drive from an agent. So the
 * judge, the assembler, the ceiling and the build door are plain functions, and
 * the component is a caller of them like any other.
 *
 * See ./README.md for the argument, and `../desk/` for what step four opens.
 */
export { Make } from './Make.js';
export type { MakeProps } from './Make.js';
export { MadePage } from './MadePage.js';
export type { MadePageProps } from './MadePage.js';

// ── the four steps, without a screen ──
export {
  MAKE_TABLE,
  MAKE_STEPS,
  MAKE_ANALYSIS_ID,
  MAKE_CHART_KINDS,
  MAKE_CHART_KIND_NAMES,
  MAKE_ANALYSES,
  MAKE_CEILING_SENTENCE,
  MAKE_PROPOSALS,
  MAKE_PROPOSAL_KINDS,
  MEASURED_FINE_ROWS,
  MEASURED_BREAKS_ROWS,
  ceilingVerdict,
  readTable,
  seedColumns,
  sniffedTypes,
  declaredColumn,
  analysisOf,
  absenceOf,
  parseStates,
  emptyDraft,
  newView,
  fitColumns,
  fitsForView,
  proposalsFor,
  viewFromProposal,
  misfit,
  assembleDef,
  judgeStep,
} from './steps.js';
export type { CeilingVerdict, TableReading } from './steps.js';

// ── the door out: a definition becomes a desk ──
export { openDesk, buildRefusals } from './open.js';
export type { MadeDesk, OpenedDesk } from './open.js';

// ── the cells a made definition implies, and the plan they read ──
export { planFromDef, useMadeCells, intentFor, GESTURE_WORDS, MAKE_BAR_CAP, MAKE_TABLE_CAP } from './cells.js';
export type { MadePlan } from './cells.js';

// ── publishing: the page becomes a file, or is refused in a sentence ──
export { MADE_FILENAME, declaredTitle, downloadHtml, externalResources, madePayload, publishRefusal, publishedHtml } from './publish.js';
export type { MadePublish } from './publish.js';

// ── the three step panels, for a host that lays the flow out its own way ──
export { ColumnsStep, DataStep, ViewsStep } from './panels.js';
export type { ColumnsStepProps, DataStepProps, ViewsStepProps } from './panels.js';

export type { MadeData, MakeAbsence, MakeAnalysis, MakeChartKind, MakeColumn, MakeDraft, MakeReading, MakeStepId, MakeView, StepVerdict } from './types.js';
