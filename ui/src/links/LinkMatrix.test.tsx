// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LinkMatrix, cellOf, edgeAt } from './index.js';
import type { LinkGraphView } from '../adapter/types.js';

afterEach(cleanup);

const GRAPH: LinkGraphView = {
  default: 'none',
  views: [
    { viewId: 'map', voice: ['point', 'match'] },
    { viewId: 'bar', voice: ['point'] },
    { viewId: 'mute', voice: [] },
  ],
  edges: [
    { id: 'map:point→bar', source: 'map', kind: 'point', target: 'bar', response: 'highlight', origin: 'declared', label: 'the map lights the bar' },
    { id: 'map:match→bar', source: 'map', kind: 'match', target: 'bar', response: 'filter', origin: 'default' },
    { id: 'bar:point→map', source: 'bar', kind: 'point', target: 'map', response: 'none', origin: 'declared' },
    { id: 'bar:point→mute', source: 'bar', kind: 'point', target: 'mute', response: 'none', origin: 'edited' },
  ],
};

describe('LinkMatrix — the three facts, the silence, the self cell', () => {
  it('draws a row per (source, kind), a column per view, and names each cell by its fact', () => {
    const { container } = render(<LinkMatrix graph={GRAPH} labels={{ map: 'Map' }} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3); // map×2 kinds + bar×1; mute is silent, no row
    expect(container.querySelector('[data-edge="map:point→bar"]')?.getAttribute('data-fact')).toBe('declared');
    expect(container.querySelector('[data-edge="map:point→bar"]')?.textContent).toBe('highlight');
    expect(container.querySelector('[data-edge="map:match→bar"]')?.getAttribute('data-fact')).toBe('default');
    expect(container.querySelector('[data-edge="bar:point→map"]')?.getAttribute('data-fact')).toBe('none');
    expect(container.querySelector('[data-edge="map:point→mute"]')?.getAttribute('data-fact')).toBe('silence');
    expect(container.querySelector('[data-edge="map:point→mute"]')?.textContent).toBe('');
    expect(container.querySelectorAll('.vzf-linkmatrix-self')).toHaveLength(3);
    expect(screen.getAllByText('Map').length).toBeGreaterThan(0);
    expect(edgeAt(GRAPH, 'map', 'point', 'bar')?.response).toBe('highlight');
    expect(cellOf(undefined)).toEqual({ text: '', fact: 'silence' });
  });
  it('with onChange every cell is a select; a change hands the host one edge; readOnly keeps text; silent sources can be shown', () => {
    const onChange = vi.fn();
    const { container } = render(<LinkMatrix graph={GRAPH} onChange={onChange} hideSilentSources={false} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3); // mute has no kinds → still no row, but not hidden by the flag
    const select = screen.getByRole('combobox', { name: 'map point → mute' }) as HTMLSelectElement;
    expect(select.value).toBe(''); // silence
    fireEvent.change(select, { target: { value: 'mirror' } });
    expect(onChange).toHaveBeenCalledWith({ source: 'map', kind: 'point', target: 'mute', response: 'mirror' });
    cleanup();
    const { container: ro } = render(<LinkMatrix graph={GRAPH} onChange={onChange} readOnly className="extra" />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(ro.querySelector('.vzf-linkmatrix')?.className).toContain('extra');
  });

  it('an edited edge wears its own fact (even when its response is none) and offers "back to the rule", which hands the host a null response', () => {
    const onChange = vi.fn();
    const { container } = render(<LinkMatrix graph={GRAPH} onChange={onChange} />);
    expect(container.querySelector('[data-edge="bar:point→mute"]')?.getAttribute('data-fact')).toBe('edited');
    expect(cellOf(GRAPH.edges[3])).toEqual({ text: 'none', fact: 'edited' });
    const select = screen.getByRole('combobox', { name: 'bar point → mute' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain('rule');
    fireEvent.change(select, { target: { value: 'rule' } });
    expect(onChange).toHaveBeenCalledWith({ source: 'bar', kind: 'point', target: 'mute', response: null });
  });
});
