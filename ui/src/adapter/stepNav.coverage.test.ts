// @vitest-environment node
//
// Fills the gaps stepNav.test.ts leaves: pathToRoot's dangling-parent break,
// stepForwardTarget's null-cursor guard and single-child fast path, and the
// layoutBranches sort-comparator + lane-fallback edges (a node the leaf-walk
// never reaches).
import { describe, it, expect } from 'vitest';
import { pathToRoot, stepForwardTarget, layoutBranches } from './stepNav.js';

describe('pathToRoot — dangling parent reference', () => {
  it('stops honestly at a parent id that is not in the record set (no throw, no phantom entry)', () => {
    const dangling = [{ id: 'a', parent: 'ghost' }];
    expect(pathToRoot(dangling, 'a').map((r) => r.id)).toEqual(['a']);
  });
});

describe('stepForwardTarget — edges', () => {
  const tree = [
    { id: 'r', parent: null },
    { id: 'a', parent: 'r' }, // r's ONLY child
    { id: 'b', parent: 'a' },
  ];

  it('returns null when there is no cursor', () => {
    expect(stepForwardTarget(tree, null, 'a')).toBe(null);
  });

  it('short-circuits to the sole child without consulting the active path at all', () => {
    // head 'r' isn't even on a's lineage — proving the single-child return
    // never falls into the active-path branch below it
    expect(stepForwardTarget(tree, 'r', 'r')).toBe('a');
  });
});

describe('layoutBranches — sort-comparator + lane-fallback edges', () => {
  it('a node unreachable from every leaf (a disconnected 2-cycle) falls back to lane 0', () => {
    const tree = [
      { id: 'r', parent: null },
      { id: 'a', parent: 'r' }, // the active leaf
      // x/y are each other's parent — childCount makes BOTH look non-leaf, so
      // neither is ever walked by the leaf-lane loop and neither gets a lane
      { id: 'x', parent: 'y' },
      { id: 'y', parent: 'x' },
    ];
    const { nodes, maxLane } = layoutBranches(tree, 'a');
    const laneOf = (id: string) => nodes.find((n) => n.node.id === id)!.lane;
    expect(laneOf('x')).toBe(0);
    expect(laneOf('y')).toBe(0);
    expect(maxLane).toBe(0); // no divergent lineage ever claimed lane 1
  });

  it('two non-active leaves tie in the sort and keep their append order (indexOf fallback)', () => {
    const tree = [
      { id: 'r', parent: null },
      { id: 'p', parent: 'r' },
      { id: 'first', parent: 'p' },
      { id: 'second', parent: 'p' },
    ];
    // head null: NEITHER leaf is active, so every comparison the sort makes
    // is a genuine tie, forcing the `|| indexOf` fallback to decide the order
    const { nodes } = layoutBranches(tree, null);
    const laneOf = (id: string) => nodes.find((n) => n.node.id === id)!.lane;
    expect(laneOf('first')).toBe(0); // earlier in append order keeps the lower lane
    expect(laneOf('second')).toBe(1);
  });

  it('whichever leaf is active always sorts to lane 0, regardless of which side of the comparator it lands on', () => {
    // three leaves off one fork point; running layoutBranches with each in
    // turn as the active head drives the comparator with the active leaf in
    // every possible pairing/position the underlying sort can produce
    const tree = [
      { id: 'r', parent: null },
      { id: 'p', parent: 'r' },
      { id: 'alpha', parent: 'p' },
      { id: 'beta', parent: 'p' },
      { id: 'gamma', parent: 'p' },
    ];
    for (const activeId of ['alpha', 'beta', 'gamma']) {
      const { nodes } = layoutBranches(tree, activeId);
      const laneOf = (id: string) => nodes.find((n) => n.node.id === id)!.lane;
      expect(laneOf(activeId)).toBe(0);
    }
  });
});
