import type { Cell } from '../../derive/types.js';
import type { ProfileEvent, ProfileOptions, ProfilePlan, ProfileResult, ProfileSchema } from './types.js';

/** One shared lifecycle/row walk; consumers own only reduction state. Internal, not a second provider API. */
export type ProfileOperation = 'profile' | 'group-profile' | 'rank';
export type ScanEvent<O extends ProfileOperation> = Omit<ProfileEvent, 'operation'> & { readonly operation: O };
export type ScanOptions<O extends ProfileOperation> = Omit<ProfileOptions, 'onEvent'> & { readonly onEvent?: (event: ScanEvent<O>) => void };
export type ProfileReader = (field: string) => Cell;
export type ProfileReserve = (kind: 'exact' | 'frequency' | 'group-key', value: Cell) => void;
export interface ProfileConsumer<T> {
  /** Additional selected-row columns, beyond predicate reads and requested measures. */
  readonly reads: readonly string[];
  /** Optional identity validation over every source row, including predicate exclusions. */
  visit?(read: ProfileReader): void;
  push(read: ProfileReader): void;
  finish(): T;
}
export interface ScanSetup<T, O extends ProfileOperation> {
  readonly operation: O;
  readonly plan: ProfilePlan;
  readonly options: ScanOptions<O>;
  create(schema: ProfileSchema, reserve: ProfileReserve, resultRef: string): Omit<ProfileConsumer<T>, 'finish'> & { finish(): T | Promise<T> };
  /** Internal terminal receipt validation; failures must precede completed. */
  validateResult?(result: ProfileScanResult<T>): void;
}
export interface ProfileScanResult<T> extends Pick<ProfileResult, 'operationId' | 'resultRef' | 'schema' | 'population' | 'execution' | 'conventions'> {
  readonly value: T;
}
