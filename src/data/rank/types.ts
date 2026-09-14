import type { Expr } from '../../derive/types.js';
import type { ProfileEvent, ProfileOptions, ProfileProvider, ProfileSchema, ProfileSourceRef } from '../profile/types.js';

/** A bounded sort of existing numeric observations; it does not aggregate or infer a metric. */
export interface RankPlan {
  readonly kind: 'rank'; readonly version: 1; readonly ops: number;
  readonly source: ProfileSourceRef; readonly selectionRef: string; readonly where?: Expr;
  readonly keys: readonly string[]; readonly metric: string;
  readonly direction: 'asc' | 'desc'; readonly limit: number;
  readonly missing: 'exclude'; readonly ties: 'keys-ascending';
  readonly limits?: RankLimits;
}
export interface RankLimits {
  readonly maxScannedRows?: number; readonly maxRetainedRows?: number;
  readonly maxRetainedCharacters?: number; readonly maxResultBytes?: number;
}
export interface RankRow {
  /** Ordinal position, not dense/competition rank; equal values are ordered by complete keys. */
  readonly position: number; readonly value: number;
  readonly sourceRef: { readonly source: ProfileSourceRef; readonly table: string; readonly keys: Readonly<Record<string, string | number | boolean>> };
}
export interface RankResult {
  readonly kind: 'rank'; readonly version: 1; readonly operationId: string; readonly resultRef: string;
  readonly plan: RankPlan; readonly schema: ProfileSchema;
  readonly population: { readonly scanned: number; readonly selected: number; readonly excluded: number; readonly predicateUnknown: number; readonly known: number; readonly missing: number };
  readonly rows: readonly RankRow[]; readonly shown: number; readonly total: number; readonly complete: boolean;
  readonly execution: { readonly strategy: 'bounded-scan-then-provider-sort'; readonly exact: true; readonly passes: 1; readonly retainedValues: number; readonly retainedCharacters: number; readonly observerFailures: number; readonly elapsedMs: number };
  readonly conventions: { readonly population: 'provider-snapshot' | 'analysis-input'; readonly missing: 'exclude-null-or-undefined'; readonly invalid: 'refuse'; readonly ties: 'keys-ascending'; readonly position: 'ordinal'; readonly boundaryTies: 'may-be-split'; readonly authorization: 'host-owned-references' };
}
export interface RankEvent extends Omit<ProfileEvent, 'operation'> { readonly operation: 'rank' }
export interface RankOptions extends Omit<ProfileOptions, 'onEvent'> { readonly onEvent?: (event: RankEvent) => void }
export type RankProvider = ProfileProvider;
