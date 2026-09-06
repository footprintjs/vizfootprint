/**
 * RELATIONS — EDGES BETWEEN TABLES, REFUSED AT DECLARATION IN SENTENCES.
 *
 * A definition declares its tables only as `data: Record<string, DataSourceDef>`;
 * until this file nothing said how two of them join. A relation is one edge:
 * a column of one table pointing at ANOTHER table's declared `key` — an
 * identity, never a loose column, so the row a value names is addressable
 * (the no-row-key law behind `DataSourceDef.key`). Five laws, each with an
 * example, in ./README.md ("Relations").
 *
 * This is the def door's half: what the declaration alone can prove. A
 * `from.column` on a table that declares no `columns` is judged post-build
 * against the engine's real columns by `Dashboard.lintData`, exactly as a key
 * is. First customers: `validateDashboardDef` (the door), `buildDashboard`
 * (writes each relation's `kind` out onto the runtime), the overview (echoes
 * them), and the neighbourhood selection kind that will walk them.
 */
import { RELATION_KINDS, type RelationEnd, type RelationKind } from './types.js';

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
