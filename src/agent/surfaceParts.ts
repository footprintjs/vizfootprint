/**
 * VOLATILITY, AS DATA — what a reader may keep, and for how long.
 *
 * A Lens serves what this reader needs now. That only works if the reader can
 * tell which parts of an answer are worth keeping: caching `rules` for the
 * life of a dashboard is free and correct, caching `activeSelections` for one
 * turn is a lie waiting to happen. Until this table the difference was
 * knowable only by reading the session's source, so every consumer either
 * cached nothing or cached wrongly.
 *
 * ── TWO AXES, NOT ONE ────────────────────────────────────────────────────────
 *
 * Scope and rate of change are different facts and a single "cache this for N
 * seconds" number conflates them. `sources` changes rarely but is a claim
 * about the DASHBOARD, so two sessions may share it; `paths` changes on every
 * act but is a claim about ONE session, so it may never be shared even if it
 * were still. One axis cannot say both.
 *
 *  - **`scope`** — *whose answer is this?* `global` (the dashboard: its
 *    definition and its data — the same for every reader) · `principal` (this
 *    acting principal) · `session` (this session's own records) · `turn` (this
 *    position — it is a claim about where the cursor is standing).
 *  - **`stability`** — *how does it change?* `immutable` (never, for the life
 *    of the build) · `versioned` (only with a version the answer carries, so a
 *    reader can compare) · `volatile` (whenever, with nothing to compare).
 *
 * `cacheClass` is DERIVED from the two by {@link cacheClassOf} — one function,
 * so the derivation is stated once and cannot drift row to row.
 *
 * ── POLICY AS DATA ───────────────────────────────────────────────────────────
 *
 * {@link SURFACE_PARTS} is a plain frozen array a host can read, filter, or
 * replace wholesale. It is served under `parts` in `whats_here` so a model
 * learns the same policy a host has, and it is byte-stable, so serving it
 * costs a delta nothing.
 *
 * **No part is `principal`-scoped today.** The value is in the vocabulary
 * because a host that serves per-viewer answers over one dashboard needs it,
 * and this table is policy a host may replace. Saying so here is cheaper than
 * a reader inferring the axis is only three-valued and building on that.
 */

/** Whose answer a part is — see the file header. */
export const PART_SCOPES = ['global', 'principal', 'session', 'turn'] as const;
export type PartScope = (typeof PART_SCOPES)[number];

/** How a part changes — see the file header. */
export const PART_STABILITIES = ['immutable', 'versioned', 'volatile'] as const;
export type PartStability = (typeof PART_STABILITIES)[number];

/**
 * What a reader may do with a part.
 *
 *  - `stable`   — keep it while `basis.revision` and `basis.data` still hold.
 *  - `session`  — keep it for this `basis.session`, and never share it.
 *  - `volatile` — do not keep it; it is a claim about a position, or it moves
 *                 with nothing to compare.
 */
export const CACHE_CLASSES = ['stable', 'session', 'volatile'] as const;
export type CacheClass = (typeof CACHE_CLASSES)[number];

/** One row of the table: a top-level part of the served answer, and what a reader may do with it. */
export interface SurfacePart {
  /** The part's key in the answer. */
  readonly part: string;
  readonly scope: PartScope;
  readonly stability: PartStability;
  /** Derived from the two above by {@link cacheClassOf} — carried so a reader never has to re-derive it. */
  readonly cacheClass: CacheClass;
}

/**
 * The ONE derivation, so the two axes reduce to advice the same way in every
 * row. A part that is a claim about a position, or that moves with nothing to
 * compare, may not be kept. Anything else may be kept for as long as its scope
 * is still the reader's.
 */
export function cacheClassOf(scope: PartScope, stability: PartStability): CacheClass {
  if (scope === 'turn' || stability === 'volatile') return 'volatile';
  if (scope === 'session' || scope === 'principal') return 'session';
  return 'stable';
}

/** Build one row, deriving its `cacheClass` so a hand-written row can never disagree with {@link cacheClassOf}. */
function row(part: string, scope: PartScope, stability: PartStability): SurfacePart {
  return Object.freeze({ part, scope, stability, cacheClass: cacheClassOf(scope, stability) });
}

/**
 * THE TABLE. Every row was decided from the code that produces the part, not
 * from what its name suggests — the churn arm of `bench/surface` is the
 * evidence for the `turn` rows, and `src/session/session.ts`'s `overview()` is
 * the evidence for the rest.
 *
 * The order is the ANSWER's own key order, so a reader can hold this beside a
 * served answer and read down both at once.
 *
 * The answer's ENVELOPE — `ok`, `basis`, `omitted`, `since` — has no row and
 * is never omitted: `ok` is what a reader branches on, `basis` is what it
 * compares against, and the other two exist only to say what this answer left
 * out. A courier's stamp is not one of the pages.
 */
export const SURFACE_PARTS: readonly SurfacePart[] = Object.freeze([
  // ── the definition: decided when the dashboard was built, still until it is rebuilt ──
  row('defaultTable', 'global', 'immutable'),
  // the link GRAPH is not the def's edge list: `applyLinkOverrides` lays this branch's `link` edits over it
  row('links', 'turn', 'volatile'),
  row('rules', 'global', 'immutable'),
  row('encodingPolicy', 'global', 'immutable'),
  // views carry each view's own + effective encodings and its prose at the cursor — a rebind or a describe moves them
  row('views', 'turn', 'volatile'),
  row('dashboard', 'turn', 'volatile'),
  row('notes', 'turn', 'volatile'),
  // saved pictures and bookmarks live on the DASHBOARD's stores, shared by every session, written by any session's doors
  row('saved', 'global', 'volatile'),
  row('bookmarks', 'global', 'volatile'),
  // ── the position: every one of these is a claim about where the cursor stands ──
  row('activeSelections', 'turn', 'volatile'),
  row('filters', 'turn', 'volatile'),
  row('clearedSelections', 'turn', 'volatile'),
  // the offers LIST is the declared voices of the link graph's views — it does not move with the cursor (`src/session/offers.ts`)
  row('offers', 'global', 'immutable'),
  row('asOf', 'turn', 'volatile'),
  // ── the data: what each source vouched for, and the record of every refresh ──
  row('sources', 'global', 'versioned'),
  row('keys', 'global', 'immutable'),
  row('tables', 'global', 'immutable'),
  // a refresh may land at any moment and journals even when nothing moved — there is no version to compare
  row('journal', 'global', 'volatile'),
  row('journalTotal', 'global', 'volatile'),
  row('selectedRowCount', 'turn', 'volatile'),
  // readiness is judged against the selected row count and the columns at this cursor
  row('analyses', 'turn', 'volatile'),
  // the FDR and gap ledgers are this session's record of what it asked for — never derived from the log
  row('fdr', 'session', 'volatile'),
  // branch-scoped: a column an analysis materialised is hidden off its branch
  row('columns', 'turn', 'versioned'),
  row('encodings', 'turn', 'volatile'),
  row('effectiveEncodings', 'turn', 'volatile'),
  row('layouts', 'turn', 'volatile'),
  row('gaps', 'session', 'volatile'),
  row('currentView', 'turn', 'volatile'),
  row('engines', 'global', 'immutable'),
  row('time', 'turn', 'volatile'),
  // the named refs and their journal are this session's, beside the log
  row('paths', 'session', 'volatile'),
  // session-local by design (README law 5): a proposal spends ledger budget when it is made, and `onPath` moves with the cursor
  row('charts', 'session', 'volatile'),
  // this table itself: a module constant, the same for every dashboard, session and turn
  row('parts', 'global', 'immutable'),
]);

/** Every part name, for the refusal sentence and the `of` check. Insertion-ordered, like the table. */
export const SURFACE_PART_NAMES: ReadonlySet<string> = new Set(SURFACE_PARTS.map((p) => p.part));
