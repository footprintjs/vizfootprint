/**
 * vizAsTools(session) — the FIXED agent tool surface (Mode B, mirroring
 * hcifootprint's `skillsAsTools`). The tool array NEVER changes for the life of
 * a session: `whats_here`, `dispatch`, `declare_analysis`, `why`, `fork`,
 * `checkpoint`. Disclosure rides the RESULT channel (`whats_here` returns the
 * current views/selections/analyses-with-readiness), never the tool channel —
 * so the byte-identical tool list keeps prompt caches stable and the library is
 * a PLAIN MCP server for any host (no `tools/list_changed`).
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
import type { DispatchAction, DispatchResult, AnalysisCommit } from '../session/index.js';

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
  'Describe the current analytical position: the declared views and their encodings, the active ' +
  'selections in DATA space, the declared analyses with their readiness, the online-FDR ledger, and ' +
  'the count of unmet requests (gaps). Call this first, then act with dispatch.';

const DISPATCH_DESCRIPTION =
  'Perform ONE semantic interaction. verb is one of: select (a point value on a field), filter (an ' +
  'interval [lo,hi] on a field, or null to clear), annotate (an inert note), navigate (focus a view), ' +
  'analyze (run a declared analysis over the current selection), fork (branch off a prior commit), ' +
  'checkpoint (name the current log position). This is the ONLY way to change state — there is no ' +
  'raw-event path.';

const DECLARE_ANALYSIS_DESCRIPTION =
  'Run a DECLARED analysis by id over the current selection (a columns analysis runs over the full ' +
  'table so its output can materialize). A kind:test analysis lands one row in the online-FDR ledger; ' +
  'a degenerate fit returns an honest flag and spends no wealth. Call whats_here for analysis ids and ' +
  'their readiness.';

const WHY_DESCRIPTION =
  'Ask why a value is what it is (a cross-tier dependency set). NOT YET IMPLEMENTED at this layer — ' +
  'returns a typed not-implemented marker naming the owning layer (L6).';

const FORK_DESCRIPTION =
  'Branch the provenance timeline off a prior commit id: the next dispatch commits as a sibling of ' +
  'that commit (append-only; no history is rewritten).';

const CHECKPOINT_DESCRIPTION = 'Name the current log position so it can be referred to later.';

// ── static input schemas (Mode B: cannot enforce per-verb shape; fire-time validates) ──

const OPTIONAL_INTENT = {
  intent: { type: 'string', description: 'An inert free-text note stored on the cause. Never parsed or executed.' },
} as const;

const DISPATCH_SCHEMA = {
  type: 'object',
  properties: {
    verb: { type: 'string', enum: [...DISPATCH_VERBS], description: 'The semantic verb.' },
    viewId: { type: 'string', description: 'The view identity a select/filter/navigate targets.' },
    field: { type: 'string', description: 'The data-space column a select/filter acts on.' },
    value: { description: 'The selected DATA-space point value (select).' },
    range: {
      type: ['array', 'null'],
      description: 'The DATA-space interval [lo, hi] (filter), or null to clear.',
    },
    target: { type: 'string', description: 'The annotation target (annotate).' },
    note: { type: 'string', description: 'The inert annotation text (annotate).' },
    analysisId: { type: 'string', description: 'A declared analysis id (analyze).' },
    fromCommitId: { type: 'string', description: 'The commit id to branch off (fork).' },
    label: { type: 'string', description: 'A checkpoint label (checkpoint).' },
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
  properties: { target: { description: 'The value/id to explain.' } },
  additionalProperties: false,
} as const;

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

const NO_PARAMS = { type: 'object', properties: {}, additionalProperties: false } as const;

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_');
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
  };

  const staticTools: VizTool[] = [
    { name: NAMES.whatsHere, description: WHATS_HERE_DESCRIPTION, inputSchema: structuredClone(NO_PARAMS) },
    { name: NAMES.dispatch, description: DISPATCH_DESCRIPTION, inputSchema: structuredClone(DISPATCH_SCHEMA) },
    { name: NAMES.declare, description: DECLARE_ANALYSIS_DESCRIPTION, inputSchema: structuredClone(DECLARE_ANALYSIS_SCHEMA) },
    { name: NAMES.why, description: WHY_DESCRIPTION, inputSchema: structuredClone(WHY_SCHEMA) },
    { name: NAMES.fork, description: FORK_DESCRIPTION, inputSchema: structuredClone(FORK_SCHEMA) },
    { name: NAMES.checkpoint, description: CHECKPOINT_DESCRIPTION, inputSchema: structuredClone(CHECKPOINT_SCHEMA) },
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
      case 'select':
        if (typeof args['viewId'] !== 'string' || typeof args['field'] !== 'string') {
          return { error: 'select requires string viewId and field' };
        }
        return { verb: 'select', viewId: args['viewId'], field: args['field'], value: args['value'], cause };
      case 'filter': {
        if (typeof args['viewId'] !== 'string' || typeof args['field'] !== 'string') {
          return { error: 'filter requires string viewId and field' };
        }
        const range = args['range'];
        if (range !== null && !(Array.isArray(range) && range.length === 2 && range.every((n) => typeof n === 'number'))) {
          return { error: 'filter.range must be a [lo, hi] number pair or null' };
        }
        return {
          verb: 'filter',
          viewId: args['viewId'],
          field: args['field'],
          range: range === null ? null : ([range[0], range[1]] as [number, number]),
          cause,
        };
      }
      case 'annotate':
        if (typeof args['target'] !== 'string' || typeof args['note'] !== 'string') {
          return { error: 'annotate requires string target and note' };
        }
        return { verb: 'annotate', target: args['target'], note: args['note'], cause };
      case 'navigate':
        if (typeof args['viewId'] !== 'string') return { error: 'navigate requires a string viewId' };
        return { verb: 'navigate', viewId: args['viewId'], cause };
      case 'analyze':
        if (typeof args['analysisId'] !== 'string') return { error: 'analyze requires a string analysisId' };
        return { verb: 'analyze', analysisId: args['analysisId'], cause };
      case 'fork':
        if (typeof args['fromCommitId'] !== 'string') return { error: 'fork requires a string fromCommitId' };
        return { verb: 'fork', fromCommitId: args['fromCommitId'], cause };
      case 'checkpoint':
        if (typeof args['label'] !== 'string') return { error: 'checkpoint requires a string label' };
        return { verb: 'checkpoint', label: args['label'], cause };
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
        case NAMES.why:
          return { ...session.why(args['target']) };
        case NAMES.fork:
          return callDispatch({ verb: 'fork', ...args });
        case NAMES.checkpoint:
          return callDispatch({ verb: 'checkpoint', ...args });
        default:
          return { ok: false, reason: 'UNKNOWN_TOOL', tools: staticTools.map((t) => t.name) };
      }
    },
  };
}
