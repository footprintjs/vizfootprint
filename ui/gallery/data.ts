/** Deterministic seeded dataset for the gallery — no fetch, no CSV, no random. */

import type { GeoFeatureCollection } from '../src/charts/VizMap.js';

export interface GalleryRow {
  readonly id: string;
  readonly category: string;
  readonly price: number;
  readonly rating: number;
  /** ISO-8601 date — the VizLine time axis + brush field. */
  readonly date: string;
  /** Sales region — matches a GALLERY_GEO feature name (the VizMap field). */
  readonly region: string;
  [k: string]: string | number;
}

export const CATEGORIES = ['Casual', 'Formal', 'Party', 'Work', 'Summer'] as const;

export const CATEGORY_COLORS: Record<string, string> = {
  Casual: '#2f80f0',
  Formal: '#7c5cff',
  Party: '#f2568f',
  // Work was #0fa38f (teal) — re-hued to green so the map's sequential TEAL
  // ramp owns that hue alone (magnitude never impersonates identity).
  // Validator-checked (dataviz six-checks, light, --pairs all): worst pair
  // violet↔azure ΔE 12.4 — above the 12 target.
  Work: '#2e9d52',
  Summer: '#f2a02c',
};

/**
 * Twelve weekly ISO dates. Kept to the data's own granularity — the line
 * chart never invents a coarser bucket.
 */
export const WEEKS: readonly string[] = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 3, 1 + i * 7)); // 2026-04-01 … 2026-06-17
  return d.toISOString().slice(0, 10);
});

/**
 * Four INHABITED regions — row `i` takes `i % 4`, so the fifth geo feature
 * (`Outer Isles`) deliberately has NO rows: the map's honest-absence state is
 * on screen by default, not just in a test.
 */
export const REGIONS = ['Northlands', 'Coastal Strip', 'Midlands', 'Southreach'] as const;

/** mulberry32 — the repo family's seeded PRNG shape (pure, reproducible). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 60 rows: price rises over the weeks (a readable time-series trend) with
 * seeded noise, rating loosely rising with price (a real correlation to
 * declare), a weekly ISO date, and a region (Outer Isles left empty).
 */
export function galleryRows(): GalleryRow[] {
  const rnd = mulberry32(20260710);
  const rows: GalleryRow[] = [];
  for (let i = 0; i < 60; i++) {
    const category = CATEGORIES[i % CATEGORIES.length]!;
    const week = i % WEEKS.length;
    const price = Math.round((22 + week * 13 + rnd() * 46) * 100) / 100; // 22–224, trending up by week
    const base = 1.5 + (price / 220) * 3; // rating trends up with price
    const rating = Math.max(1, Math.min(5, Math.round((base + (rnd() - 0.5) * 1.6) * 10) / 10));
    rows.push({
      id: `d${String(i + 1).padStart(2, '0')}`,
      category,
      price,
      rating,
      date: WEEKS[week]!,
      region: REGIONS[i % REGIONS.length]!,
    });
  }
  return rows;
}

/**
 * The gallery's region map — five stylized territories in lon/lat space
 * (gallery-local fixture, not real-world geography): a northern band, a
 * western coastal strip, the midlands, a southern reach, and a two-island
 * MultiPolygon chain that no data row inhabits (the honest empty state).
 */
export const GALLERY_GEO: GeoFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Northlands' },
      geometry: {
        type: 'Polygon',
        // the southern edge REUSES the exact vertex chain of Coastal Strip's
        // and Midlands' northern edges — shared borders must be identical
        // point-for-point or hairline gaps open between the fills
        coordinates: [[[0, 7], [2.5, 7.2], [7, 7.5], [10, 8], [10, 11], [6, 11.5], [2, 11], [0, 10], [0, 7]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Coastal Strip' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [2.5, 0.5], [3, 3.5], [2.5, 7.2], [0, 7], [0, 0]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Midlands' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[2.5, 3.5], [7, 3], [9.5, 4], [10, 8], [7, 7.5], [3, 8], [2.5, 7.2], [3, 3.5], [2.5, 3.5]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Southreach' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[2.5, 0.5], [6, 0], [10, 1], [9.5, 4], [7, 3], [3, 3.5], [2.5, 0.5]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Outer Isles' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[11, 2], [12.5, 1.8], [12.8, 3.2], [11.3, 3.5], [11, 2]]],
          [[[11.5, 4.5], [13, 4.3], [13.2, 5.8], [11.8, 6], [11.5, 4.5]]],
        ],
      },
    },
  ],
};
