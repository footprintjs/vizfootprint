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
