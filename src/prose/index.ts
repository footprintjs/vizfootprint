/**
 * vizfootprint/prose — the prose plane: a view's words as declared data with
 * an author, a level of claim, and a basis; one validator behind three doors;
 * staleness derived at read. See ./README.md.
 */
export { DASHBOARD_PROSE_ID, NOTE_PROSE_PREFIX, isNoteSubject, PROSE_SLOTS, CLAIM_LEVELS, AUTHOR_KINDS, PROPOSAL_LANE } from './types.js';
export { mentionsToRefs } from './mentions.js';
export type { MentionWorld, Mentions, UnresolvedMention } from './mentions.js';
export type { ProseSlot, ClaimLevel, AuthorKind, ProseAuthor, ProseBasis, ProseRef, ProseRecord, ProseProposal, ProposalStatus, ProseDecl, ProseStatus, ProseProblem, ProseSurface } from './types.js';
export { PROSE_SENTENCES, fillProse } from './sentences.js';
export { validateProseRecord, validateProseDecls, proseRefuses } from './validate.js';
export type { ProseWorld } from './validate.js';
export { proseStatus, constructionLine } from './status.js';
export type { ProseWorldNow } from './status.js';
