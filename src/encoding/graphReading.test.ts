/**
 * The reading rule: which picture of a graph a reader should be given, and why.
 *
 * These pin the RULING, not a preference — every case names the rule that fired
 * and the study its reason cites, because a ruling nobody can check is an
 * opinion with a citation stapled to it. The CDC graph (15 diseases, all 105
 * pairs co-occurring) is here by name: it is the demo's own graph, and the
 * caption there quotes what this file decides.
 */
import { describe, expect, it } from 'vitest';
import {
  BIG_AT,
  CHART_KIND_FOR_READING,
  DEFAULT_GRAPH_READING,
  DENSE_AT,
  GRAPH_READING_RULES,
  densityOf,
  graphReadingFor,
  proposeCharts,
  type GraphFact,
} from './index.js';
import type { FitColumn } from './whatFits.js';

const reading = (fact: GraphFact): [string, string] => {
  const r = graphReadingFor(fact);
  return [r.prefer, r.rule];
};

describe('densityOf — the share of the possible pairs', () => {
  it('takes the stated density over the counts, and derives it when it was not stated', () => {
    expect(densityOf({ density: 0.5, nodes: 100, edges: 1 })).toBe(0.5);
    expect(densityOf({ nodes: 15, edges: 105 })).toBe(1); // the CDC graph: every pair co-occurs
    expect(densityOf({ nodes: 10, edges: 9 })).toBeCloseTo(0.2, 10);
  });

  it('a graph with no pairs to count has NO density — never a zero, which is a real answer', () => {
    expect(densityOf({})).toBeNull();
    expect(densityOf({ nodes: 12 })).toBeNull();
    expect(densityOf({ edges: 3 })).toBeNull();
    expect(densityOf({ nodes: 1, edges: 0 })).toBeNull();
  });
});

describe('graphReadingFor — the first rule that fires, with its reason', () => {
  it('the CDC graph is dense, so the MATRIX is preferred and the reason names Ghoniem et al. 2004', () => {
    const r = graphReadingFor({ nodes: 15, edges: 105 });
    expect([r.prefer, r.rule]).toEqual(['matrix', 'dense']);
    expect(r.reason).toContain('Ghoniem, Fekete and Castagliola (2004)');
    expect(r.reason).toContain('0.2');
  });

  it('the density threshold is a boundary, not a slope: AT 0.2 the matrix, just under it not', () => {
    expect(reading({ density: DENSE_AT })).toEqual(['matrix', 'dense']);
    expect(reading({ density: DENSE_AT - 0.001 })).toEqual(['node-link', 'default']);
  });

  it('the three matrix questions win on a sparse graph too — adjacency, common neighbours, clusters', () => {
    for (const question of ['adjacency', 'common-neighbours', 'clusters'] as const) {
      expect(reading({ density: 0.01, question })).toEqual(['matrix', 'matrix-question']);
    }
    expect(graphReadingFor({ density: 0.01, question: 'clusters' }).reason).toContain('Okoe, Jianu and Kobourov (2018)');
  });

  it('a big STATIC graph reads as a matrix; the same graph with interaction does not fire that rule', () => {
    expect(reading({ nodes: BIG_AT + 1, density: 0.01 })).toEqual(['matrix', 'big-and-static']);
    expect(reading({ nodes: BIG_AT + 1, density: 0.01, interaction: true })).toEqual(['node-link', 'default']);
    expect(reading({ nodes: BIG_AT, density: 0.01 })).toEqual(['node-link', 'default']); // at the threshold, not past it
    expect(graphReadingFor({ nodes: 400, density: 0.01 }).reason).toContain('Okoe, Jianu and Kobourov (2018)');
  });

  it('a path or a topology question keeps the node-link — but only where a reader can explore it', () => {
    expect(reading({ density: 0.01, question: 'path', interaction: true })).toEqual(['node-link', 'sparse-path']);
    expect(reading({ density: 0.01, question: 'topology', interaction: true })).toEqual(['node-link', 'sparse-path']);
    // no interaction: no rule fires, and the default says the same thing for a weaker reason
    expect(reading({ density: 0.01, question: 'path' })).toEqual(['node-link', 'default']);
  });

  it('DENSITY OUTRANKS THE QUESTION — a path through a hairball is still a hairball', () => {
    expect(reading({ nodes: 15, edges: 105, question: 'path', interaction: true })).toEqual(['matrix', 'dense']);
  });

  it('knowing nothing prefers the node-link, and says plainly that it knows nothing', () => {
    expect(graphReadingFor({})).toEqual(DEFAULT_GRAPH_READING);
    expect(DEFAULT_GRAPH_READING.reason).toContain('Ghoniem, Fekete and Castagliola 2004');
  });

  it('every rule is DATA: an id, a picture, a reason with a study in it, and a condition', () => {
    expect(GRAPH_READING_RULES.map((r) => [r.id, r.prefer])).toEqual([
      ['dense', 'matrix'],
      ['matrix-question', 'matrix'],
      ['big-and-static', 'matrix'],
      ['sparse-path', 'node-link'],
    ]);
    for (const rule of GRAPH_READING_RULES) expect(rule.reason).toMatch(/\((?:2004|2018)\)/);
    expect(Object.isFrozen(GRAPH_READING_RULES)).toBe(true);
  });

  it('the two readings name the two chart kinds this library actually draws', () => {
    expect(CHART_KIND_FOR_READING).toEqual({ matrix: 'heatmap', 'node-link': 'network' });
  });
});

// ── the offer reads it: which picture comes first ─────────────────────────────

const COLUMNS: readonly FitColumn[] = [
  { name: 'source', role: 'dimension', scale: 'discrete' },
  { name: 'target', role: 'dimension', scale: 'discrete' },
  { name: 'weight', role: 'measure', scale: 'continuous' },
];

/** Both pictures asked for by name — `network` is never proposed by default (it needs two tables and a layout act). */
const BOTH = [
  { chartKind: 'heatmap', channels: ['x', 'y'] },
  { chartKind: 'network', channels: ['x', 'y', 'key'] },
];

describe('proposeCharts — the reading orders the two pictures and nothing else', () => {
  it('with no graph fact the offer is byte-identical to before: no ruling, no reordering', () => {
    const offered = proposeCharts({ columns: COLUMNS, kinds: BOTH });
    expect(offered.reading).toBeUndefined();
    expect('reading' in offered).toBe(false);
  });

  it('a dense graph puts the MATRIX first, and the ruling travels with the offer', () => {
    const offered = proposeCharts({ columns: COLUMNS, kinds: BOTH, graph: { nodes: 15, edges: 105 } });
    expect(offered.reading?.rule).toBe('dense');
    expect(offered.proposals[0]!.chartKind).toBe('heatmap');
    // the same question, asked of a sparse explorable graph, puts the node-link back
    const sparse = proposeCharts({ columns: COLUMNS, kinds: BOTH, graph: { nodes: 15, edges: 20, question: 'path', interaction: true } });
    expect(sparse.reading?.rule).toBe('sparse-path');
    expect(sparse.proposals[0]!.chartKind).toBe('network');
  });

  it('the ruling stands even when only ONE picture was proposable — a reader is told what reads better either way', () => {
    const offered = proposeCharts({ columns: COLUMNS, kinds: [BOTH[0]!], graph: { nodes: 15, edges: 105 } });
    expect(offered.reading?.prefer).toBe('matrix');
    expect(offered.proposals.every((p) => p.chartKind === 'heatmap')).toBe(true);
  });

  it('every other kind keeps its COST order — a reading has no opinion about a bar chart', () => {
    const kinds = [{ chartKind: 'bar', channels: ['x', 'y'] }, ...BOTH];
    const plain = proposeCharts({ columns: COLUMNS, kinds });
    const ruled = proposeCharts({ columns: COLUMNS, kinds, graph: { nodes: 15, edges: 105 } });
    const bars = (r: typeof plain): unknown[] => r.proposals.map((p, at) => [at, p.chartKind, p.cost]).filter(([, kind]) => kind === 'bar');
    expect(bars(ruled)).toEqual(bars(plain)); // the bars did not move
    expect(ruled.proposals.map((p) => p.cost)).toEqual([...ruled.proposals.map((p) => p.cost)].sort((a, b) => a - b));
  });
});
