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
 * carrying a finite number in [0,1] — the L1-native way to say "this commit's
 * value IS a test's p-value". This mirrors how L3's `defineAnalysis` already
 * treats `kind:'test'` as the sole thing that arms the FDR gate
 * (`src/analysis/defineAnalysis.ts:171-181`): everything else (ordinary
 * point/interval brushes) passes through the log untouched and is simply not
 * a hypothesis. That IS invariant R6 (a brush is not a test) enforced at the
 * L1 rail — the ordinary-brush skip is proven in `fromLog.test.ts`, the L1
 * analog of the L3 proof at `src/analysis/builtins.test.ts:158-182`.
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

/** The reserved field name a declared-analysis test emission commits its p-value under. */
export const TEST_ANALOG_FIELD = 'pValue';

/** A commit is a declared-analysis test emission iff it is a point commit on the reserved 'pValue' field carrying a valid p-value. */
function isTestAnalogCommit(r: CommitRecord): boolean {
  return (
    r.kind === 'point' &&
    r.field === TEST_ANALOG_FIELD &&
    typeof r.value === 'number' &&
    Number.isFinite(r.value) &&
    r.value >= 0 &&
    r.value <= 1
  );
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
    const branchId = branchOf.get(r.id);
    out.push({
      hypothesisId: r.correlationId ?? r.id,
      pValue: r.value as number,
      timestamp: r.ts,
      ...(branchId !== undefined ? { branchId } : {}),
    });
  }
  return out;
}
