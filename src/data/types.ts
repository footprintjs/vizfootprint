/**
 * L-data — the DataProvider seam (D24, docs/RESEARCH_STATE.md).
 *
 * D24 [GROUNDED]: ONE coordination model (typed clauses), THREE execution
 * engines behind the def's data seam — memory | wasm | server | auto.
 * INVARIANT: engine choice never changes commit semantics — same clauses,
 * same CommitRecord, same replay (proven structurally in
 * `engineInvariant.test.ts`).
 *
 * `PredicateClause` is deliberately shaped to match what L1/L2 actually
 * produce, so a `CommitRecord` can be evaluated against a `DataProvider`
 * with a plain field-rename, not a translation layer:
 *   - `src/log/log.ts` `CommitRecord.kind` — `'point' | 'interval' | 'cell' |
 *     'match' | 'neighbourhood'`, `field: string`, `value: unknown`. The TWO-column
 *     kinds ({@link PAIR_CLAUSE_KINDS} — `'cell'`, `'neighbourhood'`) carry their
 *     columns in `fields`; their `field` slot holds only the display label
 *     {@link cellFieldLabel} / {@link neighbourhoodFieldLabel} mints.
 *   - `src/selection/types.ts` `CauseClauseSpec` — carries the same FIVE
 *     kinds, each with a registry-backed source. `'match'` below is the
 *     SET-1 IN-list (with `exclude` for NOT IN) that the port mints — it is
 *     NOT Mosaic's own `clauseMatch` (text search: contains / prefix /
 *     regex, `node_modules/@uwdata/mosaic-core/dist/src/SelectionClause.js:121-140`);
 *     an IN-list is a genuinely trivial predicate to add without pretending
 *     to implement Mosaic's fuzzy-match semantics.
 *
 * R14 (honest capability declaration + typed rejection, never a silent
 * no-op — the family's "honest absence" pattern, mirrored from
 * `src/analysis/types.ts:61-73`'s `DegenerateResult`) runs through this
 * whole module: `DataProvider.capabilities` declares what an engine CAN do;
 * every operation that cannot be honored returns a `DataProviderRejection`
 * (a discriminated union member, `{ ok: false, reason, ... }`), never an
 * empty/undefined stand-in for "didn't work."
 */
// WHY a type-only import from a module that imports this one: `RefreshDelta` is the answer `replaceRows` owes, and a type cycle is erased at compile time
import type { RefreshDelta } from './delta.js';

/** The three execution engines D24 names, plus the policy-driven seam. */
export type Engine = 'memory' | 'wasm' | 'server' | 'auto';

/** The two engines a `DataProvider` VALUE can actually report as itself. `auto` only ever appears as a `chooseEngine` INPUT/output selection — a resolved provider is never self-tagged 'auto'. */
export type ResolvedEngine = Exclude<Engine, 'auto'>;

/** A single filterable data row. Values are borrowed, not cloned — do not mutate. */
export type Row = Record<string, unknown>;

/** The column type vocabulary a provider can report (duck-typed, sniffed for CSV/memory input). */
export type ColumnType = 'number' | 'string' | 'boolean' | 'date' | 'unknown';

export interface ColumnInfo {
  readonly name: string;
  readonly type: ColumnType;
}

// ── Column facets (the encoding plane's input; see src/encoding/README.md) ──

/**
 * What a column IS to a chart, declared by the def (`DataSourceDef.columns`)
 * or derived: each of the table's declared STATE columns is `absence`; every other
 * role is stated, never guessed — a rule that needs a role simply does not
 * match a column that never declared one.
 */
export type ColumnRole = 'identifier' | 'dimension' | 'measure' | 'absence';

/** Discrete (categories, ids, states) or continuous (magnitudes, time). Derived from the type when not declared. */
export type ColumnScale = 'discrete' | 'continuous';

/**
 * One column as the encoding plane sees it: the provider's type plus what the
 * def declared about it. The wire shape `whats_here` serves per column.
 */
export interface ColumnFacet {
  readonly field: string;
  readonly type: ColumnType;
  /** Present when the def declared (or derived) a role for this column. */
  readonly role?: ColumnRole;
  /** Present when declared, or derived from the type (number/date → continuous; string/boolean → discrete). */
  readonly scale?: ColumnScale;
  /**
   * Present when the def declared this column as one of the table's STATE
   * columns (`DataSourceDef.absence`): the vocabulary IT speaks, verbatim. An
   * agent reading `whats_here` learns that "unavailable" here is a kind of
   * silence, not a category like any other — and never a number.
   *
   * A table may have more than one, each with its own words, because silence
   * belongs to a column and not to the row (`./silence.ts`): `radius_state`
   * speaks of a radius and says nothing about a mass.
   */
  readonly absence?: readonly string[];
  /** A display label, echoed verbatim (never parsed). */
  readonly label?: string;
  /**
   * The UNIT the column's values are in ('mg/dL', 'cases', 'USD'), echoed
   * verbatim and never parsed or converted. It exists so a shared scale can be
   * refused: two layers on one frame may only share a channel when the columns
   * they bind speak the same unit (`../def/README.md`, "The frame"). Declared,
   * never guessed — a mismatch is refused only when BOTH columns declare one.
   */
  readonly unit?: string;
}

// ── The clause kinds this seam evaluates. ──────────────────────────────────

/**
 * `value: unknown`, `value === null`, and `value === undefined` are THREE
 * distinct, meaningful states — mirrored exactly from the real Mosaic clause
 * factories this repo already depends on (verified against the installed
 * package):
 *   - a concrete value        → `("field" IN (value))`            (matches)
 *   - `value === null`        → `("field" IS NULL)`                (matches nulls)
 *   - `value === undefined`   → no predicate at all (the clause is CLEARED;
 *     `clausePoint`, `node_modules/@uwdata/mosaic-core/dist/src/SelectionClause.js:14-24`,
 *     only builds `isInDistinct` when `value !== undefined`, else the clause
 *     carries a `null` predicate — an inactive filter, not "match nothing").
 * `resolvePredicateSQL`/`matchesClause` (`predicate.ts`) replicate this
 * three-way split precisely so a `DataProvider` never silently reinterprets
 * a commit's semantics.
 */
export interface PointClause {
  readonly kind: 'point';
  readonly field: string;
  readonly value: unknown;
}

/**
 * One side of an interval, or `null` for "no bound on this side" — a
 * HALF-OPEN interval (e.g. field >= lo with no ceiling, or field <= hi with
 * no floor). This is this layer's own extension beyond what a real Mosaic
 * `clauseInterval` expresses (mirrors the `'match'` clause precedent above:
 * a genuinely useful addition, not a Mosaic-mirroring concern — see
 * `predicate.ts`'s `resolveIntervalSQL`). Both sides `null` is deliberately
 * UNREPRESENTABLE by this type — "no filter at all" is
 * `IntervalClause.value === null` (the whole clause cleared), never a
 * `[null, null]` tuple.
 */
export type IntervalBounds<T> = readonly [T, T] | readonly [T, null] | readonly [null, T];

/**
 * `value === null` clears the interval (no predicate — matches everything),
 * mirroring `clauseInterval`'s `value != null ? isBetween(...) : null`
 * (`SelectionClause.js:70-82`). `[lo, hi]` is inclusive on both ends
 * (`isBetween` → SQL `BETWEEN`), matching Mosaic exactly. A bound may itself
 * be `null` for a HALF-OPEN interval — `[150, null]` is "150 or more",
 * `[null, 150]` is "up to 150" — this layer's own extension (see
 * {@link IntervalBounds}); at least one side must be non-null.
 *
 * A string-bounded pair is a DATE interval: the bounds are ISO-8601 date
 * strings (the format a time-series chart's brush emits, or an agent's
 * `filter` tool call), compared lexicographically — for uniform ISO-8601
 * that IS chronological order, exactly what SQL `BETWEEN` does over string
 * operands. The two bound types never mix: one interval is either numeric or
 * string on both (non-null) ends.
 */
export interface IntervalClause {
  readonly kind: 'interval';
  readonly field: string;
  readonly value: IntervalBounds<number> | IntervalBounds<string> | null;
}

/**
 * A trivial IN-list predicate — NOT Mosaic's `clauseMatch` (see file header).
 * An empty `values` array matches nothing (never "everything"); to mean "no
 * filter", pass `null` as the whole clause, not an empty match. `exclude`
 * flips it to NOT IN — "everything but these" (so an empty exclude-list keeps
 * everything: nothing is excluded).
 */
export interface MatchClause {
  readonly kind: 'match';
  readonly field: string;
  readonly values: readonly unknown[];
  readonly exclude?: boolean;
}

/**
 * What a `match` commit CARRIES (`CommitRecord.value` for kind:'match'): the
 * IN-list and its polarity in ONE JSON-safe object, or `null` to clear — the
 * cleared-interval rule. Polarity rides the value, not the record, so every
 * replica of the wire (fold, recipe, adapter, agent) carries it without
 * learning a new field.
 */
export interface MatchValueBody {
  readonly values: readonly unknown[];
  readonly exclude?: boolean;
}
export type MatchValue = MatchValueBody | null;

/**
 * One SIDE of a `cell` selection (D30 — the compound-cell commit): either a
 * POINT value (strict equality; `null` means SQL IS NULL, exactly the point
 * clause's own rule) or an INTERVAL `[lo, hi]` (bucket bounds, inclusive both
 * ends, half-open allowed — the exact {@link IntervalBounds} discipline
 * above). The two are told apart by shape: an array side is an interval,
 * anything else is a point. `undefined` is deliberately NOT a side — a cell
 * has no per-side clearing; the WHOLE cell clears via
 * `CellClause.value === null`, mirroring a cleared interval.
 */
export type CellSide =
  | IntervalBounds<number>
  | IntervalBounds<string>
  | number
  | string
  | boolean
  | null;

/**
 * The compound CELL clause (D30): one heatmap-cell gesture selects on TWO
 * fields at once ("price 100–150 AND category Formal") and the predicate is
 * the AND of both sides — one gesture, ONE commit, never two
 * correlationId-linked ones. `fields` is `[x side, y side]`; `value` is the
 * matching side pair, or `null` to clear the whole cell (the cleared-interval
 * rule: `null` = no predicate, matches everything).
 */
export interface CellClause {
  readonly kind: 'cell';
  readonly fields: readonly [string, string];
  readonly value: readonly [CellSide, CellSide] | null;
}

/**
 * How a neighbourhood's id set was WALKED. THREE derivations, all UNDIRECTED
 * (either end joins — R1, `../session/neighbourhood.ts`):
 *
 * - `'ego'` — the seed plus every node within the hops it asked for (1 or 2).
 * - `'path'` — the nodes IN ORDER from the seed to one other node (`to`), a
 *   shortest path, ties broken by row order.
 * - `'component'` — everything the seed can reach, however far.
 *
 * It is named (and recorded) rather than assumed because the set alone cannot
 * say which walk produced it, and a set nobody can re-walk is a number without
 * a question. A DIRECTED walk is a later dial and is deliberately not offered.
 */
export type NeighbourhoodDerivation = 'ego' | 'path' | 'component';

/**
 * WHICH WALK a neighbourhood `select` asks for (R3) — absent on the act means
 * `{ derivation: 'ego', hops: 1 }`, so every caller written before the other
 * two walks existed lands the same bytes and the same record.
 *
 * - `derivation` — `'ego'` (the seed and everything within `hops` of it),
 *   `'path'` (the nodes IN ORDER from the seed to `to`) or `'component'`
 *   (everything the seed can reach, however far).
 * - `hops` — legal ONLY with `'ego'`, and 1 or 2: past two hops an ego set is
 *   most of any real graph (a POLICY of this build, not a limit of the walk).
 *   For "everything reachable", ask for the component instead. A path and a
 *   component ANSWER their own distance, so neither can be told one.
 * - `to` — REQUIRED with `'path'` and refused elsewhere. `to` equal to the
 *   seed is the trivial path (`hops: 0`, `ids: [seed]`); a `to` nothing joins
 *   to the seed is the honest "no path" (`hops: null`, `ids: [seed, to]`).
 *
 * Every one of those refusals is a sentence, and nothing lands. So is a walk
 * whose answer would be bigger than a commit records
 * (`NEIGHBOURHOOD_ID_CEILING`, `./neighbourhood.ts`) — that one is filed under
 * `result-too-large`, because no re-reading of the declaration repairs it.
 *
 * ```ts
 * await session.dispatch({ verb: 'select', viewId, field: 'source', seed: 'flu', walk: { derivation: 'path', to: 'strep' }, cause });
 * // → one commit: { seed: 'flu', derivation: 'path', hops: 2, to: 'strep', ids: ['flu', 'cold', 'strep'] }
 * ```
 */
export interface WalkAsk {
  readonly derivation?: NeighbourhoodDerivation;
  readonly hops?: 1 | 2;
  readonly to?: unknown;
}

/**
 * What a `neighbourhood` commit CARRIES (`CommitRecord.value` for
 * kind:'neighbourhood'): the QUESTION — the `seed` the gesture landed on, the
 * `derivation` that walked from it, how many `hops` — and the ANSWER it
 * produced, the materialized `ids`, in ONE JSON-safe object; or `null` to
 * clear (the cleared-interval rule, and the match body's own shape).
 *
 * WHY the answer is recorded and not only the question: a read at a cursor
 * answers about THAT cursor, and the walk is over rows a later act may change
 * (a derived column, a live filter). A record carrying only the seed would
 * re-walk today's rows and answer a question nobody asked. The question rides
 * beside the answer so the act stays legible and could be walked again — the
 * shape every serious tool converges on (Cytoscape collections, Gephi ego
 * filters, Graphistry expanders).
 */
export interface NeighbourhoodValueBody {
  /**
   * The node the gesture landed on — the id the walk started from. `null` means
   * the seed is UNNAMED: a walk projected from a clause with no commit behind it
   * (`../session/wire.ts`), never a node whose key is `null`.
   */
  readonly seed: unknown;
  /**
   * The walk this body records. {@link NeighbourhoodDerivation} is what THIS
   * version MINTS; the slot is typed open because a body read back from a log or
   * a saved picture written by another build may name a derivation this one does
   * not — it still selects by its recorded `ids`. A consumer that branches on a
   * derivation it knows must keep an honest else.
   */
  readonly derivation: NeighbourhoodDerivation | (string & {});
  /**
   * HOW FAR THE WALK WENT — one number per derivation, and each of them is
   * about a different thing:
   *
   * - `'ego'`: the hops it ASKED for (1 or 2). A one-hop walk on a graph two
   *   hops wide still asked one hop.
   * - `'path'`: the path's LENGTH in edges — `0` for the trivial path (`to` is
   *   the seed), and `null` when NO PATH exists.
   * - `'component'`: the FARTHEST node's distance from the seed (`0` for a
   *   node no edge names).
   *
   * WHY `null` is a value and not an absence: "these two nodes, and nothing
   * joining them" is an ANSWER, and a reader renders what arrived rather than
   * re-walking to check it (the same law `derivation` states above — a body
   * read back from another build's log may carry a number this one would not
   * mint). A consumer that formats a distance keeps an honest else for `null`.
   */
  readonly hops: number | null;
  /**
   * The far end a `'path'` walk ran TO — present only for `'path'`, because it
   * is the only derivation whose question names a second node.
   *
   * It rides beside `seed` rather than inside `ids` because it is part of the
   * QUESTION: `ids` is the path it found (and, when there is none, just the two
   * nodes), and a re-ask needs to know which of them was asked for.
   */
  readonly to?: unknown;
  /**
   * The materialized set, the seed included — the answer, recorded with its
   * question. The ORDER is the walk's own: `'ego'` and `'component'` put the
   * seed first, then by distance, then row order; `'path'` puts the nodes in
   * order from the seed to `to` (or, with no path, just those two).
   */
  readonly ids: readonly unknown[];
}
export type NeighbourhoodValue = NeighbourhoodValueBody | null;

/**
 * The NEIGHBOURHOOD clause: one gesture on a node selects the ties INSIDE the
 * walked set — the INDUCED ego subgraph. `fields` is the edges table's two
 * endpoint columns (`[sourceColumn, targetColumn]`) and a row is kept when
 * BOTH endpoints are in `ids`, which is exactly the edge set the network chart
 * brightens for that gesture (`ui/src/charts/VizNetwork.tsx`) and what every
 * named tool returns for a depth-1 ego filter (Cytoscape `neighborhood()`,
 * Gephi, Neo4j Bloom's expand).
 *
 * WHY BOTH and not EITHER: an id set is CLOSED (seed + its neighbours), so
 * "either endpoint" also keeps a neighbour's tie to a stranger — an edge the
 * seed does not touch, whose far end is not in the recorded set and is drawn
 * dim. A gesture's rows must be the ones its own highlight promised.
 *
 * WHY a kind of its own, given that the predicate is an AND: for the reason
 * {@link CellClause} is one — ONE gesture must land ONE commit, over a value
 * (the walk) that is recorded whole. Two composed clauses would be two acts
 * and two records of half a question.
 *
 * `ids` is the clause tier's own sibling field, exactly as a match's
 * `values` is: the seed, derivation and hops the wire carries
 * ({@link NeighbourhoodValueBody}) are the act's provenance, not part of the
 * predicate. An empty `ids` keeps nothing (a real always-false predicate,
 * never "everything") — to mean "no filter", the clause is `null`, the same
 * rule the match kind follows.
 */
export interface NeighbourhoodClause {
  readonly kind: 'neighbourhood';
  readonly fields: readonly [string, string];
  readonly ids: readonly unknown[];
}

export type PredicateClause = PointClause | IntervalClause | MatchClause | CellClause | NeighbourhoodClause;

/**
 * The ONE display spelling of a cell's joint field ("price × category") —
 * carried in slots that expect a single field name (`CommitRecord.field`, a
 * commit-log chip). Display-only, NEVER parsed: the authoritative pair always
 * rides `fields`.
 */
export function cellFieldLabel(fields: readonly [string, string]): string {
  return `${fields[0]} × ${fields[1]}`;
}

/**
 * The ONE display spelling of a neighbourhood's joint field
 * ("source ↔ target") — the same slot, and the same display-only law, as
 * {@link cellFieldLabel}: carried where a single field name is expected
 * (`CommitRecord.field`, a commit-log chip), NEVER parsed. The authoritative
 * pair always rides `fields`. The arrow is `↔` and not `×` because the two
 * columns are the two ENDS of one edge, not two axes of a grid — a reader who
 * sees the label should read "one edge", and the predicate keeps the edges
 * whose BOTH ends are inside the walked set.
 */
export function neighbourhoodFieldLabel(fields: readonly [string, string]): string {
  return `${fields[0]} ↔ ${fields[1]}`;
}

/**
 * The TWO-COLUMN kinds — THE one array literal. A kind here carries its
 * authoritative column pair in `fields` and only a display label in the
 * single-field slots (`CommitRecord.field`, a chip).
 *
 * WHY it is data and exported: the fork is asked about a KIND long before a
 * clause exists — a wire triple's arm, a saved condition, a `CommitInput` the
 * log judges (`../log/log.ts`), a saved-selection rebuild (`../session`) — and
 * {@link clauseFields} can only answer it for an already-built clause. Two
 * spellings of one rule are two chances to disagree; the third pair kind lands
 * here, once.
 */
export const PAIR_CLAUSE_KINDS = ['cell', 'neighbourhood'] as const;

/** Whether a clause KIND carries its columns as a `fields` pair ({@link PAIR_CLAUSE_KINDS}). */
export function isPairKind(kind: string): kind is (typeof PAIR_CLAUSE_KINDS)[number] {
  return (PAIR_CLAUSE_KINDS as readonly string[]).includes(kind);
}

/**
 * Every column a clause reads — ONE field for point/interval/match, BOTH for
 * a cell (D30) and for a neighbourhood (its two edge endpoints). The single
 * place an engine asks "which columns must exist for this clause?" so no
 * consumer ever forks on `kind` for it.
 */
export function clauseFields(clause: PredicateClause): readonly string[] {
  return isPairClause(clause) ? clause.fields : [clause.field];
}

/**
 * One clause, a list of them, or none — as the LIST every engine walks. The
 * single place `null` and a bare clause become the same shape, so two engines
 * cannot disagree about what "no predicate" is (it is the empty list, whose
 * descriptor is the cleared one — `resolvePredicateSQL`).
 */
export function clauseList(clause: PredicateClause | readonly PredicateClause[] | null): readonly PredicateClause[] {
  return clause === null ? [] : Array.isArray(clause) ? (clause as readonly PredicateClause[]) : [clause as PredicateClause];
}

/** {@link isPairKind} over a BUILT clause — the narrowing the union needs, still reading the one array. */
export function isPairClause(clause: PredicateClause): clause is CellClause | NeighbourhoodClause {
  return isPairKind(clause.kind);
}

// ── evaluate() surface: "rows or count surface" (D24 build step 1). ───────

export interface EvaluateOptions {
  /** Default `'rows'`. `'count'` skips materializing row objects — the cheap surface for gap/threshold checks. */
  readonly mode?: 'rows' | 'count';
  /** Optional column projection. Ignored in `'count'` mode. Absent = all columns. */
  readonly columns?: readonly string[];
  /** Optional row cap (rows mode only). A provider MAY still return fewer per `capabilities.maxRows`. */
  readonly limit?: number;
  /**
   * The sheet's window (rows mode only): the order the rows come back in, and
   * how many matching rows to skip before the first one returned. A provider
   * without `capabilities.canSort` rejects a `sort` with `unsupported-sort` —
   * never a silent source order. `offset` past the last match answers zero
   * rows with the honest `count`; a negative or fractional offset is rejected.
   */
  readonly sort?: readonly SortSpec[];
  readonly offset?: number;
  /** Rows mode only: also return each returned row's index in the table's source order (`EvaluateResult.indices`) — what a positional row identity is made of. */
  readonly indices?: boolean;
}

/** One sort key: a column, a direction, and where absent values (null, undefined, NaN) go — last unless said otherwise. */
export interface SortSpec {
  readonly field: string;
  readonly dir: 'asc' | 'desc';
  readonly absent?: 'first' | 'last';
}

export interface EvaluateResult {
  /**
   * The RESOLVED predicate SQL text for this call — a DESCRIPTOR (mirrors
   * `CommitRecord.predicateSQL`'s documented role, `src/log/log.ts:68-69`:
   * "a descriptor for verification / replay determinism"), not proof that
   * SQL was executed. `capabilities.canEvaluateSQL` says whether an engine
   * actually ran it. This is the field the D24 invariant test pins: the SAME
   * clause resolves to the SAME `sql` regardless of engine or internal
   * storage layout.
   */
  readonly sql: string;
  /** Row count matching the predicate. Always present, even in `'rows'` mode. */
  readonly count: number;
  /** Present unless `mode: 'count'`. */
  readonly rows?: readonly Row[];
  /** Rows mode with an `offset`: the offset honoured (clamped to `count`), so a window knows where it starts. */
  readonly start?: number;
  /** Rows mode with `indices: true`: the source-order index of each returned row, parallel to `rows`. */
  readonly indices?: readonly number[];
}

// ── find(): "where is the next match in THIS order?" (the sheet's Ctrl+F). ─

/**
 * ONE new question on the port, and the reason it is on the port at all: only
 * the engine can answer "the POSITION of the next match in this order" without
 * walking the table. A consumer that filtered instead would answer a different
 * question — filtering REMOVES rows, and a find must leave the view exactly as
 * it is and only say where to stand (src/data/README.md, "A find is a read").
 *
 * A FIND IS A TEXT QUESTION: the match is a case-insensitive SUBSTRING over the
 * TEXT FORM of a cell (`cellString` in the memory engine, `CAST(… AS VARCHAR)`
 * in SQL). The two engines agree on strings and integers; floats, timestamps and
 * one class of case fold (the ones that CHANGE LENGTH, `İ` → `i` + a combining
 * dot) are the known divergences — named in the README and pinned by a test
 * rather than papered over.
 */
export interface FindOptions {
  /** What a person typed. Empty after trimming is `bad-find` — a search for nothing is not a search. */
  readonly text: string;
  /** Which columns to look in. Empty is `bad-find`: the CALLER decides the default (the session uses the text columns of the projection). */
  readonly columns: readonly string[];
  /** The order the positions are counted in — the same `sort` the window was read with, or absent for source order. */
  readonly sort?: readonly SortSpec[];
  /** The view position to search FROM, inclusive. Negative or fractional is `bad-find`. */
  readonly from: number;
  /** `'forward'` = the first match at a position ≥ `from`; `'backward'` = the last match at a position ≤ `from`. Anything else is `bad-find`. */
  readonly direction: 'forward' | 'backward';
}

/**
 * The ONE judgement of a malformed find, in the ONE set of words both engines
 * refuse in — `undefined` when the ask is well formed.
 *
 * WHY it lives beside the type and not inside an engine: `bad-find` is a fact
 * about the ASK, not about a backend, so two engines must not be able to
 * disagree about which asks are askable or say it two ways. The memory engine
 * calls it directly; the SQL builder (`findSQL`) calls it and throws the
 * sentence as a `WindowRefusal` its provider converts.
 *
 * `direction` is judged at RUNTIME even though the type pins it: this port is
 * reached across an HTTP door (the session's `findInView` is served as JSON),
 * and a word the compiler never saw must be refused rather than silently read
 * as "backward".
 */
export function badFindReason(options: FindOptions): string | undefined {
  if (options.text.trim() === '') return 'a find needs something to look for — the text was empty';
  // WHY the whole-number sentence is word for word `bad-window`'s: it is the same
  // complaint about the same kind of number, and one library says it one way.
  if (!Number.isInteger(options.from) || options.from < 0) return `from must be a whole number at or above zero (got ${String(options.from)})`;
  if (options.direction !== 'forward' && options.direction !== 'backward') return `direction must be "forward" or "backward" (got ${JSON.stringify(options.direction)})`;
  if (options.columns.length === 0) return 'a find needs at least one column to look in';
  return undefined;
}

/**
 * Where the next match is — and how many there are in the whole view, so a
 * reader knows what they are walking.
 *
 * TWO SHAPES, and the type is what keeps them apart: a MISS (`position: null`)
 * carries no ordinal, no index and no row, because there is nothing to name;
 * a HIT carries all three. A caller therefore cannot mint a row identity out of
 * a match that was not found — the compiler stops it.
 *
 * A miss with `matches > 0` is the honest end of a walk: no match THAT WAY, and
 * some the other way. Nothing here wraps; the caller decides to ask again from
 * the other end, and can say so in words.
 */
export type FindResult =
  | {
      /**
       * The RESOLVED predicate SQL for the view the find ran over — a
       * DESCRIPTOR, exactly as `EvaluateResult.sql` is: what rows the find could
       * see, not proof that SQL ran. The text searched for is NOT in it; the
       * descriptor describes the VIEW, and the view is what a receipt names.
       */
      readonly sql: string;
      /** How many rows in the whole view hold the text — the count a reader is told, whatever direction they walked. */
      readonly matches: number;
      /** No match in that direction. */
      readonly position: null;
    }
  | {
      /** The view descriptor, as above. */
      readonly sql: string;
      /** How many rows in the whole view hold the text. */
      readonly matches: number;
      /** The match's position in the view — 0-based, so it IS the `offset` a window opens at to show it. */
      readonly position: number;
      /** 1-based among the matches, in view order — "match 3 of 12" is this and `matches`. */
      readonly ordinal: number;
      /** The found row's index in the table's SOURCE order — the same fact `EvaluateResult.indices` carries, and what a positional row identity is made of. */
      readonly index: number;
      /** The found row, whole: `columns` says where to LOOK, not what to answer with, so the caller can read its own identity (a key column) off it. */
      readonly row: Row;
    }

// ── R14: honest capability declaration + typed rejection. ─────────────────

export interface DataProviderCapabilities {
  /** Does this engine actually EXECUTE the resolved SQL against a real query engine (vs. evaluating predicates in JS)? */
  readonly canEvaluateSQL: boolean;
  /** Can `materializeColumn` land a new column (R11's landing spot)? */
  readonly canMaterialize: boolean;
  /** Soft cap this engine is comfortable with, if any. `undefined` = no declared cap. */
  readonly maxRows?: number;
  /** Can `evaluate` honour a `sort`? Absent = no (the stub engines); the memory engine sorts in JS over a cached permutation. */
  readonly canSort?: boolean;
  /**
   * Can this engine answer {@link DataProvider.find}? ABSENT = NO — a provider
   * written before find existed declares nothing and is refused in words, never
   * silently walked over in JavaScript by a caller filling the gap.
   */
  readonly canFind?: boolean;
  /**
   * Can this engine RE-LAND a table's rows in place ({@link DataProvider.replaceRows})
   * and answer what changed? ABSENT = NO — the stub engines declare nothing and a
   * refresh refuses them in words, never by rebuilding the table on another engine.
   */
  readonly canReland?: boolean;
}

/** Typed reason codes — every rejection names one; never a bare `false`/`undefined`. */
export type RejectionReason =
  /** This engine does not do this at all in this version: a typed stub with no backend (`server`), or a door an engine declares shut (`canMaterialize: false`). */
  | 'not-implemented'
  /**
   * A backend handle (Coordinator / DuckDB-WASM connection) was required but
   * not supplied — OR it was there and the exchange with it failed: a statement
   * the backend refused (its own error quoted in `detail`), an opener that
   * threw, a count that came back without a number. Every outcome that depends
   * on the backend rather than on the caller's ask is filed here, so `detail`
   * is the only place that says WHICH — read it, never branch on this word
   * alone to mean "pass a connection".
   */
  | 'no-backend-connection'
  /** The named table is not known to this provider. */
  | 'unknown-table'
  /** The clause's `field` is not a column of the named table. */
  | 'unknown-column'
  /** `materializeColumn`'s `values` length does not match the table's row count. */
  | 'row-count-mismatch'
  /** The clause carries a literal type this engine cannot honestly render as SQL (e.g. a nested object). */
  | 'unsupported-literal'
  /** `evaluate` was asked to sort and this engine cannot (`capabilities.canSort` is not true). */
  | 'unsupported-sort'
  /** `evaluate`'s window is malformed: a negative or fractional `offset` or `limit`. */
  | 'bad-window'
  /** `find`'s ask is malformed: no text once trimmed, a negative or fractional `from`, a direction that is neither way, or an empty `columns` list. */
  | 'bad-find';

export interface DataProviderRejection {
  readonly ok: false;
  readonly engine: ResolvedEngine;
  readonly operation: 'evaluate' | 'find' | 'materializeColumn' | 'replaceRows' | 'tables' | 'columns';
  readonly reason: RejectionReason;
  /** Human-facing detail. INERT — never parsed, never dispatched on (R12 firewall reused). */
  readonly detail?: string;
}

/** Build a typed rejection. The one constructor every provider funnels through — no ad hoc shapes. */
export function reject(
  engine: ResolvedEngine,
  operation: DataProviderRejection['operation'],
  reason: RejectionReason,
  detail?: string,
): DataProviderRejection {
  return detail !== undefined
    ? { ok: false, engine, operation, reason, detail }
    : { ok: false, engine, operation, reason };
}

/**
 * THE package's one `{ ok: false }` guard — `src/selection` re-exports it
 * rather than redefining it. WHY a structural predicate and not
 * `value is DataProviderRejection`: TS narrows a union by filtering its members
 * against the predicate, so `EvaluateResult | DataProviderRejection` still
 * narrows to `DataProviderRejection` and `CauseClause | SelectionRejection` to
 * `SelectionRejection`; a nominal predicate here would let a caller with both
 * doors open narrow a port answer to the WRONG reason vocabulary, silently.
 */
export function isRejection(value: unknown): value is { readonly ok: false } {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;
}

// ── A reland: one act, one answer, computed where the rows live. ──────────

/**
 * What {@link DataProvider.replaceRows} answers when the rows are in place.
 *
 * `delta` is the ONE shape every engine owes for it ({@link RefreshDelta}):
 * counts and samples, never the rows. `columns` is the table's schema AFTER the
 * replace, read from the new rows (the memory engine's tally; the wasm engine's
 * re-DESCRIBE, or — when that cleanup step itself fails after the rows have
 * already moved — the staging table's own schema, read a moment before the
 * replace, which is byte-identical to it), so a caller that remembered the old
 * names can say which are gone without a second call.
 */
export interface RelandResult {
  readonly ok: true;
  readonly delta: RefreshDelta;
  readonly columns: readonly ColumnInfo[];
}

/** What a reland is told: the declared row key, if any — with it the delta is exact, without it the table is `replaced`. */
export interface RelandOptions {
  readonly key?: string;
}

// ── The DataProvider interface itself (D24 build step 1). ──────────────────

/**
 * A plain, honest surface over ONE of the three D24 engines. Every method is
 * `Promise`-returning — including on `memoryProvider`, which could answer
 * synchronously — so a caller can swap `engine` without touching call sites
 * (the D24 invariant: engine choice never changes commit semantics, and it
 * must not change the CALLING code's shape either).
 */
export interface DataProvider {
  readonly engine: ResolvedEngine;
  readonly capabilities: DataProviderCapabilities;

  /**
   * Known table names. Typed to allow rejection (not just `evaluate`/
   * `columns`) for the same reason a real server/wasm engine can genuinely
   * fail to ENUMERATE tables (a dropped connection, an unauthenticated
   * session) even though `memoryProvider` never does — R14 consistency
   * across all four methods, not a per-method special case.
   */
  tables(): Promise<readonly string[] | DataProviderRejection>;

  /** Column info for one table, or a typed rejection if the table is unknown. */
  columns(table: string): Promise<readonly ColumnInfo[] | DataProviderRejection>;

  /**
   * Evaluate a predicate clause against a table. `clause: null` means "no
   * filter" — matches every row, mirroring an inactive/cleared Mosaic clause.
   * A LIST of clauses is their AND — the whole live selection in one query,
   * so the session never folds rows in JavaScript after the engine answered.
   */
  evaluate(
    table: string,
    clause: PredicateClause | readonly PredicateClause[] | null,
    options?: EvaluateOptions,
  ): Promise<EvaluateResult | DataProviderRejection>;

  /**
   * WHERE IS THE NEXT MATCH — the one question a consumer cannot answer for
   * itself without walking the table (see {@link FindOptions}).
   *
   * OPTIONAL, and the option is the honesty: a provider that cannot answer it
   * leaves the method off and declares `capabilities.canFind` absent/false, and
   * the caller refuses in words (`unsupported-find` at the session door). It is
   * a READ in the strictest sense — the view is unchanged, nothing is staged,
   * and the answer is a POSITION plus the counts a reader is owed.
   *
   * Refusals are the same vocabulary `evaluate` speaks: `unknown-table`,
   * `unknown-column` for a column the table lacks, `unsupported-sort` for an
   * engine that cannot order, and `bad-find` for a malformed ask.
   */
  find?(
    table: string,
    clause: PredicateClause | readonly PredicateClause[] | null,
    options: FindOptions,
  ): Promise<FindResult | DataProviderRejection>;

  /**
   * REPLACE A TABLE'S ROWS IN PLACE, AND SAY WHAT CHANGED. The refresh law
   * (src/data/README.md): a refresh is one act with one answer, and the engine
   * that HOLDS the rows computes it — the memory engine diffs its arrays, the
   * wasm engine lands a staging table and asks SQL; no row leaves either.
   *
   * OPTIONAL, the way `find` is: an engine that cannot re-land leaves the method
   * off and `capabilities.canReland` absent, and the caller refuses in words.
   * The provider stays the SAME object across the act, so nothing that holds a
   * reference to it goes stale; every cache it keeps over the old rows (a sort
   * permutation, a remembered schema) is dropped by the act itself.
   *
   * The compare runs over the columns the NEW rows carry: a column the old rows
   * had and the new do not is stripped before the compare (a column an analysis
   * materialised is not in the new bytes, and is reported by the caller, never
   * read as "every row updated"); a column the new rows ADD is a change to every
   * row that carries it.
   */
  replaceRows?(table: string, rows: readonly Row[], options?: RelandOptions): Promise<RelandResult | DataProviderRejection>;

  /**
   * R11's landing spot: land a computed column (e.g. an L3 analysis output)
   * back into the table so it re-enters the data space as an ordinary,
   * filterable column. `values` must align positionally with the table's
   * existing row order.
   */
  materializeColumn(
    table: string,
    name: string,
    values: readonly unknown[],
  ): Promise<{ readonly ok: true } | DataProviderRejection>;
}
