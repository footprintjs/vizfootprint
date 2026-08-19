/**
 * L5 def — the LONG-FORM SERIES contract (F3).
 *
 * ONE shape in — `{ t, entity, metric, value }` — rows and a declared
 * channel→field map out. There is deliberately **no series chart API here and
 * none is coming**: the renderer contract already speaks "rows + declared
 * encodings" (`ui/src/contract/types.ts` `RenderState.rows` / `.encodings`), so
 * a long-form series becomes a first-class *input* to the surface that already
 * exists instead of a ninth chart component with its own bespoke props.
 *
 * The pieces, smallest-first (compose them; each is usable alone):
 *   - {@link seriesToRows}      points → `{ rows, encodings, entities, metrics, caption, skipped }`
 *   - {@link seriesDataSource}  that bundle → a `DataSourceDef` for `def.data[table]`
 *   - {@link seriesEncodingDecl} a `'series'` {@link ViewEncodingDecl} for `def.encodings`
 *   - {@link seriesCaption}     a caller-STATED grain → the caption line
 *
 * ── The column names ARE the contract ────────────────────────────────────────
 * `seriesToRows` always emits the four canonical columns (`t`/`entity`/
 * `metric`/`value`) and never renames them: that is what makes an
 * app-defined tool result plug in with no per-app mapping table. A *renderer*
 * still must not hardcode them — it reads the channel→field map, because
 * `reencode` can rebind any channel to any column at runtime.
 *
 * ── The fourth dimension: facet vs. filter (the decision, and why) ───────────
 * `t`→x, `value`→y and `entity`→color are the canonical three. `metric` is the
 * genuinely new dimension, and this module binds it to NEITHER a facet nor a
 * filter at conversion time. Both readings are reachable, per view, through
 * verbs the session already has:
 *
 *   - **Facet** — `reencode` the `facet` channel to the `metric` column. The
 *     `'series'` kind declares `facet` in its channel VOCABULARY
 *     ({@link SERIES_CHANNELS}) but leaves it UNBOUND at the fold's root, so a
 *     view that wants panels lands one cause-tagged `reencode` commit and gets
 *     branch-scoping, replay and seek-restore for free.
 *   - **Filter to one metric** — `select` on the `metric` column. That is a
 *     plain point clause in the crossfilter (`activeFilters`), which is
 *     precisely what "show only p95_latency" means, and it too is cause-tagged
 *     and time-travel restorable.
 *
 * Why not bake one in? Because `ViewEncodingDecl`'s grammar is channel→**field
 * name** (the `reencode` commit carries `field` = channel, `value` = target
 * *field*). "Show only the metric named `p95_latency`" pins a channel to a
 * **value**, which that grammar cannot express — encoding it there would mean
 * giving `initial` a second, value-carrying meaning, a breaking change to a
 * grammar the session fold, `compare`, and adopt all read. Restricting rows by
 * a column value already has a verb; a channel binding already has a verb. The
 * converter therefore declares the SCHEMA and lets a view's own history decide
 * the reading — which is also why `encodings` here is data-independent: the
 * facet binding is not switched on by "we happen to see two metrics," because
 * that would be the converter inferring a view decision from the data.
 *
 * ── Grain is stated, never inferred ─────────────────────────────────────────
 * A row array cannot reveal that it was downsampled — 100 daily means and 100
 * raw readings are byte-identical in shape. So {@link SeriesGrain} is something
 * the CALLER states (the triage contract's `grain`), it rides as source
 * metadata on `DataSourceDef.grain`, and {@link seriesCaption} renders it under
 * the chart. Absent a stated grain the caption is `null` — vizfootprint never
 * invents "hourly mean". Every grain string is caller-supplied and is echoed
 * verbatim, never parsed (R12).
 */

import type { Row } from '../data/index.js';
import type { DataSourceDef, SeriesGrain, ViewEncodingDecl } from './types.js';

/**
 * ONE measurement in long form: at instant `t`, for `entity`, the measurement
 * named `metric` read `value`.
 *
 * `t` is an ISO-8601 date or timestamp STRING (lexicographic order ==
 * chronological order — the same rule `<VizLine>` and `src/data`'s string
 * interval predicate already rely on). A measurement that did not happen is an
 * ABSENT point, never a `null` value: honest absence, so a gap in a line is a
 * gap in the data and not a zero.
 */
export interface SeriesPoint {
  /** ISO-8601 date or timestamp, e.g. `'2026-08-19'` or `'2026-08-19T14:00:00Z'`. */
  readonly t: string;
  /** WHO/WHAT was measured — the canonical color split (one line per entity). */
  readonly entity: string;
  /** WHICH measurement this is — the fourth dimension (facet or filter, per view). */
  readonly metric: string;
  /** The measured number. Non-finite values are not measurements — such points are skipped. */
  readonly value: number;
}

/** The canonical column name each part of a {@link SeriesPoint} lands under. */
export const SERIES_FIELDS = Object.freeze({
  t: 't',
  entity: 'entity',
  metric: 'metric',
  value: 'value',
} as const);

/** The chart kind a series view declares (`ViewEncodingDecl.chartKind`; echoed verbatim, never parsed — R12). */
export const SERIES_CHART_KIND = 'series';

/**
 * The channel VOCABULARY a `'series'` view accepts. `facet` is declared here —
 * so a `reencode` binding it to `metric` is validated and accepted (R14: the
 * host declared the vocabulary, the session never guessed it) — while staying
 * unbound in {@link SERIES_ENCODINGS} until a view actually asks for it.
 */
export const SERIES_CHANNELS: readonly string[] = Object.freeze(['x', 'y', 'color', 'facet']);

/** The canonical channel→field binding: time on x, the number on y, the entity as color. */
export const SERIES_ENCODINGS: Readonly<Record<string, string>> = Object.freeze({
  x: SERIES_FIELDS.t,
  y: SERIES_FIELDS.value,
  color: SERIES_FIELDS.entity,
});

/** What {@link seriesToRows} was told, beyond the points themselves. */
export interface SeriesToRowsOptions {
  /**
   * What the CALLER states about how these points were produced — bucket,
   * reducer, how many source points collapsed. Never inferred; absent means the
   * source says nothing and the caption is `null`.
   */
  readonly grain?: SeriesGrain;
}

/**
 * The converted series: rows ready for `DataSourceDef.rows`, the canonical
 * channel→field map, the two categorical vocabularies the points actually
 * contain, and the honest count of points that could not be placed.
 */
export interface SeriesSource {
  /** One row per placeable point, in input order. Drop straight into `DataSourceDef.rows`. */
  readonly rows: readonly Row[];
  /** The canonical binding ({@link SERIES_ENCODINGS}) — data-independent by design. */
  readonly encodings: Readonly<Record<string, string>>;
  /** Distinct `entity` values, in first-seen order (the color vocabulary). */
  readonly entities: readonly string[];
  /** Distinct `metric` values, in first-seen order — what a facet would panel by, or a `select` narrow to. */
  readonly metrics: readonly string[];
  /** The caller's stated grain, echoed. Absent when the caller stated none. */
  readonly grain?: SeriesGrain;
  /** The grain rendered as one line of prose, or `null` when no grain was stated. */
  readonly caption: string | null;
  /**
   * Points the converter could not place (not an object, or a missing/blank
   * `t`/`entity`/`metric`, or a non-finite `value`). Counted and reported —
   * never silently dropped, never guessed at. A tool result is untrusted input;
   * this is where its malformed entries surface.
   */
  readonly skipped: number;
}

/** True iff a point carries all four parts in a placeable form. */
function isPlaceable(point: unknown): point is SeriesPoint {
  if (point === null || typeof point !== 'object') return false;
  const p = point as Partial<SeriesPoint>;
  if (typeof p.t !== 'string' || p.t.length === 0) return false;
  if (typeof p.entity !== 'string' || p.entity.length === 0) return false;
  if (typeof p.metric !== 'string' || p.metric.length === 0) return false;
  return typeof p.value === 'number' && Number.isFinite(p.value);
}

/**
 * Render a caller-STATED {@link SeriesGrain} as the one caption line that goes
 * under the chart. Returns `null` when nothing was stated (or an empty grain
 * object was) — the absence of a caption is itself honest: it means the source
 * told us nothing about its own granularity, not that the data is raw.
 *
 * Every part is the caller's own wording, echoed verbatim and never parsed
 * (R12) — vizfootprint does not know what `'5m'` or `'p95'` mean and does not
 * pretend to.
 */
export function seriesCaption(grain: SeriesGrain | undefined): string | null {
  if (grain === undefined) return null;
  const parts: string[] = [];
  if (grain.reducer !== undefined && grain.bucket !== undefined) {
    parts.push(`${grain.reducer} per ${grain.bucket}`);
  } else if (grain.bucket !== undefined) {
    parts.push(`one point per ${grain.bucket}`);
  } else if (grain.reducer !== undefined) {
    parts.push(`reduced by ${grain.reducer}`);
  }
  if (grain.collapsedFrom !== undefined) {
    parts.push(`folded from ${grain.collapsedFrom} point${grain.collapsedFrom === 1 ? '' : 's'}`);
  }
  if (grain.note !== undefined) parts.push(grain.note);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * THE converter: long-form points → rows + the canonical channel→field map.
 *
 * Pure and total — it never throws on a malformed entry, it skips it and counts
 * it ({@link SeriesSource.skipped}), the same discipline `<VizLine>` already
 * applies to an unparseable date ("skipped, never guessed"). Row order is input
 * order; the converter sorts nothing, buckets nothing, and aggregates nothing
 * (the host owns every transform — the transform-ownership rule).
 */
export function seriesToRows(
  points: readonly SeriesPoint[],
  options: SeriesToRowsOptions = {},
): SeriesSource {
  const rows: Row[] = [];
  const entities: string[] = [];
  const metrics: string[] = [];
  const seenEntity = new Set<string>();
  const seenMetric = new Set<string>();
  let skipped = 0;

  for (const point of points) {
    if (!isPlaceable(point)) {
      skipped += 1;
      continue;
    }
    rows.push({
      [SERIES_FIELDS.t]: point.t,
      [SERIES_FIELDS.entity]: point.entity,
      [SERIES_FIELDS.metric]: point.metric,
      [SERIES_FIELDS.value]: point.value,
    });
    if (!seenEntity.has(point.entity)) {
      seenEntity.add(point.entity);
      entities.push(point.entity);
    }
    if (!seenMetric.has(point.metric)) {
      seenMetric.add(point.metric);
      metrics.push(point.metric);
    }
  }

  const grain = options.grain;
  return {
    rows,
    encodings: SERIES_ENCODINGS,
    entities,
    metrics,
    ...(grain !== undefined ? { grain } : {}),
    caption: seriesCaption(grain),
    skipped,
  };
}

/**
 * Narrow a converted series to the `DataSourceDef` slot — `def.data[table]`.
 * The stated grain rides along as source metadata so the caption survives all
 * the way to a renderer without a side channel.
 */
export function seriesDataSource(source: SeriesSource): DataSourceDef {
  return {
    rows: source.rows,
    ...(source.grain !== undefined ? { grain: source.grain } : {}),
  };
}

/**
 * The `'series'` view-kind declaration for `def.encodings` (R14: a view's
 * channel vocabulary is DECLARED, never guessed from its chart kind).
 *
 * `channels` is the full vocabulary ({@link SERIES_CHANNELS}, `facet`
 * included); `initial` seeds the fold with the canonical three. Pass
 * `{ facet: true }` for a view that should START faceted by metric — the same
 * state a `reencode` of the `facet` channel would reach, just seeded at the
 * fold's root instead of landed as a commit.
 */
export function seriesEncodingDecl(
  viewId: string,
  options: { readonly facet?: boolean } = {},
): ViewEncodingDecl {
  return {
    viewId,
    chartKind: SERIES_CHART_KIND,
    channels: SERIES_CHANNELS,
    initial: options.facet === true
      ? { ...SERIES_ENCODINGS, facet: SERIES_FIELDS.metric }
      : { ...SERIES_ENCODINGS },
  };
}
