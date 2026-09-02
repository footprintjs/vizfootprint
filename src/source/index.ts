/**
 * vizfootprint/source — the data-source layer: a def's `source` (format, via,
 * at), the small SourceAdapter port, the inline carrier, and the decoders.
 * Carriers that need a runtime (file, http) are their own modules beside this
 * one, so the default entry never loads node or a socket.
 */
export { SOURCE_FORMATS, SOURCE_VIAS } from './types.js';
export type { SourceFormat, SourceVia, SourceDecl, SourceCapabilities, SnapshotOptions, SourceSnapshot, SourceHandle, SourceAdapter, SourceInfo, SourceRejection } from './types.js';
export { decodeRows } from './decode.js';
export { inlineSource, inlineVersion } from './inline.js';
export { openSource } from './open.js';
