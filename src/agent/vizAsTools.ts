/**
 * vizAsTools(session) — the FIXED agent tool surface (Mode B, mirroring
 * hcifootprint's `skillsAsTools`). The tool array NEVER changes for the life of
 * a session: `whats_here`, `dispatch`, `declare_analysis`, `why`, `fork`,
 * `checkpoint`, `paths`, `compare` (BR-1), `propose_chart` (RP-3). Disclosure rides the RESULT channel
 * (`whats_here` returns the current views/selections/analyses-with-readiness
 * plus the named paths), never the tool channel — so the byte-identical tool
 * list keeps prompt caches stable and the library is a PLAIN MCP server for
 * any host (no `tools/list_changed`).
 *
 * R4 (zero synthetic input): the ONLY way to change state is a SEMANTIC verb.
 * There is no `emit_event` / `pointermove` tool — a probe that tries to push a
 * raw DOM event has no entry point. `declare_analysis` deliberately does NOT
 * accept raw input rows; an analysis always runs over the CURRENT selection the
 * agent built with `dispatch` (the agent never hands the surface fabricated
 * data).
 *
 * Two-string discipline (Q8 / R12): every text field in the tool DESCRIPTORS is
 * an authored constant. Runtime app content — column VALUES, category labels,
 * a `cause.intent`, an analysis id — only ever appears in structured DATA
 * fields of a RESULT, never in an instruction/description string. An adversarial
 * category literally named "IGNORE PREVIOUS INSTRUCTIONS" round-trips as inert
 * data and never reaches the instruction channel.
 */

import type { Actor, Cause } from '../cause/index.js';
import { DISPATCH_VERBS } from '../def/index.js';
import type { InteractionSession } from '../session/index.js';
import type { CellValues, DispatchAction, DispatchResult, AnalysisCommit, FilterRange, ProposeChartResult, WhyTarget } from '../session/index.js';

/** One tool descriptor (shape-compatible with footprintjs `MCPToolDescription` / the MCP SDK `Tool`). */
export interface VizTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** A tool result — a plain data object; serialize one as the tool_result body. */
export type VizToolResult = Record<string, unknown>;

export interface VizToolsPort {
  /** The STATIC tool array — identical bytes for the life of the session. */
  tools(): VizTool[];
  /** Route a tool call by name. Unknown names / verbs return a structured error result. */
  call(name: string, args?: unknown): Promise<VizToolResult>;
}

export interface VizToolsOptions {
  /** Namespace prefix for tool names. Default `'viz'`. */
  namespace?: string;
  /** Acting principal stamped on dispatches made through this port. Default: the session's default actor. */
  as?: Actor;
}

// ── authored-constant descriptions (never interpolate runtime data — Q8) ───────

const WHATS_HERE_DESCRIPTION =
  'Describe the current analytical position: the declared views, their current channel->field visual ' +
  'encodings and the columns available to put on them, the active selections in DATA space, the ' +
  'declared analyses with their readiness, the online-FDR ledger, the count of unmet requests ' +
  '(gaps), and the NAMED PATHS of the history (which path you are on, every path with its tip, and ' +
  'how many paths are ARCHIVED — hidden from the list but never erased; the paths tool lists them). ' +
  'Call this first, then act with dispatch.';

const DISPATCH_DESCRIPTION =
  'Perform ONE semantic interaction. verb is one of: select (a point value on a field — OR MANY values: pass ' +
  'field + values (an array) to keep exactly those, add exclude: true to keep everything BUT them; ' +
  'values: null clears — OR a CELL: ' +
  'pass fields + values instead of field/value to select on TWO fields with one gesture, e.g. a ' +
  'heatmap cell "price 100-150 AND category Formal"; the two constraints land as ONE commit whose ' +
  'predicate is the AND of both sides, and values: null clears the cell), filter (an ' +
  'interval [lo, hi] on a field, or null to clear — see the range parameter for the full shape, ' +
  'including open-ended and date ranges), annotate (an inert note), navigate (move view state — a ' +
  'declared viewId focuses/pans it, field and value are ignored; OR the "layout:<scope>" identity, ' +
  'e.g. "layout:dashboard", rearranges the cockpit — field names the arrangement prop (preset|order|' +
  'focus) and value is its new plain-string value, and this lands a real commit), ' +
  'analyze (run a declared analysis over the current selection), fork (travel the cursor back to a ' +
  'prior commit so your NEXT act branches off it — a sibling, no history rewritten), checkpoint (name ' +
  'the current position to return to), reencode (rebind a view\'s visual channel, e.g. x, to a ' +
  'different data field — must be a channel valid for that view and a column that exists). This is ' +
  'the ONLY way to change state — there is no raw-event path.';

const DECLARE_ANALYSIS_DESCRIPTION =
  'Run a DECLARED analysis by id over the current selection (a columns analysis runs over the full ' +
  'table so its output can materialize). A kind:test analysis lands one row in the online-FDR ledger; ' +
  'a degenerate fit returns an honest flag and spends no wealth. Call whats_here for analysis ids and ' +
  'their readiness.';

const WHY_DESCRIPTION =
  'Ask why a value is what it is: returns the MINIMAL cross-tier dependency set (declaring commit, ' +
  'input-selection commits, kernel stages) as machine-shaped {tier,id,kind} records — never prose. ' +
  'target is a materialized column name (string) or { analysisId } for a scalar/test result. Tiers ' +
  'that were not threaded come back as typed misses, never faked.';

const FORK_DESCRIPTION =
  'Travel back: move the read-only cursor to a prior commit id and rebuild the visible selection there. ' +
  'The active branch head is left intact, so the old lineage stays a live branch; your NEXT dispatch or ' +
  'declare_analysis lands as a SIBLING off the fork point (append-only — no history is rewritten, and ' +
  'alpha spent on the branch you left is never refunded). The sibling starts a NAMED path, auto-named ' +
  'from its cause — see the paths tool to list, switch, or rename.';

const CHECKPOINT_DESCRIPTION =
  'Name the current cursor position (a checkpoint) so you can fork back to it later. Stored as inert ' +
  'data; never parsed.';

const PATHS_DESCRIPTION =
  'Work with the NAMED paths (branches) of the analysis history. action=list shows every path with its ' +
  'tip commit, step count, and which one is current (pass includeArchived: true to see the hidden ones ' +
  'too, each flagged archived); switch moves to a path by name (the cursor jumps ' +
  'to its tip and your next act extends it); rename gives a path a better name; new starts a named path ' +
  'at a prior commit (auto-named from that commit when name is omitted). ' +
  'To tidy up: archive hides a dead-end path, restore un-hides it, discard drops everything after a ' +
  'commit on your own path (the abandoned part is kept as an archived path you can restore), and adopt ' +
  'replays another path\'s steps onto where you stand, one ordinary commit each. NOTHING here deletes ' +
  'anything: hidden is not erased — every step stays in the log, and the statistics remember ' +
  '(archiving or discarding never refunds alpha, never lowers the test count, and never removes a ' +
  'ledger row). Every action is journaled — branch bookkeeping is auditable, and nothing rewrites history.';

const COMPARE_DESCRIPTION =
  'Compare two positions of the analysis history — path names or commit ids. Returns the common ' +
  'ancestor, what CHANGED between the two sides (selections, visual encodings, analyses — the last ' +
  'state per key), what exists on only one side, and per-side row counts under each side\'s ' +
  'selections. Read-only: nothing moves.';

const PROPOSE_CHART_DESCRIPTION =
  'Propose a NEW chart at runtime as a Vega-Lite spec (a single-view mark with an encoding). Give ' +
  'an id, the spec (VL JSON), and a rationale. RULES the host enforces: (1) the spec must NOT carry ' +
  'its own data transforms — no aggregate/bin/timeUnit/calculate/window and no top-level transform: ' +
  'the HOST owns all binning and aggregation, so encode raw fields only; (2) one single-view mark — ' +
  'no facet/repeat/layer/concat; (3) every field you encode must be a real column (call whats_here ' +
  'first to see them). Your chart is a HYPOTHESIS: it is registered in the online-FDR ledger before ' +
  'it renders (it costs a little multiplicity budget and is honestly marked UNTESTED — a chart is ' +
  'never counted as a discovery on its own). If any rule fails, you get back a TYPED gap with the ' +
  'reason and NOTHING renders — read the reason, fix the spec, and propose again.';

// ── static input schemas (Mode B: cannot enforce per-verb shape; fire-time validates) ──

const OPTIONAL_INTENT = {
  intent: { type: 'string', description: 'An inert free-text note stored on the cause. Never parsed or executed.' },
} as const;

const DISPATCH_SCHEMA = {
  type: 'object',
  properties: {
    verb: { type: 'string', enum: [...DISPATCH_VERBS], description: 'The semantic verb.' },
    viewId: {
      type: 'string',
      description:
        'The view identity a select/filter/navigate/reencode targets. For navigate, also accepts the ' +
        '"layout:<scope>" identity (e.g. "layout:dashboard") to rearrange the cockpit layout.',
    },
    field: {
      type: 'string',
      description:
        'The data-space column a select/filter acts on, the target field a reencode rebinds a channel ' +
        'to, or — for a navigate on "layout:<scope>" — the arrangement prop being set (preset|order|focus).',
    },
    value: {
      description:
        'The selected DATA-space point value (select), or — for a navigate on "layout:<scope>" — the ' +
        'plain-string new value of the arrangement prop named by field.',
    },
    values: {
      type: ['array', 'null'],
      description:
        'Two forms, never both. (1) select WITH field: MANY data-space values on that field — a multi-select ' +
        '(strings, numbers, booleans; null in the list means "is empty"), or null to clear the match. ' +
        '(2) select WITH fields — a CELL: the two sides matching fields, each a plain value (equality; null ' +
        'means "is empty") or a [lo, hi] interval (bucket bounds, inclusive; either bound may be null for ' +
        'open-ended), e.g. [[100, 150], "Formal"]; values: null clears the cell. A cell lands ONE commit whose ' +
        'predicate is the AND of both sides.',
    },
    exclude: {
      type: 'boolean',
      description: 'For a multi-value select only: true keeps everything BUT the listed values (NOT IN). Default false.',
    },
    range: {
      type: ['array', 'null'],
      description:
        'The DATA-space interval for filter, or null to clear. [lo, hi] with both numbers (e.g. price), ' +
        'or both ISO-8601 date strings "YYYY-MM-DD" (e.g. a date column) — the two never mix. Either bound ' +
        'may be null for an OPEN-ENDED range: [150, null] means "150 or more", [null, "2026-05-31"] means ' +
        '"up to that date" — never invent a made-up ceiling/floor number when the user names only one side. ' +
        'Both bounds cannot be null (use range: null on the whole call to clear instead).',
    },
    target: { type: 'string', description: 'The annotation target (annotate).' },
    note: { type: 'string', description: 'The inert annotation text (annotate).' },
    analysisId: { type: 'string', description: 'A declared analysis id (analyze).' },
    fromCommitId: { type: 'string', description: 'The commit id to branch off (fork).' },
    label: { type: 'string', description: 'A checkpoint label (checkpoint).' },
    channel: { type: 'string', description: 'The visual channel to rebind, e.g. "x" | "y" | "color" (reencode) — must be valid for the view.' },
    fields: {
      type: 'array',
      description:
        'CELL-select only: the TWO fields selected in one gesture, x side then y side, e.g. ' +
        '["price", "category"]. Use together with values (and omit field/value/range). The view must ' +
        'declare the cell emission kind (a heatmap does; classic charts do not).',
    },
    ...OPTIONAL_INTENT,
  },
  required: ['verb'],
  additionalProperties: false,
} as const;

const DECLARE_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    analysisId: { type: 'string', description: 'A declared analysis id.' },
    ...OPTIONAL_INTENT,
  },
  required: ['analysisId'],
  additionalProperties: false,
} as const;

const WHY_SCHEMA = {
  type: 'object',
  properties: {
    target: { description: 'A materialized column name (string), or { column } / { analysisId } for a scalar/test.' },
  },
  required: ['target'],
  additionalProperties: false,
} as const;

/** Coerce a raw tool `target` into a typed {@link WhyTarget} (Mode B fire-time validation). */
function coerceWhyTarget(raw: unknown): WhyTarget | { error: string } {
  if (typeof raw === 'string') return { kind: 'column', column: raw };
  if (raw !== null && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o['column'] === 'string') return { kind: 'column', column: o['column'] };
    if (typeof o['analysisId'] === 'string') return { kind: 'hypothesis', analysisId: o['analysisId'] };
  }
  return { error: 'why requires target: a column name (string), or { column } / { analysisId }' };
}

const FORK_SCHEMA = {
  type: 'object',
  properties: { fromCommitId: { type: 'string', description: 'The commit id to branch off.' }, ...OPTIONAL_INTENT },
  required: ['fromCommitId'],
  additionalProperties: false,
} as const;

const CHECKPOINT_SCHEMA = {
  type: 'object',
  properties: { label: { type: 'string', description: 'The checkpoint label.' }, ...OPTIONAL_INTENT },
  required: ['label'],
  additionalProperties: false,
} as const;

const PATHS_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'switch', 'rename', 'new', 'archive', 'restore', 'discard', 'adopt'],
      description: 'What to do with the named paths.',
    },
    name: {
      type: 'string',
      description:
        'The path name: the switch target, the rename source, an optional custom name for new, or the ' +
        'path to archive / restore / adopt.',
    },
    newName: { type: 'string', description: 'The new name (rename only).' },
    commitId: {
      type: 'string',
      description:
        'The commit id: where a new path starts (new), or the point to keep when discarding — everything ' +
        'AFTER it on your path is hidden (discard; omit to use where the cursor is).',
    },
    includeArchived: {
      type: 'boolean',
      description: 'list only: also list the archived (hidden) paths, each flagged archived. Default false.',
    },
  },
  required: ['action'],
  additionalProperties: false,
} as const;

const COMPARE_SCHEMA = {
  type: 'object',
  properties: {
    a: { type: 'string', description: 'One side: a path name or a commit id.' },
    b: { type: 'string', description: 'The other side: a path name or a commit id.' },
  },
  required: ['a', 'b'],
  additionalProperties: false,
} as const;

const PROPOSE_CHART_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'A stable id for the chart (its view lands under chart:<id>).' },
    spec: { type: 'object', description: 'The Vega-Lite spec as JSON — a single-view mark with an encoding, NO data transforms (the host owns aggregation), NO inline data (the host supplies rows).' },
    rationale: { type: 'string', description: 'The chart\'s claim, e.g. "price vs rating reveals a relationship" — inert data, ledgered with the chart.' },
  },
  required: ['id', 'spec'],
  additionalProperties: false,
} as const;

const NO_PARAMS = { type: 'object', properties: {}, additionalProperties: false } as const;

/**
 * TL-1 — the one honesty line every hiding action carries back, verbatim (an
 * authored constant, Q8: it is the LIBRARY's words, never runtime data). The UI
 * shows the same sentence on its confirm dialogs, so the human and the model are
 * told exactly the same truth.
 */
export const HIDDEN_NOT_ERASED = 'Hidden, not erased — the statistics remember.';

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_');
}

/** One bound of a `filter` range as it arrives off the wire: a concrete value, or `null` (open-ended). */
type RawBound = number | string | null;

/**
 * Validate a raw `filter.range` array against the `FilterRange` shape
 * (mirrors `src/data`'s `IntervalBounds`, fire-time validated here since Mode
 * B cannot enforce per-verb shape ahead of the call): exactly two elements,
 * each a number, a string, or null; not both null (that is not "open-ended
 * both ways", it is malformed — `range: null` on the whole call is how a
 * model clears a filter); and non-null bounds must share a type — a
 * [number, string] pair is never a legal interval (see `IntervalClause` in
 * `src/data/types.ts`: numeric and date-string bounds never mix).
 */
function isValidFilterRange(range: unknown): range is readonly [RawBound, RawBound] {
  if (!Array.isArray(range) || range.length !== 2) return false;
  const isBound = (v: unknown): v is RawBound => v === null || typeof v === 'number' || typeof v === 'string';
  const [lo, hi] = range as [unknown, unknown];
  if (!isBound(lo) || !isBound(hi)) return false;
  if (lo === null && hi === null) return false;
  if (lo !== null && hi !== null && typeof lo !== typeof hi) return false;
  return true;
}

/**
 * Validate ONE cell side (D30, fire-time — Mode B cannot enforce per-verb
 * shape ahead of the call): an array side must be a legal interval (the
 * `isValidFilterRange` rules verbatim — the two disciplines never fork);
 * anything else must be a plain JSON scalar (number/string/boolean/null —
 * `null` is a real IS-NULL constraint, never a per-side clear).
 */
/** A plain value a match list may carry — a string, number, boolean, or null (IS NULL). */
function isScalarValue(v: unknown): boolean {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function isValidCellSide(side: unknown): side is CellValuesSide {
  if (Array.isArray(side)) return isValidFilterRange(side);
  return side === null || typeof side === 'number' || typeof side === 'string' || typeof side === 'boolean';
}

type CellValuesSide = NonNullable<CellValues>[number];

/** The whole cell payload: exactly two string fields + two valid sides (or values: null to clear). */
function isValidCellFields(fields: unknown): fields is readonly [string, string] {
  return Array.isArray(fields) && fields.length === 2 && fields.every((f) => typeof f === 'string');
}

export function vizAsTools(session: InteractionSession, opts?: VizToolsOptions): VizToolsPort {
  const ns = opts?.namespace ?? 'viz';
  const source: Actor = opts?.as ?? session.defaultActor;

  const NAMES = {
    whatsHere: sanitize(`${ns}.whats_here`),
    dispatch: sanitize(`${ns}.dispatch`),
    declare: sanitize(`${ns}.declare_analysis`),
    why: sanitize(`${ns}.why`),
    fork: sanitize(`${ns}.fork`),
    checkpoint: sanitize(`${ns}.checkpoint`),
    paths: sanitize(`${ns}.paths`),
    compare: sanitize(`${ns}.compare`),
    proposeChart: sanitize(`${ns}.propose_chart`),
  };

  const staticTools: VizTool[] = [
    { name: NAMES.whatsHere, description: WHATS_HERE_DESCRIPTION, inputSchema: structuredClone(NO_PARAMS) },
    { name: NAMES.dispatch, description: DISPATCH_DESCRIPTION, inputSchema: structuredClone(DISPATCH_SCHEMA) },
    { name: NAMES.declare, description: DECLARE_ANALYSIS_DESCRIPTION, inputSchema: structuredClone(DECLARE_ANALYSIS_SCHEMA) },
    { name: NAMES.why, description: WHY_DESCRIPTION, inputSchema: structuredClone(WHY_SCHEMA) },
    { name: NAMES.fork, description: FORK_DESCRIPTION, inputSchema: structuredClone(FORK_SCHEMA) },
    { name: NAMES.checkpoint, description: CHECKPOINT_DESCRIPTION, inputSchema: structuredClone(CHECKPOINT_SCHEMA) },
    { name: NAMES.paths, description: PATHS_DESCRIPTION, inputSchema: structuredClone(PATHS_SCHEMA) },
    { name: NAMES.compare, description: COMPARE_DESCRIPTION, inputSchema: structuredClone(COMPARE_SCHEMA) },
    { name: NAMES.proposeChart, description: PROPOSE_CHART_DESCRIPTION, inputSchema: structuredClone(PROPOSE_CHART_SCHEMA) },
  ];

  /** Build the two-slot cause from the port's principal + an inert intent (Q8: intent is data). */
  function causeFor(args: Record<string, unknown>): Cause {
    const intent = typeof args['intent'] === 'string' ? args['intent'] : undefined;
    return { requestedBy: source, computedBy: source, ...(intent !== undefined ? { intent } : {}) };
  }

  function buildAction(args: Record<string, unknown>): DispatchAction | { error: string } {
    const verb = args['verb'];
    if (typeof verb !== 'string' || !(DISPATCH_VERBS as readonly string[]).includes(verb)) {
      return { error: `verb must be one of ${DISPATCH_VERBS.join('|')}` };
    }
    const cause = causeFor(args);
    switch (verb) {
      case 'select': {
        if (typeof args['viewId'] !== 'string') return { error: 'select requires a string viewId' };
        // D30: the CELL form — fields+values selects on two fields in one
        // gesture, landing ONE compound commit (never two linked ones).
        if (args['fields'] !== undefined) {
          if (!isValidCellFields(args['fields'])) {
            return { error: 'cell select requires fields: exactly two column names, x side then y side, e.g. ["price", "category"]' };
          }
          const values = args['values'];
          if (values !== null && (!Array.isArray(values) || values.length !== 2 || !values.every(isValidCellSide))) {
            return {
              error:
                'cell select requires values: the two sides matching fields — each a plain value or a [lo, hi] ' +
                'interval (one bound may be null; never both) — or values: null to clear the cell',
            };
          }
          return {
            verb: 'select',
            viewId: args['viewId'],
            fields: args['fields'],
            values: values === null ? null : ([values[0], values[1]] as CellValues),
            cause,
          };
        }
        if (typeof args['field'] !== 'string') {
          return { error: 'select requires string viewId and field' };
        }
        // SET-1: the MATCH form — field + values (many), optional exclude.
        if (args['values'] !== undefined) {
          const values = args['values'];
          if (values !== null && (!Array.isArray(values) || !values.every(isScalarValue))) {
            return { error: 'a multi-value select requires values: an array of plain values (strings, numbers, booleans, null) on field — or values: null to clear' };
          }
          const exclude = args['exclude'];
          if (exclude !== undefined && typeof exclude !== 'boolean') return { error: 'exclude must be true or false' };
          return { verb: 'select', viewId: args['viewId'], field: args['field'], values, ...(exclude === undefined ? {} : { exclude }), cause };
        }
        return { verb: 'select', viewId: args['viewId'], field: args['field'], value: args['value'], cause };
      }
      case 'filter': {
        if (typeof args['viewId'] !== 'string' || typeof args['field'] !== 'string') {
          return { error: 'filter requires string viewId and field' };
        }
        const range = args['range'];
        if (range !== null && !isValidFilterRange(range)) {
          return {
            error:
              'filter.range must be [lo, hi] — both numbers, both ISO date strings ("YYYY-MM-DD"), or one bound ' +
              'null for an open-ended range (e.g. [150, null] means "150 or more") — or null to clear',
          };
        }
        return {
          verb: 'filter',
          viewId: args['viewId'],
          field: args['field'],
          range: range === null ? null : ([range[0], range[1]] as FilterRange),
          cause,
        };
      }
      case 'annotate':
        if (typeof args['target'] !== 'string' || typeof args['note'] !== 'string') {
          return { error: 'annotate requires string target and note' };
        }
        return { verb: 'annotate', target: args['target'], note: args['note'], cause };
      case 'navigate': {
        if (typeof args['viewId'] !== 'string') return { error: 'navigate requires a string viewId' };
        // field/value are OPTIONAL on the wire (a declared-view pan/zoom sends
        // neither) and DispatchAction types them `string | undefined` — a
        // wrong-typed value (e.g. a number) narrows to undefined here rather
        // than being forwarded, which the session's own doLayoutNote guard
        // then reports identically to an omitted value (typeof check, same
        // message) — no guard logic is duplicated here, just type narrowing.
        const field = typeof args['field'] === 'string' ? args['field'] : undefined;
        const value = typeof args['value'] === 'string' ? args['value'] : undefined;
        return {
          verb: 'navigate',
          viewId: args['viewId'],
          ...(field !== undefined ? { field } : {}),
          ...(value !== undefined ? { value } : {}),
          cause,
        };
      }
      case 'analyze':
        if (typeof args['analysisId'] !== 'string') return { error: 'analyze requires a string analysisId' };
        return { verb: 'analyze', analysisId: args['analysisId'], cause };
      case 'fork':
        if (typeof args['fromCommitId'] !== 'string') return { error: 'fork requires a string fromCommitId' };
        return { verb: 'fork', fromCommitId: args['fromCommitId'], cause };
      case 'checkpoint':
        if (typeof args['label'] !== 'string') return { error: 'checkpoint requires a string label' };
        return { verb: 'checkpoint', label: args['label'], cause };
      case 'reencode':
        if (typeof args['viewId'] !== 'string' || typeof args['channel'] !== 'string' || typeof args['field'] !== 'string') {
          return { error: 'reencode requires string viewId, channel, and field' };
        }
        return { verb: 'reencode', viewId: args['viewId'], channel: args['channel'], field: args['field'], cause };
      /* v8 ignore next 2 -- defensive exhaustiveness fallback: `verb` was already checked against
         (DISPATCH_VERBS as readonly string[]).includes(verb) above, and the switch enumerates all
         8 DISPATCH_VERBS members as cases, so `verb` can never reach `default` through any public
         call path (vizAsTools.call / mcpServer's tools/call route only ever construct `args` from
         JSON-typed tool arguments, never bypass buildAction). Kept as a type-narrowing belt, not a
         reachable branch. */
      default:
        return { error: `unhandled verb "${verb}"` };
    }
  }

  function projectDispatch(result: DispatchResult): VizToolResult {
    if (!result.ok) {
      return { ok: false, verb: result.verb, intent: result.intent, gap: result.rejection };
    }
    return {
      ok: true,
      verb: result.verb,
      intent: result.intent,
      ...(result.commit ? { commit: result.commit } : {}),
      ...(result.analysis ? { analysis: projectAnalysis(result.analysis) } : {}),
      ...(result.checkpoint ? { checkpoint: result.checkpoint } : {}),
      ...(result.annotated ? { annotated: result.annotated } : {}),
      ...(result.navigatedTo ? { navigatedTo: result.navigatedTo } : {}),
      ...(result.reencoded ? { reencoded: result.reencoded } : {}),
    };
  }

  function projectAnalysis(a: AnalysisCommit): VizToolResult {
    return {
      analysisId: a.analysisId,
      kind: a.kind,
      result: a.result,
      ...(a.commit ? { commit: a.commit } : {}),
      ...(a.hypothesis ? { hypothesis: a.hypothesis } : {}),
      ...(a.fdrStep ? { fdrStep: a.fdrStep } : {}),
      ...(a.materialized ? { materialized: a.materialized } : {}),
      ...(a.gap ? { gap: a.gap } : {}),
    };
  }

  async function callDispatch(args: Record<string, unknown>): Promise<VizToolResult> {
    const action = buildAction(args);
    if ('error' in action) return { ok: false, reason: 'PAYLOAD_INVALID', detail: action.error };
    const result = await session.dispatch(action, { as: source });
    return projectDispatch(result);
  }

  /**
   * Route `propose_chart` (RP-3). Fire-time validates the payload (Mode B) then
   * runs the governed pipeline. The result is LEAN — the ledger status + the
   * honest untested-hypothesis marker, never the spec echoed back (the agent
   * already sent it; whats_here later lists the chart, the host renders it).
   * A gate refusal comes back as the typed gap the agent reads and repairs.
   */
  async function callProposeChart(args: Record<string, unknown>): Promise<VizToolResult> {
    if (typeof args['id'] !== 'string') {
      return { ok: false, reason: 'PAYLOAD_INVALID', detail: 'propose_chart requires a string id' };
    }
    if (args['spec'] === null || typeof args['spec'] !== 'object' || Array.isArray(args['spec'])) {
      return { ok: false, reason: 'PAYLOAD_INVALID', detail: 'propose_chart requires spec to be a Vega-Lite spec object' };
    }
    const claim = typeof args['rationale'] === 'string' ? args['rationale'] : undefined;
    const result: ProposeChartResult = await session.proposeChart(
      { id: args['id'], spec: args['spec'], ...(claim !== undefined ? { claim } : {}) },
      { as: source },
    );
    if (!result.ok) return { ok: false, gap: result.gap };
    return {
      ok: true,
      chartId: result.chartId,
      viewId: result.view.viewId,
      claim: result.view.claim,
      authoredBy: result.view.authoredBy,
      ledgered: true,
      tested: result.hypothesis.tested,
      ledgerStep: result.fdrStep.step,
      fdrStep: result.fdrStep,
    };
  }

  /**
   * Route the `paths` tool — mutations go through the SESSION methods (never
   * the refs directly). TL-1: the lifecycle actions (archive / restore /
   * discard / adopt) hide and move refs; not one of them deletes a step, and
   * the results say so in plain words the model reads back.
   */
  async function callPaths(args: Record<string, unknown>): Promise<VizToolResult> {
    switch (args['action']) {
      case 'list': {
        const list = session.paths({ includeArchived: args['includeArchived'] === true });
        return {
          ok: true,
          current: list.find((p) => p.active)?.name ?? null,
          paths: list,
          archived: session.paths({ includeArchived: true }).filter((p) => p.archived === true).length,
        };
      }
      case 'switch': {
        if (typeof args['name'] !== 'string') {
          return { ok: false, reason: 'PAYLOAD_INVALID', detail: 'paths switch requires a string name' };
        }
        return { ...session.switchPath(args['name']) };
      }
      case 'rename': {
        if (typeof args['name'] !== 'string' || typeof args['newName'] !== 'string') {
          return { ok: false, reason: 'PAYLOAD_INVALID', detail: 'paths rename requires string name and newName' };
        }
        return { ...session.renamePath(args['name'], args['newName']) };
      }
      case 'new': {
        const commitId = args['commitId'];
        const name = args['name'];
        if (typeof commitId !== 'string') {
          return { ok: false, reason: 'PAYLOAD_INVALID', detail: 'paths new requires a string commitId' };
        }
        if (name !== undefined && typeof name !== 'string') {
          return { ok: false, reason: 'PAYLOAD_INVALID', detail: 'paths new name, if present, must be a string' };
        }
        return { ...session.newPathAt(commitId, name) };
      }
      case 'archive': {
        if (typeof args['name'] !== 'string') {
          return { ok: false, reason: 'PAYLOAD_INVALID', detail: 'paths archive requires a string name' };
        }
        const res = session.archivePath(args['name'], { as: source });
        return res.ok ? { ...res, note: HIDDEN_NOT_ERASED } : { ...res };
      }
      case 'restore': {
        if (typeof args['name'] !== 'string') {
          return { ok: false, reason: 'PAYLOAD_INVALID', detail: 'paths restore requires a string name' };
        }
        return { ...session.restorePath(args['name'], { as: source }) };
      }
      case 'discard': {
        const commitId = args['commitId'];
        if (commitId !== undefined && typeof commitId !== 'string') {
          return { ok: false, reason: 'PAYLOAD_INVALID', detail: 'paths discard commitId, if present, must be a string' };
        }
        const res = session.discardFromHere({ ...(commitId !== undefined ? { at: commitId } : {}), as: source });
        return res.ok ? { ...res, note: HIDDEN_NOT_ERASED } : { ...res };
      }
      case 'adopt': {
        if (typeof args['name'] !== 'string') {
          return { ok: false, reason: 'PAYLOAD_INVALID', detail: 'paths adopt requires a string name' };
        }
        return { ...(await session.adoptPath(args['name'], { as: source })) };
      }
      default:
        return {
          ok: false,
          reason: 'PAYLOAD_INVALID',
          detail: 'paths action must be one of list|switch|rename|new|archive|restore|discard|adopt',
        };
    }
  }

  return {
    tools: () => structuredClone(staticTools),
    async call(name: string, rawArgs?: unknown): Promise<VizToolResult> {
      const args = (rawArgs ?? {}) as Record<string, unknown>;
      switch (name) {
        case NAMES.whatsHere:
          return { ok: true, ...(await session.overview()) };
        case NAMES.dispatch:
          return callDispatch(args);
        case NAMES.declare: {
          if (typeof args['analysisId'] !== 'string') {
            return { ok: false, reason: 'PAYLOAD_INVALID', detail: 'declare_analysis requires a string analysisId' };
          }
          return callDispatch({ verb: 'analyze', analysisId: args['analysisId'], ...(args['intent'] !== undefined ? { intent: args['intent'] } : {}) });
        }
        case NAMES.why: {
          const target = coerceWhyTarget(args['target']);
          if ('error' in target) return { ok: false, reason: 'PAYLOAD_INVALID', detail: target.error };
          return { ...session.why(target) };
        }
        case NAMES.fork:
          return callDispatch({ verb: 'fork', ...args });
        case NAMES.checkpoint:
          return callDispatch({ verb: 'checkpoint', ...args });
        case NAMES.paths:
          return await callPaths(args);
        case NAMES.compare: {
          if (typeof args['a'] !== 'string' || typeof args['b'] !== 'string') {
            return { ok: false, reason: 'PAYLOAD_INVALID', detail: 'compare requires string a and b (path names or commit ids)' };
          }
          return { ...(await session.compare(args['a'], args['b'])) };
        }
        case NAMES.proposeChart:
          return callProposeChart(args);
        default:
          return { ok: false, reason: 'UNKNOWN_TOOL', tools: staticTools.map((t) => t.name) };
      }
    },
  };
}
