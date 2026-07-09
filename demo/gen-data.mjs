/**
 * Seeded data generator for the vizfootprint demo (per the family rule: demos
 * are GENERATED from a real, deterministic run — never hand-authored numbers).
 *
 * Produces demo/data/dresses.csv: ~300 rows of {id, category, price, rating}.
 *   - price   : continuous, ~[20, 220].
 *   - rating  : discrete 0.5 steps in [1, 5] — WEAKLY dependent on price. The
 *               weak dependence is deliberate: on the full ~300 rows the
 *               Pearson correlation lands p in (~0.00125, 0.05), i.e.
 *               "significant alone, NOT a discovery at the LORD++ threshold"
 *               (the analyst page's marquee honest-headline case). The 0.5-step
 *               quantization also guarantees a rating value shared by >= 8 rows,
 *               so the analyst's degenerate button can select 8 zero-variance
 *               points and get a genuine R14 flag (Pearson denom = 0 -> NaN r).
 *   - category: one of five, loosely priced so a bar-click visibly re-colors
 *               the scatter (Formal/Party skew expensive, Casual cheap).
 *
 * Deterministic mulberry32 PRNG (same seed -> byte-identical CSV). Run once and
 * commit the CSV; this script documents its provenance and lets us re-tune.
 *
 * Usage: node demo/gen-data.mjs [--verify]
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Deterministic PRNG (mulberry32) — the same one the bench uses. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = ['Casual', 'Formal', 'Party', 'Work', 'Summer'];
/** Per-category base price offset — makes category a visible price signal. */
const CAT_BASE = { Casual: -35, Formal: 55, Party: 40, Work: 10, Summer: -20 };

const N = 300;
const SEED = 20260709;
/** Rating's weak slope on price — tuned so full-dataset p lands in the band. */
const RATING_SLOPE = 0.0037;

function snapHalf(x) {
  return Math.max(1, Math.min(5, Math.round(x * 2) / 2));
}

export function generateRows() {
  const rand = mulberry32(SEED);
  const rows = [];
  for (let i = 0; i < N; i++) {
    const category = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
    const base = 110 + CAT_BASE[category];
    // price: base + spread; clamp into a friendly window.
    let price = base + (rand() - 0.5) * 120;
    price = Math.max(18, Math.min(230, price));
    // rating: a weak positive pull from price + noise, snapped to 0.5 steps.
    const ratingRaw = 2.6 + RATING_SLOPE * (price - 120) + (rand() - 0.5) * 2.6;
    const rating = snapHalf(ratingRaw);
    rows.push({
      id: `d${String(i + 1).padStart(3, '0')}`,
      category,
      price: Math.round(price * 100) / 100,
      rating,
    });
  }
  return rows;
}

export function toCSV(rows) {
  const header = 'id,category,price,rating';
  const body = rows.map((r) => `${r.id},${r.category},${r.price},${r.rating}`).join('\n');
  return `${header}\n${body}\n`;
}

// ── pure stats for the self-verify (mirrors src/analysis/stats.ts formulae) ──
function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}
function phi(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}
function normalApproxPValue(r, n) {
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  return 2 * (1 - phi(Math.abs(t)));
}

const rows = generateRows();
const csv = toCSV(rows);
const outPath = path.join(__dirname, 'data', 'dresses.csv');
writeFileSync(outPath, csv);

// Self-verify + report (anti-fabrication: print the REAL numbers this seed gives).
const price = rows.map((r) => r.price);
const rating = rows.map((r) => r.rating);
const r = pearson(price, rating);
const p = normalApproxPValue(r, rows.length);
const ratingCounts = {};
for (const row of rows) ratingCounts[row.rating] = (ratingCounts[row.rating] ?? 0) + 1;
const maxRatingBucket = Math.max(...Object.values(ratingCounts));

// LORD++ first-step threshold: w0 * gamma(1), w0 = alpha/2, gamma(1)=0.0722*ln2.
const gamma1 = 0.0722 * Math.log(2);
const alpha1 = (0.05 / 2) * gamma1;

console.log(`wrote ${rows.length} rows -> ${outPath}`);
console.log(`pearson(price,rating) r=${r.toFixed(4)}  p=${p.toFixed(4)}`);
console.log(`LORD++ test#1 threshold alpha_1=${alpha1.toFixed(5)}`);
console.log(
  `honest-headline band  (alpha_1 < p <= 0.05): ${alpha1 < p && p <= 0.05 ? 'YES — p is significant-alone but NOT a discovery' : 'NO — retune RATING_SLOPE'}`,
);
console.log(`max rows sharing one rating value: ${maxRatingBucket} (need >= 8 for the degenerate button)`);
console.log('category counts:', Object.fromEntries(CATEGORIES.map((c) => [c, rows.filter((x) => x.category === c).length])));
