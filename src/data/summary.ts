import { listProfileOperations } from './profile/operations.js';
import type { ProfileOperationSummary } from './profile/operations.types.js';
import type { ProfileResult } from './profile/types.js';
import type { GroupProfileResult } from './profile/groups.types.js';
import { summarizeProfileResult, type ProfileResultSummary, type ProfileSummaryOptions } from './profile/summary.js';
import { declaration, invalid, record } from './profile/validate.js';
import { RANK_OPERATION } from './rank/semantics.js';
import { summarizeRankResult, type RankResultSummary, type RankSummaryOptions } from './rank/summary.js';
import type { RankResult } from './rank/types.js';

export type DataOperationSummary = ProfileOperationSummary | typeof RANK_OPERATION;
export type DataResult = ProfileResult | GroupProfileResult | RankResult;
export type DataResultSummary = ProfileResultSummary | RankResultSummary;
export type DataSummaryOptions = ProfileSummaryOptions | RankSummaryOptions;
const OPERATIONS = Object.freeze([...listProfileOperations(), RANK_OPERATION]);

/** Additive discovery for implemented analytical operations. Existing profile-only APIs keep their contracts. */
export function listDataOperations(): readonly DataOperationSummary[] { return OPERATIONS; }

export function summarizeDataResult(result: RankResult, options?: RankSummaryOptions): RankResultSummary;
export function summarizeDataResult(result: ProfileResult | GroupProfileResult, options?: ProfileSummaryOptions): ProfileResultSummary;
export function summarizeDataResult(result: DataResult, options?: DataSummaryOptions): DataResultSummary;
/** Dispatch to the existing receipt-specific projections; never execute, store or authenticate data. */
export function summarizeDataResult(result: DataResult, options: DataSummaryOptions = {}): DataResultSummary {
  // Inspect the discriminant without invoking a caller getter; each projection owns receipt validation.
  const kind = result && Object.getOwnPropertyDescriptor(result, 'kind');
  if (!kind || !('value' in kind)) invalid('Analytical result requires an own kind value');
  if (kind.value === 'rank') return summarizeRankResult(result as RankResult, options);
  if (kind.value !== 'profile' && kind.value !== 'group-profile') invalid('Unsupported analytical result kind');
  record(declaration(options), ['fields', 'groupOffset', 'groupLimit', 'frequencyLimit', 'maxCharacters'], 'profile summary options');
  return summarizeProfileResult(result as ProfileResult | GroupProfileResult, options);
}
