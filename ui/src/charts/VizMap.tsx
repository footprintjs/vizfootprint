/**
 * `<VizMap>` — a self-contained SVG choropleth: the consumer passes a GeoJSON
 * FeatureCollection (`geo`, region name on a feature property), the data
 * column those names match (`regionField`), and one value per region (`data`
 * — in the canonical wiring the CONSUMER computes it as the row count per
 * region under the current crossfilter, the {@link VizBar} recompute pattern).
 * No tiles, no map library — pure SVG paths.
 *
 * PROJECTION (design call): a fitted equirectangular (plate carrée) — the
 * collection's lon/lat bounding box is scaled uniformly into the plot, with a
 * cos(mid-latitude) x-compression so east–west distances are not stretched at
 * higher latitudes. For the regional extents a dashboard choropleth shows,
 * this is visually faithful, deterministic, and zero-dependency; it is NOT a
 * world-scale conformal projection and does not claim to be.
 *
 * COLOR (design call, validator-backed): a QUANTIZED five-step single-hue
 * sequential ramp — teal, a hue deliberately absent from the semantic accent
 * palette (violet/azure/amber/green/rose/clay) so magnitude never impersonates
 * identity. The steps live on the `--vzf-seq-1..5` tokens with their own dark
 * values (high = brightest on dark — the anchor flips), so the SAME markup is
 * readable in both themes. Regions with NO rows get an honest neutral
 * (`--vzf-map-empty` + dashed outline) plus a tooltip note — never step 1 of
 * the ramp, which means "low", not "none".
 *
 * GESTURE: click a region → the R3 point emission `{ rawValue: regionName,
 * encoding: { kind: 'point', field: regionField } }` (the emission contract
 * carries kind+field only — a chart never builds clauses). The selected
 * region wears the selection stroke; clicking it AGAIN emits the CLEARED
 * point (`rawValue: undefined` — the "no filter" state of the three-way
 * point split in src/data/types.ts), releasing the filter. Regions are
 * keyboard-focusable; Enter/Space selects; aria labels carry name + value.
 */
import type { ChartEmission } from '../../../src/mosaic/index.js';
import type { RenderSelection } from '../contract/types.js';
import { togglePointEmission, toggleInSetEmission } from '../primitives/pointSelect.js';
import { markClass, selectedSet } from '../primitives/useSelection.js';
import { rampStep, SEQ_RAMP_STEPS } from '../primitives/scales.js';

/** A lon/lat ring: `[ [lon, lat], … ]`. */
export type GeoRing = readonly (readonly [number, number])[];

/** The two geometry kinds a choropleth region needs (holes supported via rings). */
export type GeoGeometry =
  | { readonly type: 'Polygon'; readonly coordinates: readonly GeoRing[] }
  | { readonly type: 'MultiPolygon'; readonly coordinates: readonly (readonly GeoRing[])[] };

export interface GeoFeature {
  readonly type: 'Feature';
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly geometry: GeoGeometry;
}

export interface GeoFeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: readonly GeoFeature[];
}

/** One region's value under the current crossfilter (row count in the canonical wiring). */
export interface RegionDatum {
  readonly region: string;
  readonly value: number;
}

export interface VizMapProps {
  readonly viewId?: string;
  /** GeoJSON FeatureCollection; each feature's `properties[nameProperty]` is its region name. */
  readonly geo: GeoFeatureCollection;
  /** The DATA column whose values match the feature names (the point-emission field). */
  readonly regionField: string;
  /** The feature property carrying the region name. Default `'name'`. */
  readonly nameProperty?: string;
  /**
   * What the feature coordinates ARE. `'lonlat'` (default): degrees, fitted
   * equirectangular with cos(mid-latitude) x-compression, north up.
   * `'planar'`: already projected to a screen-like plane (us-atlas, any Albers
   * output) — fitted uniformly, y growing DOWN, no compression.
   */
  readonly coordinates?: 'lonlat' | 'planar';
  /** Value per region, consumer-computed (canonically: crossfiltered row count). */
  readonly data: readonly RegionDatum[];
  /** The unit word for tooltips/legend (default `'rows'`). */
  readonly valueLabel?: string;
  /** The selected region (controlled). Omit it and the outline derives from `selection`'s own point clause (RP-1). */
  readonly selected?: string | null;
  /** The clause-addressable crossfilter selection (RP-1) — feeds the `selected` derivation. */
  readonly selection?: RenderSelection;
  readonly onEmit?: (emission: ChartEmission) => void;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

const PAD = { l: 12, r: 12, t: 12, b: 40 };
// The quantized sequential ramp is the shared primitives-tier helper now
// (`rampStep`/`SEQ_RAMP_STEPS` in ../primitives/scales.ts) — VizHeatmap rides
// the exact same magnitude scale, so the two never drift.
const RAMP_STEPS = SEQ_RAMP_STEPS;

interface Projector {
  (lonLat: readonly [number, number]): readonly [number, number];
}

/**
 * Fitted equirectangular: uniform scale of the collection's bbox into the
 * plot with cos(mid-latitude) x-compression, centered on both axes. With
 * `planar`, the bbox is fitted as-is: no compression, y already downward.
 */
function fitProjection(geo: GeoFeatureCollection, plot: { x: number; y: number; w: number; h: number }, planar = false): Projector {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const f of geo.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of polys) {
      for (const ring of rings) {
        for (const [lon, lat] of ring) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
  }
  if (!Number.isFinite(minLon)) {
    // a collection with no coordinates — default the bbox to a unit box so the
    // projector below stays well-defined (nothing will ever ask it to project,
    // since no ring has points, but a real function beats a special case)
    minLon = 0;
    maxLon = 1;
    minLat = 0;
    maxLat = 1;
  }
  const kx = planar ? 1 : Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const spanX = (maxLon - minLon) * kx || 1;
  const spanY = maxLat - minLat || 1;
  const scale = Math.min(plot.w / spanX, plot.h / spanY);
  const offX = plot.x + (plot.w - spanX * scale) / 2;
  const offY = plot.y + (plot.h - spanY * scale) / 2;
  if (planar) return ([x, y]) => [offX + (x - minLon) * scale, offY + (y - minLat) * scale];
  return ([lon, lat]) => [offX + (lon - minLon) * kx * scale, offY + (maxLat - lat) * scale];
}

/** One SVG path string per feature (rings joined; holes render via evenodd). */
function featurePath(f: GeoFeature, project: Projector): string {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const parts: string[] = [];
  for (const rings of polys) {
    for (const ring of rings) {
      const pts = ring.map((c) => project(c).map((n) => Math.round(n * 100) / 100).join(','));
      /* v8 ignore next -- a zero-point ring is representable but not constructible from real
         GeoJSON (a ring is a closed line of ≥4 positions); guarded so a malformed feature
         degrades to an empty subpath instead of "M Z" garbage */
      if (pts.length === 0) continue;
      parts.push(`M${pts.join(' L')} Z`);
    }
  }
  return parts.join(' ');
}

export function VizMap(props: VizMapProps): JSX.Element {
  const {
    viewId = 'map',
    geo,
    regionField,
    nameProperty = 'name',
    data,
    valueLabel = 'rows',
    selection,
    onEmit,
    width = 420,
    height = 340,
  } = props;

  // explicit `selected` wins; otherwise the outline derives from the fold's own point OR match clause (SET-1)
  const set = selectedSet(props.selected, selection);
  const selected = set.values.length === 1 && !set.exclude ? set.values[0]! : null;

  const values = new Map(data.map((d) => [d.region, d.value]));
  const max = Math.max(0, ...data.map((d) => d.value));
  const project = fitProjection(geo, { x: PAD.l, y: PAD.t, w: width - PAD.l - PAD.r, h: height - PAD.t - PAD.b }, props.coordinates === 'planar');

  const emit = (region: string, additive: boolean): void => {
    // plain click: the selected region again CLEARS the point (rawValue undefined —
    // src/data's three-way split; null would mean "match SQL NULL"), another
    // region selects it; shift/⌘/ctrl-click toggles it in the view's own SET (SET-1)
    const emission: ChartEmission = additive ? toggleInSetEmission(regionField, region, set) : togglePointEmission(regionField, region, selected);
    onEmit?.(emission);
  };

  const legendW = 18;
  const legendX = (i: number): number => PAD.l + i * (legendW + 2);

  return (
    <svg
      className={`vzf-chart vzf-map${props.className ? ' ' + props.className : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${valueLabel} by ${regionField}`}
    >
      {geo.features.map((f, i) => {
        const name = String(f.properties?.[nameProperty] ?? `region ${i + 1}`);
        const value = values.get(name);
        const hasData = value !== undefined && value > 0 && max > 0;
        const isSel = set.values.includes(name);
        return (
          <path
            key={name}
            className={`vzf-region${hasData ? '' : ' vzf-region-empty'}${markClass(name, set)}`}
            d={featurePath(f, project)}
            fillRule="evenodd"
            fill={hasData ? `var(--vzf-seq-${rampStep(value, max)})` : 'var(--vzf-map-empty)'}
            role="button"
            tabIndex={0}
            aria-pressed={isSel}
            aria-label={hasData ? `${name} · ${value} ${valueLabel}` : `${name} · no ${valueLabel}`}
            data-region={name}
            onClick={(e) => emit(name, e.shiftKey || e.metaKey || e.ctrlKey)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              emit(name, e.shiftKey || e.metaKey || e.ctrlKey);
            }}
          >
            <title>
              {hasData
                ? `${name} · ${value} ${valueLabel} · click to ${isSel ? 'clear' : 'select'}`
                : `${name} · no ${valueLabel} under the current selection`}
            </title>
          </path>
        );
      })}
      {/* legend: the five ramp steps, bottom-left; the field label sits
          bottom-RIGHT (end-anchored) so the two never collide at narrow
          cockpit cell widths. When max is 0 the 0→max labels would read
          "0 to 0", so the honest absence line replaces them. */}
      <g className="vzf-map-legend" aria-hidden="true">
        {Array.from({ length: RAMP_STEPS }, (_, i) => (
          <rect
            key={i}
            className="vzf-map-swatch"
            x={legendX(i)}
            y={height - PAD.b + 14}
            width={legendW}
            height={8}
            rx={2}
            fill={`var(--vzf-seq-${i + 1})`}
          />
        ))}
        {max > 0 ? (
          <>
            <text className="vzf-map-minmax" x={legendX(0)} y={height - PAD.b + 32}>
              0
            </text>
            <text className="vzf-map-minmax" x={legendX(RAMP_STEPS) + 4} y={height - PAD.b + 22}>
              {max} {valueLabel}
            </text>
          </>
        ) : (
          <text className="vzf-map-note" x={legendX(0)} y={height - PAD.b + 32}>
            no {valueLabel} under the current selection
          </text>
        )}
      </g>
      {/* a PLAIN field label — deliberately not .vzf-axis-label (that class is
          the interactive picker affordance; the map has no encoding picker,
          so it must not look like it does) */}
      <text className="vzf-map-field" x={width - PAD.r} y={height - 6} textAnchor="end" data-map-field={regionField} aria-hidden="true">
        {regionField}
      </text>
      {/* viewId anchors the a11y relationship between chart + emissions in tests */}
      <desc>{`view ${viewId}: click a region to filter ${regionField}; click it again to clear`}</desc>
    </svg>
  );
}
