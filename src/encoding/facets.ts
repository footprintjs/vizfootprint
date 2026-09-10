/**
 * Facet resolution — one column as the plane sees it: the provider's type,
 * plus what the def declared. A STATE column is derived (role `absence`,
 * scale `discrete`, its own vocabulary attached); every other role is stated or
 * absent — never guessed from a name or a value.
 *
 * There may be MORE THAN ONE state column, because silence belongs to a column
 * and not to the row (`../data/silence.ts`): a `measurements` table declares one
 * per measured quantity, and each gets role `absence` with the words IT speaks.
 * This door reads the port, so it cannot disagree with the arithmetic about
 * which columns those are.
 */
import { silenceOfDecl, silenceOfNothing, type TableSilence } from '../data/silence.js';
import type { ColumnFacet, ColumnInfo, ColumnScale, ColumnType } from '../data/types.js';
import type { AbsenceDecl } from '../def/types.js';
import type { ColumnDecl } from './types.js';

export interface FacetSource {
  readonly columns?: Readonly<Record<string, ColumnDecl>>;
  /** The table's DECLARATION, bare or a list — this door adapts it to the port once (see {@link silenceOf}). */
  readonly absence?: AbsenceDecl | readonly AbsenceDecl[];
}

/** The source's silences as the port — the null object when it declares none, so nothing below branches. */
function silenceOf(source: FacetSource): TableSilence {
  return source.absence === undefined ? silenceOfNothing() : silenceOfDecl(source.absence);
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
  // ONE reading for the whole table, spent per column — the adapter is cheap, but a second reading
  // per column would be a second chance to disagree with itself.
  const silence = silenceOf(source);
  return cols.map((c) => facetOf(c, source, silence));
}

export function resolveFacet(col: ColumnInfo, source: FacetSource = {}): ColumnFacet {
  return facetOf(col, source, silenceOf(source));
}

/** One column, given the declaration and the table's reading of its silences. */
function facetOf(col: ColumnInfo, source: FacetSource, silence: TableSilence): ColumnFacet {
  const decl = source.columns?.[col.name];
  // A state column's OWN vocabulary — the port answers this and `silenceFor` deliberately does not
  // (a state column speaks for itself), so this is the one question the plane asks about it.
  const vocabulary = silence.vocabularyOf(col.name);
  const type = decl?.type ?? col.type; // a declared type wins: the def knows an ISO string is a date
  const role = vocabulary !== undefined ? 'absence' : decl?.role;
  const scale = decl?.scale ?? (vocabulary !== undefined ? 'discrete' : scaleOfType(type));
  return {
    field: col.name,
    type,
    ...(role !== undefined ? { role } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(vocabulary !== undefined ? { absence: vocabulary } : {}),
    ...(decl?.label !== undefined ? { label: decl.label } : {}),
    ...(decl?.unit !== undefined ? { unit: decl.unit } : {}),
  };
}
