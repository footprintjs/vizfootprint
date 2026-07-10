/** Deterministic seeded dataset for the gallery — no fetch, no CSV, no random. */

export interface GalleryRow {
  readonly id: string;
  readonly category: string;
  readonly price: number;
  readonly rating: number;
  [k: string]: string | number;
}

export const CATEGORIES = ['Casual', 'Formal', 'Party', 'Work', 'Summer'] as const;

export const CATEGORY_COLORS: Record<string, string> = {
  Casual: '#2f80f0',
  Formal: '#7c5cff',
  Party: '#f2568f',
  Work: '#0fa38f',
  Summer: '#f2a02c',
};

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

/** 60 rows, price 20–220, rating loosely rising with price (a real correlation to declare). */
export function galleryRows(): GalleryRow[] {
  const rnd = mulberry32(20260710);
  const rows: GalleryRow[] = [];
  for (let i = 0; i < 60; i++) {
    const category = CATEGORIES[i % CATEGORIES.length]!;
    const price = Math.round((20 + rnd() * 200) * 100) / 100;
    const base = 1.5 + (price / 220) * 3; // rating trends up with price
    const rating = Math.max(1, Math.min(5, Math.round((base + (rnd() - 0.5) * 1.6) * 10) / 10));
    rows.push({ id: `d${String(i + 1).padStart(2, '0')}`, category, price, rating });
  }
  return rows;
}
