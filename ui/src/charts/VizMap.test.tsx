// @vitest-environment jsdom
/**
 * VizMap — behavioral suite: projection + path generation (Polygon,
 * MultiPolygon, holes), the quantized sequential ramp (token fills, both
 * themes ride the same markup), the honest empty state, point emission +
 * click-again-clear, keyboard access, aria labels, legend, degenerate geo.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { VizMap, type GeoFeatureCollection } from './VizMap.js';
import { selectionForView } from '../contract/selection.js';

afterEach(cleanup);

/** Three rectangular regions + one two-island MultiPolygon, lon/lat space. */
const GEO: GeoFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'North' },
      geometry: { type: 'Polygon', coordinates: [[[0, 6], [8, 6], [8, 10], [0, 10], [0, 6]]] },
    },
    {
      type: 'Feature',
      properties: { name: 'South' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [8, 0], [8, 6], [0, 6], [0, 0]]] },
    },
    {
      type: 'Feature',
      properties: { name: 'Isles' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[9, 1], [11, 1], [11, 3], [9, 3], [9, 1]]],
          [[[9, 4], [11, 4], [11, 6], [9, 6], [9, 4]]],
        ],
      },
    },
  ],
};

const DATA = [
  { region: 'North', value: 12 },
  { region: 'South', value: 3 },
  // Isles deliberately absent → the honest empty state
];

describe('VizMap — geometry and projection', () => {
  it('renders one region path per feature; a MultiPolygon joins its islands into one path', () => {
    const { container } = render(<VizMap geo={GEO} regionField="region" data={DATA} />);
    const paths = container.querySelectorAll('path.vzf-region');
    expect(paths).toHaveLength(3);
    const isles = container.querySelector('[data-region="Isles"]')!;
    // two islands → two closed subpaths in one d
    expect((isles.getAttribute('d')!.match(/M/g) ?? []).length).toBe(2);
    expect((isles.getAttribute('d')!.match(/Z/g) ?? []).length).toBe(2);
  });

  it('a Polygon hole rides the same path as an extra subpath under evenodd', () => {
    const holed: GeoFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Ring' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
              [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]], // the hole
            ],
          },
        },
      ],
    };
    const { container } = render(<VizMap geo={holed} regionField="region" data={[{ region: 'Ring', value: 1 }]} />);
    const path = container.querySelector('path.vzf-region')!;
    expect((path.getAttribute('d')!.match(/M/g) ?? []).length).toBe(2);
    expect(path.getAttribute('fill-rule')).toBe('evenodd');
  });

  it('projection preserves orientation: higher latitude renders HIGHER on screen (smaller y)', () => {
    const { container } = render(<VizMap geo={GEO} regionField="region" data={DATA} width={420} height={340} />);
    const yOf = (region: string): number => {
      const d = container.querySelector(`[data-region="${region}"]`)!.getAttribute('d')!;
      return Number(d.slice(1).split(' ')[0]!.split(',')[1]);
    };
    expect(yOf('North')).toBeLessThan(yOf('South'));
  });

  it('coordinates="planar" fits already-projected shapes as-is: larger y renders LOWER, no latitude compression', () => {
    const { container } = render(<VizMap geo={GEO} coordinates="planar" regionField="region" data={DATA} width={420} height={340} />);
    const yOf = (region: string): number => {
      const d = container.querySelector(`[data-region="${region}"]`)!.getAttribute('d')!;
      return Number(d.slice(1).split(' ')[0]!.split(',')[1]);
    };
    // the fixture's "North" carries the larger second coordinate — on a screen plane that is further DOWN
    expect(yOf('North')).toBeGreaterThan(yOf('South'));
  });

  it('a feature without properties (or without the name property) gets an indexed fallback name', () => {
    const anon: GeoFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
        { type: 'Feature', properties: { other: 1 }, geometry: { type: 'Polygon', coordinates: [[[1, 1], [2, 1], [2, 2], [1, 1]]] } },
      ],
    };
    const { container } = render(<VizMap geo={anon} regionField="region" data={[]} />);
    expect(container.querySelector('[data-region="region 1"]')).toBeTruthy();
    expect(container.querySelector('[data-region="region 2"]')).toBeTruthy();
  });

  it('honours a custom nameProperty', () => {
    const geo: GeoFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: 'Z1' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      ],
    };
    const { container } = render(<VizMap geo={geo} regionField="zone" nameProperty="id" data={[{ region: 'Z1', value: 2 }]} />);
    expect(container.querySelector('[data-region="Z1"]')).toBeTruthy();
  });

  it('a zero-area bbox (all points identical) falls back to a unit span — no division by zero', () => {
    const dot: GeoFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: 'Dot' }, geometry: { type: 'Polygon', coordinates: [[[5, 5], [5, 5], [5, 5], [5, 5]]] } },
      ],
    };
    const { container } = render(<VizMap geo={dot} regionField="region" data={[{ region: 'Dot', value: 1 }]} />);
    const d = container.querySelector('[data-region="Dot"]')!.getAttribute('d')!;
    expect(d.startsWith('M')).toBe(true);
    expect(d).not.toContain('NaN');
    expect(d).not.toContain('Infinity');
  });

  it('a collection with no coordinates renders without throwing (degenerate bbox)', () => {
    const empty: GeoFeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { name: 'Void' }, geometry: { type: 'Polygon', coordinates: [] } }],
    };
    const { container } = render(<VizMap geo={empty} regionField="region" data={[]} />);
    const path = container.querySelector('[data-region="Void"]')!;
    expect(path.getAttribute('d')).toBe('');
  });
});

describe('VizMap — the sequential ramp and the honest empty state', () => {
  it('fills ride the --vzf-seq-N tokens: the max region wears step 5, a low one a low step', () => {
    const { container } = render(<VizMap geo={GEO} regionField="region" data={DATA} />);
    expect(container.querySelector('[data-region="North"]')!.getAttribute('fill')).toBe('var(--vzf-seq-5)'); // 12/12
    expect(container.querySelector('[data-region="South"]')!.getAttribute('fill')).toBe('var(--vzf-seq-2)'); // ceil(3/12·5)=2
  });

  it('a region with no rows gets the NEUTRAL empty fill, the dashed class, and a tooltip note — never ramp step 1', () => {
    const { container } = render(<VizMap geo={GEO} regionField="region" data={DATA} valueLabel="rows" />);
    const isles = container.querySelector('[data-region="Isles"]')!;
    expect(isles.getAttribute('fill')).toBe('var(--vzf-map-empty)');
    expect(isles.getAttribute('class')).toContain('vzf-region-empty');
    expect(isles.querySelector('title')!.textContent).toBe('Isles · no rows under the current selection');
    expect(isles.getAttribute('aria-label')).toBe('Isles · no rows');
  });

  it('a zero-valued region is empty too (0 means none, not "low")', () => {
    const { container } = render(
      <VizMap geo={GEO} regionField="region" data={[...DATA, { region: 'Isles', value: 0 }]} />,
    );
    expect(container.querySelector('[data-region="Isles"]')!.getAttribute('fill')).toBe('var(--vzf-map-empty)');
  });

  it('when EVERY region is empty (max 0) all fills are neutral and the legend says so', () => {
    const { container } = render(
      <VizMap geo={GEO} regionField="region" data={[{ region: 'North', value: 0 }]} valueLabel="rows" />,
    );
    for (const p of container.querySelectorAll('path.vzf-region')) {
      expect(p.getAttribute('fill')).toBe('var(--vzf-map-empty)');
    }
    expect(container.querySelector('.vzf-map-note')!.textContent).toBe('no rows under the current selection');
    // a "0 to 0" domain would be noise — the absence line replaces the min/max labels
    expect(container.querySelectorAll('.vzf-map-minmax')).toHaveLength(0);
  });

  it('the legend shows the five ramp swatches and the 0→max domain with the unit word', () => {
    const { container } = render(<VizMap geo={GEO} regionField="region" data={DATA} valueLabel="sales" />);
    const swatches = container.querySelectorAll('.vzf-map-swatch');
    expect(swatches).toHaveLength(5);
    expect([...swatches].map((s) => s.getAttribute('fill'))).toEqual([
      'var(--vzf-seq-1)',
      'var(--vzf-seq-2)',
      'var(--vzf-seq-3)',
      'var(--vzf-seq-4)',
      'var(--vzf-seq-5)',
    ]);
    const minmax = [...container.querySelectorAll('.vzf-map-minmax')].map((t) => t.textContent);
    expect(minmax).toEqual(['0', '12 sales']);
    expect(container.querySelector('.vzf-map-note')).toBeNull(); // data exists — no absence note
  });

  it('shows the plain region-field label (NOT the interactive axis-label affordance) and the aria chart label', () => {
    const { container } = render(<VizMap geo={GEO} regionField="region" data={DATA} className="extra" />);
    const svg = container.querySelector('svg.vzf-map')!;
    expect(svg.getAttribute('class')).toBe('vzf-chart vzf-map extra');
    expect(svg.getAttribute('aria-label')).toBe('rows by region');
    const label = container.querySelector('.vzf-map-field')!;
    expect(label.textContent).toBe('region');
    expect(container.querySelector('.vzf-axis-label')).toBeNull();
  });
});

describe('VizMap — gesture, selection, keyboard', () => {
  it('clicking a region emits the R3 point on the region field; the selected region wears the stroke', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizMap geo={GEO} regionField="region" data={DATA} selected="South" onEmit={onEmit} />);
    expect(container.querySelector('[data-region="South"]')!.getAttribute('class')).toContain('vzf-selected');
    expect(container.querySelector('[data-region="South"]')!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'North · 12 rows' }));
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'North', encoding: { kind: 'point', field: 'region' } });
  });

  it('clicking the ALREADY-selected region emits the CLEARED point (rawValue undefined, not null)', () => {
    const onEmit = vi.fn();
    render(<VizMap geo={GEO} regionField="region" data={DATA} selected="North" onEmit={onEmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'North · 12 rows' }));
    expect(onEmit).toHaveBeenCalledTimes(1);
    const emission = onEmit.mock.calls[0]![0];
    expect(emission.encoding).toEqual({ kind: 'point', field: 'region' });
    expect('rawValue' in emission).toBe(true);
    expect(emission.rawValue).toBeUndefined();
    // the tooltip is honest about what the click will do
    const { container } = render(<VizMap geo={GEO} regionField="region" data={DATA} selected="North" />);
    expect(container.querySelector('[data-region="North"] title')!.textContent).toContain('click to clear');
    expect(container.querySelector('[data-region="South"] title')!.textContent).toContain('click to select');
  });

  it('regions are keyboard-focusable; Enter and Space select; other keys do not', () => {
    const onEmit = vi.fn();
    render(<VizMap geo={GEO} regionField="region" data={DATA} onEmit={onEmit} />);
    const north = screen.getByRole('button', { name: 'North · 12 rows' });
    expect(north.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(north, { key: 'Enter' });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'North', encoding: { kind: 'point', field: 'region' } });
    fireEvent.keyDown(north, { key: ' ' });
    expect(onEmit).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(north, { key: 'Tab' });
    expect(onEmit).toHaveBeenCalledTimes(2);
  });

  it('an empty region is still selectable (its name is a real data value) and works without onEmit', () => {
    const onEmit = vi.fn();
    render(<VizMap geo={GEO} regionField="region" data={DATA} onEmit={onEmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Isles · no rows' }));
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'Isles', encoding: { kind: 'point', field: 'region' } });
    // no onEmit handler → the click is a safe no-op
    cleanup();
    render(<VizMap geo={GEO} regionField="region" data={DATA} />);
    fireEvent.click(screen.getByRole('button', { name: 'North · 12 rows' }));
  });

  it("the outline derives from the selection fold's own point clause when `selected` is omitted (RP-1)", () => {
    const selection = selectionForView([{ viewId: 'map', field: 'region', kind: 'point', value: 'North' }], 'map');
    const { container } = render(<VizMap geo={GEO} regionField="region" data={DATA} selection={selection} />);
    expect(container.querySelector('[data-region="North"]')!.getAttribute('class')).toContain('vzf-selected');
    expect(container.querySelector('[data-region="South"]')!.getAttribute('class')).not.toContain('vzf-selected');
  });

  it('an explicit `selected` prop wins over the selection derivation', () => {
    const selection = selectionForView([{ viewId: 'map', field: 'region', kind: 'point', value: 'North' }], 'map');
    const { container } = render(<VizMap geo={GEO} regionField="region" data={DATA} selection={selection} selected="South" />);
    expect(container.querySelector('[data-region="South"]')!.getAttribute('class')).toContain('vzf-selected');
    expect(container.querySelector('[data-region="North"]')!.getAttribute('class')).not.toContain('vzf-selected');
  });
});
