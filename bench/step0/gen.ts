/**
 * Step-0 synthetic rows — the demo's `cells` schema (disease, jurisdiction,
 * kind, t, cases, report_state), seeded (mulberry32) so a run is reproducible,
 * CALIBRATED to the real NNDSS snapshot's shape when the bench can read it:
 * the same 70 jurisdictions split (state/region/total), the same 86 ISO weeks,
 * the same report_state mix. Row count scales through the DISEASE axis
 * (15 diseases at 90,300 rows; ~166 at 1,000,000) — the other two axes keep
 * their real cardinality, so a per-week or per-state group stays the same
 * width and only the disease groups widen.
 */
import type { Row } from '../../src/data/types.js';

export interface Shape {
  /** [state, region, total] jurisdiction counts. */
  readonly kinds: readonly [number, number, number];
  readonly weeks: number;
  /** report_state → share of rows (sums to 1). */
  readonly reportStates: Readonly<Record<string, number>>;
}

/** The real snapshot's shape (2026-09-01 NNDSS slice); used when the real file cannot be read. */
export const FALLBACK_SHAPE: Shape = {
  kinds: [58, 9, 3],
  weeks: 86,
  reportStates: { present: 0.55, 'not-configured': 0.27, unavailable: 0.13, withheld: 0.01, unknown: 0.04 },
};

/** Deterministic PRNG (mulberry32) — the same one bench/x4 uses. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoWeeks(n: number): string[] {
  const start = Date.UTC(2025, 0, 4);
  return Array.from({ length: n }, (_, i) => new Date(start + i * 7 * 86_400_000).toISOString().slice(0, 10));
}

export interface Synthetic {
  readonly rows: Row[];
  readonly diseases: readonly string[];
  readonly jurisdictions: readonly string[];
  readonly weeks: readonly string[];
}

/** `n` rows in disease-major order (the ETL's order is jurisdiction-major; order does not change any measurement here). */
export function synthesize(n: number, shape: Shape, seed = 42): Synthetic {
  const rnd = mulberry32(seed);
  const jurisdictions: { name: string; kind: string }[] = [];
  const [ns, nr, nt] = shape.kinds;
  for (let i = 0; i < ns; i++) jurisdictions.push({ name: `State ${String(i + 1).padStart(2, '0')}`, kind: 'state' });
  for (let i = 0; i < nr; i++) jurisdictions.push({ name: `Region ${i + 1}`, kind: 'region' });
  for (let i = 0; i < nt; i++) jurisdictions.push({ name: `Total ${i + 1}`, kind: 'total' });
  const weeks = isoWeeks(shape.weeks);
  const perDisease = jurisdictions.length * weeks.length;
  const nd = Math.ceil(n / perDisease);
  const diseases = Array.from({ length: nd }, (_, i) => `Disease ${String(i + 1).padStart(3, '0')} (confirmed)`);
  // cumulative report_state table for one uniform draw
  const states = Object.entries(shape.reportStates);
  const cum: [string, number][] = [];
  let acc = 0;
  for (const [s, p] of states) {
    acc += p;
    cum.push([s, acc]);
  }
  const rows: Row[] = new Array(n);
  let i = 0;
  outer: for (const disease of diseases) {
    for (const j of jurisdictions) {
      for (const t of weeks) {
        if (i >= n) break outer;
        const u = rnd();
        let report_state = cum[cum.length - 1]![0];
        for (const [s, c] of cum) {
          if (u < c) {
            report_state = s;
            break;
          }
        }
        // a present cell's count: skewed small integers with a long tail (roughly the NNDSS look)
        const cases = report_state === 'present' ? Math.floor(Math.pow(rnd(), 3) * 200) : null;
        rows[i++] = { disease, jurisdiction: j.name, kind: j.kind, t, cases, report_state };
      }
    }
  }
  return { rows, diseases, jurisdictions: jurisdictions.map((j) => j.name), weeks };
}

/** Median and p95 of a sample (ms). p95 = nearest-rank. */
export function stats(samples: readonly number[]): { median: number; p95: number; min: number; n: number } {
  const s = [...samples].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
  return { median: at(0.5), p95: at(0.95), min: s[0]!, n: s.length };
}
