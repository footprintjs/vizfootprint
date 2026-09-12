/**
 * Which gestures REACH a view, and what they are called by the time they get
 * there — the engine-side twin of the renderer's crossfilter law.
 *
 * A view is never filtered by the whole live selection. It is filtered by the
 * clauses that travel to it along the link graph: its own excluded, each edge's
 * `response` carried along, each edge's field `mapping` applied so the clause
 * arrives speaking the consumer's names, and a source that CLEARED still
 * reaching it when the edge's `onClear` says it should. Four rules, and every
 * one of them is a rule about the GRAPH — none of them is about the session.
 *
 * So they are a function of (the graph, the live clauses, the cleared ones) and
 * they live here. That matters more than the line count: `ui/src/contract`
 * enforces the same law over the same edges for the renderer, and
 * [`../../ui/src/adapter/README.md`](../../ui/src/adapter/README.md)'s third law
 * is precisely about what happens when a rule the library knows is restated by
 * a consumer instead of asked for. A rule that is a function is a rule that can
 * be handed over; a rule that is a private method is one the next consumer will
 * write again.
 *
 * **The one thing to know before changing it**: the consumer gets its OWN copy
 * of every clause. The session is still holding those objects and will fold
 * more acts into them, so handing out the live one is the leak
 * [`../detach/README.md`](../detach/README.md) exists to prevent — and a
 * mapping REWRITES field names, which would corrupt the session's own fold if
 * it were done in place.
 *
 * A fifth rule, the one that is NOT about the graph alone: a clause that
 * TRAVELLED a declared relation (`travelled` — the session's sets, folded by
 * the engine at dispatch, `session.ts` · `travelOf`) arrives at that consumer
 * as the `match` on the relation's far column, with `via` saying how. This is
 * still the one place a clause is re-phrased for a consumer — a mapping
 * renames, a relation re-phrases — and the two never apply to one clause: a
 * mapped field is the author's aim, and the aim stands (`authorMapped`).
 */
import { copyClause } from './wire.js';
import { columnStanding } from '../links/index.js';
import type { FieldMapping, LinkEdge, LinkGraph, TableReach } from '../links/index.js';
// the ONE renamer and the ONE column reader — a two-column kind is renamed and
// read here the day it is added there, never by a second spelling of the rule
import { clauseFields, renameClauseFields, type PredicateClause } from '../data/index.js';
import type { ReachingClause, TravelledClause } from './types.js';

/** A view whose last selection was CLEARED, with what it was and the clearing commit. */
export interface ClearedSelection {
  readonly clause: PredicateClause;
  readonly clearedBy: string;
  /**
   * The commit that LANDED the remembered clause — the key its travelled sets
   * are held under (`session.ts` · `travelledByCommit`), so a `leave` edge that
   * keeps the clause in force keeps it travelled too. Absent for a clause the
   * fold could not name a landing for (none today: every cleared record is
   * noted while the live commit is still known, `session.ts` · `noteCleared`).
   */
  readonly landedBy?: string;
}

/**
 * The clauses that reach `viewId` under `graph` — its own excluded, each edge's
 * response and mapping applied, a cleared source honoured per its `onClear`.
 * Cleared sources are listed first, then the live ones, which is the order the
 * caller's own maps produce and the order a consumer reads them in.
 */
export function clausesReaching(input: {
  readonly viewId: string;
  readonly graph: LinkGraph;
  readonly live: ReadonlyMap<string, PredicateClause>;
  readonly cleared: ReadonlyMap<string, ClearedSelection>;
  /** Source address → consumer address → the clause as it TRAVELLED a relation to that consumer. Absent = nothing travelled (every caller before the sets existed). */
  readonly travelled?: ReadonlyMap<string, Readonly<Record<string, TravelledClause>>>;
}): ReachingClause[] {
  const { viewId, graph, live, cleared, travelled } = input;
  // one lookup per (source, kind) INTO this consumer — the same law the renderer contract applies (ui/src/contract/selection.ts)
  const into = new Map<string, LinkEdge>();
  for (const e of graph.edges) if (e.target === viewId) into.set(`${e.source}|${e.kind}`, e);
  const reaches = (from: string, kind: string): LinkEdge | undefined => {
    if (from === viewId) return undefined; // never its own clause
    const edge = into.get(`${from}|${kind}`);
    // an encoding edge never matches a clause's kind, so `follow` cannot reach here; the guard keeps the type honest
    return edge === undefined || edge.response === 'none' || edge.response === 'follow' ? undefined : edge;
  };
  // the consumer gets its own copy: a clause handed out is never the session's live object
  const mapped = (edge: LinkEdge, clause: PredicateClause): PredicateClause => {
    const own = copyClause(clause);
    if (edge.mapping === undefined) return own;
    const to = (f: string): string => edge.mapping!.find((m) => m.from === f)?.to ?? f;
    return renameClauseFields(own, to);
  };
  // The mapping entries that actually RENAMED one of `clause`'s fields — the
  // author naming a landing column, versus a field an identity pair or no
  // mapping at all left unchanged. Read by the view-query door alone
  // (`ReachingClause.mappedFields`'s own WHY): an aim that misses is an author
  // error, not a coincidence to narrow away quietly.
  const authorMapped = (edge: LinkEdge, clause: PredicateClause): readonly FieldMapping[] | undefined => {
    if (edge.mapping === undefined) return undefined;
    const out = clauseFields(clause).flatMap((f) => {
      const m = edge.mapping!.find((mm) => mm.from === f);
      return m !== undefined && m.to !== m.from ? [m] : [];
    });
    return out.length > 0 ? out : undefined;
  };
  // A CLAUSE THAT TRAVELLED arrives as the session folded it — the `match` on
  // the far column, its own copy, and `via` naming the relation and the clause
  // the source made. Read only where the edge AT THIS CURSOR still carries the
  // relation (`LinkEdge.via` — a `link` edit may have moved the edge since the
  // set was folded) and no mapping renamed a field (the aim stands). Everything
  // else about the set — which consumer lacks which column, which relation end
  // the consumer has — was judged when it was folded, and a set that is no
  // longer true of the tables is re-folded by the session, not re-judged here.
  const travelledTo = (edge: LinkEdge, from: string, clause: PredicateClause, mappedFields: readonly FieldMapping[] | undefined): Pick<ReachingClause, 'clause' | 'via'> | undefined => {
    const set = travelled?.get(from)?.[viewId];
    if (set === undefined || edge.via === undefined || mappedFields !== undefined) return undefined;
    return { clause: copyClause(set.clause), via: { ...set.via, from: copyClause(clause) } };
  };
  const out: ReachingClause[] = [];
  // a source that CLEARED still reaches a consumer whose edge says so: `leave` keeps the last clause, `excludeAll` keeps nothing, `showAll` (the default) = gone
  for (const [from, rec] of cleared) {
    /* v8 ignore next -- every select door drops the view's cleared record when a live clause lands, so the two maps are disjoint; the guard enforces here what the doors maintain */
    if (live.has(from)) continue; // it is selecting again — the live clause speaks, and it is listed once
    const edge = reaches(from, rec.clause.kind);
    if (edge === undefined) continue;
    const policy = edge.onClear ?? 'showAll';
    if (policy === 'showAll') continue;
    const clause = mapped(edge, rec.clause);
    const mappedFields = authorMapped(edge, rec.clause);
    // `excludeAll` keeps nothing: an empty IN-list on the clause's first column — whatever kind it was, asked once (`clauseFields`).
    // A `leave` keeps the clause AS IT REACHED: travelled where it travelled (the set is held under its landing commit).
    out.push({
      from,
      response: edge.response,
      clause: policy === 'leave' ? clause : { kind: 'match', field: clauseFields(clause)[0]!, values: [] },
      ...(mappedFields !== undefined ? { mappedFields } : {}),
      ...(policy === 'leave' ? travelledTo(edge, from, rec.clause, mappedFields) : {}),
    });
  }
  for (const [from, clause] of live) {
    const edge = reaches(from, clause.kind);
    if (edge === undefined) continue;
    const mappedFields = authorMapped(edge, clause);
    out.push({ from, response: edge.response, clause: mapped(edge, clause), ...(mappedFields !== undefined ? { mappedFields } : {}), ...travelledTo(edge, from, clause, mappedFields) });
  }
  return out;
}

/**
 * The field mappings on the edges INTO a view (none for the whole-dashboard
 * truth): which names a link INVENTED for this consumer. Read only when the
 * engine has refused an unknown column — a name nothing declared is very often
 * a mapping's doing, and a refusal that does not say so leaves a person hunting
 * for a column that never existed.
 */
export function mappingsInto(graph: LinkGraph, viewId: string | undefined): readonly { readonly from: string; readonly field: string; readonly to: string }[] {
  if (viewId === undefined) return [];
  const out: { from: string; field: string; to: string }[] = [];
  for (const e of graph.edges) {
    if (e.target !== viewId || e.mapping === undefined) continue;
    for (const m of e.mapping) out.push({ from: e.source, field: m.from, to: m.to }); // an identity pair names a real column and is never picked as invented
  }
  return out;
}

// ── Can this table JUDGE this clause? (the reach law's runtime half) ─────────

/**
 * THE narrowing law, named once: which column of `clause` the table does not
 * have — `undefined` when it can judge every one of them.
 *
 * WHY every read needs it, and not only a walk (this argument was written at
 * `doNeighbourhoodProbe` and lived there alone): a clause reaching a table may
 * name a column ANOTHER table carries — a view's clause reaches every table
 * (`Session.clauseReaches`), and a link's `mapping` can rename a field into a
 * column nothing on this side declares. An engine asked to judge
 * `disease = "Measles"` against an edges table with no such column refuses the
 * WHOLE read, so one selection anywhere else on the dashboard would make every
 * read on that table impossible. **A sentence about a column these rows do not
 * have is not a claim about these rows.** So it is dropped from the predicate
 * and REPORTED instead (`ReachingClause.narrowed`) — omitted, never denied.
 *
 * `columns` must be the SAME reading of the table the caller's own guards were
 * made against (`Session.effectiveColumnsOf`), so a guard and the read that
 * follows it can never disagree about what the table has.
 */
export function unjudgeableColumn(clause: PredicateClause, columns: ReadonlySet<string>): string | undefined {
  return firstMissing(clause, (f) => !columns.has(f));
}

/**
 * ONE walk over a clause's columns, two ORACLES for "does the table have it".
 *
 * WHY the walk is factored out rather than written twice: which column a
 * narrowing NAMES is the clause's first unjudgeable field in `clauseFields`
 * order, and a two-column kind added there must change that answer in one
 * place. The oracles differ only in who is being asked — the engine's
 * description of the built table (`unjudgeableColumn`), or the DEFINITION
 * (`narrowedByDef`, which can answer with no engine and no `await`).
 */
function firstMissing(clause: PredicateClause, lacks: (field: string) => boolean): string | undefined {
  return clauseFields(clause).find(lacks);
}

/**
 * THE SAME NARROWING LAW, asked of the DEFINITION instead of the engine — the
 * `narrowed` marker for a clause the def says this table cannot judge, or
 * `undefined` when it can judge every column the def speaks about.
 *
 * WHY a def-reading twin exists at all: `why({ kind: 'chart' })` is
 * SYNCHRONOUS, and crediting a clause that filtered nothing as a commit that
 * shaped the chart is a false claim in the flagship self-explain answer. A
 * definition declares its own columns (`../def/tableReach.ts` reads them, and
 * an act-minted table carries its whole list), so the door can answer without
 * an engine — and where the definition is SILENT (`columnStanding` ·
 * `undeclared`) so is this: no marker, which is byte-identical to every answer
 * given before the marker existed. Omit, never deny.
 *
 * The reason is `unjudgeableWords`, the same sentence the read door reports, so
 * a window and a `why()` answer never word one fact two ways.
 */
export function narrowedByDef(clause: PredicateClause, table: string, reach: TableReach): { readonly column: string; readonly reason: string } | undefined {
  // `absent` only — never `undeclared`, which is the definition saying nothing
  const missing = firstMissing(clause, (f) => columnStanding(table, f, reach) === 'absent');
  return missing === undefined ? undefined : { column: missing, reason: unjudgeableWords(table, missing) };
}

/**
 * The one spelling of WHY a clause was narrowed away, naming the column and the
 * table — the sentence a reader of `ViewQueryResult.clauses` (and `why()`) meets.
 * One owner, so the sheet, the prose and a refusal cannot word it three ways.
 */
export function unjudgeableWords(table: string, column: string): string {
  return `table "${table}" has no column "${column}" — a sentence about a column these rows do not have is not a claim about these rows`;
}

/**
 * The reaching clauses as a READ sees them: each one the table cannot judge
 * carries its `narrowed` reason, and every other is untouched. The list keeps
 * its order and its length — law 3 is that a narrowed clause is still listed.
 */
export function narrowToJudgeable(clauses: readonly ReachingClause[], table: string, columns: ReadonlySet<string>): ReachingClause[] {
  return clauses.map((c) => {
    const missing = unjudgeableColumn(c.clause, columns);
    return missing === undefined ? c : { ...c, narrowed: { column: missing, reason: unjudgeableWords(table, missing) } };
  });
}
