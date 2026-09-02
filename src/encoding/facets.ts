/**
 * Facet resolution — one column as the plane sees it: the provider's type,
 * plus what the def declared. The absence column is derived (role `absence`,
 * scale `discrete`, its vocabulary attached); every other role is stated or
 * absent — never guessed from a name or a value.
 */
import type { ColumnFacet, ColumnInfo, ColumnScale, ColumnType } from '../data/types.js';
import type { ColumnDecl } from './types.js';

export interface FacetSource {
  readonly columns?: Readonly<Record<string, ColumnDecl>>;
  readonly absence?: { readonly field: string; readonly states: readonly string[] };
}

/** The scale a type implies when the def stated none; `unknown` and `boolean`-free ambiguity stay undefined. */
export function scaleOfType(type: ColumnType): ColumnScale | undefined {
  switch (type) {
    case 'number':
    case 'date':
      return 'continuous';
    case 'string':
    case 'boolean':
      return 'discrete';
    default:
      return undefined;
  }
}

export function resolveFacets(cols: readonly ColumnInfo[], source: FacetSource = {}): ColumnFacet[] {
  return cols.map((c) => resolveFacet(c, source));
}

export function resolveFacet(col: ColumnInfo, source: FacetSource = {}): ColumnFacet {
  const decl = source.columns?.[col.name];
  const isAbsence = source.absence !== undefined && source.absence.field === col.name;
  const type = decl?.type ?? col.type; // a declared type wins: the def knows an ISO string is a date
  const role = isAbsence ? 'absence' : decl?.role;
  const scale = decl?.scale ?? (isAbsence ? 'discrete' : scaleOfType(type));
  return {
    field: col.name,
    type,
    ...(role !== undefined ? { role } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(isAbsence ? { absence: source.absence!.states } : {}),
    ...(decl?.label !== undefined ? { label: decl.label } : {}),
  };
}
