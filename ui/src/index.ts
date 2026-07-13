/**
 * vizfootprint-ui — the designed, reusable component library for vizfootprint.
 *
 * Layered, each module consumable alone:
 *   • tokens/   — the design-token + theme engine (scoped CSS variables).
 *   • adapter/  — `createSessionView`, the framework-light store every
 *                 component reads (over a live session OR a polled endpoint).
 *   • layout/   — `<VizCockpit>` shell + `<VizModal>` + `<VizPanel>`/`<VizCard>`.
 *   • charts/   — `<VizScatter>`, `<VizBar>`, `<EncodingPicker>` (axis affordance).
 *   • time/     — `<TimeTravelBar>` (explore/present) + `<BranchMap>`.
 *   • panels/   — `<CommitLog>`, `<FdrLedger>`, `<GapsPanel>`, `<ReadinessPanel>`.
 *
 * The stylesheet ships separately: `import 'vizfootprint-ui/styles.css'`.
 */

export * from './tokens/index.js';
export * from './adapter/index.js';
export * from './layout/index.js';
export * from './charts/index.js';
export * from './time/index.js';
export * from './panels/index.js';
