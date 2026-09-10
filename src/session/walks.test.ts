/**
 * THE THREE WALKS — one adjacency map, three answers, and one door with a
 * ceiling on it.
 *
 * The laws under test: every walk is UNDIRECTED (R1); the three derivations
 * share ONE value shape and differ only in what `hops` MEANS (R2); a question
 * is either askable or refused in a sentence (R3); and no walk records more ids
 * than a commit can carry (R4).
 *
 * The one-hop ego walk is PINNED here against a copy of the implementation it
 * had before the other two existed: its output is the bytes every caller
 * already landed, and a record that moved would rewrite history.
 */
import { describe, it, expect } from 'vitest';
import { NEIGHBOURHOOD_ID_CEILING, componentIds, egoIds, pathIds, walkNeighbourhood, walkRefusal } from './neighbourhood.js';
import type { Row } from '../data/index.js';

const ENDS = ['from', 'to'] as const;

/** A triangle (a–b–c–a), a tail (c–d) and an island (e–f). `z` is a node no edge names. */
const GRAPH: readonly Row[] = [
  { from: 'a', to: 'b' },
  { from: 'b', to: 'c' },
  { from: 'c', to: 'a' },
  { from: 'c', to: 'd' },
  { from: 'e', to: 'f' },
];

/**
 * THE ONE-HOP WALK, AS IT WAS — a byte-for-byte copy of `egoIds` before the
 * adjacency map existed. Nothing imports it; it is here to be disagreed with.
 */
function egoIdsAsItWas(rows: readonly Row[], fields: readonly [string, string], seed: unknown): unknown[] {
  const ids: unknown[] = [seed];
  const seen = new Set<unknown>([seed]);
  for (const row of rows) {
    const ends = [row[fields[0]], row[fields[1]]];
    if (ends[0] !== seed && ends[1] !== seed) continue;
    for (const end of ends) {
      if (end === null || end === undefined) continue;
      if (seen.has(end)) continue;
      seen.add(end);
      ids.push(end);
    }
  }
  return ids;
}

describe('the ego walk', () => {
  it('one hop answers exactly what it answered before the other two walks existed — every node of the hand graph', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'z']) {
      expect(egoIds(GRAPH, ENDS, seed)).toEqual(egoIdsAsItWas(GRAPH, ENDS, seed));
    }
    // and the answer itself: the seed FIRST, then the others by distance, then row order
    expect(egoIds(GRAPH, ENDS, 'c')).toEqual(['c', 'b', 'a', 'd']);
    expect(egoIds(GRAPH, ENDS, 'z')).toEqual(['z']);
  });

  it('two hops reaches what one hop could not — the tail past the triangle', () => {
    expect(egoIds(GRAPH, ENDS, 'a', 2)).toEqual(['a', 'b', 'c', 'd']);
    expect(egoIds(GRAPH, ENDS, 'd', 2)).toEqual(['d', 'c', 'b', 'a']);
    // an island is an island at any depth this build offers
    expect(egoIds(GRAPH, ENDS, 'e', 2)).toEqual(['e', 'f']);
  });

  it('an edge missing an end is not a tie to null, at either depth', () => {
    const ragged: readonly Row[] = [{ from: 'a', to: null }, { from: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: null }];
    expect(egoIds(ragged, ENDS, 'a')).toEqual(['a', 'b']);
    expect(egoIds(ragged, ENDS, 'a', 2)).toEqual(['a', 'b']);
  });
});

describe('the path walk', () => {
  it('the nodes IN ORDER, and hops is the length in EDGES', () => {
    expect(pathIds(GRAPH, ENDS, 'a', 'd')).toEqual({ ids: ['a', 'c', 'd'], hops: 2 });
    expect(pathIds(GRAPH, ENDS, 'd', 'b')).toEqual({ ids: ['d', 'c', 'b'], hops: 2 });
    expect(pathIds(GRAPH, ENDS, 'a', 'b')).toEqual({ ids: ['a', 'b'], hops: 1 });
  });

  it('UNDIRECTED: the path runs the same either way round (R1)', () => {
    const there = pathIds(GRAPH, ENDS, 'a', 'd');
    const back = pathIds(GRAPH, ENDS, 'd', 'a');
    expect([...back.ids].reverse()).toEqual(there.ids);
    expect(back.hops).toBe(there.hops);
  });

  it('NO PATH is an answer: the two nodes the question named, and null where a length would go', () => {
    expect(pathIds(GRAPH, ENDS, 'a', 'f')).toEqual({ ids: ['a', 'f'], hops: null });
    expect(pathIds(GRAPH, ENDS, 'a', 'z')).toEqual({ ids: ['a', 'z'], hops: null });
  });

  it('the trivial path — `to` is the seed: one node, no edge', () => {
    expect(pathIds(GRAPH, ENDS, 'a', 'a')).toEqual({ ids: ['a'], hops: 0 });
  });

  it('TIES ARE BROKEN BY ROW ORDER, so the same graph always answers the same path', () => {
    // s reaches t through x or through y, both one hop each way: the FIRST row that reached it wins
    const viaX: readonly Row[] = [
      { from: 's', to: 'x' },
      { from: 's', to: 'y' },
      { from: 'x', to: 't' },
      { from: 'y', to: 't' },
    ];
    const viaY: readonly Row[] = [viaX[1]!, viaX[0]!, viaX[3]!, viaX[2]!];
    expect(pathIds(viaX, ENDS, 's', 't')).toEqual({ ids: ['s', 'x', 't'], hops: 2 });
    expect(pathIds(viaY, ENDS, 's', 't')).toEqual({ ids: ['s', 'y', 't'], hops: 2 });
    // and asking twice over the same rows answers twice the same — determinism is the whole point
    expect(pathIds(viaX, ENDS, 's', 't')).toEqual(pathIds(viaX, ENDS, 's', 't'));
  });
});

describe('the component walk', () => {
  it('everything the seed can reach, and hops is the FARTHEST node distance', () => {
    expect(componentIds(GRAPH, ENDS, 'a')).toEqual({ ids: ['a', 'b', 'c', 'd'], hops: 2 });
    expect(componentIds(GRAPH, ENDS, 'd')).toEqual({ ids: ['d', 'c', 'b', 'a'], hops: 2 });
  });

  it('an island of one is itself, no hops at all', () => {
    expect(componentIds(GRAPH, ENDS, 'z')).toEqual({ ids: ['z'], hops: 0 });
    expect(componentIds(GRAPH, ENDS, 'e')).toEqual({ ids: ['e', 'f'], hops: 1 });
    // a self-loop names no second node: the component of a node tied only to itself is itself
    expect(componentIds([{ from: 'a', to: 'a' }], ENDS, 'a')).toEqual({ ids: ['a'], hops: 0 });
  });
});

describe('the door — one value shape, three walks (R2)', () => {
  const body = (question: Parameters<typeof walkNeighbourhood>[2]) => {
    const out = walkNeighbourhood(GRAPH, ENDS, question);
    expect(out.ok).toBe(true);
    return out.ok ? out.body : null;
  };

  it('the default walk is one hop of ego, in the key order the record has always had', () => {
    expect(JSON.stringify(body({ seed: 'a' }))).toBe('{"seed":"a","derivation":"ego","hops":1,"ids":["a","b","c"]}');
    // an explicit one-hop ego asks the same question and lands the same bytes
    expect(JSON.stringify(body({ seed: 'a', derivation: 'ego', hops: 1 }))).toBe(JSON.stringify(body({ seed: 'a' })));
  });

  it("an ego body records the hops it ASKED — a one-hop walk on a wider graph still asked one hop", () => {
    expect(body({ seed: 'a', derivation: 'ego', hops: 2 })).toEqual({ seed: 'a', derivation: 'ego', hops: 2, ids: ['a', 'b', 'c', 'd'] });
  });

  it('only a path body carries `to`, and its hops is the length it FOUND', () => {
    expect(body({ seed: 'a', derivation: 'path', to: 'd' })).toEqual({ seed: 'a', derivation: 'path', hops: 2, to: 'd', ids: ['a', 'c', 'd'] });
    expect(body({ seed: 'a', derivation: 'path', to: 'f' })).toEqual({ seed: 'a', derivation: 'path', hops: null, to: 'f', ids: ['a', 'f'] });
    expect(body({ seed: 'a', derivation: 'path', to: 'a' })).toEqual({ seed: 'a', derivation: 'path', hops: 0, to: 'a', ids: ['a'] });
    // the other two never do: a walk with no far end has none to record
    expect('to' in body({ seed: 'a' })!).toBe(false);
    expect('to' in body({ seed: 'a', derivation: 'component' })!).toBe(false);
  });

  it('a component body records the distance it reached', () => {
    expect(body({ seed: 'a', derivation: 'component' })).toEqual({ seed: 'a', derivation: 'component', hops: 2, ids: ['a', 'b', 'c', 'd'] });
  });
});

describe('every unaskable question is a sentence, and the door and the session read the SAME one (R3)', () => {
  const refused = (question: Parameters<typeof walkNeighbourhood>[2]): string => {
    const out = walkNeighbourhood(GRAPH, ENDS, question);
    expect(out.ok).toBe(false);
    // the door's refusal IS `walkRefusal`'s — one owner of the law, read twice
    expect(out.ok ? null : out.rejected).toBe(walkRefusal(question));
    return out.ok ? '' : out.rejected;
  };

  it('hops is asked of an ego walk and of nothing else', () => {
    expect(refused({ seed: 'a', derivation: 'path', to: 'd', hops: 2 })).toBe(
      'select.walk.hops is only asked of an "ego" walk — a "path" walk answers its own distance, so it cannot also be told one',
    );
    expect(refused({ seed: 'a', derivation: 'component', hops: 1 })).toContain('a "component" walk answers its own distance');
  });

  it('two hops is the policy ceiling, and the sentence says it is a policy', () => {
    expect(refused({ seed: 'a', derivation: 'ego', hops: 3 as 1 | 2 })).toBe(
      'select.walk.hops must be 1 or 2 — past two hops an ego set is most of any real graph (a policy of this build, not a limit of the walk); for everything the seed can reach, ask for the "component"',
    );
  });

  it('a path names the node it runs to — and a value that names no node is missing, not a node', () => {
    const missing = 'select.walk.to is missing — a "path" walk runs from the seed TO a node, and the node it runs to is named, never guessed';
    expect(refused({ seed: 'a', derivation: 'path' })).toBe(missing);
    expect(refused({ seed: 'a', derivation: 'path', to: undefined })).toBe(missing);
    expect(refused({ seed: 'a', derivation: 'path', to: null })).toBe(missing);
  });

  it('`to` belongs to a path and to nothing else', () => {
    expect(refused({ seed: 'a', to: 'd' })).toBe('select.walk.to is only asked of a "path" walk — an "ego" walk has no far end to name');
    expect(refused({ seed: 'a', derivation: 'component', to: 'd' })).toContain('a "component" walk has no far end to name');
  });

  it('a derivation this build does not mint is refused by name, never run as something else', () => {
    expect(refused({ seed: 'a', derivation: 'lasso' as 'ego' })).toBe(
      'select.walk.derivation must be one of "ego", "path", "component" — "lasso" is not a walk this build knows how to run',
    );
  });

  it('an askable question refuses nothing', () => {
    expect(walkRefusal({ seed: 'a' })).toBeNull();
    expect(walkRefusal({ seed: 'a', derivation: 'ego', hops: 2 })).toBeNull();
    expect(walkRefusal({ seed: 'a', derivation: 'path', to: 'd' })).toBeNull();
    expect(walkRefusal({ seed: 'a', derivation: 'component' })).toBeNull();
  });
});

describe('the ceiling on what a commit records (R4)', () => {
  /** A star: one hub, `n` neighbours — the cheapest way to a very wide one-hop walk. */
  const star = (n: number): readonly Row[] => Array.from({ length: n }, (_, i) => ({ from: 'hub', to: `n${i}` }));
  /** A chain of `n` nodes — the cheapest way to a very long path and a very big component. */
  const chain = (n: number): readonly Row[] => Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));

  it('passes at the ceiling and refuses at one past it, naming the count and the remedy', () => {
    const atCeiling = walkNeighbourhood(star(NEIGHBOURHOOD_ID_CEILING - 1), ENDS, { seed: 'hub' });
    expect(atCeiling.ok && atCeiling.body.ids.length).toBe(NEIGHBOURHOOD_ID_CEILING);

    const past = walkNeighbourhood(star(NEIGHBOURHOOD_ID_CEILING), ENDS, { seed: 'hub' });
    expect(past.ok).toBe(false);
    expect(past.ok ? '' : past.rejected).toBe(
      'the 1-hop neighbourhood of "hub" holds 10,001 nodes, past the 10,000 one commit records — filter the edges first, or select by a column instead',
    );
  });

  it('names the walk it refused — the component, and the path', () => {
    const rows = chain(NEIGHBOURHOOD_ID_CEILING + 1);
    const component = walkNeighbourhood(rows, ENDS, { seed: 'n0', derivation: 'component' });
    expect(component.ok ? '' : component.rejected).toBe(
      'the component of "n0" holds 10,001 nodes, past the 10,000 one commit records — filter the edges first, or select by a column instead',
    );
    const path = walkNeighbourhood(rows, ENDS, { seed: 'n0', derivation: 'path', to: `n${NEIGHBOURHOOD_ID_CEILING}` });
    expect(path.ok ? '' : path.rejected).toBe(
      'the path from "n0" to "n10000" holds 10,001 nodes, past the 10,000 one commit records — filter the edges first, or select by a column instead',
    );
    // and the seed is quoted as it arrived: a number is not dressed up as a string
    const numbered = walkNeighbourhood(star(NEIGHBOURHOOD_ID_CEILING).map((r) => ({ ...r, from: 1 })), ENDS, { seed: 1 });
    expect(numbered.ok ? '' : numbered.rejected).toContain('the 1-hop neighbourhood of 1 holds 10,001 nodes');
  });
});

describe('what counts as ONE node — the adjacency map\'s own law', () => {
  it('a self-loop is not a second node: the seed is listed once, at every depth and in every walk', () => {
    const loop: readonly Row[] = [{ from: 'a', to: 'a' }, { from: 'a', to: 'b' }];
    expect(egoIds(loop, ENDS, 'a')).toEqual(['a', 'b']);
    expect(egoIds(loop, ENDS, 'a', 2)).toEqual(['a', 'b']);
    expect(componentIds(loop, ENDS, 'a')).toEqual({ ids: ['a', 'b'], hops: 1 });
    expect(pathIds(loop, ENDS, 'a', 'b')).toEqual({ ids: ['a', 'b'], hops: 1 });
  });

  it('a tie named twice is the same tie — parallel edges join two nodes once', () => {
    const parallel: readonly Row[] = [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }, { from: 'b', to: 'a' }];
    expect(egoIds(parallel, ENDS, 'a')).toEqual(['a', 'b']);
    expect(componentIds(parallel, ENDS, 'a')).toEqual({ ids: ['a', 'b'], hops: 1 });
  });

  it('`0`, `\'\'` and `false` are NODES — only `null` and `undefined` name none', () => {
    const falsy: readonly Row[] = [{ from: 0, to: '' }, { from: '', to: false }];
    expect(egoIds(falsy, ENDS, 0)).toEqual([0, '']);
    expect(componentIds(falsy, ENDS, 0)).toEqual({ ids: [0, '', false], hops: 2 });
    expect(pathIds(falsy, ENDS, 0, false)).toEqual({ ids: [0, '', false], hops: 2 });
  });

  it('a number is not a string: `1` and `"1"` are two nodes, in the walk and in the ids it records', () => {
    const numbered: readonly Row[] = [{ from: 1, to: 2 }];
    expect(egoIds(numbered, ENDS, '1')).toEqual(['1']); // a node these rows never name
    expect(egoIds(numbered, ENDS, 1)).toEqual([1, 2]);
    expect(pathIds(numbered, ENDS, 1, '2')).toEqual({ ids: [1, '2'], hops: null });
  });

  it('NaN is one node like any other — the map holds it, so the path finds it and RETURNS', () => {
    // the map compares by SameValueZero, so a walk that compared ends with `===` would hold a node
    // it could never path to — and would read the parents back for ever looking for its own seed
    const nan: readonly Row[] = [{ from: Number.NaN, to: 'b' }, { from: 'b', to: 'c' }];
    expect(egoIds(nan, ENDS, Number.NaN)).toEqual([Number.NaN, 'b']);
    expect(pathIds(nan, ENDS, Number.NaN, 'c')).toEqual({ ids: [Number.NaN, 'b', 'c'], hops: 2 });
    expect(pathIds(nan, ENDS, 'c', Number.NaN)).toEqual({ ids: ['c', 'b', Number.NaN], hops: 2 });
    expect(pathIds(nan, ENDS, Number.NaN, Number.NaN)).toEqual({ ids: [Number.NaN], hops: 0 });
  });
});
