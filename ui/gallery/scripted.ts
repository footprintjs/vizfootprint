/**
 * The gallery's scripted IN-MEMORY session — a REAL InteractionSession (the
 * actual L5 declare→connect grammar, not a mock), driven through a short
 * two-principal story so every component has real state to render:
 *
 *   #1 user brushes price          → a user commit (the fork point later)
 *   ⚑  "opening brush"             → checkpoint (present-mode beat 1)
 *   #2 agent selects Formal        → an agent commit
 *   #3 user declares correlation   → an FDR ledger row (a real LORD++ step)
 *   ⚑  "first test"                → checkpoint (beat 2)
 *   —  user tries reencode(theta)  → an HONEST typed gap (invalid channel)
 *   —  user seeks back to #1, brushes again → BRANCH-ON-ACT (two lineages;
 *      #2/#3 dim off-branch in the log; the branch map forks)
 *
 * The def also declares a regression on a column that doesn't exist, so the
 * ReadinessPanel shows a real blocked-with-reason row.
 */
import { buildDashboard } from '../../src/agent/index.js';
import type { InteractionSession } from '../../src/agent/index.js';
import type { Cause } from '../../src/cause/index.js';
import { correlationAnalysis, regressionAnalysis } from '../../src/analysis/index.js';
import { galleryRows, type GalleryRow } from './data.js';

function cause(requestedBy: 'user' | 'agent', intent: string): Cause {
  return { requestedBy, computedBy: requestedBy, intent };
}

export interface ScriptedGallery {
  readonly session: InteractionSession;
  readonly rows: readonly GalleryRow[];
}

export async function buildScriptedSession(): Promise<ScriptedGallery> {
  const rows = galleryRows();
  const dashboard = buildDashboard({
    meta: { title: 'vizfootprint-ui gallery' },
    data: { data: { rows } },
    actors: {
      scatter: { actor: 'user', label: 'Price × rating' },
      bar: { actor: 'user', label: 'Category' },
      line: { actor: 'user', label: 'Price over time' },
      map: { actor: 'user', label: 'Rows by region' },
      // the "build your own chart" proof cell: VizHistogram, composed from the
      // PUBLIC primitives tier — declared like any first-party view so its
      // bucket-brush emissions land real commits.
      histogram: { actor: 'user', label: 'Price distribution' },
      // D29: the compound-cell chart — one cell click selects price AND
      // category together, landing ONE commit (the heatmap is the only view
      // that declares the cell emission kind; see `capabilities` below).
      heatmap: { actor: 'user', label: 'Price × category' },
      // the vizfootprint-vega-lite bridge cell (RP-2): a THIRD-PARTY-shaped
      // renderer riding the SAME declared-view/crossfilter loop as the four
      // first-party charts above — must be declared here for its emissions
      // to land real commits (an undeclared viewId never lands one).
      vl: { actor: 'user', label: 'Rating × price (Vega-Lite bridge)' },
    },
    encodings: [
      { viewId: 'scatter', chartKind: 'point', channels: ['x', 'y', 'color'], initial: { x: 'price', y: 'rating' } },
      { viewId: 'bar', chartKind: 'bar', channels: ['category'], initial: { category: 'category' } },
      { viewId: 'line', chartKind: 'line', channels: ['x', 'y', 'color'], initial: { x: 'date', y: 'price' } },
      { viewId: 'map', chartKind: 'map', channels: ['region'], initial: { region: 'region' } },
      { viewId: 'histogram', chartKind: 'histogram', channels: ['x'], initial: { x: 'price' } },
      { viewId: 'heatmap', chartKind: 'heatmap', channels: ['x', 'y'], initial: { x: 'price', y: 'category' } },
    ],
    // R14 honest capability: the heatmap emits ONLY the D29 cell kind — a
    // point/interval probe against it is a typed guard-failed gap, and a cell
    // against any classic chart likewise (they never declare 'cell').
    capabilities: [{ viewId: 'heatmap', canProbe: true, encodings: ['cell'] }],
    analyses: {
      correlation: correlationAnalysis({ x: 'price', y: 'rating' }),
      // 'discount' does not exist → an honestly BLOCKED readiness row
      regression: regressionAnalysis({ x: 'price', y: 'discount' }),
    },
    fdr: { procedure: 'LORD++', alpha: 0.05 },
    defaultTable: 'data',
  });
  const session = dashboard.createSession({ as: 'user' });

  // #1 the user's opening brush (the later fork point)
  const first = await session.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [30, 210], cause: cause('user', 'opening price brush') });
  const firstId = first.ok && first.commit ? first.commit.id : null;
  await session.dispatch({ verb: 'checkpoint', label: 'opening brush', cause: cause('user', 'checkpoint opening brush') });

  // #2 the agent narrows to Formal
  await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: cause('agent', 'focus Formal dresses') }, { as: 'agent' });

  // #3 a declared test → one real LORD++ ledger row
  await session.dispatch({ verb: 'analyze', analysisId: 'correlation', cause: cause('user', 'is price correlated with rating?') });
  await session.dispatch({ verb: 'checkpoint', label: 'first test', cause: cause('user', 'checkpoint first test') });

  // an HONEST gap: theta is not a declared channel on the scatter
  await session.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'theta', field: 'price', cause: cause('user', 'try an undeclared channel') });

  // branch-on-act: seek back to #1, brush differently → a second lineage
  if (firstId) {
    session.seek(firstId);
    await session.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [120, 220], cause: cause('user', 'what about the premium end?') });
  }

  // RP-3: the agent PROPOSES a chart at runtime. It passes the governed
  // pipeline (single-view, no host-owned transforms, real columns) → ledgered
  // as an untested hypothesis, then rendered as a real cockpit cell (below,
  // in entry.tsx, via the SAME RP-2 bridge as the 'vl' cell) that crossfilters.
  await session.proposeChart(
    {
      id: 'agent-price-rating',
      claim: 'price vs rating, colored by category, reveals a relationship',
      spec: {
        mark: { type: 'circle', size: 60 },
        params: [{ name: 'vzfProposedBrush', select: { type: 'interval', encodings: ['x'] } }],
        encoding: {
          x: { field: 'price', type: 'quantitative', title: 'Price' },
          y: { field: 'rating', type: 'quantitative', title: 'Rating' },
          color: { field: 'category', type: 'nominal' },
        },
      },
    },
    { as: 'agent' },
  );

  // RP-3: a REJECTED proposal — the spec carries its own aggregate (a host-owned
  // transform), so the pipeline refuses it with a typed gap and renders NOTHING.
  // It shows in the Gaps panel with its reason (chart-transforms-not-owned).
  await session.proposeChart(
    {
      id: 'agent-bad-agg',
      claim: 'mean price per category',
      spec: {
        mark: 'bar',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'price', type: 'quantitative', aggregate: 'mean' },
        },
      },
    },
    { as: 'agent' },
  );

  return { session, rows };
}
