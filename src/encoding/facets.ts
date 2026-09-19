/**
 * Facet resolution — one column as the plane sees it: the provider's type,
 * plus what was DECLARED about it. A STATE column is derived (role `absence`,
 * scale `discrete`, its own vocabulary attached); every other role is stated or
 * absent — never guessed from a name or a value.
 *
 * TWO SPEAKERS, ONE OWNER PER COLUMN. A def states what its table's own
 * columns are; an ACT states what a column it LANDS is (`ColumnMeaning`,
 * `../data/types.ts` — the one vocabulary both speak). Which of the two this
 * door reads is {@link meaningOf}'s rule, and it is a rule and not a merge.
 *
 * There may be MORE THAN ONE state column, because silence belongs to a column
 * and not to the row (`../data/silence.ts`): a `measurements` table declares one
 * per measured quantity, and each gets role `absence` with the words IT speaks.
 * This door reads the port, so it cannot disagree with the arithmetic about
 * which columns those are.
 */
import { silenceOfDecl, silenceOfNothing, type TableSilence } from '../data/silence.js';
import type { ColumnFacet, ColumnMeaning, ColumnScale, ColumnType, ResolvedColumn } from '../data/types.js';
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

export function resolveFacets(cols: readonly ResolvedColumn[], source: FacetSource = {}): ColumnFacet[] {
  // ONE reading for the whole table, spent per column — the adapter is cheap, but a second reading
  // per column would be a second chance to disagree with itself.
  const silence = silenceOf(source);
  return cols.map((c) => facetOf(c, source, silence));
}

export function resolveFacet(col: ResolvedColumn, source: FacetSource = {}): ColumnFacet {
  return facetOf(col, source, silenceOf(source));
}

/**
 * WHO OWNS A COLUMN'S MEANING — the ACT that landed it, whenever that act said
 * anything; otherwise the def.
 *
 * ── THE RULE, and it is a rule rather than a merge ─────────────────────────
 * When an act declared any of the four words for a column it landed, the act's
 * declaration is the WHOLE declaration for that column: the def's `columns`
 * entry for that name is not read for a role, a scale, a label or a unit. You
 * cannot take the role from the act and the label from the def. When the act
 * said nothing beyond its type there is nothing to own, and the def's entry
 * applies exactly as it always did.
 *
 * ── WHY THE ACT ────────────────────────────────────────────────────────────
 * A def's `columns` map is what the caller states about the table's OWN
 * columns — the map. A landed column is the TRACE: it exists only because an
 * act made it, at a commit, on a branch (`../data/derivedColumns.ts`). The
 * session already rules the mirror half of this at the landing door — a
 * computed column may not take a declared column's name, because the map is
 * not the trace's to edit — and this is the same law facing the other way.
 * And it is the only one that can be right per landing: two acts on two
 * branches land one logical name with two meanings, while a def has ONE entry
 * for that name, so a def that won would govern a branch it never saw.
 *
 * A DISAGREEMENT never reaches here — it is refused where the act lands, by
 * name, before a value moves (`../session/session.ts` · `writeColumns`).
 *
 * Typed `ColumnDecl` for both, and the TYPE falls out of that rather than
 * being a second rule: an act's word is a bare {@link ColumnMeaning} with no
 * `type` key at all ({@link landedMeaning} drops it), so the line below that
 * has always read `decl?.type ?? col.type` keeps reading the def's declared
 * type for a def-owned column and the store's reading for an act-owned one,
 * unchanged and un-branched.
 */
function meaningOf(col: ResolvedColumn, source: FacetSource): ColumnDecl | undefined {
  return col.landed ?? source.columns?.[col.name];
}

/**
 * THE FOUR WORDS OFF AN ACT'S OUTPUT — {@link meaningOf}'s writing twin, spent
 * once at the landing door (`../session/session.ts` · `writeColumns`) and
 * stored beside the act (`DerivedColumn.landed`).
 *
 * `undefined` when the act said NONE of them, which is what keeps an act that
 * declares nothing byte-identical: no key is written, so its registry row and
 * every facet folded from it are the ones they always were. The act's own
 * `type` is deliberately dropped — it is the act's shape vocabulary and not a
 * facet ({@link import('../analysis/types.js').OutputColumn}).
 */
export function landedMeaning(column: ColumnMeaning): ColumnMeaning | undefined {
  const said: ColumnMeaning = {
    ...(column.role !== undefined ? { role: column.role } : {}),
    ...(column.scale !== undefined ? { scale: column.scale } : {}),
    ...(column.label !== undefined ? { label: column.label } : {}),
    ...(column.unit !== undefined ? { unit: column.unit } : {}),
  };
  return Object.keys(said).length === 0 ? undefined : said;
}

/** One column, given the declaration and the table's reading of its silences. */
function facetOf(col: ResolvedColumn, source: FacetSource, silence: TableSilence): ColumnFacet {
  const decl = meaningOf(col, source);
  // A state column's OWN vocabulary — the port answers this and `silenceFor` deliberately does not
  // (a state column speaks for itself), so this is the one question the plane asks about it.
  const vocabulary = silence.vocabularyOf(col.name);
  // A declared type wins: the def knows an ISO string is a date. An ACT's declaration carries no
  // type at all, so a column the act owns is charted as the store reads it — see {@link meaningOf}.
  const type = decl?.type ?? col.type;
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
