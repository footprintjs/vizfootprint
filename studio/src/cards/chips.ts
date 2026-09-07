/**
 * THE CHIPS — one surface's feature card, minted from the two readers.
 *
 * THE LAW IT FOLLOWS: **generated, never typed.** Nothing below writes a
 * feature down. Every chip's LABEL is a value that came out of
 * `defFeatures(dashboard)` or `logFeatures(records)`; the only words this module
 * owns are the FACET names (`chart`, `selection`, `verb` …) and the sentence
 * that says which reader vouched for the chip and on which surface.
 *
 * THE SECOND LAW: **a chip is a claim, and only a claim.** A verb the log
 * reports as `'unseen'` mints NO chip — three of the ten verbs land no commit,
 * so their absence proves nothing, and a chip is how this card says "yes". What
 * a log cannot see leaves through {@link unseenOf} as the reader's own sentence,
 * which the card prints in the open.
 *
 * THE THIRD LAW: **a correlation id is not a signature.** `walkReadoutOf`
 * reports `correlated` and `agentCorrelated` as two numbers and says so in
 * words, because a correlation id is a caller's join key: on the CDC trace five
 * of them sit on ordinary user selections.
 *
 * HOW TO ADD A FACET: add one line to the list in `declaresChipsOf` (or its
 * neighbours) reading a field the readers already answer. If the fact is not on
 * a reader, it does not belong on a card — teach the reader first.
 */
import type { DashboardFeatures } from 'vizfootprint/def';
import { UNSEEN_VERBS, type LogFeatures, type LogVerb } from 'vizfootprint/branches';
import type { ChipGround, DemoSurface, FeatureChip, GestureNote } from './types.js';

// ── Minting one chip ──────────────────────────────────────────────────────────

/** Where a ground's facts came from — the half of every chip's sentence that names the surface (law 2 of ./types.ts). */
const GROUND_SOURCE: Readonly<Record<ChipGround, string>> = {
  declares: 'read off the built definition of',
  walked: 'read off the captured trace of',
  'by hand': 'hand-written, and derivable from nothing, for',
};

/** The filter key of a chip — `<ground>:<facet>:<value>`; the ground is in the key so two grounds can never collide. */
export function chipId(ground: ChipGround, facet: string, value: string): string {
  return `${ground}:${facet}:${value}`;
}

/**
 * The sentence a whole GROUND is vouched for by, naming the demo and the
 * surface — the same words every chip in it carries, minted once here so a
 * group heading and a chip's own title can never say different things.
 */
export function groundSentenceOf(ground: ChipGround, surface: DemoSurface): string {
  return `${GROUND_SOURCE[ground]} ${surface.demo} / ${surface.surface}`;
}

function mint(surface: DemoSurface, ground: ChipGround, facet: string, value: string, what: string): FeatureChip {
  return {
    id: chipId(ground, facet, value),
    ground,
    facet,
    label: value,
    title: `${value} — ${what}; ${groundSentenceOf(ground, surface)}`,
    demo: surface.demo,
    surface: surface.surface,
  };
}

// ── What a build DECLARES ─────────────────────────────────────────────────────

/** One structural holding: a plane a build either carries or does not. `holds` is called for every surface, and answers off the reader alone. */
interface Holding {
  readonly value: string;
  readonly what: string;
  readonly holds: (features: DashboardFeatures) => boolean;
}

/**
 * The planes a card reports as present or absent.
 *
 * They are HOLDINGS rather than counts because a card is scanned, not read: "it
 * has layers" is the question a reader brings, and the number is a click away on
 * the surface itself.
 */
const HOLDINGS: readonly Holding[] = [
  { value: 'layers', what: 'some view draws more than one table on one frame', holds: (f) => f.views.some((v) => v.layers !== undefined) },
  { value: 'grain', what: 'some view declares what its marks stand for', holds: (f) => f.views.some((v) => v.grain !== undefined) },
  { value: 'prose', what: 'the definition writes words for its views', holds: (f) => f.proseSubjects.length > 0 },
  { value: 'absence', what: 'some table declares the vocabulary its blanks speak', holds: (f) => f.tables.some((t) => t.absence !== undefined) },
  { value: 'row key', what: 'some table names the column its rows are identified by', holds: (f) => f.tables.some((t) => t.key !== undefined) },
  { value: 'encoding rules', what: 'the definition adds rules to the encoding plane', holds: (f) => f.encodingRules.rules > 0 },
  { value: 'stated fold', what: 'some declared edge says how an emission folds onto its target', holds: (f) => f.links.statesFold },
  { value: 'false-discovery control', what: 'the definition declares an FDR procedure', holds: (f) => f.fdr !== null },
];

/** Every chip the BUILT definition of one surface vouches for. */
export function declaresChipsOf(surface: DemoSurface): readonly FeatureChip[] {
  const f = surface.declares;
  const of = (facet: string, values: readonly string[], what: string): readonly FeatureChip[] => values.map((v) => mint(surface, 'declares', facet, v, what));
  return [
    ...of('chart', f.chartKinds, 'a chart kind this surface draws with'),
    ...of('selection', f.selectionKinds, 'a selection kind some view here can emit'),
    ...of('actor', sortedUnique(f.views.map((v) => v.actor)), 'who drives a view here'),
    ...of('engine', sortedUnique(f.tables.map((t) => t.engine)), 'the engine a table here routed to at build'),
    ...of('source', sortedUnique(f.tables.flatMap(sourceFormatOf)), 'a format a table here was read from'),
    ...of('link', f.links.kinds, 'a kind a declared edge carries'),
    ...of('response', f.links.responses, 'how a declared edge answers what reaches it'),
    ...of('on-clear', f.links.onClear, 'what a declared edge does when its source clears'),
    ...of('link-default', linkDefaultOf(f), 'the rule the whole link graph starts from'),
    ...of('relation', sortedUnique(f.relations.map((r) => r.kind)), 'a declared relation of this cardinality'),
    ...of('analysis', sortedUnique(f.analyses.map((a) => a.kind)), 'a declared analysis of this kind'),
    ...of('builtin', sortedUnique(f.analyses.flatMap(builtinOf)), "a builtin analysis this definition names, rather than a developer's own"),
    ...HOLDINGS.filter((h) => h.holds(f)).map((h) => mint(surface, 'declares', 'holds', h.value, h.what)),
  ];
}

/** The source format, when the table was read through one — a bare `rows` table names none. */
function sourceFormatOf(table: DashboardFeatures['tables'][number]): readonly string[] {
  return table.source === undefined ? [] : [table.source.format];
}

/** The builtin a slot names, when it named one — the two code forms name none. */
function builtinOf(analysis: DashboardFeatures['analyses'][number]): readonly string[] {
  return analysis.builtin === undefined ? [] : [analysis.builtin];
}

/**
 * The declared link rule, or nothing at all.
 *
 * `null` is the reader saying the def declared none, and this card REPEATS that
 * silence rather than printing the build's fallback: copying a default that
 * lives in another module is exactly the drift both readers exist to prevent
 * (`src/def/features.ts`, law 2).
 */
function linkDefaultOf(features: DashboardFeatures): readonly string[] {
  return features.links.linkDefault === null ? [] : [features.links.linkDefault];
}

// ── What somebody DID ─────────────────────────────────────────────────────────

/** Every chip the captured trace of one surface vouches for; none at all when no trace was captured. */
export function walkedChipsOf(surface: DemoSurface): readonly FeatureChip[] {
  const walked = surface.walked;
  if (walked === undefined) return [];
  const of = (facet: string, values: readonly string[], what: string): readonly FeatureChip[] => values.map((v) => mint(surface, 'walked', facet, v, what));
  return [
    ...of('verb', landedVerbsOf(walked), 'a commit on this trace lands only this verb'),
    ...of('selection', walked.selectionKinds, 'a selection of this kind landed on a real view'),
    ...of('trace', branchedOf(walked), 'the trace holds more than one lane — somebody acted while looking at the past'),
    ...of('trace', agentActedOf(walked), "a commit's own cause names the agent, which is the only thing that can"),
  ];
}

/** The verbs a commit proves — never the ones a log merely failed to see (law 2). */
function landedVerbsOf(walked: LogFeatures): readonly LogVerb[] {
  return (Object.keys(walked.verbs) as LogVerb[]).filter((verb) => walked.verbs[verb] === 'landed');
}

function branchedOf(walked: LogFeatures): readonly string[] {
  return walked.branched ? ['branched'] : [];
}

function agentActedOf(walked: LogFeatures): readonly string[] {
  return walked.agentCorrelated > 0 ? ['agent acted'] : [];
}

// ── What only a person knows ──────────────────────────────────────────────────

/**
 * The hand-written chips: a gesture per verb, and the verbs this build leaves
 * unwired.
 *
 * They are the ONE thing on a card no reader can produce, and they wear their
 * own ground so a reader can see at a glance which part of the card is checked
 * and which is somebody's word.
 */
export function byHandChipsOf(surface: DemoSurface): readonly FeatureChip[] {
  return (surface.byHand ?? []).map((note) => mint(surface, 'by hand', facetOfNote(note), note.verb, whatOfNote(note)));
}

const facetOfNote = (note: GestureNote): string => (note.gesture === null ? 'unwired' : 'gesture');

const whatOfNote = (note: GestureNote): string =>
  note.gesture === null ? 'a verb this build declares and wires no gesture to' : `produced by: ${note.gesture}`;

// ── The card's chips, in one order ────────────────────────────────────────────

/**
 * Every chip of one surface, grounds in the order a card reads them.
 *
 * ```ts
 * const chips = chipsOf(deskSurface);
 * chips.filter((c) => c.ground === 'declares').map((c) => c.label);  // chart kinds, selection kinds, …
 * chips.some((c) => c.id === 'declares:chart:network');              // true on the desk, false on the story page
 * ```
 */
export function chipsOf(surface: DemoSurface): readonly FeatureChip[] {
  return [...declaresChipsOf(surface), ...walkedChipsOf(surface), ...byHandChipsOf(surface)];
}

// ── The two things a card says in sentences rather than chips ─────────────────

/** One verb a log is structurally blind to, with the reader's own sentence for why. */
export interface UnseenNote {
  readonly verb: LogVerb;
  readonly why: string;
}

/**
 * The verbs this trace CANNOT speak for — never "not used".
 *
 * The sentences are `UNSEEN_VERBS`, the library's own, so the card and the
 * reader say the same thing about the same silence.
 */
export function unseenOf(walked: LogFeatures): readonly UnseenNote[] {
  return (Object.keys(walked.verbs) as LogVerb[])
    .filter((verb) => walked.verbs[verb] === 'unseen')
    .map((verb) => ({ verb, why: UNSEEN_VERBS[verb as keyof typeof UNSEEN_VERBS] }));
}

/**
 * The counted facts of a walk, as sentences — the things that are numbers rather
 * than features.
 *
 * The correlation line is TWO facts on purpose. A `correlationId` is a caller's
 * own join key and proves nothing about who acted; only a commit's cause names
 * the agent. Saying "5 correlated" and letting a reader conclude "an agent did
 * five things" is the misreading this line exists to prevent.
 */
export function walkReadoutOf(walked: LogFeatures): readonly string[] {
  return [
    `${commitCount(walked.commits)} on ${walked.lanes} ${plural(walked.lanes, 'lane')}`,
    `${walked.bookmarks} ${plural(walked.bookmarks, 'bookmark')}, ${walked.saved} saved ${plural(walked.saved, 'selection')}`,
    ...familyLinesOf(walked),
    ...correlationLinesOf(walked),
  ];
}

function familyLinesOf(walked: LogFeatures): readonly string[] {
  const named = Object.entries(walked.families).filter(([, count]) => count > 0);
  if (named.length === 0) return [];
  return [named.map(([family, count]) => `${count} ${family}`).join(' · ')];
}

function correlationLinesOf(walked: LogFeatures): readonly string[] {
  if (walked.correlated === 0) return [];
  if (walked.agentCorrelated === 0) {
    return [`a correlation id sits on ${commitCount(walked.correlated)}, and not one of them names the agent — an id is a caller's join key, not a signature`];
  }
  return [`a correlation id sits on ${commitCount(walked.correlated)}; the agent's own cause is on ${walked.agentCorrelated} of them`];
}

const commitCount = (n: number): string => `${n} ${plural(n, 'commit')}`;

const plural = (n: number, word: string): string => (n === 1 ? word : `${word}s`);

// ── One shared reducer ────────────────────────────────────────────────────────

/** Every distinct value, in one order — two cards are read side by side, and two orders would read as two answers. */
function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
