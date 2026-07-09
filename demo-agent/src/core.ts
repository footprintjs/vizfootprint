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
import type { Cause } from '../../src/cause/index.js';
import type { DispatchAction, DispatchResult } from '../../src/agent/index.js';

export interface CreateAnalystOptions {
  /** The seeded dataset as CSV text (the server reads it once and passes it in). */
  readonly csv: string;
  /** Use the scripted mock provider (tests / no-API-key mode) instead of Anthropic. */
  readonly mock?: boolean;
}

/** The human's dispatch request, straight off `/api/dispatch`. */
export interface UserDispatchBody {
  readonly verb: 'filter' | 'select' | 'analyze';
  readonly viewId?: string;
  readonly field?: string;
  readonly value?: unknown;
  readonly range?: readonly [number, number] | null;
  readonly analysisId?: string;
  readonly intent?: string;
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
  readonly activity: readonly ActivityStep[];
  readonly turnActive: boolean;
  readonly mode: 'mock' | 'live';
}

export interface Analyst {
  chat(message: string): Promise<{ text: string; correlationId: string }>;
  dispatchUser(body: UserDispatchBody): Promise<DispatchResult | { ok: false; error: string }>;
  state(): Promise<AnalystState>;
}

export function createAnalyst(options: CreateAnalystOptions): Analyst {
  const { session, port, rows } = buildAnalystSurface(options.csv);
  const mode: 'mock' | 'live' = options.mock ? 'mock' : 'live';

  // Per-turn live activity buffer — the browser polls it while a turn runs so
  // the user sees the agent's tool calls, not just a spinner.
  let activity: ActivityStep[] = [];
  let turnActive = false;

  const assistant = createAssistant(port, {
    provider: options.mock ? scriptedAnalystMock() : undefined,
    onActivity: (step) => {
      activity.push(step);
      if (activity.length > 60) activity.shift();
    },
  });

  function userCause(intent: string): Cause {
    return { requestedBy: 'user', computedBy: 'user', intent };
  }

  return {
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
      } else {
        return { ok: false, error: `unsupported human verb "${String((body as { verb?: unknown }).verb)}"` };
      }
      // The human path forces the acting principal to 'user' (agent path is 'agent').
      return session.dispatch(action, { as: 'user' });
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
        activity,
        turnActive,
        mode,
      };
    },
  };
}
