/**
 * The server-side heart of the mixed-principal demo, bundled to a node ESM
 * module by `build.mjs` and dynamic-imported by `server.mjs` (the dress-shop
 * pattern, adapted: esbuild is already the demo's toolchain, so the server core
 * is TypeScript compiled at boot rather than run through a separate loader).
 *
 * `createAnalyst({ csv, mock })` builds ONE session shared by both principals
 * and returns a small JS-callable API the http layer drives:
 *   - `dispatchUser(body)` — the human's brush/click (`user`-badged commits);
 *   - `chat(message)`      — one analyst turn (`agent`-badged commits);
 *   - `state()`            — everything the browser renders (commits + ledger +
 *                            gaps + selection + live agent activity).
 */
import { buildAnalystSurface } from './def.js';
import { createAssistant, scriptedAnalystMock, type ActivityStep } from './analyst.js';
import type { LLMProvider } from 'agentfootprint/llm-providers';
import type { AttTrace } from 'agentfootprint/observe';
import type { Cause } from '../../src/cause/index.js';
import type { DispatchAction, DispatchResult } from '../../src/agent/index.js';
// BR-3: the named-paths result/state types are owned by `src/session` — the
// `src/agent` barrel re-exports the tool port but never re-exported these
// BR-1 types (src/ is frozen; nothing to fix here), so read them from the
// barrel that OWNS them, same rule CLAUDE.md states for new public symbols.
import type {
  PathsState,
  CompareResult,
  SwitchPathResult,
  RenamePathResult,
  NewPathResult,
  BringOverResult,
} from '../../src/session/index.js';

export interface CreateAnalystOptions {
  /** The seeded dataset as CSV text (the server reads it once and passes it in). */
  readonly csv: string;
  /** Use the scripted mock provider (tests / no-API-key mode) instead of Anthropic. */
  readonly mock?: boolean;
  /**
   * Override the provider outright (tests that need a DIFFERENT scripted
   * sequence than the default `scriptedAnalystMock`, e.g. the reencode path).
   * Takes precedence over `mock`.
   */
  readonly provider?: LLMProvider;
}

/** The human's dispatch request, straight off `/api/dispatch`. */
export interface UserDispatchBody {
  readonly verb: 'filter' | 'select' | 'analyze' | 'reencode';
  readonly viewId?: string;
  readonly field?: string;
  readonly value?: unknown;
  readonly range?: readonly [number, number] | null;
  readonly analysisId?: string;
  /** The visual channel a `reencode` rebinds (e.g. 'x', 'y', 'category'). */
  readonly channel?: string;
  readonly intent?: string;
}

/** One branch tip in the branch map (a leaf of the append-only commit DAG). */
export interface BranchDot {
  readonly tip: string;
  readonly length: number;
  readonly actor: string;
  readonly active: boolean;
}

/** One named log position (the checkpoint verb). */
export interface CheckpointInfo {
  readonly label: string;
  readonly commitId: string | null;
  readonly ts: number;
}

/** The human's `/api/paths` request body — one of the three named-path actions. */
export interface PathsRequestBody {
  readonly action: 'switch' | 'rename' | 'new';
  /** switch target / new path's optional custom name. */
  readonly name?: string;
  /** rename source. */
  readonly from?: string;
  /** rename target. */
  readonly to?: string;
  /** the commit a new path starts at. */
  readonly commitId?: string;
}

/** Everything `/api/state` returns — the single render source for the browser. */
export interface AnalystState {
  readonly records: unknown;
  readonly fdr: unknown;
  readonly analyses: unknown;
  readonly activeSelections: unknown;
  readonly views: unknown;
  readonly gaps: unknown;
  readonly selectedCount: number;
  readonly totalRows: number;
  /** The table `select`/`filter`/`analyze`/`reencode` operate over (vizfootprint-ui's adapter needs this). */
  readonly defaultTable: string;
  /** table → column facets (schema; UI-2 — feeds the EncodingPicker). */
  readonly columns: unknown;
  /** viewId → channel→field map (UI-0's `reencode` fold; UI-2 — feeds chart axis fields). */
  readonly encodings: unknown;
  readonly activity: readonly ActivityStep[];
  readonly turnActive: boolean;
  readonly mode: 'mock' | 'live';
  // ── time-travel (Phase B) ──
  /** The read-only cursor (where the next act branches from); null before any commit. */
  readonly cursor: string | null;
  /** The active branch head (tip of the lineage linear commits extend). */
  readonly head: string | null;
  /** Every divergent lineage (leaf) in the DAG, active flagged — the branch map. */
  readonly branches: readonly BranchDot[];
  /** Named log positions (checkpoint flags on the timeline). */
  readonly checkpoints: readonly CheckpointInfo[];
  /** Test-analog commits visible on the cursor's branch path (the cursor-local truth). */
  readonly cursorTests: number;
  /** Whether the cursor is behind the active head (you are viewing the past). */
  readonly viewingPast: boolean;
  /** BR-3: the named-paths surface (BR-1's refs + journal) — feeds the pill/modal/toast. */
  readonly paths: PathsState;
}

export interface Analyst {
  chat(message: string): Promise<{ text: string; correlationId: string }>;
  dispatchUser(body: UserDispatchBody): Promise<DispatchResult | { ok: false; error: string }>;
  /** Move the read-only cursor to a prior commit + rebuild the fold there (charts/log/ledger re-render). */
  seek(commitId: string): Promise<{ ok: boolean; cursor?: string | null; error?: string }>;
  /** Name the current cursor position (the checkpoint verb, badged `user`). */
  checkpoint(label: string): Promise<DispatchResult | { ok: false; error: string }>;
  /**
   * Work with the NAMED paths (BR-1 refs): list is read straight off `state()`'s
   * `paths` field, so this only ever needs switch/rename/new — the human-only
   * surface (the agent drives the SAME session methods through its own `paths`
   * tool, never this endpoint).
   */
  paths(body: PathsRequestBody): Promise<SwitchPathResult | RenamePathResult | NewPathResult | { ok: false; error: string }>;
  /** Read-only structured diff between two positions (path names or commit ids). */
  compare(a: string, b: string): Promise<CompareResult | { ok: false; error: string }>;
  /** Cherry-pick a commit from another path onto the current position (badged `user`). */
  bringOver(commitId: string): Promise<BringOverResult | { ok: false; error: string }>;
  /** Revert a commit's step — restore its parent's value (badged `user`). */
  undo(commitId: string): Promise<BringOverResult | { ok: false; error: string }>;
  state(): Promise<AnalystState>;
  /** The current turn's AgentThinkingUI Trace — served at GET /api/trace, polled
   *  by the /debug page. Grows live during a run; resets per user message. */
  trace(): AttTrace;
}

export function createAnalyst(options: CreateAnalystOptions): Analyst {
  const { session, port, rows } = buildAnalystSurface(options.csv);
  const mode: 'mock' | 'live' = options.mock ? 'mock' : 'live';

  // Per-turn live activity buffer — the browser polls it while a turn runs so
  // the user sees the agent's tool calls, not just a spinner.
  let activity: ActivityStep[] = [];
  let turnActive = false;

  const assistant = createAssistant(port, {
    provider: options.provider ?? (options.mock ? scriptedAnalystMock() : undefined),
    onActivity: (step) => {
      activity.push(step);
      if (activity.length > 60) activity.shift();
    },
  });

  function userCause(intent: string): Cause {
    return { requestedBy: 'user', computedBy: 'user', intent };
  }

  return {
    trace() {
      return assistant.trace();
    },

    async chat(message: string) {
      activity = []; // fresh strip per turn
      turnActive = true;
      try {
        return await assistant.send(message);
      } finally {
        turnActive = false;
      }
    },

    async dispatchUser(body: UserDispatchBody) {
      const intent = typeof body.intent === 'string' ? body.intent : `${body.verb} ${body.field ?? body.analysisId ?? ''}`.trim();
      const cause = userCause(intent);
      let action: DispatchAction;
      if (body.verb === 'filter') {
        if (typeof body.viewId !== 'string' || typeof body.field !== 'string') return { ok: false, error: 'filter needs viewId and field' };
        action = { verb: 'filter', viewId: body.viewId, field: body.field, range: body.range ?? null, cause };
      } else if (body.verb === 'select') {
        if (typeof body.viewId !== 'string' || typeof body.field !== 'string') return { ok: false, error: 'select needs viewId and field' };
        action = { verb: 'select', viewId: body.viewId, field: body.field, value: body.value, cause };
      } else if (body.verb === 'analyze') {
        if (typeof body.analysisId !== 'string') return { ok: false, error: 'analyze needs analysisId' };
        action = { verb: 'analyze', analysisId: body.analysisId, cause };
      } else if (body.verb === 'reencode') {
        if (typeof body.viewId !== 'string' || typeof body.channel !== 'string' || typeof body.field !== 'string') {
          return { ok: false, error: 'reencode needs viewId, channel, and field' };
        }
        action = { verb: 'reencode', viewId: body.viewId, channel: body.channel, field: body.field, cause };
      } else {
        return { ok: false, error: `unsupported human verb "${String((body as { verb?: unknown }).verb)}"` };
      }
      // The human path forces the acting principal to 'user' (agent path is 'agent').
      return session.dispatch(action, { as: 'user' });
    },

    async seek(commitId: string) {
      if (typeof commitId !== 'string' || commitId.length === 0) return { ok: false, error: 'seek needs a commitId' };
      const res = session.seek(commitId);
      return res.ok ? { ok: true, cursor: res.cursor } : { ok: false, error: res.gap.detail };
    },

    async checkpoint(label: string) {
      if (typeof label !== 'string' || label.trim().length === 0) return { ok: false, error: 'checkpoint needs a non-empty label' };
      // The human path names the position (badged `user`); the agent uses its own checkpoint tool.
      return session.dispatch({ verb: 'checkpoint', label, cause: userCause(`checkpoint ${label}`) }, { as: 'user' });
    },

    async paths(body: PathsRequestBody) {
      if (body.action === 'switch') {
        if (typeof body.name !== 'string' || body.name.length === 0) return { ok: false, error: 'paths switch needs a name' };
        return session.switchPath(body.name);
      }
      if (body.action === 'rename') {
        if (typeof body.from !== 'string' || typeof body.to !== 'string') {
          return { ok: false, error: 'paths rename needs string from and to' };
        }
        return session.renamePath(body.from, body.to);
      }
      if (body.action === 'new') {
        if (typeof body.commitId !== 'string' || body.commitId.length === 0) return { ok: false, error: 'paths new needs a commitId' };
        return session.newPathAt(body.commitId, body.name);
      }
      return { ok: false, error: `unsupported paths action "${String((body as { action?: unknown }).action)}"` };
    },

    async compare(a: string, b: string) {
      if (typeof a !== 'string' || a.length === 0 || typeof b !== 'string' || b.length === 0) {
        return { ok: false, error: 'compare needs string a and b (path names or commit ids)' };
      }
      return session.compare(a, b);
    },

    async bringOver(commitId: string) {
      if (typeof commitId !== 'string' || commitId.length === 0) return { ok: false, error: 'bringOver needs a commitId' };
      // Human-only surface (badged `user`) — the agent has no bringOver tool.
      return session.bringOver(commitId, { as: 'user' });
    },

    async undo(commitId: string) {
      if (typeof commitId !== 'string' || commitId.length === 0) return { ok: false, error: 'undo needs a commitId' };
      return session.undo(commitId, { as: 'user' });
    },

    async state(): Promise<AnalystState> {
      const overview = await session.overview();
      const selected = await session.selectedRows();
      return {
        records: session.log.records,
        fdr: overview.fdr,
        analyses: overview.analyses,
        activeSelections: overview.activeSelections,
        views: overview.views,
        gaps: session.gaps(),
        selectedCount: selected.length,
        totalRows: rows.length,
        defaultTable: overview.defaultTable,
        columns: overview.columns,
        encodings: overview.encodings,
        activity,
        turnActive,
        mode,
        cursor: overview.time.cursor,
        head: overview.time.head,
        branches: session.branches().map((b) => ({ tip: b.tip, length: b.length, actor: b.actor, active: b.active })),
        checkpoints: session.checkpoints().map((c) => ({ label: c.label, commitId: c.commitId, ts: c.ts })),
        cursorTests: overview.time.cursorTests,
        viewingPast: overview.time.viewingPast,
        paths: overview.paths,
      };
    },
  };
}
