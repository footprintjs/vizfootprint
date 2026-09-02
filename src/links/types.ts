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
/**
 * The ENCODING kind — an edge that carries a source view's channel BINDING,
 * not a selection. Deliberately outside `EMISSION_KINDS`: a view emits it
 * only by having an encoding surface, the crossfilter default never writes
 * it out (there is no honest sentence for "every chart's encoding follows
 * every other's"), and the probe guard never sees it.
 */
export const ENCODING_KIND = 'encoding' as const;
export type LinkKind = EmissionKind | typeof ENCODING_KIND;
export const LINK_KINDS = [...EMISSION_KINDS, ENCODING_KIND] as const;

/** What a target does with a SELECTION it receives. */
export const LINK_RESPONSES = ['filter', 'highlight', 'navigate', 'mirror', 'none'] as const;
/** What a target does with a BINDING it receives: follow it, or nothing (on purpose). */
export const ENCODING_RESPONSES = ['follow', 'none'] as const;
export type LinkResponse = (typeof LINK_RESPONSES)[number] | (typeof ENCODING_RESPONSES)[number];

/** The responses an edge of `kind` may carry. */
export function responsesFor(kind: LinkKind): readonly LinkResponse[] {
  return kind === ENCODING_KIND ? ENCODING_RESPONSES : LINK_RESPONSES;
}

/** One channel pair an encoding edge follows: the source's `from` channel lands on the target's `to` channel. */
export interface ChannelPair {
  readonly from: string;
  readonly to: string;
}

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
  readonly kind: LinkKind;
  readonly target: string;
  readonly response: LinkResponse;
  /** Field renames when the source's field is not the target's column. Absent = same field. */
  readonly mapping?: readonly FieldMapping[];
  /**
   * Encoding edges only: WHICH channels follow. Omitted at declaration = every
   * channel both ends declare, by the same name — written out at
   * materialization, never left implicit (law 1).
   */
  readonly channels?: readonly ChannelPair[];
  /** Absent = `showAll` (a cleared source stops filtering the target). */
  readonly onClear?: LinkOnClear;
  /** How the emission folds down to the target's rows — REQUIRED when the edge crosses grains (the source emits over an aggregate the target does not show); a default edge that crosses carries `crossfilter`. */
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
  readonly voice: readonly LinkKind[];
  /** The channels the view's encoding surface declares — present exactly when it has one (so an encoding edge can be judged). */
  readonly channels?: readonly string[];
  /** The GRAIN: the group keys the view's marks stand for ([] = one mark per row); absent = unknown, never judged. */
  readonly grain?: readonly string[];
}

/** The materialized graph the session serves and the cockpit draws. */
export interface LinkGraph {
  readonly default: LinkDefault;
  readonly views: readonly LinkView[];
  readonly edges: readonly LinkEdge[];
}

/** The id every replica of the wire uses for an edge. */
export function edgeId(source: string, kind: LinkKind, target: string): string {
  return `${source}:${kind}→${target}`;
}
