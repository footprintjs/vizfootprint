import type { Cell, Expr } from '../../derive/types.js';
import type { ProfileEvent, ProfileFieldResult, ProfileLimits, ProfileOptions, ProfilePlan, ProfileResult } from './types.js';

export interface GroupProfileLimits extends ProfileLimits {
  readonly maxGroups?: number;
  /** Total group/field accumulator pairs, including fields requesting coverage only. */
  readonly maxGroupFields?: number;
}

/** Partition a selection and profile each partition. This does not materialize source rows. */
export interface GroupProfilePlan extends Omit<ProfilePlan, 'kind' | 'limits'> {
  readonly kind: 'group-profile';
  readonly groupBy: readonly string[];
  /** Null/undefined keys may form explicit groups or be excluded with coverage reported. */
  readonly unknownKeys: 'include' | 'exclude';
  readonly limits?: GroupProfileLimits;
}

export interface ProfileGroup {
  /** Index is local to this saved result, not an entity id stable across computations. */
  readonly ref: { readonly resultRef: string; readonly index: number };
  readonly keys: Readonly<Record<string, Cell>>;
  readonly rowCount: number;
  /** Original predicate AND exact group-key tests, using the existing Expr vocabulary. */
  readonly where: Expr;
  readonly fields: readonly ProfileFieldResult[];
}

export interface GroupProfileResult extends Omit<ProfileResult, 'kind' | 'plan' | 'fields' | 'population' | 'conventions'> {
  readonly kind: 'group-profile';
  readonly plan: GroupProfilePlan;
  readonly grain: { readonly kind: 'group'; readonly groupBy: readonly string[]; readonly sourceGrain: string };
  readonly groupOrder: 'first-seen';
  readonly groups: readonly ProfileGroup[];
  readonly conventions: Omit<ProfileResult['conventions'], 'statisticsPopulation'> & {
    readonly statisticsPopulation: 'known-selected-group-values';
  };
  readonly population: ProfileResult['population'] & {
    readonly grouped: number;
    readonly withUnknownKeys: number;
    readonly excludedUnknownKeys: number;
  };
}

export interface GroupProfileEvent extends Omit<ProfileEvent, 'operation'> { readonly operation: 'group-profile' }
export interface GroupProfileOptions extends Omit<ProfileOptions, 'onEvent'> {
  readonly onEvent?: (event: GroupProfileEvent) => void;
}
