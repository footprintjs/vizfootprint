import type { ColumnInfo, ColumnRole, Row } from '../types.js';
import type { Expr } from '../../derive/types.js';

/** Source identity is supplied by the adapter; version identifies one immutable snapshot. */
export interface ProfileSourceRef { readonly id: string; readonly version: string }
export interface ProfileColumn extends ColumnInfo {
  readonly role: ColumnRole;
  readonly meaning: string;
  readonly unit?: string;
}
export interface ProfileSchema {
  readonly source: ProfileSourceRef;
  readonly table: string;
  /** What one input row represents. Counts remain row counts, never inferred distinct-entity counts. */
  readonly grain: string;
  readonly columns: readonly ProfileColumn[];
}
export type ProfileStatistic = 'sum' | 'min' | 'max' | 'mean' | 'stddevPopulation' | 'stddevSample' | 'median' | 'p95';
export type ProfileQuantileMethod = 'nearest-rank' | 'linear';
export interface ProfileFieldRequest {
  readonly field: string;
  readonly statistics?: readonly ProfileStatistic[];
  readonly frequencies?: boolean;
}
export interface ProfileLimits {
  readonly maxScannedRows?: number;
  readonly maxExactValues?: number;
  readonly maxDistinctValues?: number;
  /** Combined exact-buffer slots and distinct frequency keys across all fields. */
  readonly maxRetainedValues?: number;
  /** Combined UTF-16 characters in retained string frequency keys across all fields. */
  readonly maxRetainedCharacters?: number;
}
export interface ProfilePlan {
  readonly kind: 'profile';
  readonly version: 1;
  /** Existing Viz expression vocabulary version, including for the where expression. */
  readonly ops: number;
  readonly source: ProfileSourceRef;
  /** Caller-owned identity; the result also retains its actual predicate to prevent ambiguous scope. */
  readonly selectionRef: string;
  readonly where?: Expr;
  readonly fields: readonly ProfileFieldRequest[];
  /** Required when median or p95 is requested. linear is Hyndman–Fan type 7. */
  readonly quantileMethod?: ProfileQuantileMethod;
  readonly limits?: ProfileLimits;
}
/** Implementations must honor snapshot identity, projection, cancellation, and iterator cleanup. */
export interface ProfileProvider {
  describe(source: ProfileSourceRef, signal?: AbortSignal): ProfileSchema | Promise<ProfileSchema>;
  scan(source: ProfileSourceRef, columns: readonly string[], signal?: AbortSignal): Iterable<Row> | AsyncIterable<Row>;
}
export interface ProfileFrequency { readonly value: string | number | boolean; readonly count: number }
export interface ProfileFieldResult {
  readonly field: string;
  readonly type: ColumnInfo['type'];
  readonly role: ColumnRole;
  readonly meaning: string;
  readonly unit?: string;
  readonly known: number;
  readonly unknown: number;
  readonly statistics?: Partial<Readonly<Record<ProfileStatistic, number | null>>>;
  readonly frequencies?: readonly ProfileFrequency[];
}
export interface ProfileResult {
  readonly kind: 'profile';
  readonly version: 1;
  /** Assigned by the host. This function returns a receipt, not a persisted artifact store. */
  readonly resultRef: string;
  readonly operationId: string;
  readonly plan: ProfilePlan;
  readonly schema: ProfileSchema;
  readonly population: { readonly scanned: number; readonly selected: number; readonly excluded: number; readonly predicateUnknown: number };
  readonly fields: readonly ProfileFieldResult[];
  /** exact means unsampled population and exact quantile selection; arithmetic is IEEE 754. */
  readonly execution: { readonly strategy: 'stream'; readonly passes: 1; readonly exact: true;
    readonly retainedValues: number; readonly retainedCharacters: number;
    readonly observerFailures: number; readonly elapsedMs: number };
  readonly conventions: { readonly missing: 'null-or-undefined'; readonly invalid: 'refuse'; readonly predicate: 'only-true'; readonly statisticsPopulation: 'known-selected-values' };
}
export type ProfileEventStatus = 'started' | 'progress' | 'completed' | 'failed' | 'cancelled';
export interface ProfileEvent {
  readonly operationId: string;
  readonly operation: 'profile';
  readonly source: ProfileSourceRef;
  readonly selectionRef: string;
  readonly status: ProfileEventStatus;
  readonly scanned: number;
  readonly selected: number;
  readonly elapsedMs: number;
  readonly resultRef?: string;
  readonly error?: { readonly code: string; readonly message: string };
}
export interface ProfileOptions {
  readonly operationId: string;
  readonly resultRef: string;
  readonly signal?: AbortSignal;
  /** Synchronous observer. Throws and returned thenables count as observer failures.
   * Thenable rejections are consumed, never awaited. Dispatch asynchronous host work separately. */
  readonly onEvent?: (event: ProfileEvent) => void;
  readonly progressEvery?: number;
}
