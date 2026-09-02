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
 *   - `src/log/log.ts:60-65` — `CommitRecord.kind: 'point' | 'interval'`,
 *     `field: string`, `value: unknown`.
 *   - `src/mosaic/causeClause.ts:31-48` — `CauseClauseSpec` carries the same
 *     two kinds; L2 does not emit anything else today. `'match'` below is an
 *     ADDITIONAL trivial clause kind this layer offers (a plain IN-list) —
 *     it is NOT Mosaic's own `clauseMatch` (text search: contains / prefix /
 *     regex, `node_modules/@uwdata/mosaic-core/dist/src/SelectionClause.js:121-140`)
 *     and nothing in L2 emits it; it exists because the packet asked for
 *     "match if trivial" and an IN-list is a genuinely trivial predicate to
 *     add without pretending to implement Mosaic's fuzzy-match semantics.
 *
 * R14 (honest capability declaration + typed rejection, never a silent
 * no-op — the family's "honest absence" pattern, mirrored from
 * `src/analysis/types.ts:61-73`'s `DegenerateResult`) runs through this
 * whole module: `DataProvider.capabilities` declares what an engine CAN do;
 * every operation that cannot be honored returns a `DataProviderRejection`
 * (a discriminated union member, `{ ok: false, reason, ... }`), never an
 * empty/undefined stand-in for "didn't work."
 */

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

export type PredicateClause = PointClause | IntervalClause | MatchClause | CellClause;

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
 * Every column a clause reads — ONE field for point/interval/match, BOTH for
 * a cell (D30). The single place an engine asks "which columns must exist for
 * this clause?" so no consumer ever forks on `kind` for it.
 */
export function clauseFields(clause: PredicateClause): readonly string[] {
  return clause.kind === 'cell' ? clause.fields : [clause.field];
}

// ── evaluate() surface: "rows or count surface" (D24 build step 1). ───────

export interface EvaluateOptions {
  /** Default `'rows'`. `'count'` skips materializing row objects — the cheap surface for gap/threshold checks. */
  readonly mode?: 'rows' | 'count';
  /** Optional column projection. Ignored in `'count'` mode. Absent = all columns. */
  readonly columns?: readonly string[];
  /** Optional row cap (rows mode only). A provider MAY still return fewer per `capabilities.maxRows`. */
  readonly limit?: number;
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
}

// ── R14: honest capability declaration + typed rejection. ─────────────────

export interface DataProviderCapabilities {
  /** Does this engine actually EXECUTE the resolved SQL against a real query engine (vs. evaluating predicates in JS)? */
  readonly canEvaluateSQL: boolean;
  /** Can `materializeColumn` land a new column (R11's landing spot)? */
  readonly canMaterialize: boolean;
  /** Soft cap this engine is comfortable with, if any. `undefined` = no declared cap. */
  readonly maxRows?: number;
}

/** Typed reason codes — every rejection names one; never a bare `false`/`undefined`. */
export type RejectionReason =
  /** The engine is a stub — no backend is wired yet (wasm/server today). */
  | 'not-implemented'
  /** A backend handle (Coordinator / DuckDB-WASM connection) was required but not supplied. */
  | 'no-backend-connection'
  /** The named table is not known to this provider. */
  | 'unknown-table'
  /** The clause's `field` is not a column of the named table. */
  | 'unknown-column'
  /** `materializeColumn`'s `values` length does not match the table's row count. */
  | 'row-count-mismatch'
  /** The clause carries a literal type this engine cannot honestly render as SQL (e.g. a nested object). */
  | 'unsupported-literal';

export interface DataProviderRejection {
  readonly ok: false;
  readonly engine: ResolvedEngine;
  readonly operation: 'evaluate' | 'materializeColumn' | 'tables' | 'columns';
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

export function isRejection(value: unknown): value is DataProviderRejection {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;
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
   */
  evaluate(
    table: string,
    clause: PredicateClause | null,
    options?: EvaluateOptions,
  ): Promise<EvaluateResult | DataProviderRejection>;

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
