/**
 * RELATIONS — EDGES BETWEEN TABLES, REFUSED AT DECLARATION IN SENTENCES.
 *
 * A definition declares its tables only as `data: Record<string, DataSourceDef>`;
 * until this file nothing said how two of them join. A relation is one edge:
 * a column of one table pointing at ANOTHER table's declared `key` — an
 * identity, never a loose column, so the row a value names is addressable
 * (the no-row-key law behind `DataSourceDef.key`). Seven laws, each with an
 * example, in ./README.md ("Relations") — the last two are the ones at the
 * bottom of this file: a relation is also a PERMISSION to read across, and TWO
 * relations at one identity are the EDGE a neighbourhood is walked over.
 *
 * The door BELOW is the def door's half: what the declaration alone can prove.
 * A `from.column` on a table that declares no `columns` is judged post-build
 * against the engine's real columns by `Dashboard.lintData`, exactly as a key
 * is. First customers: `validateDashboardDef` (the door), `buildDashboard`
 * (writes each relation's `kind` out onto the runtime), the overview (echoes
 * them), the session's `doNeighbourhoodProbe` (law 7: it walks them), and —
 * for the sixth law at the bottom — `session.declareAnalysis` (which asks the
 * permission) and the `bringOver` builtin (which follows the edge).
 */
import { RELATION_KINDS, type RelationEdge, type RelationEnd, type RelationKind } from './types.js';

// ── the vocabulary ────────────────────────────────────────────────────────────

/** The cardinality a relation carries when it declares none (law 4). */
export const DEFAULT_RELATION_KIND: RelationKind = 'many-to-one';

/** The keys a relation may carry — anything else is refused by name (R12). */
const RELATION_KEYS: readonly string[] = ['from', 'to', 'kind', 'label'];

/** The keys an end may carry: exactly the two — anything else is refused by name, the way a relation's own keys are. */
const END_KEYS: readonly string[] = ['table', 'column'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const hasOwn = (record: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

/** The one spelling of an edge — `edges.source → nodes.disease` — for the repeat SENTENCE and for anything that names one to a reader. */
export function relationEdgeId(from: RelationEnd, to: RelationEnd): string {
  return `${from.table}.${from.column} → ${to.table}.${to.column}`;
}

/**
 * The identity of an edge for the repeat CHECK — the four names as a tuple.
 * WHY: the spelling above joins with "." and "→", and no door forbids a "." in a table or column name,
 * so `a.b`.`c` and `a`.`b.c` would spell one edge; a tuple cannot be read two ways.
 */
const edgeIdentity = (from: RelationEnd, to: RelationEnd): string => JSON.stringify([from.table, from.column, to.table, to.column]);

// ── the door ──────────────────────────────────────────────────────────────────

/** An end as declared, or undefined unless it is `{ table, column }` with non-empty strings — its other keys are judged by name, beside it. */
function endOf(raw: unknown): RelationEnd | undefined {
  if (!isObject(raw) || !nonEmpty(raw.table) || !nonEmpty(raw.column)) return undefined;
  return { table: raw.table, column: raw.column };
}

/** The keys an object carries that `allowed` does not name, each as a sentence — the same voice at the relation and at either end. */
function refuseUnknownKeys(where: string, raw: unknown, allowed: readonly string[], problems: string[]): void {
  if (!isObject(raw)) return;
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) problems.push(`${where}: unknown key "${key}"`);
}

/** Law 2 (the door's half): the source end names a declared table, and — when that table declares its columns — one of them. */
function judgeFrom(where: string, from: RelationEnd, data: Record<string, unknown>, problems: string[]): void {
  if (!hasOwn(data, from.table)) {
    problems.push(`${where}.from.table "${from.table}" is not a declared data table — the tables are ${Object.keys(data).join(', ')}`);
    return;
  }
  const decl = data[from.table];
  // WHY: the same conditional as `data[t].key` at the door — a table that declares no columns is
  // judged post-build by `lintData` against the engine; a malformed table was refused on its own line.
  // Own keys only: `in` would let "toString" or "constructor" through the door as a declared column.
  if (isObject(decl) && isObject(decl.columns) && !hasOwn(decl.columns, from.column)) {
    problems.push(`${where}.from.column "${from.column}" is not a declared column of "${from.table}"`);
  }
}

/** Law 1: the target end names a declared table, and its column is that table's declared key — an identity. */
function judgeTo(where: string, to: RelationEnd, data: Record<string, unknown>, problems: string[]): void {
  if (!hasOwn(data, to.table)) {
    problems.push(`${where}.to.table "${to.table}" is not a declared data table — the tables are ${Object.keys(data).join(', ')}`);
    return;
  }
  const decl = data[to.table];
  // WHY: the same law as `judgeFrom` — a malformed table was refused on its own line, and "declare its key first" is no advice for a value that is not an object
  if (!isObject(decl)) return;
  const key = decl.key;
  if (!nonEmpty(key)) problems.push(`${where}.to "${to.table}.${to.column}" — declare data["${to.table}"].key first; a relation points at an identity`);
  else if (key !== to.column) problems.push(`${where}.to.column "${to.column}" is not the key of "${to.table}" — the key is "${key}"; a relation points at an identity`);
}

/**
 * Push problems for `relations` onto `problems`; `data` is the def's table
 * map, already judged on its own lines (mirrors `validateGrains`). A malformed
 * entry is refused and not judged further; a well-formed one is judged against
 * the tables, the identity law, the self-join and repeat rules, and its own
 * `kind` / `label`.
 */
export function validateRelations(raw: unknown, data: Record<string, unknown>, problems: string[]): void {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) {
    problems.push('relations, if present, must be an array of { from, to }');
    return;
  }
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const where = `relations[${i}]`;
    if (!isObject(r)) {
      problems.push(`${where} must be an object { from, to, kind?, label? }`);
      return;
    }
    refuseUnknownKeys(where, r, RELATION_KEYS, problems);
    refuseUnknownKeys(`${where}.from`, r.from, END_KEYS, problems);
    refuseUnknownKeys(`${where}.to`, r.to, END_KEYS, problems);
    const from = endOf(r.from);
    const to = endOf(r.to);
    if (from === undefined) problems.push(`${where}.from must be { table, column } with non-empty strings`);
    else judgeFrom(where, from, data, problems);
    if (to === undefined) problems.push(`${where}.to must be { table, column } with non-empty strings`);
    else judgeTo(where, to, data, problems);
    if (from !== undefined && to !== undefined) {
      // law 3: a self-join is refused in THIS version (the neighbourhood walk has no rule for one yet), and an edge is declared once
      if (from.table === to.table) problems.push(`${where} joins "${from.table}" to itself — not in this version`);
      const identity = edgeIdentity(from, to);
      if (seen.has(identity)) problems.push(`${where} repeats the edge ${relationEdgeId(from, to)}`);
      else seen.add(identity);
    }
    if (r.kind !== undefined && !(RELATION_KINDS as readonly unknown[]).includes(r.kind)) problems.push(`${where}.kind must be one of ${RELATION_KINDS.join('|')}`);
    if (r.label !== undefined && typeof r.label !== 'string') problems.push(`${where}.label must be a string`);
  });
}

// ── law 6: the permission to read across an edge, and the edge a bringOver follows ──

/** Does a declared relation join these two tables — in EITHER direction? An edge is a join, not an arrow, to anything asking to READ across it. */
export function joinsTables(relations: readonly RelationEdge[], a: string, b: string): boolean {
  return relations.some((r) => (r.from.table === a && r.to.table === b) || (r.from.table === b && r.to.table === a));
}

/**
 * The declared edges POINTING from one table at another — `from` holds the
 * column, `to` holds the key it names.
 *
 * WHY directional where {@link joinsTables} is not: a permission to READ across
 * an edge runs both ways, but following one does not. `edges.source → nodes.id`
 * gives every edge row exactly one node, so a value can be carried back along
 * it; the other way round a node row names many edges, and there is nothing to
 * carry back without an aggregate this library has not been asked for. First
 * customer: the `bringOver` builtin, whose produced column names are PREFIXED
 * by these edges' `from.column`s (`source` + `x` → `source_x`, spelled once in
 * `broughtColumnName`).
 *
 * Named `…From` and not `…Between` because "between" names an undirected pair
 * in every graph vocabulary a reader brings — and in {@link joinsTables} eight
 * lines up, which really is either-direction.
 */
export function relationsFrom(relations: readonly RelationEdge[], from: string, to: string): RelationEdge[] {
  return relations.filter((r) => r.from.table === from && r.to.table === to);
}

/**
 * LAW 7 — THE WALK'S TWO COLUMNS: a neighbourhood is walked over an EDGE, and
 * an edge is TWO relations from one table pointing at ONE identity
 * (`edges.source → nodes.disease` and `edges.target → nodes.disease` — legal,
 * and exactly the shape a node-link declares; a self-join stays refused by law
 * 3). Answer the pair in DECLARATION order, so a gesture on either end names
 * the same walk and lands the same bytes.
 *
 * `column` is the endpoint the gesture named. WHY the act names an endpoint
 * rather than the node table: a clause names columns of the table it is judged
 * against, and a neighbourhood's predicate is "both ends are in the set" over
 * the EDGES table — the node table is reached FROM there, through the relation
 * the endpoint declares.
 *
 * A refusal quotes what is known, in the voice of every other door here: the
 * endpoints the table does declare, or how many columns name that identity.
 *
 * ```ts
 * neighbourhoodEndpoints(relations, 'edges', 'target'); // → { fields: ['source', 'target'] }
 * ```
 */
export function neighbourhoodEndpoints(
  relations: readonly RelationEdge[],
  table: string,
  column: string,
): { readonly fields: readonly [string, string] } | { readonly rejected: string } {
  const fromHere = relations.filter((r) => r.from.table === table);
  const named = fromHere.find((r) => r.from.column === column);
  if (named === undefined) {
    const ends = fromHere.map((r) => r.from.column);
    return {
      rejected:
        ends.length === 0
          ? `table "${table}" declares no relation, so "${column}" is not an endpoint — a neighbourhood is walked over an edge, and an edge is two columns naming one identity`
          : `"${table}.${column}" is not an endpoint — the endpoints of "${table}" are ${ends.join(', ')}`,
    };
  }
  // ONE identity, both ends: the pair is every column of this table naming the same (table, key) the gesture's own end names
  const pair = fromHere.filter((r) => r.to.table === named.to.table && r.to.column === named.to.column);
  if (pair.length !== 2) {
    const cols = pair.map((r) => r.from.column).join(', ');
    return {
      rejected: `"${table}" names "${named.to.table}.${named.to.column}" through ${pair.length === 1 ? 'one column' : `${pair.length} columns`} (${cols}) — a neighbourhood walks an edge with exactly two ends`,
    };
  }
  return { fields: [pair[0]!.from.column, pair[1]!.from.column] };
}

/**
 * Law 6: an analysis may read a table BESIDE the one it runs over only where a
 * declared relation joins the two — **the relation is the permission**. One
 * sentence per problem, an empty list for "nothing to say", never a throw: the
 * shape `judgeTable` answers in, so `declareAnalysis` files either the same way.
 *
 * WHY here and not at the def door: which table an analysis runs over is chosen
 * when the act is performed (`declareAnalysis(id, { table })`), so the pair
 * whose join is in question does not exist until then. The def carries the
 * NAMES; this judges the pair.
 */
export function judgeAnalysisReads(
  id: string,
  table: string,
  reads: readonly string[],
  tables: readonly string[],
  relations: readonly RelationEdge[],
): string[] {
  // WHY the analysis's own table is judged FIRST, and alone: the pair is
  // (table, name), and a pair whose LEFT side is not a table has no relation to
  // declare. Blaming the read would quote a table that is perfectly good and
  // send the reader to declare a relation the def door would itself refuse.
  if (reads.length > 0 && !tables.includes(table)) {
    return [`analysis "${id}" runs over table "${table}", which is not a declared data table — the tables are ${tables.join(', ')}`];
  }
  const problems: string[] = [];
  for (const name of reads) {
    // The own table, named as a read: `reads` names the tables BESIDE it, and no
    // relation may ever join a table to itself (law 3), so "declare the
    // relation first" would be advice the relation door refuses.
    if (name === table) {
      problems.push(`analysis "${id}" reads table "${name}", which is the table it already runs over — \`reads\` names the tables BESIDE it`);
      continue;
    }
    if (!tables.includes(name)) {
      problems.push(`analysis "${id}" reads table "${name}", which is not a declared data table — the tables are ${tables.join(', ')}`);
      continue;
    }
    // WHY: a table joined to nothing is not a neighbour, and a read of one is a
    // join this library never saw declared.
    if (!joinsTables(relations, table, name)) {
      problems.push(`analysis "${id}" reads table "${name}", which no declared relation joins to "${table}" — declare the relation first`);
    }
  }
  return problems;
}
