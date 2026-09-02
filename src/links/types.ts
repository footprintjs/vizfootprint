/**
 * LINKS — the edge layer of the interaction grammar (layer 4).
 *
 * A VIEW has a VOICE: the emission kinds it can produce. An EDGE says what one
 * view's emission does to another view: `filter` drops rows there, `highlight`
 * dims them and keeps them, `navigate` moves the target's viewport and claims
 * nothing about data, `mirror` outlines the same value there, `none` says the
 * link is deliberately off. A GRAPH is the edges plus the DEFAULT rule; the
 * default (today's implicit crossfilter: every view filters every other, self
 * excluded) is MATERIALIZED into explicit edges at declaration, so nothing is
 * ever implicit — an absent edge is a silence, a `none` edge is a fact.
 *
 * Every edge is data: the cockpit renders it, a person edits it, the agent
 * reads it. Charts never see edges; the host applies them.
 */

/** The emission kinds a view can produce — its voice. */
export const EMISSION_KINDS = ['point', 'interval', 'cell', 'match'] as const;
export type EmissionKind = (typeof EMISSION_KINDS)[number];

/** What a target does with a source's emission. */
export const LINK_RESPONSES = ['filter', 'highlight', 'navigate', 'mirror', 'none'] as const;
export type LinkResponse = (typeof LINK_RESPONSES)[number];

/** What the target does when the source CLEARS its selection. */
export const LINK_ON_CLEAR = ['leave', 'showAll', 'excludeAll'] as const;
export type LinkOnClear = (typeof LINK_ON_CLEAR)[number];

/** The default rule a graph starts from before declared edges override it. */
export const LINK_DEFAULTS = ['crossfilter', 'none'] as const;
export type LinkDefault = (typeof LINK_DEFAULTS)[number];

/** One field carried from the source's clause to the target's column. */
export interface FieldMapping {
  readonly from: string;
  readonly to: string;
}

/** A DECLARED edge, as the author writes it on the dashboard def. */
export interface LinkDecl {
  readonly source: string;
  readonly kind: EmissionKind;
  readonly target: string;
  readonly response: LinkResponse;
  /** Field renames when the source's field is not the target's column. Absent = same field. */
  readonly mapping?: readonly FieldMapping[];
  /** Absent = `showAll` (a cleared source stops filtering the target). */
  readonly onClear?: LinkOnClear;
  /** How an aggregate emission folds down to the target's rows. NOT yet enforced (see README). */
  readonly fold?: string;
  readonly label?: string;
}

/** An edge in the MATERIALIZED graph — declared, written out from the default rule, or EDITED at run time (a `link` commit). */
export interface LinkEdge extends LinkDecl {
  /** `${source}:${kind}→${target}` — one edge per (source, kind, target). */
  readonly id: string;
  readonly origin: 'declared' | 'default' | 'edited';
}

/** A view as the graph sees it: its id and its voice. */
export interface LinkView {
  readonly viewId: string;
  readonly voice: readonly EmissionKind[];
}

/** The materialized graph the session serves and the cockpit draws. */
export interface LinkGraph {
  readonly default: LinkDefault;
  readonly views: readonly LinkView[];
  readonly edges: readonly LinkEdge[];
}

/** The id every replica of the wire uses for an edge. */
export function edgeId(source: string, kind: EmissionKind, target: string): string {
  return `${source}:${kind}→${target}`;
}
