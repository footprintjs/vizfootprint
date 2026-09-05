/**
 * The names a SESSION-AUTHORED commit lands under — the ones no caller supplies
 * and no data column may take.
 *
 * A commit's `viewId` and `field` are, most of the time, a person's: the view
 * they gestured on, the column they picked. But the session also lands commits
 * that are not gestures on data — a re-encode, a link edit, a chart
 * registration, a note, an arrangement — and each of those needs an identity
 * on the same wire. It gets one by RESERVING a name: a synthetic `viewId` in a
 * namespace `runtime.views` will never hold, or a `field` a probe is refused
 * for.
 *
 * They live here rather than in `session.ts` because they are the one part of
 * the wire the session owns outright, and because a reader asking "can a column
 * be called this?" should find the whole answer in one place. The prefixes
 * themselves are NOT minted here — they are single-sourced from
 * `src/branches/fold`, which folds the same wire from the log alone, so the two
 * layers share the literal bytes and cannot drift. This module composes them
 * into the exact strings the session writes.
 *
 * **Before you add one**: a new reserved field must go into
 * {@link RESERVED_PROBE_FIELDS} in the same edit, or a data column of that name
 * will land as a session commit and be read back as one. That is the whole
 * hazard this file exists to keep in one place.
 */
import { TEST_ANALOG_FIELD } from '../fdr/index.js';
import { CHART_VIEW_PREFIX, ENCODING_VIEW_PREFIX, LINK_VIEW_PREFIX } from '../branches/index.js';

/** Reserved log fields the session lands non-filter commits under (never real data columns). */
export const ANALYSIS_FIELD = '__analysis__';
export const ANNOTATION_FIELD = '__annotation__';
/**
 * The field a bookmark commit carried its label under. The session lands NO
 * bookmark commits any more (a bookmark lives beside the log, not in it), but
 * the field stays reserved from probes: the UI's log reader still labels a
 * `__bookmark__` commit "bookmark", so a data column of that name would read as
 * a bookmark that never was.
 */
export const BOOKMARK_FIELD = '__bookmark__';
/** RP-3: the field an agent-authored chart's spec-registration commit lands under. */
export const CHART_FIELD = '__chart__';

/**
 * WHAT AN `__analysis__` COMMIT'S VALUE CARRIES — the act, in enough detail to
 * perform it again.
 *
 * It used to carry the analysis id alone, which was redundant: the id is
 * already in the `viewId` (`analysis:<id>`), so the slot said nothing the
 * record did not already say. What the record did NOT say was the TABLE the
 * analysis read — `declareAnalysis(id, { table })` takes one and the commit
 * forgot it. That is a record of an act that cannot be performed again, and a
 * replay reading it had to assume the default table: on a multi-table
 * dashboard it re-ran the act over the wrong rows and landed wrong numbers
 * under the right provenance, silently. The table lives here now, beside the
 * identity, because the identity is what the slot was already for.
 *
 * The `pValue` lane (a `kind:'test'` analysis, `TEST_ANALOG_FIELD`) cannot
 * carry this: its value slot IS the p-value, by the L1↔L4 convention
 * `src/fdr/fromLog.ts` documents and `isTestAnalogCommit` enforces. So a test
 * analysis that also writes COLUMNS records no table — and a replay refuses
 * such a log at judge time rather than guessing. See `./README.md`, law 6.
 */
export interface AnalysisAct {
  /** The declared analysis this commit ran. Also in the `viewId`; kept here so the value is the whole act. */
  readonly id: string;
  /** The table it READ. Not the table its output landed in — that is the analysis's own declared data. */
  readonly table: string;
}

/**
 * The act an `__analysis__` commit records, or `undefined` when its value does
 * not carry one — a foreign log, a hand-built record, or the `pValue` lane,
 * whose slot is spoken for. Total: it never throws and never guesses.
 */
export function analysisActOf(value: unknown): AnalysisAct | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { id, table } = value as { id?: unknown; table?: unknown };
  if (typeof id !== 'string' || id.length === 0) return undefined;
  if (typeof table !== 'string' || table.length === 0) return undefined;
  return { id, table };
}

/**
 * Fields a `select`/`filter` may NOT target — a clause on one of these would
 * collide with a session-authored commit. `pValue` (`TEST_ANALOG_FIELD`) is the
 * load-bearing one: an unguarded point select on a data column literally named
 * `pValue` carrying a value in [0,1] would be miscounted as a declared test by
 * `hypothesisRecordsFromLog` on log replay (R6). Reject it as a typed gap.
 */
export const RESERVED_PROBE_FIELDS = new Set<string>([TEST_ANALOG_FIELD, ANALYSIS_FIELD, ANNOTATION_FIELD, CHART_FIELD, BOOKMARK_FIELD]);

/**
 * The `reencode` verb's commit-landing namespace (mirrors the `annotation:`/
 * `analysis:` synthetic-viewId pattern doAnnotate/declareAnalysis use): a
 * reencode commit's `viewId` is `encoding:${targetViewId}`, so it is
 * structurally distinct from a real probe on that view (`runtime.views.has()`
 * is false for it) and `rebuildFold` can recognize + fold it without touching
 * `src/log`'s wire union (CommitRecord stays `kind:'point'|'interval'`; `field`
 * carries the CHANNEL, `value` carries the target field — both plain strings,
 * same shape every other commit already uses).
 *
 * The prefix constants themselves are SINGLE-SOURCED from `src/branches/fold`
 * (BR-1): the branches layer folds the same wire from the log alone, so the
 * two layers share the literal bytes and cannot drift.
 */
export const encodingViewId = (viewId: string): string => `${ENCODING_VIEW_PREFIX}${viewId}`;
export const linkViewId = (id: string): string => `${LINK_VIEW_PREFIX}${id}`;

/**
 * The `chart:${id}` synthetic identity an agent-authored chart's commits land
 * under (RP-3). Single-sourced from `src/branches/fold` like the other
 * prefixes, so the branches fold and the session cannot drift on the wire.
 * A chart commit is INERT in the fold (`keyOf` returns null for it) — a chart
 * registration is not crossfilter state; it renders as its own view.
 */
export const chartViewId = (id: string): string => `${CHART_VIEW_PREFIX}${id}`;

/** The dashboard subject's registry meta: its words are the system's, its label the cockpit's. */
export const DASHBOARD_ACTOR_META = { actor: 'system', label: 'the dashboard' } as const;
/** A note's registry meta: words a person (or an accepted reply) put on the dashboard. */
export const NOTE_ACTOR_META = { actor: 'user', label: 'a note' } as const;

/**
 * LY-1: the cockpit-layout commit-landing namespace — a layout note lands under
 * `layout:${scope}` (e.g. `layout:dashboard`), following the `encoding:` /
 * `annotation:` / `chart:` synthetic-viewId precedent above. `field` carries
 * the arrangement PROP (`preset` / `order` / `focus`), `value` its plain-string
 * value. Recorded through the `navigate` verb (deliberately NON-filtering —
 * the same honesty ruling as pan/zoom: an arrangement is never a data claim)
 * and folded by `rebuildFold` like `activeEncodings`, so seek / switchPath /
 * fork each restore their own arrangement. Prefix single-sourced from
 * `src/branches/fold` (where it is INERT — layout never enters row counts,
 * foldDiff, or conflicts).
 *
 * The registry meta for a layout source is CONSTANT (`{ actor: 'system',
 * label: 'layout' }`): `layout:${scope}` is ONE shared source across actors,
 * and the registry rejects a meta that varies (the doReencode BR-1 lesson) —
 * WHO acted lives in the cause (`requestedBy`).
 */
export const LAYOUT_SOURCE_META = { actor: 'system', label: 'layout' } as const;
/** A layout value is inert display state — cap it like a bookmark label (order lists fit easily). */
export const LAYOUT_VALUE_MAX = 500;
