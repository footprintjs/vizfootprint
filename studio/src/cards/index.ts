/**
 * `vizfootprint-studio/cards` — what a demo covers, read off the demo.
 *
 * The third program in this package, beside the desk that drives a definition
 * and the wizard that helps write one: the card a GALLERY puts on a demo, and
 * the filter that narrows a gallery to the demos carrying one feature.
 *
 * It is presentation over the library's own two readers and holds no knowledge
 * of its own. `defFeatures(dashboard)` says what a build can do;
 * `logFeatures(records)` says what somebody did; this door turns those into
 * chips, groups them by which reader vouched for them, and prints the one thing
 * neither can answer — which gesture produces which verb, and which verbs a
 * build leaves unwired — under a heading that says nobody derived it.
 *
 * ```tsx
 * import { DemoGallery } from 'vizfootprint-studio/cards';
 * import { defFeatures } from 'vizfootprint/def';
 * import { logFeatures } from 'vizfootprint/branches';
 *
 * <DemoGallery
 *   heading="What the demos cover"
 *   surfaces={[
 *     { demo: 'CDC NNDSS', surface: 'desk', declares: defFeatures(buildDashboard(nndssDef(tables, graph))), byHand: GESTURES },
 *     { demo: 'CDC NNDSS', surface: 'story page', declares: defFeatures(buildDashboard(nndssDef(tables))), walked: logFeatures(payload.log, payload) },
 *   ]}
 * />
 * ```
 *
 * ONE DEMO IS NOT ONE DASHBOARD, which is why that call passes two surfaces and
 * not one demo: the desk's definition has the graph and the story page's does
 * not, and a card that merged them would advertise a network view the page a
 * reader opens has never heard of. See ./README.md for the laws.
 */
export { DemoCard } from './DemoCard.js';
export type { DemoCardProps } from './DemoCard.js';
export { DemoGallery } from './DemoGallery.js';
export type { DemoGalleryProps } from './DemoGallery.js';

// ── the chips, without a screen: a card is data before it is a component ──
export { chipId, chipsOf, declaresChipsOf, groundSentenceOf, unseenOf, walkReadoutOf, walkedChipsOf, byHandChipsOf } from './chips.js';
export type { UnseenNote } from './chips.js';

// ── the filter, as plain functions — a host may narrow a gallery its own way ──
export { choicesOf, demosFor, holdsFeature, narrowRefusal, narrowTo } from './filter.js';

export type { ChipGround, DemoSurface, FeatureChip, FeatureChoice, GestureNote } from './types.js';
