/**
 * The shared analytical surface for the mixed-principal demo.
 *
 * ONE {@link InteractionSession} is built here (via the L5 declare→connect
 * grammar) and handed to BOTH principals:
 *   - the human, whose brushes/clicks arrive over `/api/dispatch` and land as
 *     `user`-badged commits (`session.dispatch(action, { as: 'user' })`);
 *   - the agent, which drives the SAME session through the fixed Mode-B tool
 *     port (`vizAsTools(session, { as: 'agent' })`) and lands `agent`-badged
 *     commits.
 * The mixed-principal commit log IS the demo — one append-only, cause-tagged
 * history with two visibly different authors.
 *
 * The def mirrors the analyst demo's shape (four declared analyses + a LORD++
 * ledger) so the agent has real statistics to declare and a real online-FDR
 * ledger to read back honestly. Data values never appear in any authored
 * string — only in the `rows` DATA field (Q8 two-string discipline).
 */
import { buildDashboard, vizAsTools } from '../../src/agent/index.js';
import type { InteractionSession, VizToolsPort } from '../../src/agent/index.js';
import type { DashboardDef } from '../../src/agent/index.js';
import type { ActorMeta } from '../../src/mosaic/index.js';
import {
  correlationAnalysis,
  clusteringAnalysis,
  regressionAnalysis,
  groupByAnalysis,
} from '../../src/analysis/index.js';
import { parseCSVTyped } from '../../src/data/csv.js';

const ALPHA = 0.05;
const CLUSTER_K = 4;

/** The four declared views: two the human drives, two the agent drives. */
const SCATTER: ActorMeta = { actor: 'user', label: 'Price brush' };
const BAR: ActorMeta = { actor: 'user', label: 'Category' };
const AGENT: ActorMeta = { actor: 'agent', label: 'Analyst' };
const CLUSTER: ActorMeta = { actor: 'agent', label: 'Cluster picker' };

/** One row of the seeded dataset (dresses.csv). */
export interface AnalystRow {
  readonly id: string;
  readonly category: string;
  readonly price: number;
  readonly rating: number;
  [k: string]: string | number;
}

export interface AnalystSurface {
  readonly session: InteractionSession;
  readonly port: VizToolsPort;
  readonly rows: readonly AnalystRow[];
}

/** Parse the seeded CSV into typed rows (the REAL src/data parser). */
export function parseAnalystRows(csv: string): AnalystRow[] {
  const parsed = parseCSVTyped(csv);
  return parsed.rows.map((r) => ({
    id: String(r['id']),
    category: String(r['category']),
    price: Number(r['price']),
    rating: Number(r['rating']),
  }));
}

/**
 * Build one live session over the seeded rows + its fixed Mode-B tool port.
 * The session default actor is `agent` (the tool port's principal); the human
 * path overrides it per dispatch with `{ as: 'user' }`.
 */
export function buildAnalystSurface(csv: string): AnalystSurface {
  const rows = parseAnalystRows(csv);
  const def: DashboardDef = {
    meta: { title: 'vizfootprint — mixed-principal analyst' },
    data: { data: { rows } },
    actors: { scatter: SCATTER, bar: BAR, agent: AGENT, cluster: CLUSTER },
    analyses: {
      correlation: correlationAnalysis({ x: 'price', y: 'rating' }),
      clustering: clusteringAnalysis({ column: 'price', k: CLUSTER_K, table: 'data', outColumn: 'cluster_id' }),
      regression: regressionAnalysis({ x: 'price', y: 'rating' }),
      groupby: groupByAnalysis({ by: 'category', measure: 'price' }),
    },
    fdr: { procedure: 'LORD++', alpha: ALPHA },
    defaultTable: 'data',
  };
  const dashboard = buildDashboard(def); // declare (offline, no API key)
  const session = dashboard.createSession({ as: 'agent' }); // connect (one live session)
  const port = vizAsTools(session, { as: 'agent' }); // serve (fixed Mode-B tools)
  return { session, port, rows };
}
