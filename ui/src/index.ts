/**
 * vizfootprint-ui — the designed, reusable component library for vizfootprint.
 *
 * Layered, each module consumable alone:
 *   • tokens/   — the design-token + theme engine (scoped CSS variables).
 *   • adapter/  — `createSessionView`, the framework-light store every
 *                 component reads (over a live session OR a polled endpoint).
 *   • contract/ — the versioned, framework-agnostic RENDERER CONTRACT:
 *                 mount handshake + capabilities, RenderState with the
 *                 clause-addressable selection, the four outbound verbs,
 *                 `bindRenderer` guards, reference renderers, conformance kit.
 *   • primitives/ — the chart-building tier the first-party charts are BUILT
 *                 FROM (`<ChartFrame>`, scales, `<AxisLabel>`, the brush +
 *                 point-select gestures, selection consumption) — compose a
 *                 chart from these and it is born contract-conformant.
 *   • layout/   — `<VizCockpit>` shell + `<VizModal>` + `<VizPanel>`/`<VizCard>`.
 *   • charts/   — `<VizScatter>`, `<VizBar>`, `<VizLine>`, `<VizMap>`,
 *                 `<VizHistogram>`, `<EncodingPicker>` (axis affordance).
 *   • time/     — `<TimeTravelBar>` (explore/present) + `<BranchMap>`.
 *   • branches/ — `<BranchPill>`, `<PathsModal>`, `<CompareModal>`, `<ForkToast>`
 *                 (the NAMED-paths family over the adapter's BR-1 actions).
 *   • panels/   — `<CommitLog>`, `<FdrLedger>`, `<GapsPanel>`, `<ReadinessPanel>`.
 *   • sheet/    — `<Sheet>`, a read-only virtualized grid over a data
 *                 session, with its `SheetData` port and two adapters.
 *   • workbook/ — `<Workbook>`, the data layer's two tabs (Sources, Sheet).
 *
 * The stylesheet ships separately: `import 'vizfootprint-ui/styles.css'`.
 */

export * from './tokens/index.js';
export * from './adapter/index.js';
export * from './contract/index.js';
export * from './primitives/index.js';
export * from './layout/index.js';
export * from './charts/index.js';
export * from './time/index.js';
export * from './branches/index.js';
export * from './panels/index.js';
export * from './sources/index.js';
export * from './notes/index.js';
// the Sheet's PUBLIC surface: the renderer, the two adapters, the cache the
// grid composes, and the port's types. The pure helpers stay in
// `./sheet/index.js` for a host that builds its own renderer over the port.
export { Sheet } from './sheet/Sheet.js';
export type { SheetProps } from './sheet/Sheet.js';
export { sessionSheetData } from './sheet/sessionSheetData.js';
export type { SessionSheetOptions, SheetSessionLike } from './sheet/sessionSheetData.js';
export { httpSheetData } from './sheet/httpSheetData.js';
export type { FetchLike, HttpSheetOptions } from './sheet/httpSheetData.js';
export { createBlockCache } from './sheet/blockCache.js';
export type { BlockCache, BlockCacheOptions, BlockKeyParts, RangeFetch } from './sheet/blockCache.js';
export type { SheetCapabilities, SheetColumn, SheetData, SheetRefusal, SheetWindow, SheetWindowRequest } from './sheet/types.js';
export * from './workbook/index.js';
