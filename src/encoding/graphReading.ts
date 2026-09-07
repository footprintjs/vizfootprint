/**
 * MATRIX OR NODE-LINK — THE READING RULE, AS DATA.
 *
 * A graph has two honest pictures and they are not interchangeable: the
 * node-link (circles and lines) and the MATRIX (source by target, shaded —
 * which is the heatmap this library already draws). Which one a reader should
 * be given is not a matter of taste, and it is not a property of the chart
 * either. It is a property of THE GRAPH and THE QUESTION, and it has been
 * measured:
 *
 *   - Ghoniem, Fekete and Castagliola (2004) put both pictures in front of
 *     readers on seven tasks. The matrix beat the node-link on every one of
 *     them except PATH-FINDING, and its advantage grew with size and density;
 *     the node-link's advantage held on small, sparse graphs.
 *   - Okoe, Jianu and Kobourov (2018) ran the comparison again at scale, with
 *     interaction allowed. The node-link recovered on topology and path tasks
 *     WHEN a reader could hover and explore; the matrix stayed ahead on
 *     adjacency, on common neighbours, and on counting clusters.
 *
 * The law this file follows is the packet's own: A RULE THAT DECIDES SOMETHING
 * IS DATA. {@link GRAPH_READING_RULES} is a frozen, ordered array — each rule
 * carrying the condition it fires on and the REASON it fires for, in words a
 * reader can weigh — and {@link graphReadingFor} is nothing but "the first rule
 * that fires". Nobody has to read this module's code to know why a dashboard
 * offered a matrix: the answer is a value, with its citation attached, and it
 * travels wherever the proposal does.
 *
 * It never draws and never refuses. A caller that has been told to prefer the
 * matrix may still draw the node-link — and the demo does draw both — but the
 * ruling and its reason are then on the record beside the picture.
 *
 * First customers: `proposeCharts` (which orders `heatmap` against `network`
 * with it) and the CDC demo's network caption, which quotes the reason.
 */

// ── the facts a ruling is made on ──────────────────────────────────────────────

/**
 * What a reader is trying to find out. The two studies split exactly here: the
 * first three are the matrix's tasks, `path` is the node-link's, and `topology`
 * (the shape of the whole thing) is the node-link's ONLY when a reader can
 * interact with it.
 */
export type GraphQuestion = 'adjacency' | 'common-neighbours' | 'clusters' | 'path' | 'topology';

/** Which picture a rule prefers. `'matrix'` is the heatmap of source by target; `'node-link'` is the network. */
export type GraphReadingKind = 'matrix' | 'node-link';

/** The chart kind each reading is DRAWN as here — the one place the reading's name meets this library's own. */
export const CHART_KIND_FOR_READING: Readonly<Record<GraphReadingKind, string>> = Object.freeze({
  matrix: 'heatmap',
  'node-link': 'network',
});

/**
 * What is known about the graph a reading is for. Every field optional: a
 * caller states what it measured and nothing else, and a rule that needs a
 * fact nobody stated does not fire.
 */
export interface GraphFact {
  /** How many nodes the graph has. */
  readonly nodes?: number;
  /** How many edges (undirected, counted once). */
  readonly edges?: number;
  /**
   * Edges as a share of the possible pairs, 0…1. Stated when a caller has it;
   * otherwise DERIVED from `nodes` and `edges` — see {@link densityOf}.
   */
  readonly density?: number;
  /** What the reader is asking. Unstated = no task rule fires. */
  readonly question?: GraphQuestion;
  /** Can the reader hover, select and explore? Absent reads as NO — a picture in a report is not interactive. */
  readonly interaction?: boolean;
}

/** The ruling: which picture, why, and which rule said so. */
export interface GraphReading {
  readonly prefer: GraphReadingKind;
  /** The reason, in words, with the study it comes from. INERT — read by people, never parsed. */
  readonly reason: string;
  /** The rule that fired, by id — what a test pins and a UI groups by. */
  readonly rule: string;
}

/** One rule: the picture it prefers, the reason it prefers it, and the fact it fires on. */
export interface GraphReadingRule {
  readonly id: string;
  readonly prefer: GraphReadingKind;
  readonly reason: string;
  holds(fact: GraphFact): boolean;
}

// ── the facts, derived ─────────────────────────────────────────────────────────

/** The density a rule reads: the stated one, or the share of possible pairs the counts imply. A graph of fewer than two nodes has no pairs and therefore no density. */
export function densityOf(fact: GraphFact): number | null {
  if (fact.density !== undefined) return fact.density;
  const { nodes, edges } = fact;
  if (nodes === undefined || edges === undefined || nodes < 2) return null;
  return (2 * edges) / (nodes * (nodes - 1));
}

/** At or above this share of the possible pairs, a node-link is a hairball (Ghoniem et al. 2004). */
export const DENSE_AT = 0.2;

/** Above about this many nodes, a static node-link stops being readable (Okoe et al. 2018). */
export const BIG_AT = 50;

/** The questions the matrix wins outright, in BOTH studies. */
const MATRIX_QUESTIONS: readonly GraphQuestion[] = ['adjacency', 'common-neighbours', 'clusters'];

/** The questions a node-link wins — but only where the graph is sparse and a reader can explore it. */
const NODE_LINK_QUESTIONS: readonly GraphQuestion[] = ['path', 'topology'];

// ── the rules ──────────────────────────────────────────────────────────────────

/**
 * The reading rules, IN ORDER. The first whose `holds` is true decides, so the
 * order is part of the rule set: density comes first because a dense graph is
 * unreadable as a node-link whatever the question, and the node-link rule comes
 * last because it asks for three things at once (a sparse graph, a path or
 * topology question, and a reader who can explore).
 */
export const GRAPH_READING_RULES: readonly GraphReadingRule[] = Object.freeze([
  {
    id: 'dense',
    prefer: 'matrix',
    reason: `at a density of ${String(DENSE_AT)} or more the lines cross more than they connect: Ghoniem, Fekete and Castagliola (2004) found the matrix beat the node-link on every task but path-finding once a graph stopped being sparse, and the gap widened with density`,
    holds: (fact) => {
      const density = densityOf(fact);
      return density !== null && density >= DENSE_AT;
    },
  },
  {
    id: 'matrix-question',
    prefer: 'matrix',
    reason:
      'the question is one the matrix answers by looking: Ghoniem, Fekete and Castagliola (2004) and Okoe, Jianu and Kobourov (2018) both put adjacency, common neighbours and counting clusters to the matrix — only path-finding went the other way',
    holds: (fact) => fact.question !== undefined && MATRIX_QUESTIONS.includes(fact.question),
  },
  {
    id: 'big-and-static',
    prefer: 'matrix',
    reason: `past about ${String(BIG_AT)} nodes a node-link needs a reader who can hover and explore it; Okoe, Jianu and Kobourov (2018) found the node-link recovered only WITH interaction, and this picture has none`,
    holds: (fact) => fact.nodes !== undefined && fact.nodes > BIG_AT && fact.interaction !== true,
  },
  {
    id: 'sparse-path',
    prefer: 'node-link',
    reason:
      'a path or the shape of the whole graph is what a node-link is for: it was the one task Ghoniem, Fekete and Castagliola (2004) gave it outright, and Okoe, Jianu and Kobourov (2018) found it recovered on topology too where a reader can explore',
    holds: (fact) => fact.question !== undefined && NODE_LINK_QUESTIONS.includes(fact.question) && fact.interaction === true,
  },
]);

/**
 * The DEFAULT reading, when no rule fires: the node-link. A sparse graph with
 * no stated question is the case both studies agree the node-link holds, and it
 * is the picture a reader recognises.
 */
export const DEFAULT_GRAPH_READING: GraphReading = Object.freeze({
  prefer: 'node-link',
  reason:
    'nothing here says the graph is dense or the question is an adjacency one, and a sparse graph is where the node-link holds its own (Ghoniem, Fekete and Castagliola 2004)',
  rule: 'default',
});

/**
 * Which picture to prefer for this graph, and why — the first rule that fires,
 * else the default.
 *
 * ```ts
 * graphReadingFor({ nodes: 15, edges: 105 });
 * // { prefer: 'matrix', rule: 'dense', reason: 'at a density of 0.2 or more the lines cross…' }
 * ```
 */
export function graphReadingFor(fact: GraphFact): GraphReading {
  const fired = GRAPH_READING_RULES.find((rule) => rule.holds(fact));
  return fired === undefined ? DEFAULT_GRAPH_READING : { prefer: fired.prefer, reason: fired.reason, rule: fired.id };
}
