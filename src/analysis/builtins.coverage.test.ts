/**
 * builtins.coverage.test.ts — closes the one reachable gap builtins.test.ts
 * leaves: `correlationAnalysis`'s optional `branchId` actually being stamped
 * onto the emitted `test` declaration (and therefore onto the HypothesisRecord).
 */

import { describe, it, expect } from 'vitest';
import { correlationAnalysis, groupByAnalysis, type DataRow } from './builtins.js';
import type { HypothesisRecord } from '../fdr/index.js';

const DATASET: readonly DataRow[] = [
  { amount: 5, size: 12 },
  { amount: 12, size: 26 },
  { amount: 15, size: 30 },
  { amount: 18, size: 40 },
  { amount: 25, size: 52 },
];

describe('correlationAnalysis — optional branchId is stamped on the emitted HypothesisRecord', () => {
  it('a branchId passed to correlationAnalysis flows through to hypothesis.branchId', async () => {
    const captured: HypothesisRecord[] = [];
    const mod = correlationAnalysis({ x: 'amount', y: 'size', branchId: 'branch-42' });
    const { hypothesis } = await mod.run(DATASET, { sink: (h) => captured.push(h) });
    expect(hypothesis?.branchId).toBe('branch-42');
    expect(captured[0]!.branchId).toBe('branch-42');
  });

  it('WITHOUT a branchId, the emitted hypothesis carries no branchId key at all (not branchId: undefined)', async () => {
    const mod = correlationAnalysis({ x: 'amount', y: 'size' });
    const { hypothesis } = await mod.run(DATASET);
    expect(hypothesis).toBeDefined();
    expect('branchId' in hypothesis!).toBe(false);
  });
});

describe('correlationAnalysis — a zero-variance x is an honest degenerate fit, not a fabricated r', () => {
  it('constant x (denom === 0 -> r is NaN) reports {ok:false, reason:"degenerate-fit"}, no hypothesis emitted', async () => {
    const degenerate: readonly DataRow[] = [
      { amount: 7, size: 1 },
      { amount: 7, size: 2 },
      { amount: 7, size: 3 },
    ];
    const captured: HypothesisRecord[] = [];
    const mod = correlationAnalysis({ x: 'amount', y: 'size' });
    const { result, hypothesis } = await mod.run(degenerate, { sink: (h) => captured.push(h) });
    expect(result).toEqual({ ok: false, reason: 'degenerate-fit', n: 3, fitDegenerate: true });
    expect(hypothesis).toBeUndefined();
    expect(captured).toHaveLength(0);
  });
});

describe('groupByAnalysis — group summary sort comparator over 3+ distinct groups', () => {
  it('sorts the summary rows alphabetically by group key regardless of first-seen (insertion) order', async () => {
    const rows: readonly DataRow[] = [
      { team: 'Zeta', amount: 10 },
      { team: 'Alpha', amount: 20 },
      { team: 'Mid', amount: 30 },
    ];
    const { result } = await groupByAnalysis({ by: 'team', measure: 'amount' }).run(rows);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.output.rows as Array<{ team: string }>).map((r) => r.team)).toEqual([
      'Alpha',
      'Mid',
      'Zeta',
    ]);
  });
});
