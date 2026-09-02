/**
 * The PROSE plane (layer 4, fourth plane beside data, encoding and
 * arrangement): the words a view carries — title, caption, alt text, how to
 * read it — as declared DATA with a cause. Every slot is a record, never a
 * bare string: who wrote it (a person, an agent, or derived from the encoding
 * surface), what kind of claim it makes, and what it was written against, so
 * the library can say when it went stale instead of letting it lie.
 */

/** The slots a view may carry, each with its own job. */
export const PROSE_SLOTS = ['title', 'caption', 'altShort', 'altLong', 'howToRead'] as const;
export type ProseSlot = (typeof PROSE_SLOTS)[number];

/**
 * The kind of claim a sentence makes (Lundgard & Satyanarayan's four levels):
 * construction = what the chart is (kind, channels, ranges); statistic = a
 * number the data holds; trend = a shape a reader perceives; causal = why —
 * a claim the data cannot carry.
 */
export const CLAIM_LEVELS = ['construction', 'statistic', 'trend', 'causal'] as const;
export type ClaimLevel = (typeof CLAIM_LEVELS)[number];

/** Who wrote the words: a person, an agent, the library from the encoding surface, or a person editing an agent's draft. */
export const AUTHOR_KINDS = ['human', 'agent', 'derived', 'humanEdited'] as const;
export type AuthorKind = (typeof AUTHOR_KINDS)[number];

export interface ProseAuthor {
  readonly kind: AuthorKind;
  /** A name or actor id, echoed verbatim. */
  readonly by?: string;
  /** The model that wrote (or drafted) it, when an agent did. */
  readonly model?: string;
  /** When, ISO 8601, echoed verbatim. */
  readonly at?: string;
  /** The commit the words were written at (a session-authored slot). */
  readonly commitId?: string;
}

/**
 * What the words were written AGAINST — structured, so the library can say
 * not just that a caption is stale but what moved. Agent-written prose must
 * state one: without a basis, a model's words are indistinguishable from
 * stated fact.
 */
export interface ProseBasis {
  /** The channel→field bindings the view showed. */
  readonly encodings?: Readonly<Record<string, string>>;
  /** The live selections the words counted on, viewId → the clause value as JSON-safe data. */
  readonly filters?: Readonly<Record<string, unknown>>;
  /** The columns the words name. */
  readonly columns?: readonly string[];
  /** The declared analysis the words quote, if any. */
  readonly analysisId?: string;
  /** The commit id the words were written at (informational; staleness is judged structurally). */
  readonly atCommit?: string | null;
}

/**
 * A REF: a span of the text that points at a saved interaction — a commit, or
 * a beat by its label — so a reader can hover to see the act and click to go
 * there, and an agent's summary carries the position each sentence was
 * computed at. Rendered as a small corner anchor in the text.
 */
export interface ProseRef {
  /** Character span `[start, end)` within `text`. */
  readonly span: readonly [number, number];
  readonly commit?: string;
  readonly beat?: string;
  /** Words for the anchor, echoed verbatim. */
  readonly label?: string;
}

export interface ProseRecord {
  /** The words. May be absent only for a `derived` author (the library renders the construction line itself). */
  readonly text?: string;
  /** The kinds of claim the words make. Default: none stated. */
  readonly levels?: readonly ClaimLevel[];
  readonly author: ProseAuthor;
  readonly basis?: ProseBasis;
  /** `decorative` lets a chart with nothing to say leave its alt empty on purpose. Default `informative`. */
  readonly role?: 'informative' | 'decorative';
  /** Spans of the text that point at a saved interaction. */
  readonly refs?: readonly ProseRef[];
}

/** A view's declared prose: the def's `prose[]` entry. */
export interface ProseDecl {
  readonly viewId: string;
  readonly slots: Readonly<Partial<Record<ProseSlot, ProseRecord>>>;
}

/** What a slot looks like AT THE CURSOR: the record, plus whether its basis still matches what is on screen. */
export interface ProseStatus {
  readonly slot: ProseSlot;
  readonly record: ProseRecord;
  /** `derived` slots are recomputed every read and can never go stale. */
  readonly status: 'current' | 'stale' | 'derived';
  /** For a stale slot: which parts of the basis moved (`encodings`, `filters`, `columns`, `analysis`). */
  readonly changed: readonly string[];
  /** The rendered words: the record's text, or the derived construction line. */
  readonly text: string;
  /** The record's refs, as declared (a derived slot has none). */
  readonly refs: readonly ProseRef[];
}

/** A refusal of a prose record — the same sentence at the def door, at dispatch, and in a lint list. */
export interface ProseProblem {
  readonly viewId: string;
  readonly slot: ProseSlot | string;
  readonly rule: string;
  readonly sentence: string;
}

/** The surface a derived construction line reads (structurally the def's ViewEncodingDecl). */
export interface ProseSurface {
  readonly viewId: string;
  readonly chartKind: string;
  readonly channels: readonly string[];
}
