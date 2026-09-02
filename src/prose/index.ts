/**
 * vizfootprint/prose — the prose plane: a view's words as declared data with
 * an author, a level of claim, and a basis; one validator behind three doors;
 * staleness derived at read. See ./README.md.
 */
export { PROSE_SLOTS, CLAIM_LEVELS, AUTHOR_KINDS } from './types.js';
export type { ProseSlot, ClaimLevel, AuthorKind, ProseAuthor, ProseBasis, ProseRecord, ProseDecl, ProseStatus, ProseProblem, ProseSurface } from './types.js';
export { PROSE_SENTENCES, fillProse } from './sentences.js';
export { validateProseRecord, validateProseDecls, proseRefuses } from './validate.js';
export type { ProseWorld } from './validate.js';
export { proseStatus, constructionLine } from './status.js';
export type { ProseWorldNow } from './status.js';
