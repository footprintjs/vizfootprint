// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { pathToRoot, activePath, stepBackTarget, stepForwardTarget, layoutBranches } from './stepNav.js';

// a small fork:  r → a → b (active head b);  a → c (a sibling leaf)
const forked = [
  { id: 'r', parent: null },
  { id: 'a', parent: 'r' },
  { id: 'b', parent: 'a' },
  { id: 'c', parent: 'a' },
];

describe('stepNav pure tree logic', () => {
  it('pathToRoot returns the root→id chain, cycle-guarded', () => {
    expect(pathToRoot(forked, 'b').map((r) => r.id)).toEqual(['r', 'a', 'b']);
    expect(pathToRoot(forked, null)).toEqual([]);
    const cyclic = [{ id: 'x', parent: 'y' }, { id: 'y', parent: 'x' }];
    expect(pathToRoot(cyclic, 'x').length).toBeLessThanOrEqual(2); // does not hang
  });

  it('stepBack is the parent; null at the root / no cursor', () => {
    expect(stepBackTarget(forked, 'b')).toBe('a');
    expect(stepBackTarget(forked, 'r')).toBe(null);
    expect(stepBackTarget(forked, null)).toBe(null);
  });

  it('stepForward prefers the active-path child, else the earliest sibling; null at a leaf', () => {
    // cursor at a, head at b → forward follows the ACTIVE child b (not c)
    expect(stepForwardTarget(forked, 'a', 'b')).toBe('b');
    // with head at c, c is now the active child of a
    expect(stepForwardTarget(forked, 'a', 'c')).toBe('c');
    // cursor at the leaf b → nothing forward
    expect(stepForwardTarget(forked, 'b', 'b')).toBe(null);
    // OFF the active path (cursor x, head b): neither child is active → earliest (y)
    const offPath = [
      { id: 'r', parent: null },
      { id: 'a', parent: 'r' },
      { id: 'b', parent: 'a' }, // active head
      { id: 'x', parent: 'r' },
      { id: 'y', parent: 'x' }, // earliest child of x
      { id: 'z', parent: 'x' },
    ];
    expect(stepForwardTarget(offPath, 'x', 'b')).toBe('y');
  });

  it('activePath is the id set on the head lineage', () => {
    expect(activePath(forked, 'b')).toEqual(new Set(['r', 'a', 'b']));
    expect(activePath(forked, 'c')).toEqual(new Set(['r', 'a', 'c']));
  });

  it('layoutBranches puts the active lineage on lane 0 and forks onto new lanes', () => {
    const { nodes, edges, maxDepth, maxLane } = layoutBranches(forked, 'b');
    const laneOf = (id: string) => nodes.find((n) => n.node.id === id)!.lane;
    const depthOf = (id: string) => nodes.find((n) => n.node.id === id)!.depth;
    expect(laneOf('r')).toBe(0);
    expect(laneOf('a')).toBe(0);
    expect(laneOf('b')).toBe(0); // active tip stays top
    expect(laneOf('c')).toBe(1); // the sibling leaf drops to its own lane
    expect(depthOf('b')).toBe(2);
    expect(maxDepth).toBe(2);
    expect(maxLane).toBe(1);
    expect(edges).toContainEqual({ from: 'a', to: 'c' });
  });
});
