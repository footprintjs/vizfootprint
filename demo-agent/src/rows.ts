/**
 * The demo-agent's OWN row loader — an extended sibling of
 * `demo/src/common.ts`'s `loadRows` (which maps only id/category/price/rating;
 * demo/ is frozen, so it cannot grow the two new columns). Fetches
 * demo-agent's own seeded CSV (`gen-data.mjs` output — id/category/price/rating
 * plus `date`/`region`) and parses it with `src/data`'s REAL CSV parser, never
 * a duplicate hand-rolled one.
 */
import { parseCSVTyped } from '../../src/data/csv.js';

/** One demo-agent row: the original four fields plus the date/region VizLine/VizMap need. */
export interface DemoRow {
  readonly id: string;
  readonly category: string;
  readonly price: number;
  readonly rating: number;
  /** ISO-8601 date — the VizLine time axis + brush field. */
  readonly date: string;
  /** Sales region — matches a DEMO_GEO feature name (the VizMap field). */
  readonly region: string;
  [k: string]: string | number;
}

export async function loadRows(): Promise<DemoRow[]> {
  const res = await fetch('/data/dresses.csv');
  const text = await res.text();
  const parsed = parseCSVTyped(text); // src/data — sniffs price/rating -> number
  return parsed.rows.map((r) => ({
    id: String(r['id']),
    category: String(r['category']),
    price: Number(r['price']),
    rating: Number(r['rating']),
    date: String(r['date']),
    region: String(r['region']),
  }));
}
