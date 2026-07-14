/**
 * THE KEY/DATUM TRANSLATION SEAM — documented once, here, for the whole
 * bridge (the Weave/Adapter `keyColumnToYIndex` lesson, docs/research/
 * weave-study.md: a renderer that speaks its own value space needs ONE
 * first-class translation table to the host's key space, or every new
 * renderer rebuilds it from scratch).
 *
 * Vega's signal values are renderer-internal:
 *   - an interval param's signal is `{ <field>: [lo, hi] }` — numbers for a
 *     quantitative axis, epoch-MILLISECOND numbers for a temporal axis, and
 *     `{}` when the brush is cleared;
 *   - a point param's signal is `{ <field>: [v1, v2, …], vlPoint: … }` — the
 *     toggle set, `{}` when cleared;
 *   - a `bind: 'scales'` param's signal is `{ <field>: [lo, hi], … }` per
 *     scaled axis.
 *
 * The host speaks DATA space only (contract R5): numbers, or ISO-8601 date
 * STRINGS (lexicographic == chronological — the half-open/date machinery in
 * src/data). Everything that crosses that boundary crosses HERE:
 *
 *   - temporal ms → ISO strings via {@link msToIso}. The default `'date'`
 *     format floors both bounds to their UTC calendar day — a brush that
 *     touches any part of a day includes the whole day (deliberate, documented
 *     WIDENING at day granularity, matching date-only row values like
 *     `2026-05-03`; a full-ISO lower bound would lexicographically EXCLUDE
 *     the very day it lands on). Pass `'datetime'` for full-precision ISO
 *     when the rows themselves carry datetimes.
 *   - a point toggle set → its MOST RECENT value (one live clause per view is
 *     the session's rule; a multi-toggle is not one clause).
 *   - cleared (`{}`) → `null` (the host's own "cleared" wire value).
 *
 * Interval rawValues ride the `[lo, hi] as unknown as [number, number]` cast
 * for ISO strings — the exact `VizLine` pattern (ui/src/charts/VizLine.tsx),
 * pinned there by the src/data string-interval path.
 */

import type { NavigateViewState } from 'vizfootprint-ui';
import type { GatedNavigateChannel } from './specGate.js';

/** How temporal bounds are written onto the host wire. Default `'date'`. */
export type DateFormat = 'date' | 'datetime';

/** Epoch ms → the host's ISO wire format (see the seam contract above). */
export function msToIso(ms: number, format: DateFormat): string {
  const iso = new Date(ms).toISOString();
  return format === 'datetime' ? iso : iso.slice(0, 10);
}

/** A signal's `[lo, hi]` pair when it carries one, else null (cleared/malformed). */
function numberPair(signalValue: unknown, field: string): readonly [number, number] | null {
  if (typeof signalValue !== 'object' || signalValue === null) return null;
  const v = (signalValue as Record<string, unknown>)[field];
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [lo, hi] = v as [unknown, unknown];
  if (typeof lo !== 'number' || typeof hi !== 'number' || Number.isNaN(lo) || Number.isNaN(hi)) return null;
  return [lo, hi];
}

/**
 * An interval param's signal value → the emission's DATA-space rawValue:
 * `[lo, hi]` numbers, ISO strings for a temporal axis, or `null` = cleared.
 */
export function intervalRawValue(
  signalValue: unknown,
  field: string,
  temporal: boolean,
  format: DateFormat,
): [number, number] | null {
  const pair = numberPair(signalValue, field);
  if (pair === null) return null;
  if (temporal) return [msToIso(pair[0], format), msToIso(pair[1], format)] as unknown as [number, number];
  return [pair[0], pair[1]];
}

/**
 * A point param's signal value → the emission's rawValue: the toggle set's
 * most recent value, or `null` = cleared.
 */
export function pointRawValue(signalValue: unknown, field: string): unknown {
  if (typeof signalValue !== 'object' || signalValue === null) return null;
  const v = (signalValue as Record<string, unknown>)[field];
  if (!Array.isArray(v) || v.length === 0) return null;
  return v[v.length - 1];
}

/**
 * A `bind: 'scales'` param's signal value → the contract's per-CHANNEL
 * {@link NavigateViewState} (x/y keys, DATA-space domains, ISO strings for
 * temporal axes), or null when no channel carries a domain yet.
 */
export function navigateViewState(
  signalValue: unknown,
  channels: readonly GatedNavigateChannel[],
  format: DateFormat,
): NavigateViewState | null {
  const out: Record<string, readonly [number, number] | readonly [string, string]> = {};
  for (const ch of channels) {
    const pair = numberPair(signalValue, ch.field);
    if (pair === null) continue;
    out[ch.channel] = ch.temporal ? [msToIso(pair[0], format), msToIso(pair[1], format)] : pair;
  }
  return Object.keys(out).length > 0 ? out : null;
}
