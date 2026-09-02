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
import { validateLinks, voiceOf, type EmissionKind } from '../links/index.js';
import { ENCODING_SET_FIELD,
  ANALYSIS_VIEW_PREFIX,
  ANNOTATION_VIEW_PREFIX,
  CHART_VIEW_PREFIX,
  ENCODING_VIEW_PREFIX,
  LAYOUT_VIEW_PREFIX,
  BEAT_VIEW_PREFIX,
  LINK_VIEW_PREFIX,
  PROSE_VIEW_PREFIX,
} from '../branches/index.js';
import { ABSENCE_UNKNOWN, DISPATCH_VERBS, type DispatchVerb } from './types.js';
import { lintEncodings, resolveFacets, validateColumnDecls, validateEncodingRulesShape } from '../encoding/index.js';
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
const ENCODINGS = new Set(['point', 'interval', 'cell', 'match']);

/**
 * The synthetic-viewId namespaces the SESSION owns, single-sourced from
 * `src/branches/fold` (the one place the log wire is defined, so this list and
 * the fold can never drift). A host-declared view may NOT squat one: the session
 * lands its own `encoding:` / `analysis:` / `annotation:` / `chart:` / `layout:` / `beat:`
 * commits there, which are INERT in the fold by design (`keyOf` returns null),
 * so such a view's probes would be unfoldable, invisible to `compare`, and
 * silently skipped when a path is adopted. Rejected at the def boundary (R12)
 * rather than left to fail confusingly at runtime.
 */
const RESERVED_VIEW_PREFIXES = [
  ENCODING_VIEW_PREFIX,
  ANALYSIS_VIEW_PREFIX,
  ANNOTATION_VIEW_PREFIX,
  CHART_VIEW_PREFIX,
  LAYOUT_VIEW_PREFIX,
  BEAT_VIEW_PREFIX,
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

/** The absence field a well-formed `absence` names, for the column-declaration check; undefined when malformed (already refused). */
function absenceFieldOf(src: Record<string, unknown>): string | undefined {
  const a = src.absence;
  return isObject(a) && typeof a.field === 'string' ? a.field : undefined;
}

/** The `{ columns, absence }` a facet resolver may read — only the well-formed parts (a malformed part is already a problem). */
function facetSourceOf(src: Record<string, unknown> | undefined): FacetSource {
  if (src === undefined) return {};
  const a = src.absence;
  const absence = isObject(a) && typeof a.field === 'string' && Array.isArray(a.states) && a.states.every((x) => typeof x === 'string') ? { field: a.field, states: a.states as string[] } : undefined;
  const columns = isObject(src.columns) && Object.values(src.columns).every(isObject) ? (src.columns as FacetSource['columns']) : undefined;
  return { ...(absence !== undefined ? { absence } : {}), ...(columns !== undefined ? { columns } : {}) };
}

/** The columns the def alone knows about — declared ones, the absence column, and every initially bound field — all of type `unknown` (types are the provider's). */
function defColumns(src: Record<string, unknown> | undefined, surfaces: readonly { surface: EncodingSurface }[]): ColumnInfo[] {
  const names = new Set<string>();
  const source = facetSourceOf(src);
  for (const name of Object.keys(source.columns ?? {})) names.add(name);
  if (source.absence !== undefined) names.add(source.absence.field);
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
 * Validate an `AbsenceDecl` — the STATED absence vocabulary of one table
 * (never inferred). Inert data: a column name and a list of words, echoed
 * verbatim. The one semantic rule: the vocabulary MUST include `unknown`,
 * because a source that cannot tell "feature off" from "collector failed"
 * needs a word for that, or it is forced to lie with one of the others.
 * Collects the declared field into `fields` so the encodings pass can refuse
 * binding it to a numeric channel.
 */
function validateAbsence(absence: unknown, where: string, problems: string[], fields: Set<string>): void {
  if (!isObject(absence)) {
    problems.push(`${where}, if present, must be an object { field, states }`);
    return;
  }
  for (const key of Object.keys(absence)) {
    if (key !== 'field' && key !== 'states') problems.push(`${where}: unknown key "${key}"`);
  }
  if (typeof absence.field !== 'string' || absence.field.length === 0) {
    problems.push(`${where}.field must be a non-empty string (the column that carries the state)`);
  } else {
    fields.add(absence.field);
  }
  const states = absence.states;
  if (!Array.isArray(states) || states.length === 0 || states.some((st) => typeof st !== 'string' || st.length === 0)) {
    problems.push(`${where}.states must be a non-empty array of non-empty strings`);
    return;
  }
  if (new Set(states).size !== states.length) problems.push(`${where}.states must not repeat a state`);
  if (!states.includes(ABSENCE_UNKNOWN)) {
    problems.push(
      `${where}.states must include "${ABSENCE_UNKNOWN}" — a source that cannot tell which silence it saw needs a word for that`,
    );
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
        // a source table is materialised in memory; another engine beside it would be silently overridden
        if (src.engine !== undefined && src.engine !== 'memory') problems.push(`data["${table}"] sets engine "${String(src.engine)}" with a source; a source table is materialised in memory — remove the engine key`);
      }
      if (src.key !== undefined) {
        if (typeof src.key !== 'string' || src.key.length === 0) problems.push(`data["${table}"].key must be a column name`);
        else if (isObject(src.columns) && !(src.key in src.columns)) problems.push(`data["${table}"].key "${src.key}" is not a declared column`);
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
      if (src.absence !== undefined) validateAbsence(src.absence, `data["${table}"].absence`, problems, absenceFields);
      if (src.columns !== undefined) validateColumnDecls(src.columns, `data["${table}"].columns`, problems, absenceFieldOf(src));
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
      problems.push('analyses, if present, must be an object mapping id -> AnalysisDef | AnalysisModule');
    } else {
      for (const [id, slot] of Object.entries(def.analyses)) {
        if (isAnalysisModule(slot)) continue; // built by defineAnalysis already — trusted
        // Otherwise it must be a raw AnalysisDef — re-firewall through L3.
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
            problems.push(`capabilities[${i}].encodings must be an array of "point" | "interval" | "cell" | "match"`);
          }
        }
        if (cap.fields !== undefined && (!Array.isArray(cap.fields) || cap.fields.some((f) => typeof f !== 'string'))) {
          problems.push(`capabilities[${i}].fields must be an array of strings`);
        }
      });
    }
  }

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
      return { viewId, voice: voiceOf(capabilityByView.get(viewId), { hasEncodingSurface: surface !== undefined }), ...(surface !== undefined ? { channels: surface.channels } : {}), ...(grain !== undefined ? { grain } : {}) };
    });
    validateLinks(def.links, def.linkDefault, linkViews, problems);
  }

  // ── encodings (optional) — the `reencode` verb's per-view validation surface ──
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
    const table = typeof def.defaultTable === 'string' ? def.defaultTable : Object.keys(def.data)[0];
    const src = table !== undefined && isObject(def.data[table]) ? (def.data[table] as Record<string, unknown>) : undefined;
    const surfaces = wellFormedSurfaces(def.encodings);
    const facets = resolveFacets(defColumns(src, surfaces), facetSourceOf(src));
    const indexOf = new Map(surfaces.map((s) => [s.surface.viewId, s.index] as const));
    for (const p of lintEncodings({ views: surfaces.map((s) => s.surface), facets, ...(def.encodingRules !== undefined ? { rules: def.encodingRules as EncodingRules } : {}) })) {
      problems.push(`encodings[${indexOf.get(p.viewId)}].initial.${p.channel}: ${p.sentence}`);
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

  // ── defaultTable (optional) — must name a declared table ──
  if (def.defaultTable !== undefined) {
    if (typeof def.defaultTable !== 'string') {
      problems.push('defaultTable, if present, must be a string');
    } else if (isObject(def.data) && !(def.defaultTable in def.data)) {
      problems.push(`defaultTable "${def.defaultTable}" is not a declared data table`);
    }
  }

  return problems;
}

/** The verbs, exported for tool-surface enumeration. */
export function dispatchVerbs(): readonly DispatchVerb[] {
  return DISPATCH_VERBS;
}
