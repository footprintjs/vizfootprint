/**
 * WHAT SOMEBODY ACTUALLY DID — the feature card of a LOG.
 *
 * THE LAW IT FOLLOWS: **never claim more than the log holds.** Three of the ten
 * verbs can be used without landing a commit — a `navigate` on a declared view
 * moves a viewport and records the verb alone, `fork` moves the cursor, and a
 * bookmark is a name kept beside the log — so a log that shows none of them
 * proves nothing. This reader answers `'unseen'` for those, never `'not-landed'`:
 * "I cannot see it from here" and "it was not used" are different sentences, and
 * a card that printed the second would be lying about the first.
 *
 * ITS TWIN is `../def/features.ts`, which answers what a build CAN do. This one
 * answers what a trace SHOWS. They are separate because a demo can declare a
 * network view nobody ever walked, and a card that merged the two would claim a
 * gesture no reader ever made.
 *
 * WHY IT LIVES HERE: the verb a commit came from is read off its synthetic
 * VIEWID NAMESPACE, and `./fold.ts` is the one owner of those prefixes —
 * `familyOf` is its immediate neighbour, classifying the same commits by the
 * same bytes. A reader in `../log` would have to import them from here, and
 * this package already imports the log: that edge only goes one way.
 *
 * FIRST CUSTOMERS: the demo gallery's per-surface card, beside the def card, and
 * the filter it offers over one.
 */

import type { CommitRecord } from '../log/index.js';
import { deriveBranches } from './derive.js';
import {
  ANALYSIS_VIEW_PREFIX,
  ANNOTATION_VIEW_PREFIX,
  BOOKMARK_VIEW_PREFIX,
  CHART_VIEW_PREFIX,
  ENCODING_VIEW_PREFIX,
  LAYOUT_VIEW_PREFIX,
  LINK_VIEW_PREFIX,
  PROSE_VIEW_PREFIX,
  familyOf,
  type CommitFamily,
} from './fold.js';

// ── The vocabulary, and what a log can say about one of its verbs ────────────

/**
 * THE TEN VERBS, as this package must spell them.
 *
 * A DELIBERATE REPLICA of `../def`'s `DISPATCH_VERBS`, and the one thing in this
 * file that is not a projection. The law of this package (`./README.md`, pinned
 * by the boundary test in `./branches.test.ts`) is that a shipped source here
 * imports `../log` and NOTHING else — that is what lets anyone run it against a
 * bare `CommitRecord[]` off a wire — so the def's vocabulary cannot be imported,
 * not even as a type.
 *
 * It is PINNED instead: `./features.test.ts` asserts this list IS
 * `DISPATCH_VERBS`, member for member and in order, so an eleventh verb fails
 * the suite here rather than going quietly unreported.
 */
export const LOG_VERBS = ['select', 'filter', 'annotate', 'navigate', 'analyze', 'fork', 'bookmark', 'reencode', 'link', 'describe'] as const;

/** One of the ten dispatch verbs, as this reader names them. */
export type LogVerb = (typeof LOG_VERBS)[number];


/**
 * `landed` — the log holds a commit only this verb lands.
 * `not-landed` — this verb always lands a commit when it is used, and none is here.
 * `unseen` — this verb can be used without landing a commit, so a log cannot say.
 */
export type VerbEvidence = 'landed' | 'not-landed' | 'unseen';

/** The three verbs a log can be blind to, and the sentence saying why — hand-written, because no commit records it. */
export type UnseenVerb = Extract<LogVerb, 'navigate' | 'fork' | 'bookmark'>;

export const UNSEEN_VERBS: Readonly<Record<UnseenVerb, string>> = Object.freeze({
  navigate:
    'a navigate on a declared view moves a viewport and lands no commit — only the `layout:` form lands one, so an absent navigate can never be read as "nobody navigated"',
  fork: 'fork moves the cursor and lands no commit of its own; the branch it opens shows up as a second lane, which is what `lanes` counts',
  bookmark: 'a bookmark is a name on a moment, kept beside the log and never in it — bookmarking lands no commit',
});

/**
 * The VERB that lands a commit under each synthetic namespace — the one table
 * this reader reads. Order matters to nothing: a viewId wears at most one of
 * these prefixes, because `../def/validate.ts` refuses a declared view that
 * squats any of them.
 */
const VERB_BY_PREFIX: readonly (readonly [string, LogVerb])[] = [
  [ANNOTATION_VIEW_PREFIX, 'annotate'],
  [ANALYSIS_VIEW_PREFIX, 'analyze'],
  [ENCODING_VIEW_PREFIX, 'reencode'],
  [LINK_VIEW_PREFIX, 'link'],
  [PROSE_VIEW_PREFIX, 'describe'],
  // the ONE form of navigate that lands: a cockpit arrangement (LY-1). A pan/zoom lands nothing — see UNSEEN_VERBS.
  [LAYOUT_VIEW_PREFIX, 'navigate'],
];

/**
 * The namespaces NO dispatch verb lands: an agent-authored chart is registered
 * through `proposeChart`, and `bookmark:` is reserved and inert (nothing this
 * library writes carries it any more). Named so a commit in either namespace
 * counts as no verb at all, rather than falling through to `select`.
 */
const NOT_A_VERB: readonly string[] = [CHART_VIEW_PREFIX, BOOKMARK_VIEW_PREFIX];

// ── The card, as data ─────────────────────────────────────────────────────────

/**
 * The stores kept BESIDE the log, handed in because they are not in it.
 *
 * Typed as `unknown[]` on purpose: this package imports only the log layer, and
 * only the LENGTH of each list is read. A card counts what it is handed; it
 * never opens a record it does not own.
 */
export interface LogFeaturesInput {
  readonly bookmarks?: readonly unknown[];
  readonly saved?: readonly unknown[];
}

/** What one captured trace shows somebody doing. */
export interface LogFeatures {
  readonly commits: number;
  /** Every verb, with what this log can honestly say about it. */
  readonly verbs: Readonly<Record<LogVerb, VerbEvidence>>;
  /** The distinct selection kinds that landed on a real view, alphabetically. */
  readonly selectionKinds: readonly CommitRecord['kind'][];
  /**
   * The distinct WALKS those neighbourhood selections recorded — the
   * `derivation` on each walk's own value (`'component'`, `'ego'`, `'path'`),
   * alphabetically; empty when nobody walked.
   *
   * Beside `selectionKinds` and not inside it because they answer different
   * questions: that one says a walk landed, this one says WHICH walk, and a
   * card that printed only the kind would report "neighbourhood" for a trace
   * whose whole story was one path between two nodes.
   */
  readonly walkDerivations: readonly string[];
  /** How many commits fell in each family (`familyOf`), including the families with none. */
  readonly families: Readonly<Record<CommitFamily, number>>;
  /** The lanes `deriveBranches` names — 1 for a straight line, 0 for an empty log. */
  readonly lanes: number;
  /** Whether anybody branched: more than one lane. */
  readonly branched: boolean;
  readonly bookmarks: number;
  readonly saved: number;
  /** Commits carrying a cross-tier `correlationId` at all. */
  readonly correlated: number;
  /**
   * Of those, the ones whose CAUSE names the agent.
   *
   * The two numbers are separate because a `correlationId` is a caller's own
   * join key and proves nothing about who acted: in the CDC capture, five ids
   * sit on ordinary user selections. Only the cause says who asked.
   */
  readonly agentCorrelated: number;
}

// ── The door ──────────────────────────────────────────────────────────────────

/**
 * The feature card of one captured trace.
 *
 * ```ts
 * const did = logFeatures(payload.log, { bookmarks: payload.bookmarks, saved: payload.saved });
 * did.verbs.describe;  // 'landed'  — eight prose commits are on the trace
 * did.verbs.link;      // 'not-landed' — a link edit always lands, and none did
 * did.verbs.bookmark;  // 'unseen' — bookmarking lands no commit; see UNSEEN_VERBS
 * ```
 */
export function logFeatures(records: readonly CommitRecord[], input: LogFeaturesInput = {}): LogFeatures {
  const landed = landedVerbsOf(records);
  const lanes = Object.keys(deriveBranches(records)).length;
  const correlated = records.filter((r) => r.correlationId !== undefined);
  return {
    commits: records.length,
    verbs: {
      select: evidenceOf('select', landed),
      filter: evidenceOf('filter', landed),
      annotate: evidenceOf('annotate', landed),
      navigate: evidenceOf('navigate', landed),
      analyze: evidenceOf('analyze', landed),
      fork: evidenceOf('fork', landed),
      bookmark: evidenceOf('bookmark', landed),
      reencode: evidenceOf('reencode', landed),
      link: evidenceOf('link', landed),
      describe: evidenceOf('describe', landed),
    },
    selectionKinds: selectionKindsOf(records),
    walkDerivations: walkDerivationsOf(records),
    families: familiesOf(records),
    lanes,
    branched: lanes > 1,
    bookmarks: input.bookmarks?.length ?? 0,
    saved: input.saved?.length ?? 0,
    correlated: correlated.length,
    agentCorrelated: correlated.filter(holdsAgentCause).length,
  };
}

// ── Reading one commit ────────────────────────────────────────────────────────

/**
 * The verb that landed this commit, or `null` for a namespace no verb lands.
 *
 * A commit under a REAL view (a plain viewId, or a `viewId~layerId` layer
 * address) is the probe, and the probe's own door splits it the same way:
 * `filter` is the interval, every other kind is `select`.
 */
export function verbOf(record: Pick<CommitRecord, 'viewId' | 'kind'>): LogVerb | null {
  const named = VERB_BY_PREFIX.find(([prefix]) => record.viewId.startsWith(prefix));
  if (named !== undefined) return named[1];
  if (NOT_A_VERB.some((prefix) => record.viewId.startsWith(prefix))) return null;
  return record.kind === 'interval' ? 'filter' : 'select';
}

/** Every verb some commit on this trace landed. */
function landedVerbsOf(records: readonly CommitRecord[]): ReadonlySet<LogVerb> {
  const landed = new Set<LogVerb>();
  for (const record of records) {
    const verb = verbOf(record);
    if (verb !== null) landed.add(verb);
  }
  return landed;
}

/** A verb is `unseen` when a log CAN be blind to it and this one saw nothing — never when it saw something. */
function evidenceOf(verb: LogVerb, landed: ReadonlySet<LogVerb>): VerbEvidence {
  if (landed.has(verb)) return 'landed';
  return verb in UNSEEN_VERBS ? 'unseen' : 'not-landed';
}

/**
 * The selection kinds that landed on a REAL view.
 *
 * A synthetic-namespace commit carries a `kind` too (`prose:` commits are
 * `point`s), and counting those would report a selection nobody made.
 *
 * Sorted alphabetically rather than in the library's own kind order: that order
 * is `EMISSION_KINDS`, which lives in `src/links` — a package this one does not
 * import. One order, chosen here, beats a second copy of somebody else's.
 */
function selectionKindsOf(records: readonly CommitRecord[]): readonly CommitRecord['kind'][] {
  const probes = records.filter((r) => {
    const verb = verbOf(r);
    return verb === 'select' || verb === 'filter';
  });
  return [...new Set(probes.map((r) => r.kind))].sort();
}

/**
 * The walks a trace SHOWS — one `derivation` per distinct walk that landed on a
 * real view, alphabetically (the order `selectionKindsOf` chose, for its
 * reason).
 *
 * Read off the recorded value LOCALLY, with a plain string test, because this
 * package imports `../log` and nothing else (`README.md`, the folder law) — so
 * `../data`'s own reader is not available here and is deliberately not
 * imported for one field. A body naming a derivation this build does not mint
 * still counts: a card reports what the trace says, not what this version can
 * run. A walk body with no readable derivation is not reported at all rather
 * than reported as `'ego'` — a default is this reader's guess, and a card never
 * guesses.
 */
function walkDerivationsOf(records: readonly CommitRecord[]): readonly string[] {
  const walks = records.filter((r) => r.kind === 'neighbourhood' && verbOf(r) === 'select');
  const named = walks.map((r) => (r.value as { readonly derivation?: unknown } | null)?.derivation).filter((d): d is string => typeof d === 'string');
  return [...new Set(named)].sort();
}

/** Every family, including the ones with no commits — a card says "no design edits", not nothing. */
function familiesOf(records: readonly CommitRecord[]): Readonly<Record<CommitFamily, number>> {
  const counts: Record<CommitFamily, number> = { interaction: 0, design: 0, analysis: 0, story: 0 };
  for (const record of records) counts[familyOf(record)] += 1;
  return counts;
}

/** Who asked, or who computed — either slot naming the agent makes this the agent's commit. */
function holdsAgentCause(record: CommitRecord): boolean {
  return record.cause.requestedBy === 'agent' || record.cause.computedBy === 'agent';
}
