/**
 * Pure unit tests for the step-navigation rule (stepNav.ts) — no server, no
 * DOM. Fixtures build small commit trees by hand (id/parent only) in APPEND
 * order, exactly like `CauseSelectionSession.records`. See server.test.ts for
 * the same rule exercised over a REAL 2-branch history built through the
 * `createAnalyst` API.
 */
import { describe, it, expect } from 'vitest';
import { pathToRoot, stepBackTarget, stepForwardTarget, type StepRec } from './stepNav.js';

describe('pathToRoot', () => {
  it('is empty for a null id', () => {
    expect(pathToRoot([], null)).toEqual([]);
  });

  it('walks parent pointers back to the root, root-first', () => {
    const records: StepRec[] = [
      { id: 'r1', parent: null },
      { id: 'a1', parent: 'r1' },
      { id: 'a2', parent: 'a1' },
    ];
    expect(pathToRoot(records, 'a2').map((r) => r.id)).toEqual(['r1', 'a1', 'a2']);
  });

  it('stops at an unknown id rather than throwing', () => {
    expect(pathToRoot([{ id: 'a1', parent: 'r1' }], 'a1').map((r) => r.id)).toEqual(['a1']);
  });
});

describe('stepBackTarget', () => {
  const records: StepRec[] = [
    { id: 'r1', parent: null },
    { id: 'a1', parent: 'r1' },
  ];

  it('is null with no cursor', () => {
    expect(stepBackTarget(records, null)).toBe(null);
  });

  it('is null at the root (no parent) — the caller disables the button', () => {
    expect(stepBackTarget(records, 'r1')).toBe(null);
  });

  it('returns the cursor’s parent otherwise', () => {
    expect(stepBackTarget(records, 'a1')).toBe('r1');
  });
});

describe('stepForwardTarget — the fork rule', () => {
  it('is null with no cursor', () => {
    expect(stepForwardTarget([], null, null)).toBe(null);
  });

  it('is null at a leaf (no children) — the caller disables the button', () => {
    const records: StepRec[] = [{ id: 'r1', parent: null }];
    expect(stepForwardTarget(records, 'r1', 'r1')).toBe(null);
  });

  it('a single child is unambiguous regardless of the active branch', () => {
    const records: StepRec[] = [
      { id: 'r1', parent: null },
      { id: 'a1', parent: 'r1' },
    ];
    expect(stepForwardTarget(records, 'r1', 'a1')).toBe('a1');
  });

  /**
   * The at-fork rule, in full: r1 -> a1 (a common prefix), then a1 forks
   * THREE ways as the demo's "seek back, act again" gesture would produce:
   *   a1 -> a2   (created 1st: the original continuation)
   *   a1 -> b1   (created 2nd: a sibling branch)
   *   a1 -> c1   (created 3rd, and made ACTIVE: head lands on c1)
   * then a1's own parent (r1) ALSO forks a fourth lineage (d1), which is what
   * finally pushes a1 itself off the active path (root..d1).
   */
  const r1: StepRec = { id: 'r1', parent: null };
  const a1: StepRec = { id: 'a1', parent: 'r1' };
  const a2: StepRec = { id: 'a2', parent: 'a1' }; // earliest child of a1
  const b1: StepRec = { id: 'b1', parent: 'a1' };
  const c1: StepRec = { id: 'c1', parent: 'a1' }; // active while head=c1
  const d1: StepRec = { id: 'd1', parent: 'r1' }; // a sibling of a1 — active when head=d1
  const records: StepRec[] = [r1, a1, a2, b1, c1, d1];

  it('at a fork ON the active path, prefers the child on the active branch — NOT the earliest-created one', () => {
    // head=c1: active path is r1 -> a1 -> c1. a1 is on it, so forward from a1
    // must land on c1, even though a2 (chronologically first) also qualifies.
    expect(stepForwardTarget(records, 'a1', 'c1')).toBe('c1');
  });

  it('at the ROOT, prefers the active child over the earlier-created sibling', () => {
    // r1's children are a1 (created 2nd overall, i.e. first child of r1) and
    // d1 (created last). With head=d1, active path is r1 -> d1: forward must
    // follow d1, not fall back to "earliest child" (a1).
    expect(stepForwardTarget(records, 'r1', 'd1')).toBe('d1');
  });

  it('at a fork OFF the active path, follows the branch tip the node belongs to (earliest-created child)', () => {
    // head=d1 → a1 is off the active path (root..d1 excludes it), yet a1
    // still has three children of its own (a2, b1, c1) from before the
    // r1-level fork happened. None of them is "active" (head=d1 isn't a
    // descendant of a1), so the rule falls back to a1's own original
    // continuation — the earliest-created child, a2.
    expect(stepForwardTarget(records, 'a1', 'd1')).toBe('a2');
  });

  it('a leaf on an inactive lane is still disabled (no children bookmarks lane membership)', () => {
    expect(stepForwardTarget(records, 'b1', 'd1')).toBe(null);
    expect(stepForwardTarget(records, 'c1', 'd1')).toBe(null);
  });
});
