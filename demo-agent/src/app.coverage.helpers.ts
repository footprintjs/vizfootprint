/**
 * Shared fixtures + DOM/fetch harness for app.coverage.test.tsx.
 *
 * `app.tsx` self-mounts on import (`void main()`), reading `#dashboard` +
 * the chat/debugger chrome ids straight off `page.mjs`'s real PAGE markup,
 * and talks ONLY to `fetch` (never an injectable client) — so the harness
 * here (a) rebuilds the real page shell per test via `installDom()`, and
 * (b) stubs `globalThis.fetch` with a small stateful router (`FakeApi`) that
 * serves `/data/dresses.csv`, `/api/state` (shared by the dashboard's poll
 * AND the chat popup's own poll), and the POST endpoints, recording every
 * call for assertions.
 */
import { vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
// page.mjs is plain JS (no .d.ts) and demo-agent/tsconfig.json has no
// allowJs — every OTHER importer of a sibling .mjs (server.test.ts,
// smoke.test.ts, demo/demo.test.ts…) lives outside the tsconfig's
// `include: ["src"]` scope and never hits this; this is the first src/ file
// to. A relative-path `declare module` can only AUGMENT an already-typed
// module, not declare one from scratch, so the narrowest fix is suppressing
// this one diagnostic at the import site rather than widening the tsconfig.
// @ts-expect-error page.mjs is untyped JS — PAGE is a plain exported string, verified by every test that boots the app against it.
import { PAGE } from '../page.mjs';

// ── fixture rows / CSV (7 rows, one per CATEGORIES entry + 2 extra Casual/Formal;
// date/region added alongside the real demo-agent schema — see gen-data.mjs) ──
export const CSV_TEXT = `id,category,price,rating,date,region
r1,Casual,50,4,2026-04-05,Northlands
r2,Casual,65,3.5,2026-04-20,Coastal Strip
r3,Formal,220,2,2026-05-10,Midlands
r4,Formal,180,4.5,2026-05-25,Southreach
r5,Party,90,5,2026-06-01,Northlands
r6,Work,60,1,2026-06-15,Coastal Strip
r7,Summer,300,3,2026-06-28,Midlands
`;

export const COLS = [
  { field: 'price', type: 'number' },
  { field: 'rating', type: 'number' },
  { field: 'category', type: 'string' },
  { field: 'date', type: 'string' },
  { field: 'region', type: 'string' },
];

/** The full boot fixture: rich enough to exercise every non-default app.tsx branch. */
export const STATE_A = {
  records: [
    { id: 'c1', parent: null, viewId: 'scatter', kind: 'interval', field: 'price', value: [40, 250], cause: { requestedBy: 'user', intent: 'brush price' } },
    { id: 'c2', parent: 'c1', viewId: 'bar', kind: 'point', field: 'category', value: 'Casual', cause: { requestedBy: 'agent', intent: 'select casual' } },
  ],
  views: [
    { viewId: 'scatter', actor: 'user', encodings: { x: 'rating', y: 'price' }, columns: COLS },
    { viewId: 'bar', actor: 'user', encodings: { category: 'category' }, columns: COLS },
  ],
  activeSelections: [
    { viewId: 'scatter', field: 'price', kind: 'interval', value: [40, 250] },
    { viewId: 'ghost', field: 'x', kind: 'interval', value: null },
    { viewId: 'bar', field: 'category', kind: 'point', value: 'Casual' },
    // a CLEARED table selection — at the adapter tier a nullish point value
    // means "cleared" (see ui/src/contract/selection.ts), so it contributes
    // no filtering AND no derived row outline: it exercises the contract's
    // cleared-point arm WITHOUT perturbing any of the row-count assertions
    // above, which were tuned against exactly the scatter+bar clauses.
    { viewId: 'table', field: 'id', kind: 'point', value: undefined },
  ],
  analyses: [
    { id: 'correlation', kind: 'stat', produces: 'r', ready: true, selectedRows: 2, minPoints: 2 },
    { id: 'cluster', kind: 'ml', produces: 'cluster_id', ready: false, blockedBy: 'not-enough-rows', missingColumns: ['price'] },
  ],
  fdr: { procedure: 'LORD++', alpha: 0.05, tests: 1, discoveries: 0, wealth: 0.9, ledger: [{ step: 1, hypothesisId: 'h1', pValue: 0.2, alphaThreshold: 0.05, reject: false, wealthAfter: 0.9 }] },
  gaps: [{ code: 'E_NO_COLUMN', op: 'reencode', detail: 'no such column', target: 'scatter' }],
  branches: [{ tip: 'c2', length: 2, actor: 'agent', active: true }],
  bookmarks: [{ label: 'start', commitId: 'c1', ts: 1000 }],
  columns: { data: COLS },
  // 'line' is explicitly present (exercises the encodings["line"] ?? {} TRUTHY
  // arm) but names the SAME fields the app-side default would — x MUST stay
  // the real 'date' column so the line chart has actually-parseable dates to
  // brush (a non-date field like 'price' stringifies to e.g. "50", which
  // Date.parse() rejects, and VizLine silently skips every unparseable point).
  encodings: { scatter: { x: 'rating', y: 'price' }, line: { x: 'date', y: 'price' } },
  cursor: 'c2',
  head: 'c2',
  viewingPast: false,
  cursorTests: 1,
  defaultTable: 'data',
  mode: 'mock' as const,
  activity: [
    { tool: 'whats_here', args: {}, result: undefined },
    {
      tool: 'dispatch',
      args: { verb: 'filter', viewId: 'scatter', field: 'price', range: [10, 20], extra: undefined },
      result: { ok: false, gap: { code: 'E_BAD', detail: 'bad' } },
    },
    { tool: 'dispatch', args: { verb: 'select', value: 'Casual' }, result: { ok: false, reason: 'no active view' } },
    { tool: 'dispatch', args: {}, result: { ok: false } },
    { tool: 'whats_here', args: {}, result: { views: [1, 2], activeSelections: [1], fdr: { tests: 5 }, gaps: 2 } },
    { tool: 'whats_here', args: {}, result: { views: [], activeSelections: [], gaps: 0 } },
    {
      tool: 'dispatch',
      args: { verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'rating' },
      result: { verb: 'reencode', reencoded: { viewId: 'scatter', channel: 'x', field: 'rating' } },
    },
    { tool: 'dispatch', args: { verb: 'filter' }, result: { verb: 'filter', commit: { id: 'c9', field: 'price', value: 123.456 } } },
    {
      tool: 'dispatch',
      args: { verb: 'analyze', analysisId: 'correlation' },
      result: { verb: 'analyze', analysis: { analysisId: 'correlation', kind: 'stat', fdrStep: { pValue: 0.031, reject: true } } },
    },
    {
      tool: 'dispatch',
      args: { verb: 'analyze', analysisId: 'x'.repeat(40) },
      result: { verb: 'analyze', analysis: { analysisId: 'x'.repeat(40), kind: 'stat' } },
    },
    { tool: 'why', args: { target: 'cluster_id', extraFlag: true, noneVal: null }, result: { tiers: ['a', 'b'], slice: {} } },
    { tool: 'fork', args: { label: 'branch2' }, result: {} },
  ],
  turnActive: false,
};

/** Same shape, but exercises every OPPOSITE default/fallback branch. */
export const STATE_B = {
  records: [],
  views: [{ viewId: 'scatter', actor: 'user' }],
  activeSelections: [],
  analyses: [],
  fdr: {},
  gaps: [],
  branches: [],
  bookmarks: [],
  cursor: null,
  head: null,
  viewingPast: true,
  cursorTests: 0,
  defaultTable: 'data',
  mode: 'live' as const,
  activity: [],
  turnActive: false,
};

/** Cursor sits BEHIND head (viewingPast) — for return-to-now / step-forward. */
export const STATE_VIEWING_PAST = { ...STATE_A, cursor: 'c1', viewingPast: true };

/**
 * BOTH scatter axes reencoded onto a NON-numeric column (agent-driven;
 * bypasses the picker's own gate) — plus the line's own y channel reencoded
 * onto a non-numeric column too (lineData's `typeof r[lineY] === 'number' ? … : 0` false arm).
 */
export const STATE_NONNUMERIC_XY = {
  ...STATE_B,
  encodings: { scatter: { x: 'category', y: 'category' }, line: { x: 'date', y: 'category' } },
};

/**
 * One selection whose viewId IS 'bar' but whose kind is NOT 'point' (the
 * derived bar outline stays empty — `selfSelectedValue` ignores intervals) —
 * plus a CLEARED map selection and a REAL table selection, the opposite combo
 * from STATE_A/STATE_MAP_SELECTED, so the contract derivation's "present but
 * cleared" vs "present with a value" arms both get exercised somewhere.
 */
export const STATE_EDGE_SELECTION = {
  ...STATE_B,
  activeSelections: [
    { viewId: 'bar', field: 'price', kind: 'interval', value: [1, 2] },
    { viewId: 'map', field: 'region', kind: 'point', value: undefined },
    { viewId: 'table', field: 'id', kind: 'point', value: 'r3' },
  ],
  columns: { data: COLS },
  encodings: { scatter: { x: 'price', y: 'rating' } },
  mode: 'mock' as const,
  viewingPast: false,
};

/**
 * RP-3: STATE_A plus a GOOD agent-authored chart — a single-view spec with an
 * interval brush over real columns, which the v1 vega-lite bridge renders. The
 * cockpit mounts a real `<ProposedChartCell>` (the RP-2 bind path) for it.
 */
export const STATE_WITH_CHART = {
  ...STATE_A,
  charts: [
    {
      chartId: 'pr',
      viewId: 'chart:pr',
      claim: 'price vs rating',
      authoredBy: 'agent',
      ledgerStep: 1,
      spec: {
        mark: { type: 'circle' },
        params: [{ name: 'b', select: { type: 'interval', encodings: ['x'] } }],
        encoding: { x: { field: 'price', type: 'quantitative' }, y: { field: 'rating', type: 'quantitative' } },
      },
    },
  ],
};

/**
 * RP-3: a ledgered chart whose spec the v1 bridge CANNOT host (no selection
 * param — a mute chart). `vegaLiteRenderer` throws; `<ProposedChartCell>` shows
 * the honest "cannot render" note instead of crashing.
 */
export const STATE_WITH_BAD_CHART = {
  ...STATE_B,
  charts: [
    {
      chartId: 'mute',
      viewId: 'chart:mute',
      claim: 'a mute chart',
      authoredBy: 'agent',
      ledgerStep: 1,
      spec: { mark: 'circle', encoding: { x: { field: 'price', type: 'quantitative' }, y: { field: 'rating', type: 'quantitative' } } },
    },
  ],
};

/**
 * LY-2: STATE_A plus a landed layout note — `overview().layouts` verbatim,
 * scope -> prop -> value (see core.ts's `state()`). The adapter's
 * `parseLayout` turns `layouts.dashboard` into the cockpit's `layout` prop.
 */
export const STATE_WITH_LAYOUT = {
  ...STATE_A,
  layouts: { dashboard: { preset: 'grid' } },
};

/** LY-2: the RP-3 agent chart PLUS a `focus` arrangement on the scatter — proves an agent-authored cell also plays by the focus/thumbnail rules. */
export const STATE_WITH_CHART_FOCUSED = {
  ...STATE_WITH_CHART,
  layouts: { dashboard: { preset: 'focus', focus: 'scatter' } },
};

/** LY-2: already on the `focus` preset (no explicit focusId -> the first cell, 'scatter', is the hero) — for exercising the thumbnail-overlay click without depending on a chained dispatch actually mutating the fake server's state. */
export const STATE_FOCUS_PRESET = {
  ...STATE_A,
  layouts: { dashboard: { preset: 'focus' } },
};

/** A real map region selection (Northlands) over an otherwise-empty baseline — the derived map outline's "present with a value" arm. */
export const STATE_MAP_SELECTED = {
  ...STATE_B,
  activeSelections: [{ viewId: 'map', field: 'region', kind: 'point', value: 'Northlands' }],
  columns: { data: COLS },
  mode: 'mock' as const,
};

/**
 * BR-3: STATE_A plus a populated named-paths surface — two paths ('main'
 * active, 'side-quest' not), and exactly ONE ref-create journal entry (the
 * first-ever create, which ForkToast never treats as a fork). A test that
 * wants to prove the toast fires appends a SECOND auto-create event to this
 * same base (see the ForkToast describe block).
 */
export const STATE_WITH_PATHS = {
  ...STATE_A,
  paths: {
    current: 'main',
    detachedAt: null,
    list: [
      { name: 'main', tip: 'c2', steps: 2, lastTs: 2000, active: true },
      { name: 'side-quest', tip: 'c1', steps: 1, lastTs: 1500, active: false },
    ],
    events: [{ type: 'create', name: 'main', at: 'c1', auto: true, ts: 1000 }],
  },
};

/**
 * TL-1 — the same two paths plus an ARCHIVED one, as `/api/state` serializes it:
 * `paths.list` holds only the VISIBLE rows while `paths.archivedList` carries the
 * hidden ones flagged (the documented adapter extension, composed by core.ts's
 * `state()`), and `paths.archived` is the count `whats_here` reports.
 */
export const STATE_WITH_ARCHIVED = {
  ...STATE_A,
  paths: {
    ...STATE_WITH_PATHS.paths,
    archived: 1,
    archivedList: [
      ...STATE_WITH_PATHS.paths.list,
      { name: 'dead-end', tip: 'c1', steps: 1, lastTs: 900, active: false, archived: true },
    ],
  },
};

export interface Call {
  readonly url: string;
  readonly method: string;
  readonly body?: unknown;
}

type ChatQueueEntry = 'reject' | { text?: string; error?: string } | Promise<{ text?: string; error?: string }>;

/** A small stateful `/api/*` router standing in for demo-agent/server.mjs. */
export class FakeApi {
  calls: Call[] = [];
  csv = CSV_TEXT;
  state: unknown = STATE_A;
  /**
   * Fails a FUTURE GET /api/state call, `skip` successful calls from now
   * (0 = the very next call). Needed because several app.tsx code paths fire
   * TWO back-to-back /api/state GETs (e.g. sendMessage's finally block does
   * `await view.refresh()` THEN `await getChatState()`) and a test may need
   * to target only the second one. Consumed once, then cleared.
   */
  stateFailPlan: { mode: 'throw' | 'notok'; skip: number } | null = null;
  chatQueue: ChatQueueEntry[] = [];
  resetCalls = 0;

  /** Convenience setter for the common "fail the very next GET /api/state" case. */
  set stateFailMode(mode: 'throw' | 'notok' | null) {
    this.stateFailPlan = mode === null ? null : { mode, skip: 0 };
  }

  fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    this.calls.push({ url, method, body });

    if (url === '/data/dresses.csv') {
      return { ok: true, text: async () => this.csv } as unknown as Response;
    }
    if (url === '/api/state') {
      if (this.stateFailPlan) {
        if (this.stateFailPlan.skip > 0) {
          this.stateFailPlan = { ...this.stateFailPlan, skip: this.stateFailPlan.skip - 1 };
        } else {
          const { mode } = this.stateFailPlan;
          this.stateFailPlan = null;
          if (mode === 'throw') throw new Error('network down');
          return { ok: false, json: async () => ({}) } as unknown as Response;
        }
      }
      // JSON round-trip — mirrors real HTTP (drops `undefined`-valued keys),
      // and stops one test's later mutation of `this.state` from silently
      // rewriting a snapshot a prior fetch already handed out.
      const snapshot = JSON.parse(JSON.stringify(this.state)) as unknown;
      return { ok: true, json: async () => snapshot } as unknown as Response;
    }
    if (url === '/api/paths' && method === 'POST' && (body as { action?: string })?.action === 'adopt') {
      // TL-1: `adopt` is the ONE lifecycle action whose ANSWER the UI reads back
      // (the AdoptToast reports it), so the fake server answers a real
      // AdoptPathResult shape — the other actions just need an ok.
      return {
        ok: true,
        json: async () => ({
          ok: true,
          path: (body as { name: string }).name,
          ancestor: 'c1',
          applied: 1,
          skipped: 1,
          conflicts: ['c2'],
          steps: [
            { commitId: 'c3', applied: true, landedAs: 'c9', conflicts: ['c2'] },
            { commitId: 'c4', applied: false, conflicts: [], skippedReason: 'an agent-authored chart is proposed, not replayed' },
          ],
        }),
      } as unknown as Response;
    }
    if (url === '/api/compare' && method === 'POST') {
      // A well-formed CompareResult (src/session shape) — the app's own
      // `onCompare` wiring just needs a real response to pass through
      // `mapCompareResult` without crashing; the diff's CONTENT is
      // vizfootprint-ui's own concern (CompareModal is tested there).
      const { a, b } = body as { a: string; b: string };
      return {
        ok: true,
        json: async () => ({ ok: true, a: { ref: a, tip: a, rows: 3 }, b: { ref: b, tip: b, rows: 4 }, ancestor: 'c1', changed: [], onlyA: [], onlyB: [] }),
      } as unknown as Response;
    }
    if (url === '/api/chat' && method === 'POST') {
      const next = this.chatQueue.shift();
      if (next === 'reject') throw new Error('network down');
      const payload = next === undefined ? { text: 'default reply' } : await Promise.resolve(next);
      return { ok: true, json: async () => payload } as unknown as Response;
    }
    if (url === '/api/reset' && method === 'POST') {
      this.resetCalls++;
      return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
    }
    if (method === 'POST') {
      return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
    }
    return { ok: false, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;

  callsTo(url: string): Call[] {
    return this.calls.filter((c) => c.url === url);
  }
}

/**
 * jsdom never lays anything out — every element's layout reads are zero. The
 * cockpit's `<ChartFrame>` (ui/src/charts/ChartFrame.tsx) measures its LAYOUT
 * box (`offsetWidth`/`offsetHeight` — transform-proof, so a FLIP morph can
 * never freeze a stale size into the viewBox) and renders NOTHING until it
 * sees a non-zero size (by design — a chart must never flash at a wrong
 * scale), so without these stubs the scatter/bar never mount in these tests
 * at all. `getBoundingClientRect` stays stubbed too: the charts' POINTER math
 * (VizScatter/VizLine brush-to-data conversion) reads the visual rect. A
 * fixed, generous box is enough — none of these tests assert exact pixel
 * geometry.
 */
function stubChartLayout(): void {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(480);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: 800, height: 480, top: 0, left: 0, right: 800, bottom: 480, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
}

/** Rebuild the real page chrome (the ids app.tsx's `main()`/`wireChatAndDebugger` require). */
export function installDom(): void {
  const parsed = new DOMParser().parseFromString(PAGE, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
  stubChartLayout();
}

if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class PE extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: typeof PE }).PointerEvent = PE;
}

/** Resolve N microtask turns — enough depth for app.tsx's fetch/json await chains. */
export async function flush(n = 60): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

export function getVizAgent(): { view: { refresh(): Promise<void>; dispose(): void } } | undefined {
  return (window as unknown as { __vizAgent?: { view: { refresh(): Promise<void>; dispose(): void } } }).__vizAgent;
}

/** A tiny deferred promise — used to hold `/api/chat` pending across a fake-timer advance. */
export function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export { fireEvent };
