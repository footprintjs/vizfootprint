# vizfootprint — SPEC

> Status: **draft for adjudication** (P2). One npm package, layered subpaths, promoted
> from four verified spikes (x1 replay · x2 FDR · x3 why-join · x4 bench). Every claim
> about existing code cites `file:line`. Where the decided architecture and the spike
> code disagree, the conflict is **flagged, not silently resolved** (see
> §8 "Architecture ↔ spike conflicts").
>
> Trust the code where any prose here disagrees. Q1/Q2 are resolved in-code; the open
> questions carried forward are in §7.

---

## 1. One-page overview

### What

vizfootprint is a **causal / agent-provenance layer for coordinated interactive
visualization**. It sits *beside* [Mosaic](https://idl.uw.edu/mosaic/) (its sole runtime
dependency, `@uwdata/mosaic-core`) and gives every state-changing interaction a **two-slot
cause** — *who requested it* and *who computed it*, each ∈ `{user, agent, system}` — then
records those causes into an **append-only, branch-capable log** that can be **replayed**
into a fresh Mosaic `Selection` with byte-identical behavior. On top of that log it adds:
**declared analyses** (executed as footprintjs flowcharts) under **online false-discovery
control**, an **agent-driving surface** (dispatch verbs + tools/MCP, symmetric with
hcifootprint), and a cross-tier **`why(x)`** that joins a visualization interaction to the
agent decision and the backend computation that produced a value.

The organizing principle, inherited from the footprintjs family: **collect provenance
*during* the interaction, never reconstruct it post-hoc.** A cause is inert, schema-validated
data (never model-authored code); replay is a *mode*, not a rewrite; hypotheses are *declared*,
never inferred from a brush.

### Why

Two failure modes motivate the layer, each demonstrated by a spike:

- **Agentic p-hacking.** When an agent adaptively brushes subset after subset and tests each,
  a batch multiple-comparison correction (Benjamini–Hochberg) is *the wrong tool* — its
  guarantee covers a single application to a fixed, pre-specified family. x2 measures this: over
  10 000 seeded pure-noise sims, BH *peeking at each step* realizes FDR ≫ α while LORD++ holds
  ≤ α (`spikes/x2-fdr/a2-batch-bh-wrong.test.ts:48-114`). vizfootprint answers with **online**
  FDR (LORD++ / alpha-investing).

- **"Why is this number what it is?"** across a viz → agent → backend stack. x3 shows a single
  `correlationId` threading all three tiers lets `why(rowCount)` return the **minimal** commit
  set by *joining slicers that already exist* — footprintjs `sliceForKey` on the kernel log +
  the agent tool-call frame + the viz cause-log commit — with decoys excluded
  (`spikes/x3-why-join/x3.test.ts`).

And a performance constraint that makes the log adoptable: the commit log must **never** enter
Mosaic's 60 Hz interaction hot path. x4 proves it — a real headless-Chromium 3 s/60 Hz brush
(180 `Selection.update` calls over 100k rows) with the log attached adds **0 long tasks /
0.00 ms TBT** versus logging disabled, committing exactly once at gesture end
(`bench/x4/x4.test.ts`; measured numbers in commit `6ff7a4e`).

### Non-goals (explicit)

- **No coordination layer.** Mosaic owns cross-filtering, query optimization, and the
  `Selection`/`Client` protocol. vizfootprint tags and logs clauses; it does not re-implement
  coordination.
- **No clause engine.** We build *real* Mosaic clauses via `clausePoint`/`clauseInterval`
  (`src/mosaic/causeClause.ts:14`) and ride a `cause` field on the clause metadata superset. We
  do not parse, evaluate, or rewrite predicates.
- **No replay-graph / no time-travel debugger UI.** Replay is a deterministic re-application of
  the log into a fresh selection; visualization of the branch tree is a downstream concern
  (explainable-ui family), not this package.
- **No charting library.** Plots come from Mosaic / Vega-Lite encodings referenced in the
  dashboard def. vizfootprint renders nothing itself.
- **No DuckDB competitor.** Query execution is Mosaic's DuckDB-WASM connector. x4 stubs it out
  only to isolate main-thread cost (`bench/x4/runner.mjs:44-57`); the shipped layer never touches
  the data engine.
- **No model-authored code (R12).** The agent authors *declarative data* validated against a
  schema. A `cause.intent` string, an injection payload, a `label` — all inert. Nothing in the
  cause/clause/def path is ever `eval`'d or dispatched-on (`src/cause/cause.ts:11-12,108-116`).

### Layer map

| subpath | layer | one job | status |
|---|---|---|---|
| `vizfootprint/cause` | **L0** | two-slot `Cause` type + validators + replay marker | **shipped** (`src/cause/`) |
| `vizfootprint/log` | **L1** | append-only branching commit log; `CommitRecord` wire shape; replay | **spike** (`spikes/x1-replay/log.ts`) → promote |
| `vizfootprint/mosaic` | **L2** | `SourceRegistry` (identity), `causeClause`, `CauseMetadata` | **shipped** (`src/mosaic/`) |
| `vizfootprint/analysis` | **L3** | `kind:'test'` analyses as footprintjs flowcharts; outputs extend the data space | **greenfield** (pattern in `spikes/x3-why-join/kernel.ts`) |
| `vizfootprint/fdr` | **L4** | online FDR (LORD++ / alpha-investing) over declared analyses | **shipped** (`src/fdr/`) |
| `vizfootprint/agent` (+ `/mcp`) | **L5** | dispatch verbs, def schema, `vizAsTools` / `mcpServer`, gap ledger | **greenfield** (grammar mirrors hcifootprint) |
| `vizfootprint/why` | **L6** | `CorrelationEnvelope` join over `sliceForKey` + agent frames + viz log | **spike** (`spikes/x3-why-join/`) → promote |

### API grammar (family-symmetric with hcifootprint)

```
buildDashboard(def)            →  Dashboard          // L5 · declarative, offline, no API key
  .createSession(opts?)        →  InteractionSession // L2+L1 · one live Mosaic Selection + log
    .mountView(viewId, client)                       // register a Mosaic client under an actor identity
    .dispatch(action)          →  DispatchResult     // L5 · R4 semantic dispatch, zero synthetic input
    .declareAnalysis(id, def)  →  AnalysisHandle      // L3 · R6 declared, R7 online-FDR gated
    .why(target)               →  CorrelationEnvelope | CrossTierMiss   // L6
vizAsTools(session)            →  ToolPort           // L5 · fixed tool surface (mirrors skillsAsTools)
mcpServer(session)             →  Server             // L5/mcp · @modelcontextprotocol/sdk Server
```

hcifootprint parallel, for reference: `buildNavigationGraph(...) → graph.createSession() →
skillsAsTools(session)` / `mcpServer(session)` (`hcifootprint/README.md:108,133,250`). Same
three-beat shape: **declare → connect → serve.**

---

## 2. L0 — cause (`vizfootprint/cause`) · SHIPPED

The smallest honest unit of provenance. **No lower dependency.**

### Public API (all live at `src/cause/cause.ts`, barrelled at `src/cause/index.ts`)

```ts
type Actor = 'user' | 'agent' | 'system';                 // cause.ts:15
const ACTORS: readonly Actor[];                            // cause.ts:18

interface Cause {                                          // cause.ts:25-40
  requestedBy: Actor;      // who initiated the intent
  computedBy: Actor;       // who produced the value / clause
  replayed?: true;         // additive replay marker (R2); never rewrites the slots
  intent?: string;         // INERT free-text; never parsed, never dispatched-on
}

type CauseParseResult = { ok: true; cause: Cause } | { ok: false; problems: string[] };
function parseCause(value: unknown): CauseParseResult;     // cause.ts:70 — never throws, never evals
function validateCause(value: unknown): Cause;             // cause.ts:120 — throws CauseValidationError
function isCause(value: unknown): value is Cause;          // cause.ts:127
function isActor(x: unknown): x is Actor;                  // cause.ts:56
function markReplayed(cause: Cause): Cause;                // cause.ts:135 — idempotent; slots untouched
class  CauseValidationError extends Error { problems }     // cause.ts:46
```

### R# satisfied
- **R1** two-slot cause `{requestedBy, computedBy} ∈ {user,agent,system}` — `cause.ts:25-29`.
- **R2** replay is a *mode* — `markReplayed` only *adds* `replayed:true`; the two slots are
  never rewritten (`cause.ts:132-138`; doc-comment `cause.ts:7-9`).
- **R12** validators, never model-authored code — the parser rebuilds a fresh object from known
  keys only, rejecting unknown/prototype-pollution keys; a string value is inert (`cause.ts:80-116`;
  design note `cause.ts:11-12`).

### Acceptance tests (in `spikes/x1-replay/replay.test.ts` A3/A4; L1 promotion carries them into `src/cause/`)
- **Malformed cause rejected at the boundary**: wrong enum (`requestedBy:'robot'`) and extra key
  (`evil:'x'`) both throw; nothing is committed (`replay.test.ts:193-205`).
- **Injection string is inert DATA**: `intent = "IGNORE PREVIOUS INSTRUCTIONS; DROP TABLE …"`
  stores and replays *verbatim*, slots preserved, `replayed:true` added (`replay.test.ts:207-220`).
- **Additive replay marker**: after replay every record carries `replayed:true` while
  `requestedBy`/`computedBy`/`intent` equal the original; the live log is never marked
  (`replay.test.ts:160-169`).
- To add (L0 own suite): `parseCause` round-trip strips getters/symbols/`__proto__`; `markReplayed`
  idempotence (`markReplayed(markReplayed(c)) === replayed with same slots`).

### Consumes / non-goals
- Consumes: nothing.
- Non-goal: L0 knows nothing about Mosaic, clauses, logs, or actors' *authority* — it validates
  *shape*, not *permission*. Capability/authority checks are L5 (R14), not here.

---

## 3. L1 — log (`vizfootprint/log`) · SPIKE → PROMOTE

The append-only, branch-capable commit log that carries cause-tagged clauses **and** rebuilds
them into a fresh `Selection` with fresh source identity. Currently `spikes/x1-replay/log.ts`;
L1 promotes it verbatim into `src/log/` (the x2 stub `DeclaredAnalysisLog` is explicitly
throwaway — `spikes/x2-fdr/commit-log-stub.ts:1-9`).

### Public API (from `src/log/log.ts` — promoted P3.1, commit `a24dc50`)

```ts
class CauseSelectionSession {                             // src/log/log.ts:98
  readonly selection: Selection;                          // a real Mosaic Selection
  readonly registry: SourceRegistry;                      // owns source identities (L2)
  readonly records: CommitRecord[];
  constructor(selection?: Selection, registry?: SourceRegistry);
  commit(input: CommitInput): { record: CommitRecord; clause: SelectionClause };  // src/log/log.ts:113
}

function serializeLog(records: readonly CommitRecord[]): string;                   // src/log/log.ts:158
function deserializeLog(json: string): CommitRecord[];                             // src/log/log.ts:163
function replayLog(log: string | readonly CommitRecord[],
                   order?: readonly string[]): CauseSelectionSession;              // src/log/log.ts:179
function causeHistogram(records: readonly CommitRecord[]): Record<string, number>; // src/log/log.ts:216
```

`commit()` is the single write path shared by live authoring **and** replay, so their behavior
is identical by construction (`src/log/log.ts:93-98`). It: validates the cause (R12 gate again at the
log boundary — `src/log/log.ts:114`), reconstructs source identity from the registry, builds the
cause-tagged clause, applies it to the `Selection`, and appends the record.

### R# satisfied
- **R2** (replay mode) + **byte-identical histogram** — `causeHistogram` deliberately excludes
  `replayed`/`intent` so it is invariant across replay (`src/log/log.ts:211-223`); proven byte-identical
  in `src/log/log.test.ts:167-173`.
- **R5** spatial interactions commit **DATA-space** values — `CommitRecord.value` stores the data
  interval `[10,20]` / point `'Data'`, not pixels; replay rebuilds identical predicate SQL in a
  fresh selection (`src/log/log.test.ts:187-194`; `src/log/branch.test.ts:27-35`). *(Viewport/library
  independence is asserted via SQL determinism, not yet across two rendering libraries — see Q4.
  P3-L2 strengthens the DATA-space-in half explicitly — see `src/log/viewport-replay.test.ts` and
  `src/mosaic/emission.test.ts`'s R5 block — but does not close Q4's cross-library claim.)*
- **R8** append-only branching — `parent: string | null` chains commits; siblings branch off one
  parent; each branch replays into its own fresh selection (`src/log/branching.fixture.ts:24-91`;
  `src/log/branch.test.ts:12-41`).
- **R13** commit-on-intent — one commit per gesture (the session's single write at gesture end);
  proven in x4 (`bench/x4/x4.test.ts:64-81`).
- **R15** the log stays out of the 60 Hz hot path — x4 (see §6).
- Supports **R10** — first-class `CommitRecord.correlationId` cross-tier join key (`src/log/log.ts:45-55`).

### Acceptance tests
- **Self-exclusion identical pre/post replay** (A1): view A never sees its own clause but does
  see B, before AND after replay into a fresh Selection+registry; fresh objects (`!== `), identical
  predicate sets (`src/log/log.test.ts:88-124`).
- **`remove(source)` after replay** (A2): removing the replayed source-for-A leaves exactly B;
  original selection unchanged (remove returns a clone) (`src/log/log.test.ts:128-142`).
- **Branching replays independently** (R8): two sibling branches off `c1` produce different,
  deterministic selections; same path replays byte-identically twice; unknown commit id in a path
  throws (`src/log/branch.test.ts:12-41`).
- **`correlationId` is first-class, replay-preserved** (A5, D20/P3): `commit()` lands
  `correlationId` on the record; **absent** (not undefined-valued) when unsupplied; survives
  serialize→replay verbatim while still marking `replayed:true`; `id !== correlationId`
  (`src/log/log.test.ts:238-271`).

### Consumes
- L0 `validateCause`, `markReplayed`, `Cause` (`src/log/log.ts:31`).
- L2 `SourceRegistry`, `causeClause`, `ActorMeta`, `CauseClauseSpec` (`src/log/log.ts:32-37`).
- `@uwdata/mosaic-core` `Selection`, `SelectionClause` (`src/log/log.ts:29-30`).

### Non-goals
- **Not** a general event bus — it logs *state-changing clause commits*, not every UI event.
- **Not** a persistence layer — `serializeLog`/`deserializeLog` are plain JSON round-trips
  (`src/log/log.ts:158-167`); a caller chooses storage. `value` **must be JSON-serializable** (`src/log/log.ts:64-65`).
- Branch *selection* is by explicit id-path (`replayLog(log, order)`); the log does not choose a
  branch policy.

---

## 4. L2 — mosaic (`vizfootprint/mosaic`) · SHIPPED

Restores Mosaic's non-serializable **object-identity** source model across replay, and rides the
two-slot cause on the clause metadata as a *strict superset* of Mosaic's own `ClauseMetadata`.

### The identity problem it solves
A Mosaic `SelectionClause` identifies its origin by **object identity**
(`ClauseSource = object & { reset?: () => void }` — cited at `SourceRegistry.ts:5-7` from the
installed `SelectionClause.d.ts:56-69`), and every identity-dependent op is a reference compare
or `Set.has` (`remove(source)` filters `source !== c.source`; cross-filter self-exclusion is
`clause.clients.has(client)` — cited at `SourceRegistry.ts:10-14`). Object identity cannot be
serialized. `SourceRegistry` restores it by **reconstruction**: a stable string `viewId` → one
live source object per registry; a fresh registry rebuilds fresh objects for the same ids, so
every replayed clause shares one consistent identity again (`SourceRegistry.ts:16-19,69-99`).

### Public API (`src/mosaic/`, barrelled at `src/mosaic/index.ts`)

```ts
class SourceRegistry {                                    // SourceRegistry.ts:74
  register(viewId: string, actorMeta: ActorMeta): RegisteredSource;   // idempotent; throws on conflicting re-register
  get(viewId): RegisteredSource | undefined;  require(viewId): RegisteredSource;  has(viewId): boolean;
  ids(): string[];  get size(): number;
}
class SourceRegistryError extends Error {}                // SourceRegistry.ts:46

interface ActorMeta { actor: Actor; label?: string; }     // SourceRegistry.ts:24
interface RegisteredSource { readonly viewId: string; readonly meta: ActorMeta; reset?(): void; } // :36

interface CauseMetadata extends ClauseMetadata { cause: Cause; }  // causeClause.ts:20 — the superset
interface CauseClause extends SelectionClause { meta: CauseMetadata; }  // causeClause.ts:26
type CauseClauseSpec =                                    // causeClause.ts:31-48
  | { kind: 'point';    source: RegisteredSource; field: string; value: unknown;             cause: Cause; clients?: RegisteredSource[] }
  | { kind: 'interval'; source: RegisteredSource; field: string; value: [number, number]|null; cause: Cause; clients?: RegisteredSource[] };

function causeClause(spec: CauseClauseSpec): CauseClause;  // causeClause.ts:66 — validates cause first (R12)
function causeOf(clause: SelectionClause): Cause | undefined;  // causeClause.ts:85
```

Why the meta superset is safe (Q2, **resolved**): Mosaic's pre-aggregator reads clause metadata
by destructuring known fields and switching on `meta.type` — it never enumerates or rejects
unknown keys, so `meta.cause` rides untouched into query generation (`causeClause.ts:1-12`,
citing installed `PreAggregator.js:192-206`).

### R# satisfied
- **R1** the cause is *carried on the clause* (`CauseMetadata.cause` — `causeClause.ts:20-23`).
- **R3** symmetric adapter — **echo suppression is from the clause, never a flag**: the registry
  source identity + cross-filter `clients` self-exclusion is what makes a view not see its own
  clause (`causeClause.ts:50-60`; `SourceRegistry.ts:10-14`), proven identity-stable across replay
  in `src/log/log.test.ts:88-124`. *(The **mandatory outbound typed emit carrying origin** half of R3
  is designed at L5's adapter contract — see §6 and Q3.)*
- **R12** malformed causes never enter the clause stream — `causeClause` calls `validateCause`
  before building anything (`causeClause.ts:67`).

### Acceptance tests
- `src/mosaic/SourceRegistry.test.ts` and `src/mosaic/causeClause.test.ts` (shipped); plus the L1
  end-to-end A1/A2 which exercise identity across replay.
- To add on promotion: `causeClause` cross-filter — a two-view registry where `clients` excludes
  only self (already exercised via A1), and a `causeOf(round-trip)` equality.

### Consumes
- L0 `validateCause`, `Cause`, `Actor` (`causeClause.ts:16`; `SourceRegistry.ts:21`).
- `@uwdata/mosaic-core` `clausePoint`, `clauseInterval`, `SelectionClause`, `ClauseMetadata`,
  `MosaicClient` (`causeClause.ts:14-15`). **This is the package's sole runtime dependency**
  (`package.json:23-25`).

### Non-goals / known seam
- **Q9 (open)**: `clients` is typed `Set<MosaicClient>` but the only runtime use is identity
  `Set.has`, so the spike localizes an unsafe cast `new Set(sources) as unknown as Set<MosaicClient>`
  (`causeClause.ts:58-60`; repeated `replay.test.ts:78-81`). L2 promotion must **resolve this cast
  properly** — see §7 Q9. Not a correctness bug today (identity-only use), but a type-honesty debt.

---

## 5. L3 — analysis (`vizfootprint/analysis`) · GREENFIELD

Declared analyses executed **as footprintjs flowcharts**, whose outputs **extend the data space**
so the agent (L5) and the log (L1) treat an analysis result as *just more columns/geometry/scalars/
tables* — filterable through ordinary predicates, with **zero new dispatch verbs**.

> No L3 code exists yet. The **execution pattern** is demonstrated by the x3 kernel
> (`spikes/x3-why-join/kernel.ts:60-108`): a footprintjs `flowChart(...).addFunction(...).build()`
> whose stages read tracked keys and write named outputs into committed state, so
> `getSnapshot().commitLog` + `sliceForKey` can slice it (R9). L3 generalizes that into a declared,
> schema-validated analysis module. This is the **highest design risk** in the package.

### Proposed public API

```ts
type AnalysisKind = 'test' | 'transform';   // 'test' arms L4 (R6/R7); 'transform' is FDR-exempt

// Output shapes — the R11 vocabulary. NEVER a row-id list.
type AnalysisOutput =
  | { as: 'columns';  table: string; columns: Record<string, ColumnSpec> }  // e.g. adds cluster_id : int
  | { as: 'geometry'; layer: string; features: GeoSpec }                    // hulls, contours, regressions
  | { as: 'scalar';   name: string;  value: number | string | boolean }     // e.g. corr coefficient
  | { as: 'table';    name: string;  schema: TableSchema };                  // summary tables

interface AnalysisDef<I = unknown> {
  readonly id: string;
  readonly kind: AnalysisKind;
  readonly inputs: InputBinding[];            // columns/params/selection state read (feeds sliceForKey read-set)
  readonly output: AnalysisOutput;            // how the result RE-ENTERS the data space (R11)
  readonly test?: TestDecl;                   // required iff kind==='test': statistic + null + p-value fn (R6)
  readonly honesty?: HonestyDecl;             // degenerate-fit flags, min-n, typed rejections (R14)
  build(): FlowChart;                         // → a footprintjs flowchart (kernel.ts pattern)
}

function defineAnalysis<I>(def: AnalysisDef<I>): AnalysisModule<I>;   // validates the def (R12)
// used via the session: session.declareAnalysis(id, def) → AnalysisHandle (declares → L4-gated)
```

### R# satisfied
- **R6** hypotheses **declared never inferred** — a `kind:'test'` analysis must be *declared* with
  its statistic/null before it runs; a brush is not a test. (x2's stream is built from *declared*
  `HypothesisRecord`s, never from brushing alone — `spikes/x2-fdr/scenario.ts:52-71`.) L3's
  acceptance gate: **brush 100× → 0 test commits** unless `declareAnalysis` was called.
- **R9** `why(x)` returns the **minimal** commit set — because L3 stages write named outputs and
  read tracked keys, footprintjs `sliceForKey` finds the exact dependency chain
  (`spikes/x3-why-join/whyJoin.ts:73-82`; kernel proves the `decoy` stage is excluded —
  `x3.test.ts:109-121`).
- **R11** analysis **extends the data space** — outputs are columns/geometry/scalar/table; a
  `cluster_id` column filters through an *ordinary point/interval predicate* (L2 `causeClause`),
  introducing **no new verb** (this is the R11 acceptance criterion; see Q11).
- **R14** honest by construction — `honesty` declarations surface degenerate-fit flags and typed
  rejections rather than silently returning a fit (R14; mirrors the family's "honest absence" arm).

### Acceptance tests (to write)
- **Declared-only** (R6): a session that brushes 100 times and never calls `declareAnalysis`
  produces **0** analysis/test commits; exactly one `declareAnalysis` produces exactly one.
- **Minimal slice** (R9): an analysis with a decoy stage (writes an unread key) is sliced to
  exactly its true dependency set (port `x3.test.ts:35-44,109-121`).
- **Re-entry as predicate** (R11): a `kind:'test'` clustering analysis emits `cluster_id`; a
  subsequent `select cluster_id = 2` is an *ordinary* L2 point clause (assert the dispatch verb set
  did not grow, and the clause carries a normal cause).
- **Honest degeneracy** (R14): a regression on < min-n rows returns `{ ok:false, reason:'degenerate-fit' }`
  (typed), not a fabricated coefficient.

### Consumes
- L0 (cause on emitted clauses), L1 (writes outputs as commits), L2 (outputs re-enter as clauses),
  L4 (a `kind:'test'` output feeds the online-FDR stepper), `footprintjs` (`flowChart`,
  `FlowChartExecutor`, `getSnapshot`, `sliceForKey` — `kernel.ts:26-27`, `whyJoin.ts:20`).

### Non-goals
- **Never emits a row-id list** as an output (R11 forbids it — outputs are schema shapes that
  filter through predicates).
- Not a stats library — `test.pValue` is caller-supplied (the package brings the *machinery*
  — declaration, FDR, provenance — not the judge; cf. the family rule "we ship machinery, the
  consumer brings the metric").

---

## 6. L4 — fdr (`vizfootprint/fdr`) · SHIPPED

Online false-discovery control over the stream of declared analyses. Two procedures implemented
**exactly from the primary literature**, each exposed twice: a streaming stepper (`create*`, the
true online interface L3/L1 drive one record at a time) and a pure whole-stream fold.

### Public API (`src/fdr/`, barrelled at `src/fdr/index.ts`)

```ts
interface HypothesisRecord { readonly hypothesisId: string; readonly pValue: number;
                             readonly timestamp: number; readonly branchId?: string; }  // types.ts:20
interface FdrStep { step; hypothesisId; pValue; timestamp; branchId?; alphaThreshold;
                    reject; wealthBefore; wealthAfter; firstRejection; }                 // types.ts:36
interface FdrRun  { procedure: 'LORD++'|'alpha-investing'; alpha; w0; audit; discoveries; finalWealth; } // types.ts:60

// LORD++ (Ramdas et al. 2017, NeurIPS 30, eq. 5) — controls FDR under independence.
function createLordPlusPlus(o: LordPlusPlusOptions): { state; step(h): FdrStep };  // lordPlusPlus.ts:62
function lordPlusPlus(stream, o: LordPlusPlusOptions): FdrRun;                     // lordPlusPlus.ts:129
// LordPlusPlusOptions { alpha: number; w0?: number /*=alpha/2*/; gamma?: GammaSequence }

// alpha-investing (Foster & Stine 2008, JRSS-B 70(2), eqs. 6-9) — controls mFDR (a ratio of expectations).
function createAlphaInvesting(o: AlphaInvestingOptions): { state; step(h): FdrStep };  // alphaInvesting.ts:69
function alphaInvesting(stream, o: AlphaInvestingOptions): FdrRun;                      // alphaInvesting.ts:135
// AlphaInvestingOptions { alpha; w0?/*=alpha*/; omega?/*=alpha*/ }

const LORD_GAMMA_CONSTANT = 0.0722;               // gamma.ts:28 — Ramdas Sec. 3.1 published constant
function lordGamma(j): number; lordGammaShape(j): number;                        // gamma.ts:48,34
function sumGamma(gamma, upTo): number; normalizingConstant(upTo): number;       // gamma.ts:53,65
function makeRng(seed): Rng; mulberry32(seed); normalVector(rng, n);             // rng.ts (seeded, reproducible)
```

### R# satisfied
- **R6** declared hypotheses — the stepper consumes `HypothesisRecord`s (declared analyses), not
  brushes (`types.ts:19-33`).
- **R7** **online** correction (batch is wrong) — LORD++/alpha-investing make an immediate valid
  decision per arrival; x2/A2 shows adaptive/peeking BH grossly exceeds α while LORD++ holds
  (`a2-batch-bh-wrong.test.ts:105-113`).
- **R8** **dead ends stay in the denominator** — no procedure exposes a refund; every test draws
  wealth via `phi_t` regardless of `branchId` (`types.ts:11-17`; `lordPlusPlus.ts:105`;
  `alphaInvesting.ts:109-111`), pinned in `a3-dead-ends.test.ts:32-71`.

### Acceptance tests (all shipped)
- **A1 "reviewer number"** — p\*=0.03 (significant uncorrected) is **not** a discovery online among
  40 brushes; prints exact thresholds at n=1 vs n=40 (`a1-reviewer-number.test.ts:24-85`).
- **A2 realized FDR over 10k sims** — peeking-BH VIOLATES α by ≫10 SE; LORD++ holds ≤ α; control:
  BH-once-on-fixed-family sits at α within MC error (`a2-batch-bh-wrong.test.ts:48-114`).
- **A3 dead ends** — abandoning half the branch does not refund α; counterfactual removal leaves
  strictly *more* wealth (`a3-dead-ends.test.ts:32-71`).
- **A4 paper invariants** — γ positive & nonincreasing; partial sums ≤ 1 (conservative);
  thresholds nonincreasing with no rejections; monotone (eq. 3); wealth never negative for both
  procedures (`src/fdr/a4-invariants.test.ts:43-143`).

### Consumes
- Nothing from vizfootprint's other layers (pure). L3 drives it; L1 supplies the arrival stream.
  The x2 `DeclaredAnalysisLog` stub is throwaway — L1 replaces it (`commit-log-stub.ts:1-9`).

### Non-goals / open decisions
- **Q10 (open)**: the shipped default γ uses the published constant `0.0722`, which is
  horizon-**independent** and makes LORD++ *conservative* (partial sums reach 1 only in the
  infinite limit; `normalizingConstant` offers a horizon-normalized alternative)
  (`gamma.ts:59-67`; honest finding `a4-invariants.test.ts:55-82`). L4 must **decide** which is the
  user-facing default — see §7 Q10.
- alpha-investing controls **mFDR** (a ratio of expectations), *weaker* than the FDR LORD++
  controls — documented, not hidden (`alphaInvesting.ts:36-39`). L4 does not claim they are
  interchangeable.
- `branchId` is **optional** and drives **no** control decision (`types.ts:26-33`) — R8 holds
  structurally (no refund op), independent of whether provenance is present.

---

## 7. L5 — agent (`vizfootprint/agent`, `vizfootprint/mcp`) · GREENFIELD

The agent-driving surface. Mirrors hcifootprint's grammar exactly: a declarative def →
`createSession()` → `vizAsTools` / `mcpServer`. The agent drives **every** interaction through
**semantic dispatch** (R4) over declarative data (R12); it never synthesizes raw input events.

> No L5 code exists yet. Grammar is fixed by family symmetry (`hcifootprint/README.md:108,133,250`).

### Proposed public API

```ts
function buildDashboard(def: DashboardDef): Dashboard;   // offline, no API key; validates def (R12)
interface Dashboard { createSession(opts?: SessionOptions): InteractionSession; }

interface InteractionSession {
  mountView(viewId: string, client: MosaicClient, meta: ActorMeta): void;  // register under an actor identity
  dispatch(action: DispatchAction): DispatchResult;      // R4 · the single agent entry point
  declareAnalysis(id: string, def: AnalysisDef): AnalysisHandle;           // → L3
  why(target: WhyTarget): CorrelationEnvelope | CrossTierMiss;             // → L6
  readonly log: CauseSelectionSession;                   // → L1
  readonly gaps: GapLedger;                              // taxonomy'd unmet requests (below)
}

function vizAsTools(session: InteractionSession): ToolPort;   // fixed tool surface (mirror skillsAsTools)
function mcpServer(session: InteractionSession): Server;      // vizfootprint/mcp · @modelcontextprotocol/sdk
```

### Dispatch action vocabulary (flag **Q6**: completeness)

```ts
type DispatchAction =
  | { verb: 'select';     viewId; field; value; cause: Cause }              // point clause (L2)
  | { verb: 'filter';     viewId; field; range; cause: Cause }              // interval clause (L2)
  | { verb: 'annotate';   target; note; cause: Cause }                      // inert note commit
  | { verb: 'navigate';   viewId /* focus/mount a view */; cause: Cause }
  | { verb: 'analyze';    analysisId; inputs; cause: Cause }                // declare + run (L3/L4)
  | { verb: 'fork';       fromCommitId /* new branch */; cause: Cause }     // R8 branch (L1)
  | { verb: 'checkpoint'; label; cause: Cause };                           // name a log position
```

**Dual intent (R11 / R4):** each verb is tagged **mandatory-analytical** (must be honored or a gap
is filed) or **optional-interaction** (best-effort UI affordance). `analyze` is mandatory-analytical;
`annotate`/`navigate` are optional-interaction.

**Gap ledger** — every request the surface cannot honor is filed with a **taxonomy code**, never
silently dropped:
`{ needs-column | needs-analysis-kind | needs-view | guard-failed | needs-backend-data }`.
(Directly ports hcifootprint's gap-ledger discipline — `MEMORY.md` D17/D18.)

### R# satisfied
- **R4** agent drives every interaction via semantic dispatch, **zero synthetic input** — the only
  agent entry is `dispatch(action)`; there is no "emit raw pointermove" path.
- **R11** dual intent (mandatory analytical / optional interaction) — the verb tagging above.
- **R12** no model-authored code — `DashboardDef` and every `DispatchAction` is schema-validated
  declarative data; `cause.intent` and `annotate.note` are inert (L0 firewall reused).
- **R14** honest by construction — capability declarations in the def, typed rejections via the
  gap ledger, degenerate-fit flags surfaced from L3.

### Acceptance tests (to write)
- **Zero synthetic input** (R4): assert the tool/MCP surface exposes only semantic verbs; a probe
  that tries to push a raw DOM event has no entry point.
- **Every unmet request is a typed gap** (R14): request a nonexistent column → one gap with code
  `needs-column`; no throw, no silent drop.
- **Injection corpus** (R12): a corpus of adversarial `intent`/`note`/`label` strings round-trips
  as inert data and never alters control flow (extend `replay.test.ts:207-220` to the dispatch path).
- **Tool-surface parity with MCP** (family): `vizAsTools(session)` and `mcpServer(session)` expose
  the same verb set (mirror hcifootprint's dual surface).

### The def schema outline — a **mosaic-spec superset** (+ VL encodings)

Grounded: `@uwdata/mosaic-spec` destructures its top level as
`{ meta, config, data = {}, params, plotDefaults = {}, ...root }`
(`node_modules/@uwdata/mosaic-spec/dist/src/parse-spec.js:60`; `SpecNode` carries
`root, meta, config, data, params, plotDefaults` — `.../ast/SpecNode.d.ts:2-7`). vizfootprint's
`DashboardDef` **is a Mosaic spec** plus vizfootprint keys:

```
DashboardDef = {
  // ── inherited Mosaic-spec top-level keys (passed through untouched) ──
  meta?, config?, data, params?, plotDefaults?,      // parse-spec.js:60
  ...views,                                          // the vconcat/hconcat/plot tree (VL encodings)
  // ── vizfootprint additions ──
  actors:       Record<viewId, ActorMeta>,           // who drives each view (L2 registry seed)
  analyses?:    Record<id, AnalysisDef>,             // declared kind:test / transform (L3, gates L4)
  capabilities?: CapabilityDecl[],                   // R14 honest capability envelope
  fdr?:         { procedure: 'LORD++'|'alpha-investing'; alpha: number; w0?; omega?; gamma? },  // L4 defaults
  agent?:       { intents: IntentDecl[] }            // dual-intent tagging for dispatch verbs (R4/R11)
}
```

### Consumes
- L0/L1/L2 (cause, log, registry+clauses), L3 (`analyses`), L4 (`fdr`), L6 (`why`), and — for the
  agent runtime — `agentfootprint` (`Agent`, `defineTool`, `AgentRunOptions.correlationId`),
  `hcifootprint` grammar as the template.

### Non-goals
- Not an LLM client — `buildDashboard` and `dispatch` run offline; a caller wires their own
  provider (as x3 does with `agentfootprint` `mock` — `chain.ts:26,164`).
- Not a permission system beyond *declaring* the capability envelope; the app remains the
  authority (hcifootprint principle: the agent inherits the signed-in user's envelope).

---

## 8. L6 — why (`vizfootprint/why`) · SPIKE → PROMOTE

`why(x)` traverses **viz → agent → backend** and returns the **minimal** commit set `x` depends
on, as a **machine-shaped** answer (ids + tier tags, never prose). It is **not a new algorithm** —
it is a **join over slicers that already exist** (`spikes/x3-why-join/whyJoin.ts:2-18`): footprintjs
`sliceForKey` on the kernel commit log + the agent tool-call frame + the viz cause-log commit,
stitched by one `correlationId`.

### Public API (promote `spikes/x3-why-join/whyJoin.ts` + `chain.ts`)

```ts
// The wire join type. Spike name: JoinRecord (chain.ts:33). Promoted name: CorrelationEnvelope.
interface CorrelationEnvelope {                          // ⇐ chain.ts:33-46 (renamed)
  readonly correlationId: string;
  readonly viz:   { readonly commitId: string; readonly viewId: string; readonly cause: Cause };
  readonly agent: { readonly toolCallId: string; readonly iteration: number;
                    readonly runId: string; readonly runtimeStageId: string };  // unique addr = (runId, runtimeStageId)
  readonly kernel: KernelResult;   // footprintjs RuntimeSnapshot + rowCount + committedCorrelationId
}

// The composed answer (spike: CrossTierSlice — whyJoin.ts:33).
interface CrossTierSlice {
  readonly correlationId: string; readonly key: string;
  readonly threaded: boolean;                            // did the join key survive into COMMITTED kernel state?
  readonly kernel: { writerId: string; commitIds: string[]; stageIds: string[] };  // R9 minimal set
  readonly agent:  { toolCallId: string; runtimeStageId: string; runId: string };
  readonly viz:    { commitId: string };
  readonly commits: TierCommit[];                        // flat { tier:'viz'|'agent'|'kernel'; id; stageId? }[]
}
interface CrossTierMiss { correlationId; key; missing: 'no-join-key' | 'no-viz-commit'; }  // whyJoin.ts:53

function why(correlationId: string, envelopes: CorrelationEnvelope[] , /* joinTable+vizRecords */):
  CrossTierSlice | CrossTierMiss;   // ⇐ whyRowCount(correlationId, chain) — whyJoin.ts:63, generalized off 'rowCount'
```

### R# satisfied
- **R9** minimal, machine-shaped — `sliceForKey` yields the exact dependency chain; the answer is
  ids + tier tags with **no** free-text (proven: no `cause.intent`, no agent answer, no stage
  *name* leaks — `x3.test.ts:124-143`).
- **R10** viz → agent → backend traversal via the envelope — `why()` resolves the viz commit by its
  first-class `correlationId` **field** (not id-overload), the agent frame by `toolCallId`, and the
  kernel slice by `sliceForKey` (`whyJoin.ts:63-108`); decoys (2 viz + 1 agent + 1 kernel stage)
  excluded (`x3.test.ts:84-122`).

### Acceptance tests (all shipped, in `spikes/x3-why-join/x3.test.ts`)
- **A1 composed == hand-computed minimal set**: threaded end-to-end; kernel set is *exactly*
  `{load, filter, count}` anchored at `count#…`; agent frame is `call-corr-amt-1`; viz commit
  resolved by its `correlationId` field with `id !== correlationId` (`x3.test.ts:29-82`).
- **A2 decoys excluded**: the user-category viz commit, the second question's whole tier trail, and
  the intra-kernel `decoy` stage write (`auditNote`) never appear; **honest finding pinned as an
  assertion** — `runtimeStageId` collides across independent agent runs, so it is *not* a valid
  cross-run discriminator (`x3.test.ts:84-122`, esp. `:104-107`).
- **A3 machine-shaped**: every commit is `{tier,id}` with a known tier tag; no prose fields;
  fixed key set (`x3.test.ts:124-143`).

### Consumes
- L1 (viz `CommitRecord.correlationId`), L5 (agent frame), `footprintjs/trace` (`sliceForKey`,
  `keysReadFromExecutionTree`, `sliceToJSON` — `whyJoin.ts:20`), `footprintjs`
  (`getSnapshot`/`RuntimeSnapshot` — `kernel.ts:26-27`), `agentfootprint` (`Agent`,
  `EventMeta.{runId,runtimeStageId,correlationId}` — `chain.ts:182-188`).

### Non-goals
- No counterfactual/root-cause verdict — L6 returns the *dependency set*, not a "this is the bug"
  claim (that is the CTXBUG/localizer line in the family, not this package).
- No prose. Ever (`x3.test.ts:133-138`).

---

## 9. Wire contracts (verbatim / promoted)

### 9.1 `CommitRecord` (L1 — `spikes/x1-replay/log.ts:23-58`, verbatim)

```ts
interface CommitRecord {
  id: string;                       // stable commit id, unique within a log
  parent: string | null;           // parent commit id, or null for a root — enables branching (R8)
  correlationId?: string;          // FIRST-CLASS cross-tier join key (R10). NOT the id. Absent when unused.
  viewId: string;                  // registry key → clause source identity on replay
  actorMeta: ActorMeta;            // { actor: Actor; label?: string } — rebuilds the source in a fresh registry
  kind: 'point' | 'interval';      // which clause factory to reconstruct with
  field: string;                   // column / expression the clause filters on
  value: unknown;                  // selected value — DATA-space (R5); MUST be JSON-serializable
  clientViewIds: string[];         // cross-filter self-exclusion set (registry ids)
  predicateSQL: string;            // predicate string — replay-determinism descriptor
  cause: Cause;                    // two-slot cause (+ replayed:true once re-emitted)
  ts: number;                      // authoring timestamp (logical ok; not load-bearing)
}
```
**Design note carried verbatim** (`log.ts:29-38`): `correlationId` is first-class and independent
of `id` — `id` must stay unique per entry (parent-pointer chaining relies on it); `correlationId`
may be shared, absent, or reused by a caller's own scheme. Before this field existed, x3 overloaded
`id` as the join key (commit `e6470ec` split them).

### 9.2 `HypothesisRecord` (L4 — `src/fdr/types.ts:19-33`, verbatim)

```ts
interface HypothesisRecord {
  readonly hypothesisId: string;   // stable id of the declared analysis (a node in the provenance graph)
  readonly pValue: number;         // the test's p-value, in [0,1]
  readonly timestamp: number;      // logical arrival time (monotone within a run)
  readonly branchId?: string;      // provenance branch; a dead end still consumed wealth (R8). Optional.
}
```
Companion audit row `FdrStep` (`types.ts:36-57`) and run fold `FdrRun` (`types.ts:60-70`) carry the
full trail the papers' guarantees are stated over (`alphaThreshold`, `reject`, `wealthBefore/After`,
`firstRejection`; `procedure/alpha/w0/audit/discoveries/finalWealth`).

### 9.3 `CorrelationEnvelope` (L6 — **reconstructed** from `spikes/x3-why-join/chain.ts:33-46`)

The spike's live type is **`JoinRecord`**; "CorrelationEnvelope" is the P3 promotion name (the type
does **not** yet exist under that name — see §10 conflict C2):

```ts
interface CorrelationEnvelope {                    // = JoinRecord, renamed on promotion
  readonly correlationId: string;                  // the ONE key threading all three tiers
  readonly viz:    { readonly commitId: string; readonly viewId: string; readonly cause: Cause };
  readonly agent:  { readonly toolCallId: string; readonly iteration: number;
                     readonly runId: string; readonly runtimeStageId: string };
  readonly kernel: KernelResult;                   // RuntimeSnapshot + rowCount + committedCorrelationId
}
```
**Load-bearing honesty gate** (`whyJoin.ts:84-90`): the agent-tier unique address is
`(runId, runtimeStageId)` **or** `toolCallId` — `runtimeStageId` alone **collides across independent
agent runs** (each fresh executor over the same chart reuses execution indices, e.g.
`tool-calls#22`). The envelope therefore stores `runId` alongside `runtimeStageId`. `threaded`
(from `CrossTierSlice`) records whether `correlationId` survived into the kernel's *committed*
state; if not, the answer is honest (`threaded:false`), never faked (`whyJoin.ts:12-16,85`).

### 9.4 `Cause` (L0 — `src/cause/cause.ts:25-40`, verbatim) — see §2.

### 9.5 `DashboardDef` schema outline — see §7 ("mosaic-spec superset"), grounded at
`parse-spec.js:60`.

### 9.6 Dispatch action vocabulary — see §7. **Q6 flagged open**: completeness of
`{select, filter, annotate, navigate, analyze, fork, checkpoint}` is unproven; benchmark against a
DashboardQA-style task set (§7, §10 Q6).

---

## 10. Open questions (carried honestly)

> **Provenance caveat.** `RESEARCH_STATE` (the canonical Q-number index) is **not present in the
> repo** (searched: repo tree, git history, user memory — absent). Q1/Q2 are *resolved in code*
> and cited below. **Q6/Q9/Q10 are grounded** in the P2 packet text + code seams and are stated
> with confidence. **Q3/Q4/Q8/Q11 are RECONSTRUCTED** from the architectural seams the code leaves
> open; each is flagged `[reconstructed]` and should be reconciled against the orchestrator's
> canonical RESEARCH_STATE text before it is treated as authoritative.

**Resolved (for context):**
- **Q1** — log wire shape. *Resolved:* store the deterministic **recipe** (`kind, field, value` +
  source registry id), not a clause object graph (`source` is identity, `predicate` an AST). Bespoke
  JSONL+branch (`log.ts:1-11`).
- **Q2** — can `cause` ride on Mosaic clause metadata? *Resolved: yes* — Mosaic reads known meta
  fields only, never rejects unknown keys (`causeClause.ts:1-12` citing `PreAggregator.js:192-206`).

**Grounded open questions:**
- **Q6 — dispatch vocabulary completeness.** Is `{select, filter, annotate, navigate, analyze,
  fork, checkpoint}` (§7) *sufficient* to express the interactions a real analyst/agent needs?
  Proposed resolution: measure verb coverage against a **DashboardQA**-style task battery; a task
  that cannot be expressed files a `needs-*` gap, and the gap distribution is the completeness
  signal. **Open until benchmarked.**
- **Q9 — `MosaicClient` cast.** `clients` is `Set<MosaicClient>` but used only for identity
  `Set.has`; the spike casts `Set<RegisteredSource> as unknown as Set<MosaicClient>`
  (`causeClause.ts:58-60`; `replay.test.ts:78-81`). Resolve on promotion by one of: (a)
  `RegisteredSource implements MosaicClient` (stub the protocol methods), (b) a branded
  `ClientIdentity` type Mosaic accepts, or (c) upstream a narrower `ClauseClient = { }` identity
  type. **Decision needed; no correctness impact today.**
- **Q10 — LORD γ constant.** Ship the published horizon-independent `0.0722` (conservative; sums to
  1 only in the limit) or the horizon-normalized `normalizingConstant(H)` (calibrated per session,
  looser thresholds)? (`gamma.ts:44-67`; `a4-invariants.test.ts:55-82`). Recommendation to
  adjudicate: **default `0.0722`** (thresholds independent of horizon, provably conservative),
  expose `gamma` override for callers who want horizon normalization.

**Reconstructed open questions `[reconstructed]`:**
- **Q3 `[reconstructed]` — the R3 outbound-emit half.** L2 proves the *inbound apply* + *echo
  suppression from clause* half of R3 (§4), but the **mandatory outbound typed emit carrying
  origin** — the adapter re-broadcasting cause-tagged clauses to peer views/tiers — has **no spike**.
  Open: what is the outbound envelope, and is echo suppression on the *receive* side still purely
  identity-driven (never a boolean flag)? *Seam:* `SourceRegistry` + `clients` (`causeClause.ts:50-60`).
- **Q4 `[reconstructed]` — R5 across rendering libraries.** R5 requires replay "at different
  viewport/**library** → identical state." The spike proves data-space values + SQL determinism in a
  fresh selection (`replay.test.ts:172-179`), but *not* across two different rendering libraries
  (only re-parse in the same Mosaic). Open: is `field`/`value` enough, or does a commit need a
  data-space **scale/encoding** descriptor to be library-portable? *Seam:* `CommitRecord.{field,value}`
  (`log.ts:46-49`).
- **Q8 `[reconstructed]` — agent-tier addressing under collision.** x3 pins that `runtimeStageId`
  collides across runs; the unique address is `(runId, runtimeStageId)` or `toolCallId`
  (`whyJoin.ts:87-90`; `x3.test.ts:104-107`). Open: does L6's `CorrelationEnvelope` standardize on
  `toolCallId` (unambiguous but agentfootprint-specific) or the `(runId, runtimeStageId)` pair
  (portable but two-part)? Related: adopt the now-available `AgentRunOptions.correlationId` path
  (see §11 C4). *Seam:* `whyJoin.ts:84-98`.
- **Q11 `[reconstructed]` — analysis output re-entry (R11).** R11 says outputs (e.g. `cluster_id`)
  "filter through ordinary predicates with zero new verbs." No L3 code exists to prove a computed
  column round-trips as a normal L2 clause with a normal cause. Open: do *all four* output shapes
  (columns/geometry/scalar/table) re-enter as predicates uniformly, or do geometry/table need a
  distinct (still verb-free) binding? *Seam:* L3 `AnalysisOutput` (§5, greenfield).

---

## 11. Architecture ↔ spike conflicts (flag, do not silently resolve)

- **C1 — `CorrelationEnvelope` does not exist under that name.** The decided L6 names the join type
  `CorrelationEnvelope`; the spike's real type is `JoinRecord` (`chain.ts:33`) and its composed
  answer is `CrossTierSlice` (`whyJoin.ts:33`). Promotion must introduce `CorrelationEnvelope` (I
  mapped it to `JoinRecord` in §9.3). **No behavioral conflict — a naming/promotion gap.**
- **C2 — `why()` is hard-coded to the key `rowCount`.** The spike function is `whyRowCount(...)`
  with `key: 'rowCount'` literals throughout (`whyJoin.ts:63,104`; `x3.test.ts`). The decided L6
  `why(target)` must generalize the anchor key. Straightforward (parameterize the `sliceForKey` key),
  but the spike does **not** yet demonstrate a non-`rowCount` slice. **Flag: generalization unproven.**
- **C3 — L3 has no embryo.** The decided L3 ("kind:test stages executed as footprintjs flowcharts,
  outputs as columns/geometry/scalar/table") has **only** an execution *pattern* in `kernel.ts`
  (a hand-wired kernel, not a declared analysis module). Everything in §5 is design, not promotion.
  **Highest-risk layer; nothing to promote, only to build.**
- **C4 — the agent-tier join carrier changed under the spike.** x3 threaded `correlationId` through
  **tool args** because, at spike time, agentfootprint's runtime did not populate
  `EventMeta.correlationId` (commit `d75e487` body: "the Agent runtime never populates it
  (core/Agent.js:639-643) — join key must ride in tool args instead"). **That gap is now closed:**
  `AgentRunOptions.correlationId` exists (`agentfootprint/src/core/Agent.ts:134-135`), is populated
  into the run context (`Agent.ts:794-801`), and is forwarded onto **every** emitted
  `EventMeta.correlationId` (`agentfootprint/src/bridge/eventMeta.ts:83`). **Decision for P3:** L6
  should adopt the sanctioned `AgentRunOptions.correlationId → EventMeta.correlationId` path and
  **retire the tool-args workaround** in `chain.ts:98-160`. Flagged because it changes the L5→L6
  seam from what the committed spike does.
- **C5 — R13/R15 proof depends on a synthetic hot path.** x4's per-update work is an *in-page
  synthetic row scan*, **not** a real DuckDB round-trip (`bench/x4` commit `6ff7a4e` caveat; the
  bench stubs `@duckdb/duckdb-wasm` — `runner.mjs:44-57`). The 0-long-task / 0.00 ms-TBT result
  proves *the log adds no main-thread blocking*, **not** end-to-end query latency. **Do not
  overstate R15 as an end-to-end latency claim.**

---

## 12. P3 packet plan (L1 → L6 promotion order)

Promotion order follows the dependency DAG: L1 first (everything logs), then L2 is already shipped,
then L4 (shipped, needs Q10 decision), then L3 (unblocks L4 gating + L6 slicing), then L5, then L6
last (joins all tiers). Each packet is **write-tests-first** (Convention 2/3 family rule) and bounded.

| Packet | Layer | Promotes / builds | R# | Acceptance tests | Boundary | Est. size |
|---|---|---|---|---|---|---|
| **P3.1** | **L1 log** | `spikes/x1-replay/log.ts` → `src/log/`; re-home `CommitRecord`/`CommitInput`/`CauseSelectionSession`/`replayLog`/`serializeLog`/`causeHistogram`; delete `x2` stub dependency | R2, R5, R8, R13, R10-support | port A1/A2/A3/A5 (`replay.test.ts`) + branch (`branch.test.ts`); add `parseCause` firewall + `markReplayed` idempotence | `src/log/**`, `src/cause/**` (L0 test top-up); **no** L3+ | **S–M** (mostly move + retest) |
| **P3.2** | **L2 mosaic** | resolve **Q9** cast; finalize `causeClause`/`SourceRegistry` public surface | R1, R3(inbound+echo), R12 | keep `SourceRegistry.test`/`causeClause.test`; add cross-filter + `causeOf` round-trip; a `MosaicClient`-shape conformance test | `src/mosaic/**` | **S** |
| **P3.3** | **L4 fdr** | already shipped; **decide Q10 default**; wire the streaming `create*` steppers to consume L1 records | R6, R7, R8 | keep A1–A4; add "L1 stream → stepper" integration (one commit → one `FdrStep`) | `src/fdr/**` (+ read-only L1 import) | **S** (decision + glue) |
| **P3.4** | **L3 analysis** | **build** `defineAnalysis`, `AnalysisOutput` (columns/geometry/scalar/table), footprintjs-flowchart execution (port `kernel.ts` pattern), honesty decls | R6, R9, R11, R14 | declared-only (brush 100× → 0 test commits); minimal slice w/ decoy; **cluster_id re-enters as ordinary predicate** (Q11); degenerate-fit typed rejection | `src/analysis/**`; consumes L0/L1/L2/L4 + `footprintjs` | **L** (greenfield, highest risk) |
| **P3.5** | **L5 agent** | **build** `buildDashboard`/`createSession`/`dispatch`; `DashboardDef` (mosaic-spec superset); dispatch verbs; gap ledger; `vizAsTools` + `mcpServer` | R4, R11(dual-intent), R12, R14 | zero-synthetic-input; every unmet request → typed gap; injection corpus inert; `vizAsTools`≡`mcpServer` verb parity; **Q6** DashboardQA coverage harness | `src/agent/**`, `src/mcp/**`; consumes L0–L4 + `agentfootprint`, `hcifootprint` grammar | **L** |
| **P3.6** | **L6 why** | promote `whyJoin.ts`/`chain.ts` → `src/why/`; rename `JoinRecord`→`CorrelationEnvelope` (**C1**); generalize `whyRowCount`→`why(target)` (**C2**); adopt `AgentRunOptions.correlationId` path (**C4**), retire tool-args workaround | R9, R10 | port A1/A2/A3 (`x3.test.ts`); add a non-`rowCount` slice; add an envelope built via `AgentRunOptions.correlationId` (no tool-args) | `src/why/**`; consumes L1/L5 + `footprintjs/trace`, `agentfootprint` | **M** |

**Cross-cutting (fold into P3.1 or a P3.0 chore):** promote `bench/x4` into a repeatable perf gate
guarding R13/R15 with the **synthetic-hot-path caveat** documented (**C5**); do **not** claim
end-to-end latency.

**Sequencing note:** P3.4 (L3) is the gate for a fully-wired R7 (L4 needs declared analyses to
correct) and R9/R10 (L6 slices L3 outputs). If time-boxed, ship P3.1–P3.3 (a working cause-log +
online-FDR + identity replay) as a coherent **pre-alpha**, and land P3.4–P3.6 as the **alpha**.
