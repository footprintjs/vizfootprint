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
 * `CommitRecord.kind` is L1's real, closed union — `'point' | 'interval'`,
 * the Mosaic clause kind (`src/log/log.ts:61`) — NOT an FDR concept, and this
 * packet does not touch `src/log`. A commit is read as a DECLARED-ANALYSIS
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
 */

import type { CommitRecord } from '../log/index.js';
import type { HypothesisRecord } from './types.js';

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
}

/**
 * The act a `pValue` commit records, or `undefined` when its value does not
 * carry one — a foreign log, a hand-built record, or the bare number this lane
 * used to carry. Total: it never throws and never guesses.
 */
export function testActOf(value: unknown): TestAct | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { id, table, pValue } = value as { id?: unknown; table?: unknown; pValue?: unknown };
  if (typeof id !== 'string' || id.length === 0) return undefined;
  if (typeof table !== 'string' || table.length === 0) return undefined;
  if (typeof pValue !== 'number' || !Number.isFinite(pValue) || pValue < 0 || pValue > 1) return undefined;
  return { id, table, pValue };
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

/**
 * Adapt a real L1 commit log into the arrival-ordered `HypothesisRecord`
 * stream L4's steppers consume. Non-test-analog commits (ordinary brushes)
 * are silently skipped — that IS R6 (a brush is not a test) enforced at the
 * L1 rail. Output order follows `records` (the log's own append/arrival
 * order): `CauseSelectionSession.commit()` always pushes, so "records order
 * == arrival order" already, matching `HypothesisRecord.timestamp`'s
 * "monotone within a run" contract.
 */
export function hypothesisRecordsFromLog(
  records: readonly CommitRecord[],
): HypothesisRecord[] {
  const branchOf = branchIdFromLog(records);
  const out: HypothesisRecord[] = [];
  for (const r of records) {
    if (!isTestAnalogCommit(r)) continue;
    // The predicate above IS `testActOf` over the same value — one owner of the
    // shape, read twice rather than spelled twice.
    const act = testActOf(r.value) as TestAct;
    const branchId = branchOf.get(r.id);
    out.push({
      hypothesisId: r.correlationId ?? r.id,
      pValue: act.pValue,
      timestamp: r.ts,
      ...(branchId !== undefined ? { branchId } : {}),
    });
  }
  return out;
}
