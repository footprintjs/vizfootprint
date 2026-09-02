// @vitest-environment jsdom
/**
 * Layer 4 `onClear`: a cleared clause an edge still keeps in force is a
 * visible chip — a person must see why a target is still filtered.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { SelectionChips, keptClauses } from './SelectionChips.js';
import type { ClearedSelectionView, LinkGraphView } from '../adapter/types.js';

afterEach(cleanup);

const cleared: ClearedSelectionView[] = [
  { viewId: 'weeks', field: 't', kind: 'interval', value: ['2025-03-01', '2025-05-01'], clearedBy: 's2' },
  { viewId: 'map', field: 'region', kind: 'point', value: 'Ohio', clearedBy: 's4' },
];
const links: LinkGraphView = {
  default: 'crossfilter',
  views: [
    { viewId: 'weeks', voice: ['interval'] },
    { viewId: 'trend', voice: [] },
    { viewId: 'map', voice: ['point'] },
    { viewId: 'bar', voice: ['point'] },
  ],
  edges: [
    { id: 'weeks:interval→trend', source: 'weeks', kind: 'interval', target: 'trend', response: 'navigate', origin: 'declared', onClear: 'leave' },
    { id: 'map:point→bar', source: 'map', kind: 'point', target: 'bar', response: 'highlight', origin: 'declared', onClear: 'showAll' },
  ],
};

describe('kept chips', () => {
  it('a leave/excludeAll edge makes a kept chip; showAll, a live re-selection, or no graph make none', () => {
    expect(keptClauses(cleared, links, []).map((k) => [k.clause.viewId, k.kept])).toEqual([['weeks', [{ target: 'trend', policy: 'leave' }]]]);
    expect(keptClauses(cleared, links, [{ viewId: 'weeks', field: 't', kind: 'interval', value: ['2025-06-01', '2025-07-01'] }])).toEqual([]);
    expect(keptClauses(cleared, undefined, [])).toEqual([]);
    render(<SelectionChips selections={[]} cleared={cleared} links={links} labels={{ weeks: 'Weeks', trend: 'Trend' }} />);
    const chip = screen.getByText(/kept after clearing for Trend/);
    expect(chip.closest('[data-kept="true"]')).not.toBeNull();
    expect(screen.queryByText(/no selection/)).toBeNull(); // a kept chip is a selection a person can see
    expect(chip.closest('.vzf-selchip')!.textContent).toContain('cleared by commit s2; Trend keeps it. To release it, select on Weeks again');
    expect(chip.closest('[role="group"]')!.getAttribute('aria-label')).toBe('selections, live and kept');
  });
  it('without labels the view ids speak; an excludeAll edge says the target shows nothing; a follow edge never keeps a clause', () => {
    const graph: LinkGraphView = {
      ...links,
      edges: [
        { id: 'weeks:interval→trend', source: 'weeks', kind: 'interval', target: 'trend', response: 'filter', origin: 'edited', onClear: 'excludeAll' },
        { id: 'weeks:encoding→trend', source: 'weeks', kind: 'encoding', target: 'trend', response: 'follow', origin: 'declared' },
      ],
    };
    render(<SelectionChips selections={[]} cleared={cleared} links={graph} />);
    const chip = screen.getByText(/kept after clearing for trend/);
    expect(chip.closest('.vzf-selchip')!.textContent).toContain('cleared by commit s2; trend shows nothing. To release it, select on weeks again');
    expect(keptClauses(cleared, graph, [])).toHaveLength(1);
  });
  it('with nothing kept and nothing live, the empty line shows as before', () => {
    render(<SelectionChips selections={[]} cleared={cleared} links={{ ...links, edges: [] }} />);
    expect(screen.getByText(/no selection/)).toBeDefined();
  });
});
