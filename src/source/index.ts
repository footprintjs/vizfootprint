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
export { SOURCE_FORMATS, SOURCE_VIAS, SOURCE_REFUSALS, CAPABILITY_REFUSALS, SourceRefusal, isSourceRefusal, isUnchanged } from './types.js';
export type { SourceFormat, SourceVia, SourceRefusalReason, SourceDecl, SourceCapabilities, SnapshotOptions, SourceSnapshot, SourceUnchanged, SourceHandle, SourceAdapter, SourceInfo, SourceRejection } from './types.js';
export { decodeRows } from './decode.js';
export { inlineSource, inlineVersion } from './inline.js';
export { httpSource } from './http.js';
export type { HttpSourceOptions } from './http.js';
export { openSource } from './open.js';
export { fnv1a } from './hash.js';
// WHY from data/: the delta is the shape the data port's `replaceRows` answers, so its owner is the folder that owns the port (`../data/delta.ts`); this barrel keeps naming it
export { deltaByKey, DELTA_SAMPLE } from '../data/delta.js';
export type { RefreshDelta } from '../data/delta.js';
