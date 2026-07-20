/** A pure linear scale with an inverse (data ⇄ pixel), no chart-library dep. */
export interface LinearScale {
  (v: number): number;
  invert(px: number): number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
}

export function linearScale(d0: number, d1: number, r0: number, r1: number): LinearScale {
  const m = (r1 - r0) / (d1 - d0 || 1);
  const f = ((v: number) => r0 + (v - d0) * m) as ((v: number) => number) & {
    invert(px: number): number;
    domain: [number, number];
    range: [number, number];
  };
  f.invert = (px: number) => d0 + (px - r0) / m;
  f.domain = [d0, d1];
  f.range = [r0, r1];
  return f;
}

/** The [min, max] extent of a numeric accessor over rows, padded by `pad`. */
export function extent<T>(rows: readonly T[], get: (r: T) => number, pad = 0): [number, number] {
  if (rows.length === 0) return [0 - pad, 1 + pad];
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    const v = get(r);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0 - pad, 1 + pad];
  if (lo === hi) return [lo - pad - 1, hi + pad + 1];
  return [lo - pad, hi + pad];
}

/** `n+1` evenly-spaced tick values across [lo, hi]. */
export function ticks(lo: number, hi: number, n: number): number[] {
  const out: number[] = [];
  for (let k = 0; k <= n; k++) out.push(lo + ((hi - lo) * k) / n);
  return out;
}

// ── the shared date handling (ISO-8601 strings, lexicographic == chronological) ──

/**
 * An ISO-8601 date string's epoch milliseconds, or null when unparseable —
 * a chart positions dates on a linear scale through this and SKIPS what it
 * cannot place (never guessed; the VizLine/VizHistogram discipline).
 */
export function epochOf(iso: string): number | null {
  const epoch = Date.parse(iso);
  return Number.isNaN(epoch) ? null : epoch;
}

/** The date-part of an ISO string — tick labels stay short even for full timestamps. */
export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

// ── the shared sequential-ramp step (the map's magnitude scale, D30 reused) ──

/** How many steps the quantized `--vzf-seq-*` sequential ramp has. */
export const SEQ_RAMP_STEPS = 5;

/**
 * Ramp step 1..{@link SEQ_RAMP_STEPS} for a value in (0, max]. A 0/absent
 * value is the EMPTY state (`--vzf-map-empty`, the honest neutral), never
 * step 1 — step 1 means "low", not "none". Shared by VizMap and VizHeatmap
 * so magnitude reads identically across both.
 */
export function rampStep(value: number, max: number): number {
  return Math.min(SEQ_RAMP_STEPS, Math.max(1, Math.ceil((value / max) * SEQ_RAMP_STEPS)));
}
