import type { ProfileColumn, ProfileQuantileMethod, ProfileSourceRef, ProfileStatistic } from './types.js';

/** Shared executable value lists: discovery must not advertise a different vocabulary. */
export const PROFILE_STATISTICS = Object.freeze([
  'sum', 'min', 'max', 'mean', 'stddevPopulation', 'stddevSample', 'median', 'p95',
] as const satisfies readonly ProfileStatistic[]);
export const PROFILE_QUANTILE_METHODS = Object.freeze([
  'nearest-rank', 'linear',
] as const satisfies readonly ProfileQuantileMethod[]);

export type ProfileOperationKind = 'profile' | 'group-profile';
export interface ProfileOperationSummary {
  readonly id: ProfileOperationKind;
  readonly title: string;
  readonly description: string;
}

/** A JSON Schema projection of the existing plan, not an expression grammar or executor. */
export interface ProfileOperationInputSchema {
  readonly type: 'object';
  readonly description: string;
  readonly additionalProperties: false;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
}

export interface ProfileOperationDescriptor {
  readonly definitionVersion: 1;
  readonly operation: ProfileOperationSummary;
  readonly source: ProfileSourceRef;
  readonly table: string;
  /** Grain of the source rows. Output grain is stated separately in ui.outputGrain. */
  readonly grain: string;
  readonly fields: readonly ProfileColumn[];
  readonly tool: {
    readonly name: 'profile_data' | 'profile_groups';
    readonly description: string;
    readonly inputSchema: ProfileOperationInputSchema;
  };
  readonly ui: {
    readonly title: string;
    readonly description: string;
    readonly inputGrain: string;
    readonly outputGrain: string;
    readonly notes: readonly string[];
  };
}
