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
import {
  ANALYSIS_VIEW_PREFIX,
  ANNOTATION_VIEW_PREFIX,
  CHART_VIEW_PREFIX,
  ENCODING_VIEW_PREFIX,
  LAYOUT_VIEW_PREFIX,
  BEAT_VIEW_PREFIX,
} from '../branches/index.js';
import { ABSENCE_UNKNOWN, DISPATCH_VERBS, MAGNITUDE_CHANNELS, type DispatchVerb } from './types.js';

/** Thrown when a def is structurally malformed. Carries every problem at once. */
export class DashboardDefError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`invalid DashboardDef: ${problems.join('; ')}`);
    this.name = 'DashboardDefError';
    this.problems = problems;
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
]);

/** The exhaustive set of keys a `SeriesGrain` may carry (R12: stated facts only, nothing executable). */
const GRAIN_KEYS = new Set(['bucket', 'reducer', 'collapsedFrom', 'note']);

/** The grain's string-valued keys — each echoed verbatim, never parsed. */
const GRAIN_STRING_KEYS = ['bucket', 'reducer', 'note'] as const;

const ACTORS = new Set(['user', 'agent', 'system']);
const ENGINES = new Set(['memory', 'wasm', 'server', 'auto']);
const PROCEDURES = new Set(['LORD++', 'alpha-investing']);
const ENCODINGS = new Set(['point', 'interval', 'cell']);

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
] as const;

/** The reserved namespace a view id squats, or undefined when it is free to use. */
function reservedPrefix(viewId: string): string | undefined {
  return RESERVED_VIEW_PREFIXES.find((prefix) => viewId.startsWith(prefix));
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
    problems.push(`${where} must be an object { actor, label? }`);
    return;
  }
  if (typeof meta.actor !== 'string' || !ACTORS.has(meta.actor)) {
    problems.push(`${where}.actor must be one of user|agent|system`);
  }
  if (meta.label !== undefined && typeof meta.label !== 'string') {
    problems.push(`${where}.label, if present, must be a string`);
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
    problems.push('data must be an object mapping table name -> { rows | csv }');
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
      if (hasRows && hasCsv) problems.push(`data["${table}"] must not set both rows and csv`);
      if (!hasRows && !hasCsv) problems.push(`data["${table}"] must set rows or csv`);
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
    }
  }

  // ── actors (required) — the ONE place a view identity is declared ──
  if (!isObject(def.actors)) {
    problems.push('actors must be an object mapping viewId -> { actor, label? }');
  } else {
    for (const [viewId, meta] of Object.entries(def.actors)) {
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
            problems.push(`capabilities[${i}].encodings must be an array of "point" | "interval" | "cell"`);
          }
        }
        if (cap.fields !== undefined && (!Array.isArray(cap.fields) || cap.fields.some((f) => typeof f !== 'string'))) {
          problems.push(`capabilities[${i}].fields must be an array of strings`);
        }
      });
    }
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
        }
        if (enc.initial !== undefined) {
          if (!isObject(enc.initial) || Object.values(enc.initial).some((v) => typeof v !== 'string')) {
            problems.push(`encodings[${i}].initial, if present, must be an object mapping channel -> field (strings)`);
          } else {
            // An absence state is a KIND of silence, never a magnitude: "unavailable"
            // on a numeric axis would render as a low number and tell the reader
            // the wrong thing with a straight face.
            for (const [channel, field] of Object.entries(enc.initial)) {
              if (MAGNITUDE_CHANNELS.has(channel) && absenceFields.has(field as string)) {
                problems.push(
                  `encodings[${i}].initial.${channel} binds "${String(field)}", a declared absence column, to a magnitude channel — absence is a category, never a magnitude`,
                );
              }
            }
          }
        }
      });
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
