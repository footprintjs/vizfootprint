/**
 * `validateDashboardDef` — the R12 firewall at the def boundary (mirrors L0
 * `parseCause` and L3 `validateAnalysisDef`). Collects every problem; never
 * throws in the caller's control flow, never executes any of the def's
 * functions, never interprets a declarative string.
 *
 * A raw `AnalysisDef` entry is re-run through L3's own `validateAnalysisDef` so
 * the injection corpus L3 already firewalls is enforced here too; an
 * already-built `AnalysisModule` (an L3 built-in) was validated at its own
 * construction and is checked only for shape.
 */

import { validateAnalysisDef } from '../analysis/index.js';
import { isBuiltinRecord, validateBuiltinAnalysis } from './builtinAnalyses.js';
import { validateRelations } from './relations.js';
import { mintedTables } from './builtinAnalyses.js';
import { layerLinkViewsOf, layerSurfacesOf, markerRefusal, validateFrame, validateLayers } from './layers.js';
import { tableReachOf } from './tableReach.js';
import { holdsLayerMarker } from './layerAddress.js';
import { EMISSION_KINDS, validateLinks, voiceOf, type EmissionKind } from '../links/index.js';
import { ENCODING_SET_FIELD,
  ANALYSIS_VIEW_PREFIX,
  ANNOTATION_VIEW_PREFIX,
  CHART_VIEW_PREFIX,
  ENCODING_VIEW_PREFIX,
  LAYOUT_VIEW_PREFIX,
  BOOKMARK_VIEW_PREFIX,
  LINK_VIEW_PREFIX,
  PROSE_VIEW_PREFIX,
} from '../branches/index.js';
import { ABSENCE_PRESENT, ABSENCE_UNKNOWN, DISPATCH_VERBS, type AbsenceDecl, type DashboardDef, type DispatchVerb } from './types.js';
import { absenceContradictionOf } from '../data/absenceContradiction.js';
import { SILENCE_ARITHMETICS, silenceOfDecl } from '../data/silence.js';
import { lintEncodings, pageBindings, resolveFacets, validateColumnDecls, validateEncodingRulesShape } from '../encoding/index.js';
import type { EncodingRules, EncodingSurface, FacetSource } from '../encoding/index.js';
import type { ColumnInfo } from '../data/index.js';
import { DASHBOARD_PROSE_ID, NOTE_PROSE_PREFIX, validateProseDecls } from '../prose/index.js';
import { SOURCE_FORMATS, SOURCE_VIAS } from '../source/index.js';
import type { SourceRefusalReason } from '../source/index.js';

/** Thrown when a def is structurally malformed. Carries every problem at once. */
export class DashboardDefError extends Error {
  readonly problems: readonly string[];
  /** When a declared source refused, its typed reason — a host may retry a `timeout`, never a `malformed`. */
  readonly reason?: SourceRefusalReason;
  constructor(problems: readonly string[], reason?: SourceRefusalReason) {
    super(`invalid DashboardDef: ${problems.join('; ')}`);
    this.name = 'DashboardDefError';
    this.problems = problems;
    if (reason !== undefined) this.reason = reason;
  }
}

/** The exhaustive set of top-level keys a def may carry. Anything else is rejected (R12). */
const DEF_KEYS = new Set([
  'meta',
  'config',
  'data',
  'params',
  'plotDefaults',
  'views',
  'actors',
  'analyses',
  'capabilities',
  'encodings',
  'fdr',
  'agent',
  'defaultTable',
  'grains',
  'links',
  'linkDefault',
  'relations',
  'encodingRules',
  'prose',
]);

/** The exhaustive set of keys a `SeriesGrain` may carry (R12: stated facts only, nothing executable). */
const GRAIN_KEYS = new Set(['bucket', 'reducer', 'collapsedFrom', 'note']);

/** The grain's string-valued keys — each echoed verbatim, never parsed. */
const GRAIN_STRING_KEYS = ['bucket', 'reducer', 'note'] as const;

const ACTORS = new Set(['user', 'agent', 'system']);
const ENGINES = new Set(['memory', 'wasm', 'server', 'auto']);
const PROCEDURES = new Set(['LORD++', 'alpha-investing']);
// the ONE array literal of emission kinds (`../links/types.ts`) — projected, never restated, so a new kind is declarable the day it exists
const ENCODINGS = new Set<string>(EMISSION_KINDS);
/** The declarable emission kinds as a sentence — `"point" | "interval" | …` — for the refusals below. */
const ENCODING_WORDS = EMISSION_KINDS.map((k) => `"${k}"`).join(' | ');

/**
 * The synthetic-viewId namespaces the SESSION owns, single-sourced from
 * `src/branches/fold` (the one place the log wire is defined, so this list and
 * the fold can never drift). A host-declared view may NOT squat one: the session
 * lands its own `encoding:` / `analysis:` / `annotation:` / `chart:` / `layout:`
 * commits there, which are INERT in the fold by design (`keyOf` returns null),
 * so such a view's probes would be unfoldable, invisible to `compare`, and
 * silently skipped when a path is adopted. `bookmark:` is reserved for the older
 * reason it was: nothing lands one now (a bookmark lives beside the log, not in
 * it), but the UI still reads that shape as a bookmark. Rejected at the def
 * boundary (R12) rather than left to fail confusingly at runtime.
 */
const RESERVED_VIEW_PREFIXES = [
  ENCODING_VIEW_PREFIX,
  ANALYSIS_VIEW_PREFIX,
  ANNOTATION_VIEW_PREFIX,
  CHART_VIEW_PREFIX,
  LAYOUT_VIEW_PREFIX,
  BOOKMARK_VIEW_PREFIX,
  LINK_VIEW_PREFIX, // layer 4: `link:<edgeId>` is a keyed namespace — a view there would be read as a link-graph edit
  PROSE_VIEW_PREFIX, // the prose plane: `prose:<viewId>` carries a view's words
  NOTE_PROSE_PREFIX, // the prose plane's notes: `note:<id>` is a prose subject, never a view
] as const;

/** The reserved namespace a view id squats, or undefined when it is free to use. */
function reservedPrefix(viewId: string): string | undefined {
  return RESERVED_VIEW_PREFIXES.find((prefix) => viewId.startsWith(prefix));
}
/** The well-formed grain declarations (a malformed entry is already a problem and is not judged). */
function wellFormedGrains(raw: unknown): { viewId: string; keys: readonly string[] }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((g) => (isObject(g) && typeof g.viewId === 'string' && Array.isArray(g.keys) && g.keys.every((k) => typeof k === 'string' && k.length > 0) ? [{ viewId: g.viewId, keys: g.keys as string[] }] : []));
}

/** `grains[i]` — a view and the group keys its marks stand for. */
function validateGrains(raw: unknown, actors: unknown, problems: string[]): void {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) {
    problems.push('grains, if present, must be an array of { viewId, keys }');
    return;
  }
  const seen = new Set<string>();
  raw.forEach((g, i) => {
    const where = `grains[${i}]`;
    if (!isObject(g)) {
      problems.push(`${where} must be an object { viewId, keys }`);
      return;
    }
    for (const key of Object.keys(g)) if (key !== 'viewId' && key !== 'keys') problems.push(`${where}.${key} is not a grain key`);
    if (typeof g.viewId !== 'string' || g.viewId.length === 0) problems.push(`${where}.viewId must be a non-empty string`);
    else if (!isObject(actors) || !(g.viewId in actors)) problems.push(`${where}.viewId "${g.viewId}" is not a declared view`);
    else if (seen.has(g.viewId)) problems.push(`${where} repeats the grain of "${g.viewId}" — one grain per view`);
    else seen.add(g.viewId);
    if (!Array.isArray(g.keys) || g.keys.some((k) => typeof k !== 'string' || k.length === 0)) problems.push(`${where}.keys must be an array of column names ([] = one mark per row)`);
    else if (new Set(g.keys).size !== g.keys.length) problems.push(`${where}.keys repeats a column`);
  });
}

/** `data[t].source` — three tags and a locator; the laws each carrier adds are the adapter's, at open. */
function validateSourceDecl(raw: unknown, where: string, problems: string[]): void {
  if (!isObject(raw)) {
    problems.push(`${where} must be an object { format, via, at?, options? }`);
    return;
  }
  for (const key of Object.keys(raw)) if (!['format', 'via', 'at', 'options'].includes(key)) problems.push(`${where}.${key} is not a source key`);
  if (!(SOURCE_FORMATS as readonly unknown[]).includes(raw.format)) problems.push(`${where}.format must be one of ${SOURCE_FORMATS.join('|')}`);
  if (!(SOURCE_VIAS as readonly unknown[]).includes(raw.via)) problems.push(`${where}.via must be one of ${SOURCE_VIAS.join('|')}`);
  if (raw.via === 'inline' && raw.at === undefined) problems.push(`${where}.at must carry the payload when via is inline`);
  if ((raw.via === 'file' || raw.via === 'http') && (typeof raw.at !== 'string' || raw.at.length === 0)) problems.push(`${where}.at must be a path or URL string when via is ${String(raw.via)}`);
  if (raw.options !== undefined && !isObject(raw.options)) problems.push(`${where}.options, if present, must be an object`);
}

/**
 * The absence fields a well-formed `absence` names, for the column-declaration
 * check. Plural since silence belongs to a COLUMN: a list declaration has one
 * state column per entry, and each of them owes its role `absence`. A malformed
 * entry contributes nothing (it is already refused).
 */
function absenceFieldsOf(src: Record<string, unknown>): readonly string[] {
  return wellFormedEntriesOf(src.absence).map((entry) => entry.field);
}

/** The `carries` list of a well-formed vocabulary — the states that hold a number anyway; absent when malformed, which is already a problem of its own. */
function carriesOf(a: Record<string, unknown>): { readonly carries?: readonly string[] } {
  const c = a.carries;
  return Array.isArray(c) && c.every((x) => typeof x === 'string') ? { carries: c as readonly string[] } : {};
}

/** The `governs` list of a well-formed entry — the value columns it speaks for; absent when malformed or unstated ("every other column"). */
function governsOf(a: Record<string, unknown>): { readonly governs?: readonly string[] } {
  const g = a.governs;
  return Array.isArray(g) && g.every((x) => typeof x === 'string') ? { governs: g as readonly string[] } : {};
}

/** The `arithmetic` word of a well-formed entry — carried only when it is one of the two words (a third is already a problem). */
function arithmeticOf(a: Record<string, unknown>): { readonly arithmetic?: 'present-only' | 'carried' } {
  const w = a.arithmetic;
  return w === 'present-only' || w === 'carried' ? { arithmetic: w } : {};
}

/**
 * A well-formed anchor word — the definition's own `present` or `unknown` — as
 * a non-empty string, or undefined when it is unstated OR malformed (malformed
 * is already a problem of its own, and the port then falls back to the default).
 */
function anchorWordOf(a: Record<string, unknown>, key: 'present' | 'unknown'): string | undefined {
  const w = a[key];
  return typeof w === 'string' && w.length > 0 ? w : undefined;
}

/** The two anchor keys of a well-formed entry — carried only when the definition named them (the adapter defaults the rest). */
function anchorsOf(a: Record<string, unknown>): { readonly present?: string; readonly unknown?: string } {
  const present = anchorWordOf(a, 'present');
  const unknown = anchorWordOf(a, 'unknown');
  return { ...(present === undefined ? {} : { present }), ...(unknown === undefined ? {} : { unknown }) };
}

/** One entry as a declaration, or undefined when it is malformed (already a problem of its own). */
function wellFormedEntryOf(a: unknown): AbsenceDecl | undefined {
  if (!isObject(a) || typeof a.field !== 'string' || !Array.isArray(a.states) || !a.states.every((x) => typeof x === 'string')) return undefined;
  return { field: a.field, states: a.states as string[], ...anchorsOf(a), ...carriesOf(a), ...governsOf(a), ...arithmeticOf(a) };
}

/**
 * Every well-formed entry of an `absence` declaration, bare or a list — the
 * shape the port's adapter takes (`../data/silence.ts` · `silenceOfDecl`), so
 * this door and every reader beneath it read one declaration one way.
 */
function wellFormedEntriesOf(a: unknown): readonly AbsenceDecl[] {
  const raw = Array.isArray(a) ? (a as readonly unknown[]) : a === undefined ? [] : [a];
  return raw.map(wellFormedEntryOf).filter((entry): entry is AbsenceDecl => entry !== undefined);
}

/** The `{ columns, absence }` a facet resolver may read — only the well-formed parts (a malformed part is already a problem). */
function facetSourceOf(src: Record<string, unknown> | undefined): FacetSource {
  if (src === undefined) return {};
  const absence = wellFormedEntriesOf(src.absence);
  const columns = isObject(src.columns) && Object.values(src.columns).every(isObject) ? (src.columns as FacetSource['columns']) : undefined;
  return { ...(absence.length > 0 ? { absence } : {}), ...(columns !== undefined ? { columns } : {}) };
}

/**
 * A table that CONTRADICTS ITSELF is refused here, once: a row its absence
 * column calls silent whose declared MEASURE holds a number
 * (`../data/absenceContradiction.ts`). Only inline rows can be judged at this
 * door — a CSV or a source is read at build — and only declared measures are
 * values; a table declaring neither an absence vocabulary nor a measure says
 * nothing this check can hold it to.
 */
function judgeAbsenceKept(rows: readonly unknown[], source: FacetSource, where: string, problems: string[]): void {
  if (source.absence === undefined) return;
  const measures = Object.entries(source.columns ?? {}).filter(([, decl]) => decl.role === 'measure').map(([name]) => name);
  if (measures.length === 0) return;
  // The reading, not the declaration: each measure is judged against the entry that governs IT, so a
  // table whose radius is silent while its mass is present is no longer refused for holding both.
  const refusal = absenceContradictionOf(rows, silenceOfDecl(source.absence), measures, where);
  if (refusal !== undefined) problems.push(refusal);
}

/** The columns the def alone knows about — declared ones, the absence column, and every initially bound field — all of type `unknown` (types are the provider's). */
function defColumns(src: Record<string, unknown> | undefined, surfaces: readonly { surface: EncodingSurface }[]): ColumnInfo[] {
  const names = new Set<string>();
  const source = facetSourceOf(src);
  for (const name of Object.keys(source.columns ?? {})) names.add(name);
  for (const field of silenceOfDecl(source.absence ?? []).stateColumns) names.add(field);
  for (const { surface } of surfaces) for (const field of Object.values(surface.initial ?? {})) names.add(field);
  return [...names].map((name) => ({ name, type: 'unknown' }));
}

/** The encoding entries that passed the structural checks above, with their index in `def.encodings` (a malformed entry is already a problem and is not judged). */
function wellFormedSurfaces(raw: readonly unknown[]): { readonly surface: EncodingSurface; readonly index: number }[] {
  const out: { surface: EncodingSurface; index: number }[] = [];
  raw.forEach((enc, index) => {
    if (!isObject(enc)) return;
    if (typeof enc.viewId !== 'string' || enc.viewId.length === 0 || typeof enc.chartKind !== 'string') return;
    if (!Array.isArray(enc.channels) || !enc.channels.every((c) => typeof c === 'string' && c.length > 0)) return;
    if (enc.initial !== undefined && (!isObject(enc.initial) || Object.values(enc.initial).some((v) => typeof v !== 'string'))) return;
    const surface: EncodingSurface = { viewId: enc.viewId, chartKind: enc.chartKind, channels: enc.channels as string[], ...(enc.initial !== undefined ? { initial: enc.initial as Record<string, string> } : {}) };
    out.push({ surface, index });
  });
  return out;
}

const INTENT_CLASSES = new Set(['mandatory-analytical', 'optional-interaction']);
const VERBS = new Set<string>(DISPATCH_VERBS);

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isFn(v: unknown): v is (...args: never[]) => unknown {
  return typeof v === 'function';
}

/** True iff a value looks like an already-built `AnalysisModule` (has a `run` function). */
function isAnalysisModule(v: unknown): boolean {
  return isObject(v) && isFn(v.run) && typeof v.id === 'string' && typeof v.kind === 'string';
}

/**
 * Validate a `SeriesGrain` — the STATED source metadata (never inferred). Pure
 * inert data: strings echoed verbatim, one non-negative count, nothing
 * executable and no unknown keys.
 */
function validateGrain(grain: unknown, where: string, problems: string[]): void {
  if (!isObject(grain)) {
    problems.push(`${where}, if present, must be an object { bucket?, reducer?, collapsedFrom?, note? }`);
    return;
  }
  for (const key of Object.keys(grain)) {
    if (!GRAIN_KEYS.has(key)) problems.push(`${where}: unknown key "${key}"`);
  }
  for (const key of GRAIN_STRING_KEYS) {
    if (grain[key] !== undefined && typeof grain[key] !== 'string') {
      problems.push(`${where}.${key}, if present, must be a string`);
    }
  }
  const collapsed = grain.collapsedFrom;
  if (collapsed !== undefined && (typeof collapsed !== 'number' || !Number.isFinite(collapsed) || collapsed < 0)) {
    problems.push(`${where}.collapsedFrom, if present, must be a non-negative finite number`);
  }
}

/**
 * Validate a table's `absence` — one entry, or a LIST of them when silence
 * belongs to a column rather than to the row.
 *
 * A bare object means exactly what it always meant, and every sentence it can
 * earn is byte-identical. A list is the shape the exoplanet demo needed: three
 * value columns, three state columns, three entries, each naming the columns it
 * `governs`. The list's own rules are all one rule — **one column, one owner** —
 * because a column whose silence has two answers has none.
 */
function validateAbsence(absence: unknown, where: string, problems: string[], fields: Set<string>, declared: ReadonlySet<string> | undefined): void {
  if (Array.isArray(absence)) {
    if (absence.length === 0) {
      problems.push(`${where}, if it is a list, must declare at least one entry — an empty list is a table saying it has an absence vocabulary and then naming none`);
      return;
    }
    absence.forEach((entry, at) => validateAbsenceEntry(entry, `${where}[${at}]`, problems, fields, declared, true));
    judgeGovernedOnce(absence, where, problems);
    judgeGovernsNoStateColumn(absence, where, problems);
    return;
  }
  validateAbsenceEntry(absence, where, problems, fields, declared, false);
}

/** The keys an absence entry may carry — the five of packet J and the two anchor words. */
const ABSENCE_KEYS: ReadonlySet<string> = new Set(['field', 'states', 'present', 'unknown', 'carries', 'governs', 'arithmetic']);

/**
 * The definition's two anchor words, resolved — its own when it named them,
 * the library's defaults when it did not. Every check below that reads an
 * anchor reads THESE, never the constants, so a definition whose word for
 * "reported" is `final` is judged in its own word.
 */
interface AnchorWords {
  readonly present: string;
  readonly unknown: string;
}

/**
 * Validate `AbsenceDecl.present` / `AbsenceDecl.unknown` — the definition's
 * own words for "reported" and "could not tell" — and answer the words the
 * rest of the entry is judged in.
 *
 * Each, if declared, must be a non-empty string; a malformed one is refused and
 * the default stands in for it so the remaining checks still have a word to
 * read. The two may not be ONE word: a row that reported its value and a
 * silence the source could not tell apart cannot share a name, or `carries`
 * and the arithmetic would be reading two laws off one cell.
 */
function validateAnchors(absence: Record<string, unknown>, where: string, problems: string[]): AnchorWords {
  const wordOf = (key: 'present' | 'unknown', fallback: string, meaning: string): string => {
    const w = absence[key];
    if (w === undefined) return fallback;
    if (typeof w === 'string' && w.length > 0) return w;
    problems.push(`${where}.${key}, if declared, must be a non-empty string — this definition's own word for ${meaning} ("${fallback}" when unstated)`);
    return fallback;
  };
  const present = wordOf('present', ABSENCE_PRESENT, 'a row that reported a value');
  const unknown = wordOf('unknown', ABSENCE_UNKNOWN, 'a silence the source could not tell apart');
  if (present === unknown) {
    problems.push(
      `${where}.present and ${where}.unknown may not be the same word ("${present}") — a row that reported a value and a silence the source could not tell apart cannot share one`,
    );
  }
  return { present, unknown };
}

/**
 * Validate ONE `AbsenceDecl` — the STATED absence vocabulary of one set of
 * columns (never inferred). Inert data: a column name and a list of words,
 * echoed verbatim. The one semantic rule: the vocabulary MUST include its word
 * for `unknown`, because a source that cannot tell "feature off" from
 * "collector failed" needs a word for that, or it is forced to lie with one of
 * the others. The vocabulary is the definition's, both anchors included: the
 * words read here are the definition's own (`validateAnchors`), and every
 * sentence quotes them. Collects the declared field into `fields` so the
 * encodings pass can refuse binding it to a numeric channel.
 */
function validateAbsenceEntry(absence: unknown, where: string, problems: string[], fields: Set<string>, declared: ReadonlySet<string> | undefined, inList: boolean): void {
  if (!isObject(absence)) {
    problems.push(`${where}, if present, must be an object { field, states }`);
    return;
  }
  for (const key of Object.keys(absence)) {
    if (!ABSENCE_KEYS.has(key)) problems.push(`${where}: unknown key "${key}"`);
  }
  const field = typeof absence.field === 'string' && absence.field.length > 0 ? absence.field : undefined;
  if (field === undefined) {
    problems.push(`${where}.field must be a non-empty string (the column that carries the state)`);
  } else {
    fields.add(field);
  }
  const anchors = validateAnchors(absence, where, problems);
  validateGoverns(absence.governs, field, where, problems, declared, inList);
  validateArithmetic(absence.arithmetic, anchors, where, problems);
  const states = absence.states;
  if (!Array.isArray(states) || states.length === 0 || states.some((st) => typeof st !== 'string' || st.length === 0)) {
    problems.push(`${where}.states must be a non-empty array of non-empty strings`);
    return;
  }
  if (new Set(states).size !== states.length) problems.push(`${where}.states must not repeat a state`);
  // WHY: the derived-column arithmetic reads this one word to know a row reported a value; a vocabulary without it blanks every cell
  if (!states.includes(anchors.present)) {
    problems.push(
      `${where}.states must include "${anchors.present}" — the word a row uses to say the source reported a value; without it every cell of this table reads as absent`,
    );
  }
  if (!states.includes(anchors.unknown)) {
    problems.push(
      `${where}.states must include "${anchors.unknown}" — a source that cannot tell which silence it saw needs a word for that`,
    );
  }
  validateCarries(absence.carries, states as readonly string[], anchors, where, problems);
}

/**
 * Validate `AbsenceDecl.governs` — the value columns this state column speaks
 * for.
 *
 * Unstated it means "every OTHER column of the table", which is what a bare
 * declaration has always meant; in a LIST it must be stated, because two
 * entries each speaking for every other column are two answers to one
 * question and this door does not pick between them. A named column must be
 * one the table DECLARES (when it declares any), or a typo would quietly
 * govern nothing, and it may never be the entry's own state column — that
 * column speaks for itself, which is what keeps `eq(radius_state, …)` honest
 * on the very row whose radius reads as absent.
 */
function validateGoverns(governs: unknown, field: string | undefined, where: string, problems: string[], declared: ReadonlySet<string> | undefined, inList: boolean): void {
  if (governs === undefined) {
    if (inList) {
      problems.push(
        `${where}.governs must name the value columns this state column speaks for — in a list every entry names its own, because two entries each speaking for "every other column" are two answers to one question`,
      );
    }
    return;
  }
  if (!Array.isArray(governs) || governs.length === 0 || governs.some((c) => typeof c !== 'string' || c.length === 0)) {
    problems.push(`${where}.governs, if present, must be a non-empty array of non-empty strings (the value columns this state column speaks for)`);
    return;
  }
  for (const column of governs as readonly string[]) {
    if (column === field) {
      problems.push(`${where}.governs may not name "${column}" — that is this entry's own state column, and a state column speaks for itself`);
    } else if (declared !== undefined && !declared.has(column)) {
      problems.push(`${where}.governs names "${column}", which this table does not declare in columns — a state column can only speak for a column the table declares`);
    }
  }
}

/** Validate `AbsenceDecl.arithmetic` — the two words of `../data/silence.ts`, and no third. The sentence quotes the definition's `present` word, since that is what `present-only` reads. */
function validateArithmetic(arithmetic: unknown, anchors: AnchorWords, where: string, problems: string[]): void {
  if (arithmetic === undefined) return;
  if (!(SILENCE_ARITHMETICS as readonly unknown[]).includes(arithmetic)) {
    problems.push(
      `${where}.arithmetic, if present, must be one of ${SILENCE_ARITHMETICS.join('|')} — "present-only" reads exactly "${anchors.present}" (the default, and every total this library has computed), "carried" also reads the states named in carries`,
    );
  }
}

/**
 * ONE COLUMN, ONE OWNER: no two entries may govern the same column.
 *
 * A column governed twice has two answers to "was this reported?", and a reader
 * that picked the first would be picking silently. Refused here so that
 * `../data/silence.ts`'s first-namer-wins totality rule is never a policy
 * anybody can reach.
 */
function judgeGovernedOnce(entries: readonly unknown[], where: string, problems: string[]): void {
  const owner = new Map<string, { readonly at: number; readonly field: string }>();
  entries.forEach((entry, at) => {
    if (!isObject(entry) || typeof entry.field !== 'string' || !Array.isArray(entry.governs)) return;
    for (const column of entry.governs as readonly unknown[]) {
      if (typeof column !== 'string' || column.length === 0) continue;
      const first = owner.get(column);
      if (first === undefined) owner.set(column, { at, field: entry.field });
      else if (first.at !== at) {
        problems.push(
          `${where}: "${column}" is governed by both entry ${String(first.at)} ("${first.field}") and entry ${String(at)} ("${entry.field}") — one column, one owner: a column whose silence has two answers has none`,
        );
      }
    }
  });
}

/**
 * A STATE COLUMN SPEAKS FOR ITSELF, always: no entry — not even a DIFFERENT
 * one — may name another entry's state column in `governs`.
 *
 * `../data/silence.ts` · `silenceOfDecl`'s `silenceFor` checks a column against
 * every entry's `field` before it ever looks in a `governs` list (a state
 * column is never governed, not even by another entry that names it — see its
 * own WHY comment). Without this refusal a `governs` naming a sibling's state
 * column would validate cleanly, land in `TableSilence.governed` (the door's
 * own listing of what was NAMED), and then be silently ignored by every
 * reader that asks `silenceFor` — a declaration that looks like it does
 * something and does nothing. `validateGoverns` alone cannot catch this: it
 * judges one entry against its OWN field, not against its siblings'.
 */
function judgeGovernsNoStateColumn(entries: readonly unknown[], where: string, problems: string[]): void {
  const stateFields = new Set(entries.filter((entry): entry is Record<string, unknown> => isObject(entry) && typeof entry.field === 'string').map((entry) => entry.field as string));
  entries.forEach((entry, at) => {
    if (!isObject(entry) || typeof entry.field !== 'string' || !Array.isArray(entry.governs)) return;
    for (const column of entry.governs as readonly unknown[]) {
      // Naming its OWN field is `validateGoverns`'s sentence already — only a SIBLING's state column is new here.
      if (typeof column === 'string' && column !== entry.field && stateFields.has(column)) {
        problems.push(`${where}[${String(at)}].governs may not name "${column}" — that is another entry's state column, and a state column speaks for itself, so this entry's claim on it is silently ignored`);
      }
    }
  });
}

/**
 * Validate `AbsenceDecl.carries` — which of the declared states hold a number
 * ANYWAY, so that the contradiction check (`../data/absenceContradiction.ts`)
 * does not refuse an honest row: an estimated figure is a figure. Three rules,
 * and each of them is the vocabulary's own honesty: a state that carries a
 * value must be a word this table DECLARES (a word nobody declared would
 * silence-proof a column by a typo); it may not be the definition's `present`
 * word, which is not a silence to begin with; and it may never be its `unknown`
 * word, the word for a silence the source could not tell apart — a source that
 * could not tell which silence it saw cannot also have carried the value. Both
 * anchors are the definition's own (`validateAnchors`), and the sentences quote them.
 */
function validateCarries(carries: unknown, states: readonly string[], anchors: AnchorWords, where: string, problems: string[]): void {
  if (carries === undefined) return;
  if (!Array.isArray(carries) || carries.length === 0 || carries.some((st) => typeof st !== 'string' || st.length === 0)) {
    problems.push(`${where}.carries, if present, must be a non-empty array of non-empty strings (which of the states carry a value)`);
    return;
  }
  for (const state of carries as readonly string[]) {
    if (state === anchors.present) {
      problems.push(`${where}.carries may not name "${anchors.present}" — that is the word for a row that reported its value, not for a silence that carries one`);
    } else if (state === anchors.unknown) {
      problems.push(`${where}.carries may not name "${anchors.unknown}" — a source that could not tell which silence it saw did not carry the value either`);
    } else if (!states.includes(state)) {
      problems.push(`${where}.carries names "${state}", which is not one of this table's states — a state that carries a value must be a word the vocabulary declares`);
    }
  }
}

function validateActorMeta(meta: unknown, where: string, problems: string[]): void {
  if (!isObject(meta)) {
    problems.push(`${where} must be an object { actor, label?, does? }`);
    return;
  }
  if (typeof meta.actor !== 'string' || !ACTORS.has(meta.actor)) {
    problems.push(`${where}.actor must be one of user|agent|system`);
  }
  if (meta.label !== undefined && typeof meta.label !== 'string') {
    problems.push(`${where}.label, if present, must be a string`);
  }
  if (meta.does !== undefined && (typeof meta.does !== 'string' || meta.does.trim().length === 0)) {
    problems.push(`${where}.does, if present, must be a sentence: what acting on the view does`);
  }
}

/**
 * Validate a def's declarative shape. Returns the (possibly empty) list of
 * problems — the caller (`buildDashboard`) throws {@link DashboardDefError} when
 * it is non-empty.
 */
export function validateDashboardDef(def: unknown): string[] {
  // Absence columns declared by any table — the encodings pass refuses them on numeric channels.
  const absenceFields = new Set<string>();
  const problems: string[] = [];
  if (!isObject(def)) return ['def must be a plain object'];

  for (const key of Object.keys(def)) {
    if (!DEF_KEYS.has(key)) problems.push(`unknown key "${key}"`);
  }

  // ── data (required) ──
  if (!isObject(def.data)) {
    problems.push('data must be an object mapping table name -> { rows | csv | source }');
  } else if (Object.keys(def.data).length === 0) {
    problems.push('data must declare at least one table');
  } else {
    for (const [table, src] of Object.entries(def.data)) {
      // a reserved marker: a layer address `viewId~layerId` names the layer's table through the split, so no table may wear it
      if (holdsLayerMarker(table)) problems.push(`data["${table}"]: ${markerRefusal('a table name', table)}`);
      if (!isObject(src)) {
        problems.push(`data["${table}"] must be an object { rows | csv, engine? }`);
        continue;
      }
      const hasRows = src.rows !== undefined;
      const hasCsv = src.csv !== undefined;
      const hasSource = src.source !== undefined;
      if ([hasRows, hasCsv, hasSource].filter(Boolean).length > 1) problems.push(`data["${table}"] must set only one of rows, csv, source`);
      if (!hasRows && !hasCsv && !hasSource) problems.push(`data["${table}"] must set rows, csv, or source`);
      if (hasSource) {
        validateSourceDecl(src.source, `data["${table}"].source`, problems);
        // THE RULING (./README.md, "A source table and the wasm engine"): a source's
        // bytes have to land in an engine that can RECEIVE them, and two can —
        // `memory` materialises them in this process, `wasm` lands them in the SQL
        // backend (an await, so `buildDashboardAsync` only). `server` cannot be
        // handed bytes at all, and `auto` would route real fetched rows on an
        // unmeasured threshold; both are refused here rather than left to fetch
        // bytes that nothing loads.
        if (src.engine !== undefined && src.engine !== 'memory' && src.engine !== 'wasm') {
          problems.push(`data["${table}"] sets engine "${String(src.engine)}" with a source; a source's rows are loaded into the engine that reads them, so a source table declares "memory" (materialised in this process) or "wasm" (landed in the SQL backend by buildDashboardAsync) — or no engine at all`);
        }
      }
      if (src.key !== undefined) {
        if (typeof src.key !== 'string' || src.key.length === 0) problems.push(`data["${table}"].key must be a column name`);
        // WHY: own keys only — `in` would let "toString" or "constructor" through the door as a declared column
        else if (isObject(src.columns) && !Object.prototype.hasOwnProperty.call(src.columns, src.key)) problems.push(`data["${table}"].key "${src.key}" is not a declared column`);
      }
      if (hasRows && !Array.isArray(src.rows)) problems.push(`data["${table}"].rows must be an array`);
      if (hasCsv && typeof src.csv !== 'string') problems.push(`data["${table}"].csv must be a string`);
      if (src.engine !== undefined && !ENGINES.has(src.engine as string)) {
        problems.push(`data["${table}"].engine must be one of memory|wasm|server|auto`);
      }
      if (src.layout !== undefined && src.layout !== 'row' && src.layout !== 'column') {
        problems.push(`data["${table}"].layout, if present, must be "row" | "column"`);
      }
      if (src.grain !== undefined) validateGrain(src.grain, `data["${table}"].grain`, problems);
      // The declared column names, when the table declares any — a `governs` entry may only name one of them.
      const declaredColumns = isObject(src.columns) ? new Set(Object.keys(src.columns)) : undefined;
      if (src.absence !== undefined) validateAbsence(src.absence, `data["${table}"].absence`, problems, absenceFields, declaredColumns);
      if (src.columns !== undefined) validateColumnDecls(src.columns, `data["${table}"].columns`, problems, absenceFieldsOf(src));
      if (Array.isArray(src.rows)) judgeAbsenceKept(src.rows, facetSourceOf(src), `data["${table}"]`, problems);
    }
  }

  // ── actors (required) — the ONE place a view identity is declared ──
  if (!isObject(def.actors)) {
    problems.push('actors must be an object mapping viewId -> { actor, label? }');
  } else {
    for (const [viewId, meta] of Object.entries(def.actors)) {
      // the prose plane's one non-view subject: a view named exactly `dashboard` would collide with the cockpit's own words
      if (viewId === DASHBOARD_PROSE_ID) {
        problems.push(`actors["${viewId}"]: "${DASHBOARD_PROSE_ID}" is the prose plane's name for the cockpit itself (describe with viewId "dashboard" sets the dashboard's own words) — a view may not take it`);
        continue;
      }
      // a reserved marker: `viewId~layerId` splits at the first one, so a view id wearing it would be read as a layer of another view
      if (holdsLayerMarker(viewId)) problems.push(`actors["${viewId}"]: ${markerRefusal('a view id', viewId)}`);
      const reserved = reservedPrefix(viewId);
      if (reserved !== undefined) {
        problems.push(
          `actors["${viewId}"]: a view id may not start with "${reserved}" — the session lands its own commits under that namespace, so a view there would be inert in the fold and silently skipped when a path is adopted`,
        );
      }
      validateActorMeta(meta, `actors["${viewId}"]`, problems);
    }
  }

  // ── analyses (optional) ──
  if (def.analyses !== undefined) {
    if (!isObject(def.analyses)) {
      problems.push('analyses, if present, must be an object mapping id -> AnalysisDef | AnalysisModule | a builtin record { builtin, ...options }');
    } else {
      for (const [id, slot] of Object.entries(def.analyses)) {
        // The KEY first, before any slot is looked at. An analysis id is the
        // name a person will look for in `why`, in the FDR ledger and in a
        // citation, and the empty string is not a name — for a module, a raw
        // def or a builtin record alike, so one sentence covers all three (and
        // the registry's key-as-id injection never sees an empty key).
        if (id.length === 0) {
          problems.push('analyses[""]: an analysis id must be a non-empty string');
          continue;
        }
        // Three forms, discriminated on shape: `run` is a module, `builtin` is
        // a record, `build` is a def — and anything else falls to L3's own
        // refusal, which names every missing piece.
        if (isAnalysisModule(slot)) continue; // built by defineAnalysis already — trusted
        if (isBuiltinRecord(slot)) {
          validateBuiltinAnalysis(slot, `analyses["${id}"]`, problems);
          continue;
        }
        const sub = validateAnalysisDef(slot);
        for (const p of sub) problems.push(`analyses["${id}"]: ${p}`);
      }
    }
  }

  // ── capabilities (optional) ──
  if (def.capabilities !== undefined) {
    if (!Array.isArray(def.capabilities)) {
      problems.push('capabilities, if present, must be an array of CapabilityDecl');
    } else {
      def.capabilities.forEach((cap, i) => {
        if (!isObject(cap)) {
          problems.push(`capabilities[${i}] must be an object`);
          return;
        }
        if (typeof cap.viewId !== 'string' || cap.viewId.length === 0) {
          problems.push(`capabilities[${i}].viewId must be a non-empty string`);
        }
        if (typeof cap.canProbe !== 'boolean') {
          problems.push(`capabilities[${i}].canProbe must be a boolean`);
        }
        if (cap.encodings !== undefined) {
          if (!Array.isArray(cap.encodings) || cap.encodings.some((e) => !ENCODINGS.has(e as string))) {
            problems.push(`capabilities[${i}].encodings must be an array of ${ENCODING_WORDS}`);
          }
        }
        if (cap.fields !== undefined && (!Array.isArray(cap.fields) || cap.fields.some((f) => typeof f !== 'string'))) {
          problems.push(`capabilities[${i}].fields must be an array of strings`);
        }
      });
    }
  }

  // The table a LAYERLESS view's columns are declared under — the def's `defaultTable`, or its first table. ONE
  // expression, read by the link graph's reach law below, by the frame's laws, and by the build door, so no two
  // of them can resolve it apart.
  const defaultTableName = isObject(def.data) ? (typeof def.defaultTable === 'string' ? def.defaultTable : Object.keys(def.data)[0]) : undefined;

  // ── links (optional) — layer 4: the edges between views, refused at declaration in sentences ──
  if (isObject(def.actors)) {
    const capabilityByView = new Map<string, { canProbe: boolean; encodings?: readonly EmissionKind[] }>();
    if (Array.isArray(def.capabilities)) {
      for (const cap of def.capabilities) {
        if (isObject(cap) && typeof cap.viewId === 'string' && typeof cap.canProbe === 'boolean') {
          const encodings = Array.isArray(cap.encodings) && cap.encodings.every((e) => ENCODINGS.has(e as string)) ? (cap.encodings as EmissionKind[]) : undefined;
          capabilityByView.set(cap.viewId, { canProbe: cap.canProbe, ...(encodings !== undefined ? { encodings } : {}) });
        }
      }
    }
    validateGrains(def.grains, def.actors, problems);
    // a view's encoding surface gives it the `encoding` voice and tells an encoding edge which channels exist
    const surfaceByView = new Map(Array.isArray(def.encodings) ? wellFormedSurfaces(def.encodings).map((s) => [s.surface.viewId, s.surface] as const) : []);
    const grainByView = new Map(wellFormedGrains(def.grains).map((g) => [g.viewId, g.keys] as const));
    const linkViews = Object.keys(def.actors).map((viewId) => {
      const surface = surfaceByView.get(viewId);
      const grain = grainByView.get(viewId);
      // the TABLE the node draws — a layerless view draws the default one, resolved by the ONE expression
      // `defaultTableName` below, so the door and the build door judge reach against the same rows
      return { viewId, voice: voiceOf(capabilityByView.get(viewId), { hasEncodingSurface: surface !== undefined }), ...(defaultTableName !== undefined ? { table: defaultTableName } : {}), ...(surface !== undefined ? { channels: surface.channels } : {}), ...(grain !== undefined ? { grain } : {}) };
    });
    // a layer is a node of the graph under its address, so a declared edge may name one (src/def/layers.ts)
    const layerViews = Array.isArray(def.encodings) ? layerLinkViewsOf(def.encodings, (viewId) => linkViews.find((v) => v.viewId === viewId)?.voice) : [];
    // the reach law's evidence, read off the def ONCE by the owner both doors share (./tableReach.ts)
    validateLinks(def.links, def.linkDefault, [...linkViews, ...layerViews], problems, tableReachOf(def));
  }

  // ── relations (optional) — the edges between TABLES: a column pointing at another table's key (src/def/relations.ts) ──
  // WHY: judged only against a well-formed, non-empty table map — a malformed or empty `data` was refused above, and every table sentence would otherwise name no tables
  if (isObject(def.data) && Object.keys(def.data).length > 0) validateRelations(def.relations, def.data, problems);

  // ── encodings (optional) — the `reencode` verb's per-view validation surface ──
  // The tables the declared ACTS land — read ONCE, off the declaration, and handed to every door below that
  // judges a table name or a field against a table's columns, so the two can never disagree (./README.md,
  // "Layers", law 2). An aggregate declares the table it lands and its whole column list; nothing new is declared.
  const minted = mintedTables(def);
  if (def.encodings !== undefined) {
    if (!Array.isArray(def.encodings)) {
      problems.push('encodings, if present, must be an array of ViewEncodingDecl');
    } else {
      def.encodings.forEach((enc, i) => {
        if (!isObject(enc)) {
          problems.push(`encodings[${i}] must be an object`);
          return;
        }
        if (typeof enc.viewId !== 'string' || enc.viewId.length === 0) {
          problems.push(`encodings[${i}].viewId must be a non-empty string`);
        }
        if (typeof enc.chartKind !== 'string' || enc.chartKind.length === 0) {
          problems.push(`encodings[${i}].chartKind must be a non-empty string`);
        }
        if (
          !Array.isArray(enc.channels) ||
          enc.channels.length === 0 ||
          enc.channels.some((c) => typeof c !== 'string' || c.length === 0)
        ) {
          problems.push(`encodings[${i}].channels must be a non-empty array of non-empty strings`);
        } else if (enc.channels.includes(ENCODING_SET_FIELD)) {
          // the marker a binding-set commit carries in `field` — a real channel may never wear it
          problems.push(`encodings[${i}].channels may not name "${ENCODING_SET_FIELD}" — it is reserved for a binding set`);
        }
        if (enc.initial !== undefined && (!isObject(enc.initial) || Object.values(enc.initial).some((v) => typeof v !== 'string'))) {
          problems.push(`encodings[${i}].initial, if present, must be an object mapping channel -> field (strings)`);
        }
        // layers — a view over more than one table (src/def/layers.ts); absent on every view built before layers existed
        const encViewId = typeof enc.viewId === 'string' ? enc.viewId : String(enc.viewId);
        validateLayers(enc.layers, `encodings[${i}]`, encViewId, def.data, problems, minted);
        // the frame — per channel, how its scale is resolved across those layers AND what the axis itself is
        // (src/def/layers.ts, "the frame"): legal on ANY view, since a transform is not a resolution. A view with
        // no layers is judged as its own one implicit layer, which is what this last argument carries.
        validateFrame(enc.frame, `encodings[${i}]`, encViewId, enc.layers, def.data, { chartKind: enc.chartKind, channels: enc.channels, initial: enc.initial, table: defaultTableName }, problems, minted);
      });
    }
  }

  // ── prose (optional): the prose plane — every slot a record; the laws judged with what the def alone knows (declared analyses; columns are the provider's) ──
  if (def.prose !== undefined && isObject(def.actors)) {
    const surfaced = new Set(Array.isArray(def.encodings) ? wellFormedSurfaces(def.encodings).map((s) => s.surface.viewId) : []);
    validateProseDecls(def.prose, new Set(Object.keys(def.actors)), problems, { analyses: new Set(Object.keys(isObject(def.analyses) ? def.analyses : {})), surfaced });
  }

  // ── encodingRules (optional): the encoding plane's rule set — shape here, meaning just below ──
  const ruleShapeProblems: string[] = [];
  if (def.encodingRules !== undefined) validateEncodingRulesShape(def.encodingRules, 'encodingRules', ruleShapeProblems);
  problems.push(...ruleShapeProblems);

  // ── the BUILD door: every declared initial binding judged by the one
  //    validator (src/encoding), with what the def alone can prove — declared
  //    roles and scales, the absence column, the business rules. Column TYPES
  //    are the provider's: `dashboard.lint()` judges them with the data, and
  //    the dispatch door judges every act. Ports are not here, so an initial
  //    binding that would need a coercer is refused: a def never STARTS coerced.
  if (ruleShapeProblems.length === 0 && Array.isArray(def.encodings) && isObject(def.data)) {
    const table = defaultTableName;
    const src = table !== undefined && isObject(def.data[table]) ? (def.data[table] as Record<string, unknown>) : undefined;
    const surfaces = wellFormedSurfaces(def.encodings);
    const facets = resolveFacets(defColumns(src, surfaces), facetSourceOf(src));
    const indexOf = new Map(surfaces.map((s) => [s.surface.viewId, s.index] as const));
    const layerSurfaces = layerSurfacesOf(def.encodings, def.data, minted);
    // a `dashboard`-scope rule means ANYWHERE on the page: every view's bindings and every layer's, side by side, so
    // the boundary between a frame and its layers is not a hole a never-together pair can hide in (../def/README.md, "Layers", law 5)
    const page = pageBindings([...surfaces.map((s) => s.surface), ...layerSurfaces.map((l) => l.surface)]);
    for (const p of lintEncodings({ views: surfaces.map((s) => s.surface), facets, page, ...(def.encodingRules !== undefined ? { rules: def.encodingRules as EncodingRules } : {}) })) {
      problems.push(`encodings[${indexOf.get(p.viewId)}].initial.${p.channel}: ${p.sentence}`);
    }
    // ── the same door once per LAYER, against the layer's own table — never the default table.
    //    WHY one call per layer: the FACETS that judge a binding are its table's; the page-wide
    //    bindings above are what its dashboard-scope rules read, and they span every table.
    for (const { index, at, table: layerTable, surface, minted: lands } of layerSurfaces) {
      const layerSrc = isObject(def.data[layerTable]) ? (def.data[layerTable] as Record<string, unknown>) : undefined;
      // A MINTED table's columns ARE its act's declaration — `groupBy` in order, then the measures in
      // landing order — and that is the WHOLE list, so a field naming a column the act does not land is
      // refused right here. TYPED, too: the declaration already knows each one's type (`mintedTables`),
      // so a channel that needs a number meets a minted string AT THE DOOR instead of when the act runs.
      // A column the parent never declared stays `unknown`, which is exactly what `requirementFailure`
      // declines to judge — the same not-judged this door has always given it. What a minted column still
      // has no way to declare is FACETS: no role, no scale, no unit, because it has no `ColumnDecl`.
      // `dashboard.lint()` judges the landed table with its data.
      const layerFacets = lands !== undefined
        ? resolveFacets(lands.columns)
        : resolveFacets(defColumns(layerSrc, [{ surface }]), facetSourceOf(layerSrc));
      for (const p of lintEncodings({ views: [surface], facets: layerFacets, page, ...(def.encodingRules !== undefined ? { rules: def.encodingRules as EncodingRules } : {}) })) {
        problems.push(`encodings[${index}].layers[${at}].initial.${p.channel}: ${p.sentence}`);
      }
    }
  }

  // ── fdr (optional) ──
  if (def.fdr !== undefined) {
    if (!isObject(def.fdr)) {
      problems.push('fdr, if present, must be an object');
    } else {
      if (typeof def.fdr.procedure !== 'string' || !PROCEDURES.has(def.fdr.procedure)) {
        problems.push('fdr.procedure must be "LORD++" | "alpha-investing"');
      }
      if (typeof def.fdr.alpha !== 'number' || !(def.fdr.alpha > 0 && def.fdr.alpha < 1)) {
        problems.push('fdr.alpha must be a number in (0,1)');
      }
      if (def.fdr.w0 !== undefined && (typeof def.fdr.w0 !== 'number' || def.fdr.w0 < 0)) {
        problems.push('fdr.w0, if present, must be a non-negative number');
      }
      if (def.fdr.omega !== undefined && (typeof def.fdr.omega !== 'number' || def.fdr.omega < 0)) {
        problems.push('fdr.omega, if present, must be a non-negative number');
      }
      // gamma is a developer-authored sequence (like AnalysisDef.build) — a function, never a string.
      if (def.fdr.gamma !== undefined && !isFn(def.fdr.gamma)) {
        problems.push('fdr.gamma, if present, must be a function (a GammaSequence), never a string');
      }
    }
  }

  // ── agent.intents (optional) ──
  if (def.agent !== undefined) {
    if (!isObject(def.agent)) {
      problems.push('agent, if present, must be an object');
    } else if (def.agent.intents !== undefined) {
      if (!Array.isArray(def.agent.intents)) {
        problems.push('agent.intents must be an array of { verb, intent }');
      } else {
        def.agent.intents.forEach((decl, i) => {
          if (!isObject(decl)) {
            problems.push(`agent.intents[${i}] must be an object { verb, intent }`);
            return;
          }
          if (typeof decl.verb !== 'string' || !VERBS.has(decl.verb)) {
            problems.push(`agent.intents[${i}].verb must be one of ${[...VERBS].join('|')}`);
          }
          if (typeof decl.intent !== 'string' || !INTENT_CLASSES.has(decl.intent)) {
            problems.push(`agent.intents[${i}].intent must be "mandatory-analytical" | "optional-interaction"`);
          }
        });
      }
    }
  }

  // ── defaultTable (optional) — must name a DECLARED table, and deliberately not a minted one.
  //    WHY law 2 widened for a layer and not for this: `defaultTable` is the dashboard's GROUND — the
  //    providers, the sources, the row keys and `lint()` are all resolved through it at build, before any
  //    act can have landed, so a default table nobody carries is a dashboard with no floor. A view that
  //    wants a minted table names it where a table is named per view: on a LAYER (./layers.ts, law 2).
  if (def.defaultTable !== undefined) {
    if (typeof def.defaultTable !== 'string') {
      problems.push('defaultTable, if present, must be a string');
    } else if (isObject(def.data) && !(def.defaultTable in def.data)) {
      problems.push(`defaultTable "${def.defaultTable}" is not a declared data table`);
    }
  }

  return problems;
}

/** What the parse door answers: a typed def, or the sentences that refuse it. */
export type ParsedDashboardDef =
  | { readonly ok: true; readonly def: DashboardDef }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * `parseDashboardDef(value)` — the door that NARROWS. `validateDashboardDef`
 * already does the judging and returns the sentences, but it hands back a
 * `string[]` and leaves the caller holding an `unknown`; a caller that parsed
 * JSON then had to assert the type by hand, which is exactly the moment the
 * firewall stops meaning anything.
 *
 * This is that same judgement with the narrowing attached — it calls the
 * validator, it never restates it, so the two can never disagree.
 * `buildDashboard(JSON.parse(text))` remains the direct path; this is for a
 * caller that wants to HOLD a typed definition before building one (an
 * authoring wizard checking a draft, a server validating a posted def).
 */
export function parseDashboardDef(value: unknown): ParsedDashboardDef {
  const problems = validateDashboardDef(value);
  return problems.length === 0 ? { ok: true, def: value as DashboardDef } : { ok: false, problems };
}

/** The verbs, exported for tool-surface enumeration. */
export function dispatchVerbs(): readonly DispatchVerb[] {
  return DISPATCH_VERBS;
}
