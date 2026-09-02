// @vitest-environment jsdom
/**
 * Layer 4 `onClear`, where responses run: a cleared source still reaches a
 * consumer whose edge says `leave` (the last emission stays in force) or
 * `excludeAll` (nothing passes); `showAll` and no graph = the clause is gone.
 */
import { describe, it, expect } from 'vitest';
import { keepPredicate, brightPredicate, navigateDomain, selectionForView } from './selection.js';
import type { ClearedSelectionView, LinkGraphView, SelectionView } from '../adapter/types.js';

const ROWS = [
  { id: 'r1', price: 40, category: 'Casual' },
  { id: 'r2', price: 160, category: 'Formal' },
  { id: 'r3', price: 220, category: 'Party' },
];
const cleared: ClearedSelectionView[] = [{ viewId: 'bar', field: 'category', kind: 'point', value: 'Formal', clearedBy: 'c9' }];
const graph = (onClear?: 'leave' | 'showAll' | 'excludeAll', response: 'filter' | 'highlight' | 'navigate' | 'none' = 'filter', mapping?: readonly { from: string; to: string }[]): LinkGraphView => ({
  default: 'crossfilter',
  views: [
    { viewId: 'bar', voice: ['point'] },
    { viewId: 'scatter', voice: ['interval'] },
  ],
  edges: [{ id: 'bar:point→scatter', source: 'bar', kind: 'point', target: 'scatter', response, origin: 'declared', ...(onClear !== undefined ? { onClear } : {}), ...(mapping !== undefined ? { mapping } : {}) }],
});
const kept = (sel: ReturnType<typeof selectionForView>) => ROWS.filter(keepPredicate(sel)).map((r) => r.id);

describe('selectionForView + cleared', () => {
  it('leave keeps the last emission in force; excludeAll keeps nothing; showAll and the default drop it', () => {
    expect(kept(selectionForView([], 'scatter', 'intersect', graph('leave'), cleared))).toEqual(['r2']);
    expect(kept(selectionForView([], 'scatter', 'intersect', graph('excludeAll'), cleared))).toEqual([]);
    expect(kept(selectionForView([], 'scatter', 'intersect', graph('showAll'), cleared))).toEqual(['r1', 'r2', 'r3']);
    expect(kept(selectionForView([], 'scatter', 'intersect', graph(), cleared))).toEqual(['r1', 'r2', 'r3']);
  });
  it('a policy needs a graph, an edge that answers, a consumer, and a source that is not selecting again', () => {
    expect(kept(selectionForView([], 'scatter', 'intersect', undefined, cleared))).toEqual(['r1', 'r2', 'r3']); // no graph
    expect(kept(selectionForView([], null, 'intersect', graph('leave'), cleared))).toEqual(['r1', 'r2', 'r3']); // whole-dashboard fold
    expect(kept(selectionForView([], 'bar', 'intersect', graph('leave'), cleared))).toEqual(['r1', 'r2', 'r3']); // the source itself
    expect(kept(selectionForView([], 'scatter', 'intersect', graph('leave', 'none'), cleared))).toEqual(['r1', 'r2', 'r3']); // a none edge
    const live: SelectionView[] = [{ viewId: 'bar', field: 'category', kind: 'point', value: 'Party' }];
    expect(kept(selectionForView(live, 'scatter', 'intersect', graph('leave'), cleared))).toEqual(['r3']); // live wins over cleared
    const elsewhere: LinkGraphView = { ...graph('leave'), edges: [] };
    expect(kept(selectionForView([], 'scatter', 'intersect', elsewhere, cleared))).toEqual(['r1', 'r2', 'r3']); // no edge from that source
  });
  it('the edge\'s response and mapping apply to the kept emission, and a cell pair is renamed on both sides', () => {
    const dim = selectionForView([], 'scatter', 'intersect', graph('leave', 'highlight'), cleared);
    expect(ROWS.filter(keepPredicate(dim)).map((r) => r.id)).toEqual(['r1', 'r2', 'r3']); // highlight never drops
    expect(ROWS.filter(brightPredicate(dim)).map((r) => r.id)).toEqual(['r2']);
    const renamed = selectionForView([], 'scatter', 'intersect', graph('leave', 'filter', [{ from: 'category', to: 'cat' }]), cleared);
    expect(renamed.clauses.get('bar')?.field).toBe('cat');
    const clearedCell: ClearedSelectionView[] = [{ viewId: 'bar', field: 'category × price', kind: 'cell', value: ['Formal', [100, 200]], fields: ['category', 'price'], clearedBy: 'c9' }];
    const cellGraph: LinkGraphView = { ...graph('leave', 'filter', [{ from: 'price', to: 'cost' }]), edges: [{ ...graph('leave')!.edges[0]!, kind: 'cell', mapping: [{ from: 'price', to: 'cost' }] }] };
    const cell = selectionForView([], 'scatter', 'intersect', cellGraph, clearedCell);
    expect(cell.clauses.get('bar')?.fields).toEqual(['category', 'cost']);
    const nav = selectionForView([], 'scatter', 'intersect', { ...graph('leave', 'navigate'), edges: [{ ...graph('leave', 'navigate').edges[0]!, kind: 'interval' }] }, [{ viewId: 'bar', field: 'price', kind: 'interval', value: [50, 200], clearedBy: 'c9' }]);
    expect(navigateDomain(nav)).toEqual({ field: 'price', range: [50, 200] });
  });
});
