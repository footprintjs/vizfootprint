/**
 * Seeded date+region augmentation for the mixed-principal demo's dataset.
 *
 * demo-agent owns its OWN copy of the seeded dresses dataset — demo/ is a
 * frozen sibling demo (this script never writes there, only READS its
 * already-committed CSV) so id/category/price/rating stay byte-identical
 * and the existing statistical story (RATING_SLOPE's honest-headline
 * p-value band, the >=8-row degenerate rating bucket) carries over
 * unchanged. It ADDS two columns via a SEPARATE seeded mulberry32 PRNG,
 * deliberately never derived from price/category (an honest, uncorrelated
 * dimension — not a fabricated trend the line/map charts would then "reveal"):
 *   - date   : ISO-8601, spread across a 91-day window (~3 months,
 *              2026-04-01..2026-06-30).
 *   - region : one of four NAMED regions (see ./src/geo.ts). A fifth region
 *              in that GeoJSON, "Outer Isles", is left deliberately
 *              uninhabited — VizMap's honest-absence state is on screen by
 *              default, matching ui/gallery's fixture design.
 *
 * Usage: node demo-agent/gen-data.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_CSV = path.join(__dirname, '..', 'demo', 'data', 'dresses.csv');
const OUT_CSV = path.join(__dirname, 'data', 'dresses.csv');

const SEED = 20260713;
const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 3, 1); // 2026-04-01
const SPAN_DAYS = 91; // ~3 months, through 2026-06-30

/** The four INHABITED regions — must match ./src/geo.ts's DEMO_GEO feature names (minus "Outer Isles"). */
export const REGIONS = ['Northlands', 'Coastal Strip', 'Midlands', 'Southreach'];

/** mulberry32 — the repo family's seeded PRNG shape (pure, reproducible). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Parse the frozen demo/dresses.csv — a simple, unquoted 4-column format (id,category,price,rating). */
function readSourceRows() {
  const text = readFileSync(SOURCE_CSV, 'utf8');
  const [header, ...lines] = text.trim().split('\n');
  const cols = header.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    const row = {};
    cols.forEach((c, i) => (row[c] = cells[i]));
    return row;
  });
}

function isoDate(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** Add `date` + `region` to each source row, deterministically, via a PRNG independent of the source's own fields. */
export function augmentRows(sourceRows) {
  const rand = mulberry32(SEED);
  return sourceRows.map((r) => {
    const dayOffset = Math.floor(rand() * SPAN_DAYS);
    const region = REGIONS[Math.floor(rand() * REGIONS.length)];
    return { ...r, date: isoDate(START + dayOffset * DAY_MS), region };
  });
}

export function toCSV(rows) {
  const header = 'id,category,price,rating,date,region';
  const body = rows.map((r) => `${r.id},${r.category},${r.price},${r.rating},${r.date},${r.region}`).join('\n');
  return `${header}\n${body}\n`;
}

const sourceRows = readSourceRows();
const rows = augmentRows(sourceRows);
const csv = toCSV(rows);
mkdirSync(path.dirname(OUT_CSV), { recursive: true });
writeFileSync(OUT_CSV, csv);

// Self-verify + report (anti-fabrication: print the REAL spread this seed gives).
const dates = rows.map((r) => r.date).sort();
const regionCounts = {};
for (const r of rows) regionCounts[r.region] = (regionCounts[r.region] ?? 0) + 1;
console.log(`wrote ${rows.length} rows -> ${OUT_CSV}`);
console.log(`date range: ${dates[0]} .. ${dates[dates.length - 1]}  (target window ${isoDate(START)} .. ${isoDate(START + (SPAN_DAYS - 1) * DAY_MS)})`);
console.log('region counts:', regionCounts, '— "Outer Isles" deliberately absent from every row (the honest-empty region)');
