/**
 * l3-channels spike — the fixed toy dataset every analysis runs over.
 *
 * `amount`/`size` are strongly (not perfectly) correlated so the correlation
 * channel yields a small p-value (a discovery worth FDR-gating), while r < 1
 * keeps the p-value honest. `category` drives the groupby (table) channel.
 * Everything is a literal — no generation — so every run is byte-identical.
 */

export interface Row {
  readonly amount: number;
  readonly size: number;
  readonly category: string;
}

/** 12 rows: enough that a fit over the whole set is non-degenerate (>= minPoints). */
export const DATASET: readonly Row[] = [
  { amount: 5, size: 12, category: 'Data' },
  { amount: 12, size: 26, category: 'Analytics' },
  { amount: 15, size: 30, category: 'Ops' },
  { amount: 18, size: 40, category: 'Data' },
  { amount: 25, size: 52, category: 'Analytics' },
  { amount: 42, size: 88, category: 'Ops' },
  { amount: 8, size: 18, category: 'Data' },
  { amount: 20, size: 44, category: 'Analytics' },
  { amount: 30, size: 62, category: 'Ops' },
  { amount: 35, size: 68, category: 'Data' },
  { amount: 10, size: 22, category: 'Analytics' },
  { amount: 22, size: 50, category: 'Ops' },
];

/** An 8-row slice — below the regression honesty floor (minPoints=10) → degenerate. */
export const DEGENERATE_DATASET: readonly Row[] = DATASET.slice(0, 8);
