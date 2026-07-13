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

/** The seven declared views: five the human drives, two the agent drives. */
const SCATTER: ActorMeta = { actor: 'user', label: 'Price brush' };
const BAR: ActorMeta = { actor: 'user', label: 'Category' };
const LINE: ActorMeta = { actor: 'user', label: 'Price over time' };
const MAP: ActorMeta = { actor: 'user', label: 'Rows by region' };
const TABLE: ActorMeta = { actor: 'user', label: 'Row table' };
const AGENT: ActorMeta = { actor: 'agent', label: 'Analyst' };
const CLUSTER: ActorMeta = { actor: 'agent', label: 'Cluster picker' };

/** One row of the seeded dataset (demo-agent/data/dresses.csv — see gen-data.mjs). */
export interface AnalystRow {
  readonly id: string;
  readonly category: string;
  readonly price: number;
  readonly rating: number;
  /** ISO-8601 date — the VizLine time axis + brush field. */
  readonly date: string;
  /** Sales region — matches a DEMO_GEO feature name (the VizMap field). */
  readonly region: string;
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
    date: String(r['date']),
    region: String(r['region']),
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
    actors: { scatter: SCATTER, bar: BAR, line: LINE, map: MAP, table: TABLE, agent: AGENT, cluster: CLUSTER },
    // UI-2: a declared visual-encoding surface per view — without this, ANY
    // reencode (human axis-click or agent dispatch) is an honest guard-failed
    // gap (R14: never guess a channel vocabulary for an undeclared chart kind).
    // 'table' is deliberately ABSENT here — it has no visual channel to
    // rebind (only a fixed id-based row selection), so it stays a declared
    // view (via `actors` above, appearing in whats_here's views/columns)
    // with no encoding surface, exactly per ViewEncodingDecl's own contract.
    encodings: [
      { viewId: 'scatter', chartKind: 'point', channels: ['x', 'y', 'color'], initial: { x: 'price', y: 'rating' } },
      { viewId: 'bar', chartKind: 'bar', channels: ['category'], initial: { category: 'category' } },
      { viewId: 'line', chartKind: 'line', channels: ['x', 'y', 'color'], initial: { x: 'date', y: 'price' } },
      { viewId: 'map', chartKind: 'map', channels: ['region'], initial: { region: 'region' } },
    ],
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
