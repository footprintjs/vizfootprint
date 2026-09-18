/**
 * vizfootprint/source — the data-source layer: a def's `source` (format, via,
 * at), the small SourceAdapter port, the inline and http carriers, and the
 * decoders.
 *
 * WHY `http` is HERE and `file` is not, which is Law 3 of PACKAGING.md applied
 * rather than a preference: a subpath is minted for a symbol whose PRESENCE on
 * the barrel would change what the barrel COSTS to load. `file.ts` imports
 * `node:fs/promises` — carrying it here would drag node into every browser
 * build that touches a data source, so it keeps its own door. `http.ts` imports
 * nothing but this folder's own decoder and hash, and reads the global `fetch`
 * at CALL time (see its options) — so importing it opens no socket and costs
 * the barrel nothing. It was left off by an earlier reading of this header,
 * which named both carriers together, and the omission meant no import path
 * reached a carrier that was written, tested and compiled.
 */
export { SOURCE_FORMATS, SOURCE_VIAS, SOURCE_REFUSALS, CAPABILITY_REFUSALS, RESOURCE_FORMATS, SourceRefusal, ResourceRefusal, isSourceRefusal, isResourceRefusal, isUnchanged } from './types.js';
export type { SourceFormat, SourceVia, SourceRefusalReason, SourceDecl, SourceCapabilities, SnapshotOptions, SourceSnapshot, SourceUnchanged, SourceHandle, SourceAdapter, SourceInfo, SourceRejection, ResourceFormat, ResourceDecl, ResourceSnapshot, ResourceSnapshotOptions, ResourceHandle, ResourceInfo, ResourceFoldOptions, ResourceFoldResult } from './types.js';
// a COMPUTATION declares where it may attach: the port, the three positions, residency derived from the declarations, and the check that falsifies a monotone claim (./fold/README.md)
export { FOLD_POSITIONS, declareFolds, residencyOf, foldOver, answersOf, falsifyMonotone } from './fold/index.js';
export type { FoldPosition, ResourceFold, DeclaredFold, FoldAnswer, FoldAnswerObserver, Residency, FoldRun, FoldEnd, FoldTap, FoldRejection, FoldOutcome, MonotoneCheck, MonotoneVerdict } from './fold/index.js';
// bytes may arrive PROGRESSIVELY: the report a host may ask for, and the one honest way to turn it into a fraction (./progress.ts)
export { progressFraction } from './progress.js';
export type { ResourceProgress, ResourceProgressObserver } from './progress.js';
// the resource shapes' own helpers: what a body's SIZE is, what identifies it, and the facts row a reader gets instead of the payload (./resource.ts)
export { utf8Bytes, resourceBytes, resourceHash, resourceInfoOf, resourceSnapshotOf, resourceVersionsOf, resourceWhere } from './resource.js';
export type { ResourceBody } from './resource.js';
export { decodeRows } from './decode.js';
export { inlineSource, inlineVersion, inlineResource } from './inline.js';
export { httpSource } from './http.js';
export type { HttpSourceOptions } from './http.js';
export { openSource, openResource, foldResource } from './open.js';
export { fnv1a, fnv1aBytes, fnv1aFold } from './hash.js';
export type { Fnv1aFold } from './hash.js';
// WHY from data/: the delta is the shape the data port's `replaceRows` answers, so its owner is the folder that owns the port (`../data/delta.ts`); this barrel keeps naming it
export { deltaByKey, DELTA_SAMPLE } from '../data/delta.js';
export type { RefreshDelta } from '../data/delta.js';
