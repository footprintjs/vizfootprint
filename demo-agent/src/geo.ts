/**
 * The demo-agent's region map — adapted from `ui/gallery/data.ts`'s
 * `GALLERY_GEO` fixture (same stylized five-territory shape, duplicated here
 * rather than imported: demo-agent bundles independently of ui/gallery's dev
 * tooling). Four stylized territories a data row can inhabit, plus a
 * two-island `MultiPolygon` chain ("Outer Isles") that `demo-agent/gen-data.mjs`
 * deliberately never assigns a row to — `VizMap`'s honest-absence state is on
 * screen by default, not just in a test.
 */
import type { GeoFeatureCollection } from 'vizfootprint-ui';

/** The four INHABITED regions — must match gen-data.mjs's REGIONS (minus "Outer Isles"). */
export const REGIONS = ['Northlands', 'Coastal Strip', 'Midlands', 'Southreach'] as const;

export const DEMO_GEO: GeoFeatureCollection = {
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
