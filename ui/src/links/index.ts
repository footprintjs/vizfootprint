/**
 * `vizfootprint-ui/links` — the link matrix, as its own entry point. Import
 * from here to edit or show the link graph; the cockpit and charts never pull
 * this in.
 */
export { LinkMatrix, edgeAt, cellOf, LINK_RESPONSES, ENCODING_RESPONSES, responsesFor } from './LinkMatrix.js';
export type { LinkMatrixProps, LinkResponse } from './LinkMatrix.js';
export type { LinkEdgeView, LinkGraphView } from '../adapter/types.js';
