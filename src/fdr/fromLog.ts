/**
 * L1 -> L4 adapter: turn REAL append-only commit-log records (`src/log`,
 * `CommitRecord`) into the `HypothesisRecord` arrival stream the online-FDR
 * steppers (`createLordPlusPlus` / `createAlphaInvesting`) consume.
 *
 * Retires `spikes/x2-fdr/commit-log-stub.ts`'s throwaway `DeclaredAnalysisLog`
 * (SPEC.md §3: "the x2 stub `DeclaredAnalysisLog` is explicitly throwaway ...
 * L1 replaces it wholesale").
 *
 * ---- the "test-analog" commit convention ----------------------------------
 * `CommitRecord.kind` is L1's closed union — the selection port's
 * `CauseClauseKind` (`src/selection/types.ts`: point, interval, cell, match)
 * — NOT an FDR concept, and this packet does not touch `src/log`. A commit is read as a DECLARED-ANALYSIS
 * TEST EMISSION iff it is a point commit on the reserved field `'pValue'`
 * whose value is a {@link TestAct}: the act that ran, and the p-value it
 * produced. This mirrors how L3's `defineAnalysis` already treats
 * `kind:'test'` as the sole thing that arms the FDR gate
 * (`src/analysis/defineAnalysis.ts:171-181`): everything else (ordinary
 * point/interval brushes) passes through the log untouched and is simply not
 * a hypothesis. That IS invariant R6 (a brush is not a test) enforced at the
 * L1 rail — the ordinary-brush skip is proven in `fromLog.test.ts`, the L1
 * analog of the L3 proof at `src/analysis/builtins.test.ts:158-182`.
 *
 * The value slot used to be the BARE p-value, and that was the last lane on
 * the wire that did not obey the law a commit is written to: *a commit records
 * enough of an act to perform it again, or it is not a record of the act*
 * (`src/session/README.md`, law 6). A number names neither the analysis nor
 * the table it read, so a `kind:'test'` analysis that ALSO writes columns was
 * a capability the library permitted and could not replay — it was refused at
 * judge time for saying so honestly. The slot carries the ACT now, and the
 * p-value rides beside it. There is no alias and no fallback for the bare
 * number: a shape whose only reader is a mistake is not a shape worth staying
 * compatible with.
 *
 * A test's value also carries `ledgerRow`: the row the test got in the error
 * budget where it was made. A replay computes its own row and compares the
 * two (`readLedgerRow`, `ledgerRowDifferences`), so a log judged again under
 * other settings is reported, not passed off as the original.
 *
 * ---- field mapping ----------------------------------------------------------
 * `hypothesisId` <- `correlationId` when present (L1's first-class cross-tier
 * join key, `src/log/log.ts:45-55`), else the commit's own `id`. A caller
 * threading one declared-analysis id across viz/agent/kernel tiers (the L6
 * `why()` rail) gets that SAME id back as `hypothesisId`; a caller with no
 * cross-tier need still gets a valid, unique record from `id` alone.
 *
 * `timestamp` <- `CommitRecord.ts` verbatim: both fields are documented as
 * "logical arrival time, monotone within a run" (`src/log/log.ts:72-73` /
 * `./types.ts:25-26`).
 *
 * `branchId` <- DERIVED from the log's real parent-chain (never a
 * caller-passed label) — see `branchIdFromLog` below.
 * (That is `hypothesisRecordsFromLog`'s rule. A REPLAY's carried row instead
 * takes the name and branch label its recorded `ledgerRow` holds, when it
 * holds one: they are what the test was entered under.)
 */

import { ANALYSIS_VIEW_PREFIX, CHART_VIEW_PREFIX } from '../branches/index.js';
import type { CommitRecord } from '../log/index.js';
import type { FdrStep, HypothesisRecord } from './types.js';

/** The reserved field name a declared-analysis test emission commits its act under. */
export const TEST_ANALOG_FIELD = 'pValue';

/**
 * WHAT A `pValue` COMMIT'S VALUE CARRIES — the act, and the p-value it made.
 *
 * `id` and `table` are the SAME pair the `__analysis__` lane carries
 * (`AnalysisAct`, `src/session/namespaces.ts`), deliberately: the question a
 * replay asks of either lane is "which analysis, over which table?", and one
 * reader answers it for both. This file adds only the half FDR needs.
 */
export interface TestAct {
  /** The declared analysis (or agent-authored chart) this commit ran. Also in the `viewId`; kept here so the value is the whole act. */
  readonly id: string;
  /** The table it READ. Not the table its output landed in — that is the analysis's own declared data. */
  readonly table: string;
  /**
   * The analysis's own declaration, when it is data — the `AnalysisAct` field
   * of the same name, typed by the reader that actually uses it
   * (`analysisActOf`, `src/session/namespaces.ts`). It is `unknown` HERE and
   * that is the honest type: FDR does not look at it, and a second declaration
   * of its shape in this file would be a second thing to keep in step. It is
   * carried because this lane carries the WHOLE act, and half an act is what
   * this lane used to carry.
   */
  readonly def?: unknown;
  /** The p-value the test produced. A finite number in [0,1]; an untested visual claim enters at 1. */
  readonly pValue: number;
  /**
   * THE ROW THIS TEST GOT in the error budget where it was made: its position,
   * the threshold it was judged against, the verdict, and the budget before and
   * after. Written by the session that ran the test. It is what lets a replay
   * CHECK the row it computes against the one the test really got
   * ({@link ledgerRowDifferences}). Absent on a log written before the row was
   * recorded, and absent when the stored row cannot be read
   * ({@link readLedgerRow}) — a replay then says the test could not be checked.
   */
  readonly ledgerRow?: FdrStep;
}

/** Why a value on the reserved test field could not be read as a test. */
export type UnreadableTestReason =
  /** The value is not an object: the bare p-value this lane used to carry, or something else entirely. */
  | 'not-an-act'
  /** No analysis id, or no table: the act cannot be named. */
  | 'unnamed-act'
  /** The act is named and its p-value is not a finite number in [0,1]. */
  | 'bad-p-value';

/**
 * THE ONE RULE for a p-value: a finite number in [0,1]. Every door a p-value
 * comes through asks it — the analysis builder's judge, the session's sink and
 * the log reader — so no door can spend budget on a number another refuses.
 */
export function isPValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * THE ONE READER of the test lane's value: the act, or the first reason it is
 * not one. `testActOf` and the unreadable count both ask it, so the shape is
 * spelled once and a new rule cannot be honoured by one and missed by the other.
 */
function readTestAct(value: unknown): TestAct | UnreadableTestReason {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'not-an-act';
  const { id, table, pValue } = value as { id?: unknown; table?: unknown; pValue?: unknown };
  if (typeof id !== 'string' || id.length === 0) return 'unnamed-act';
  if (typeof table !== 'string' || table.length === 0) return 'unnamed-act';
  if (!isPValue(pValue)) return 'bad-p-value';
  const ledgerRow = readLedgerRow((value as { ledgerRow?: unknown }).ledgerRow, pValue);
  return { id, table, pValue, ...(ledgerRow !== undefined ? { ledgerRow } : {}) };
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * THE ONE READER of a recorded ledger row: the row, or `undefined` when the
 * value is not one. It is rebuilt field by field, so nothing a foreign log
 * put beside the known fields comes along. A row whose p-value is not the
 * act's own is not a row OF this test, and is not returned.
 */
export function readLedgerRow(value: unknown, pValue: number): FdrStep | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  // each field is read ONCE, so what is judged is what is returned
  const { step, hypothesisId, pValue: rowP, timestamp, branchId, alphaThreshold, reject, wealthBefore, wealthAfter, firstRejection } = value as { readonly [K in keyof FdrStep]?: unknown };
  if (!isCount(step)) return undefined;
  if (typeof hypothesisId !== 'string' || hypothesisId.length === 0) return undefined;
  if (rowP !== pValue) return undefined;
  if (!isFiniteNumber(timestamp) || !isFiniteNumber(alphaThreshold)) return undefined;
  if (!isFiniteNumber(wealthBefore) || !isFiniteNumber(wealthAfter)) return undefined;
  if (typeof reject !== 'boolean' || typeof firstRejection !== 'boolean') return undefined;
  if (branchId !== undefined && typeof branchId !== 'string') return undefined;
  return { step, hypothesisId, pValue, timestamp, ...(branchId !== undefined ? { branchId } : {}), alphaThreshold, reject, wealthBefore, wealthAfter, firstRejection };
}

/**
 * The ledger row as a test's commit carries it: passed through the reader
 * above, so what is written is exactly what a replay can read back — the known
 * fields, no `undefined` keys. A row the reader would not accept (a procedure
 * that produced a non-finite number) is not written; a replay then lists the
 * test as unchecked rather than checking it against a bad row.
 */
export function ledgerRowToRecord(step: FdrStep): { readonly ledgerRow?: FdrStep } {
  const ledgerRow = readLedgerRow(step, step.pValue);
  return ledgerRow === undefined ? {} : { ledgerRow };
}

/** What can differ between the row a test got and the row a replay computes for it. */
export type LedgerRowDifference =
  /** Its position in the stream: tests are missing from the log, or extra. */
  | 'step'
  /** The level it was judged against. */
  | 'threshold'
  /** Whether it was a discovery. */
  | 'verdict'
  /** The budget before or after it. */
  | 'budget';

/** Two computed numbers are the same number when they agree to nine significant digits: one procedure on two JavaScript engines may differ in the last bits. */
const sameNumber = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));

/**
 * How the row a replay computed differs from the row the test recorded: empty
 * when they agree. Compared: position, threshold, verdict and budget. Not
 * compared: `timestamp` (a session's own logical clock), `hypothesisId` and
 * `branchId` (names, not judgements) and `firstRejection` (stated as
 * informational on {@link FdrStep}).
 */
export function ledgerRowDifferences(recorded: FdrStep, computed: FdrStep): LedgerRowDifference[] {
  const differs: LedgerRowDifference[] = [];
  if (recorded.step !== computed.step) differs.push('step');
  if (!sameNumber(recorded.alphaThreshold, computed.alphaThreshold)) differs.push('threshold');
  if (recorded.reject !== computed.reject) differs.push('verdict');
  if (!sameNumber(recorded.wealthBefore, computed.wealthBefore) || !sameNumber(recorded.wealthAfter, computed.wealthAfter)) differs.push('budget');
  return differs;
}

/**
 * The act a `pValue` commit records, or `undefined` when its value does not
 * carry one — a foreign log, a hand-built record, or the bare number this lane
 * used to carry. It never guesses, and it throws only if reading the value
 * itself throws (a getter or a proxy that does; a value parsed from JSON cannot).
 */
export function testActOf(value: unknown): TestAct | undefined {
  const read = readTestAct(value);
  return typeof read === 'string' ? undefined : read;
}

/** A commit is a declared-analysis test emission iff it is a point commit on the reserved 'pValue' field carrying a {@link TestAct}. */
export function isTestAnalogCommit(r: Pick<CommitRecord, 'kind' | 'field' | 'value'>): boolean {
  return r.kind === 'point' && r.field === TEST_ANALOG_FIELD && testActOf(r.value) !== undefined;
}

/**
 * Derive every commit's branchId from the log's real DAG shape: walk a
 * commit's ancestor chain toward the root; the branchId is the id of the
 * NEAREST ancestor-or-self commit whose PARENT has more than one child (a
 * fork point) — i.e. the first commit unique to this lineage. This is the L1
 * analog of "which branch a commit lives on", and mirrors the sibling-branch
 * model already proven at `src/log/branching.fixture.ts` /
 * `src/log/branch.test.ts`: `c2` and `c2b` are equal siblings off `c1`,
 * neither privileged as "main" — there is no `branch` field anywhere in
 * `CommitRecord`, only the parent-pointer DAG (R8).
 *
 * A commit whose ENTIRE ancestry back to a root is unforked has NO branch
 * label (`undefined`) — there is nothing (yet) to disambiguate it from.
 *
 * Exported (not just an internal of `hypothesisRecordsFromLog`) because the
 * derivation is a generally useful L1 query in its own right.
 */
export function branchIdFromLog(
  records: readonly CommitRecord[],
): Map<string, string | undefined> {
  const byId = new Map(records.map((r) => [r.id, r]));
  const childrenOf = new Map<string | null, string[]>();
  for (const r of records) {
    const kids = childrenOf.get(r.parent);
    if (kids) kids.push(r.id);
    else childrenOf.set(r.parent, [r.id]);
  }

  const cache = new Map<string, string | undefined>();
  function resolve(id: string): string | undefined {
    if (cache.has(id)) return cache.get(id);
    const rec = byId.get(id);
    if (!rec) return undefined;
    /* v8 ignore next -- structurally unreachable: `rec` is only reachable here once `byId.get(id)` has
     * succeeded, which means `rec` is literally one of the elements of `records`; the `childrenOf` map
     * (built above by iterating ALL of `records`) therefore already contains an entry for `rec.parent`
     * seeded with at least `[rec.id]` itself, for every such `rec`, with no way through the public API
     * to reach this line for a record whose own parent-key entry is missing. */
    const siblings = childrenOf.get(rec.parent) ?? [];
    const label: string | undefined =
      siblings.length > 1 ? id : rec.parent === null ? undefined : resolve(rec.parent);
    cache.set(id, label);
    return label;
  }

  const out = new Map<string, string | undefined>();
  for (const r of records) out.set(r.id, resolve(r.id));
  return out;
}

/** A commit that DECLARES a test (a point commit on the reserved field) and whose value cannot be read as one. */
export interface UnreadableTest {
  readonly commitId: string;
  readonly reason: UnreadableTestReason;
}

/** What a log holds for the online-FDR steppers, and what it holds that they cannot be given. */
export interface TestEmissions {
  /** The readable tests, in arrival order: the stream the steppers consume. */
  readonly hypotheses: readonly HypothesisRecord[];
  /**
   * Commits in a test lane that declare a test and that nobody can read. A
   * live session lands such a commit only when a test ran, and none is in
   * `hypotheses` — so an error rate computed
   * from `hypotheses` alone leaves out tests that were made. A consumer that
   * states that rate must state this count beside it.
   */
  readonly unreadable: readonly UnreadableTest[];
}

/**
 * The lanes a test lands in: an analysis run (`analysis:<id>`) and an
 * agent-authored chart (`chart:<id>`). Other lanes may carry a point commit
 * whose field is NAMED like the reserved one — a note about a column called
 * `pValue`, an arrangement value — and none of those is a test.
 */
const TEST_LANES: readonly string[] = [ANALYSIS_VIEW_PREFIX, CHART_VIEW_PREFIX];
const inTestLane = (viewId: string): boolean => TEST_LANES.some((prefix) => viewId.startsWith(prefix));

/** One commit in a test lane that declares a test: its act when readable, the reason when not. */
export interface LoggedTest {
  readonly commitId: string;
  readonly viewId: string;
  readonly correlationId?: string;
  /** The act, or `undefined` when the value cannot be read as one. */
  readonly act?: TestAct;
  /** Present exactly when `act` is absent. */
  readonly unreadable?: UnreadableTestReason;
}

/**
 * Every test a log holds, in arrival order: the point commits on the reserved
 * field that sit in a test lane. This is the list a replay carries its error
 * budget from — one entry per test that was made, readable or not, so none can
 * be left out of the count.
 */
export function loggedTests(records: readonly CommitRecord[]): LoggedTest[] {
  const tests: LoggedTest[] = [];
  for (const r of records) {
    if (r.kind !== 'point' || r.field !== TEST_ANALOG_FIELD || !inTestLane(r.viewId)) continue;
    const read = readTestAct(r.value);
    tests.push({
      commitId: r.id,
      viewId: r.viewId,
      ...(r.correlationId !== undefined ? { correlationId: r.correlationId } : {}),
      ...(typeof read === 'string' ? { unreadable: read } : { act: read }),
    });
  }
  return tests;
}

/**
 * Read a real L1 commit log for the online-FDR steppers: the arrival-ordered
 * `HypothesisRecord` stream, and the test commits that could not be read.
 *
 * A commit that is not a point commit on the reserved field (an ordinary
 * brush) is not a test and appears in neither list — that IS R6 (a brush is
 * not a test) enforced at the L1 rail.
 *
 * A point commit on the reserved field IN A TEST LANE that carries no readable
 * act is counted in `unreadable`. It used to be skipped like a brush: the
 * stream was then short by a test that had run, and the error-rate guarantee
 * computed from it was overstated with nothing to show for it. The lane is
 * part of the rule because the field name alone proves nothing: a note or an
 * arrangement commit may name `pValue` too, and calling that a test that ran
 * would be a false claim in the other direction.
 *
 * `hypotheses` keeps its older, looser rule on purpose (a readable act on the
 * field is a hypothesis in any lane), so what the steppers are fed is unchanged.
 *
 * Output order follows `records` (the log's own append/arrival order):
 * `CauseSelectionSession.commit()` always pushes, so "records order == arrival
 * order" already, matching `HypothesisRecord.timestamp`'s "monotone within a
 * run" contract.
 */
export function testEmissionsFromLog(records: readonly CommitRecord[]): TestEmissions {
  const branchOf = branchIdFromLog(records);
  const hypotheses: HypothesisRecord[] = [];
  const unreadable: UnreadableTest[] = [];
  for (const r of records) {
    if (r.kind !== 'point' || r.field !== TEST_ANALOG_FIELD) continue;
    const act = readTestAct(r.value);
    if (typeof act === 'string') {
      if (inTestLane(r.viewId)) unreadable.push({ commitId: r.id, reason: act });
      continue;
    }
    const branchId = branchOf.get(r.id);
    hypotheses.push({
      hypothesisId: r.correlationId ?? r.id,
      pValue: act.pValue,
      timestamp: r.ts,
      ...(branchId !== undefined ? { branchId } : {}),
    });
  }
  return { hypotheses, unreadable };
}

/**
 * The readable tests of a log, and nothing else — `testEmissionsFromLog(…).hypotheses`.
 * Use it to feed a stepper. To STATE an error rate over a log, call
 * {@link testEmissionsFromLog} and read `unreadable` too: this function cannot
 * tell you a test was left out.
 */
export function hypothesisRecordsFromLog(records: readonly CommitRecord[]): HypothesisRecord[] {
  return [...testEmissionsFromLog(records).hypotheses];
}
