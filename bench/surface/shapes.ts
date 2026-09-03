/**
 * Surface-bench shapes — a parameterised `DashboardDef` generator, so every
 * byte count in this bench carries the SHAPE it was measured at.
 *
 * Nothing here hand-writes an answer. `makeDef` builds a def and hands it to
 * the library's real `buildDashboard` door; the numbers come out of a real
 * `createSession()` + `vizAsTools(session)`. If the surface changes, the bench
 * changes with it — there is no second copy of the answer to drift.
 *
 * Five knobs, because those are the five things a host actually varies:
 * views, columns of the table, DECLARED link edges (on top of whatever the
 * `crossfilter` default rule materializes), declared analyses, and how many
 * prose slots carry words. Three named shapes: SMALL, REALISTIC (roughly nine
 * views over a ~thirty-column table with a dense link graph — the shape the
 * quoted numbers were always meant to be about) and LARGE.
 */

import { buildDashboard } from '../../src/agent/index.js';
import type { Dashboard, DashboardDef } from '../../src/agent/index.js';
import { clusteringAnalysis, correlationAnalysis, groupByAnalysis, regressionAnalysis, type DataRow } from '../../src/analysis/index.js';
import type { AnalysisSlot, CapabilityDecl, GrainDecl, ViewEncodingDecl } from '../../src/def/index.js';
import type { LinkDecl } from '../../src/links/index.js';
import type { ProseDecl, ProseSlot } from '../../src/prose/index.js';
import type { ColumnDecl } from '../../src/encoding/index.js';

// ── the knobs ────────────────────────────────────────────────────────────────

export interface ShapeSpec {
  /** Row label for every table this bench prints. */
  readonly name: string;
  /** Declared views (each gets an encoding surface, a capability and a grain). */
  readonly views: number;
  /** Columns of the one table, INCLUDING the id column and the date column. */
  readonly columns: number;
  /** DECLARED link edges, laid over the `crossfilter` default rule's materialized edges. */
  readonly links: number;
  /** Declared analyses. */
  readonly analyses: number;
  /** How many of the five prose slots carry words, per view. */
  readonly proseSlots: number;
  /** Rows of the table (never serialized into an answer — but it is what the engine counts). */
  readonly rows: number;
}

/** A dashboard of roughly nine views over a ~thirty-column table with a dense link graph. */
export const REALISTIC: ShapeSpec = { name: 'realistic', views: 9, columns: 30, links: 12, analyses: 6, proseSlots: 3, rows: 400 };
/** The smallest thing anyone would call a dashboard. */
export const SMALL: ShapeSpec = { name: 'small', views: 3, columns: 8, links: 2, analyses: 2, proseSlots: 1, rows: 120 };
/** A big one — where the shape stops being a rounding error on the answer. */
export const LARGE: ShapeSpec = { name: 'large', views: 20, columns: 80, links: 30, analyses: 12, proseSlots: 5, rows: 1200 };

export const SHAPES: readonly ShapeSpec[] = [SMALL, REALISTIC, LARGE];

// ── deterministic data ───────────────────────────────────────────────────────

/** Deterministic PRNG (mulberry32) — the same one bench/step0 and bench/x4 use. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ColumnPlan {
  readonly id: string;
  readonly date: string;
  readonly dims: readonly string[];
  readonly measures: readonly string[];
  readonly all: readonly string[];
}

/** `n` columns: one identifier, one date, the rest split evenly dimension / measure. */
export function planColumns(n: number): ColumnPlan {
  const rest = Math.max(4, n - 2);
  const nDims = Math.max(2, Math.floor(rest / 2));
  const nMeasures = Math.max(2, rest - nDims);
  const dims = Array.from({ length: nDims }, (_, i) => `dim_${String(i).padStart(2, '0')}`);
  const measures = Array.from({ length: nMeasures }, (_, i) => `m_${String(i).padStart(2, '0')}`);
  const id = 'row_id';
  const date = 'week';
  return { id, date, dims, measures, all: [id, date, ...dims, ...measures] };
}

const ISO_WEEK_0 = Date.UTC(2026, 0, 5);

/** Deterministic rows over the planned columns. Dimension cardinality stays small (6) so a select keeps a real share of the table. */
export function makeRows(plan: ColumnPlan, n: number, seed = 7): DataRow[] {
  const rnd = mulberry32(seed);
  const weeks = Array.from({ length: 26 }, (_, i) => new Date(ISO_WEEK_0 + i * 7 * 86_400_000).toISOString().slice(0, 10));
  const out: DataRow[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row: Record<string, unknown> = { [plan.id]: `r${i}`, [plan.date]: weeks[i % weeks.length]! };
    plan.dims.forEach((d, k) => {
      row[d] = `${d}_v${(i + k) % 6}`;
    });
    // measures rise together with a little noise, so correlation / regression fit rather than degenerate
    plan.measures.forEach((m, k) => {
      row[m] = Math.round((10 + i * 0.5 + k * 3 + rnd() * 8) * 100) / 100;
    });
    out[i] = row as DataRow;
  }
  return out;
}

// ── views ────────────────────────────────────────────────────────────────────

/** The chart kinds cycled across views — each with the channels its requirements actually accept (src/encoding/requirements.ts). */
const KINDS = ['point', 'bar', 'line', 'heatmap', 'boxplot', 'histogram'] as const;
type Kind = (typeof KINDS)[number];

export interface ViewPlan {
  readonly viewId: string;
  readonly kind: Kind;
  readonly channels: readonly string[];
  readonly initial: Readonly<Record<string, string>>;
  readonly selectionKinds: readonly ('point' | 'interval' | 'cell' | 'match')[];
  readonly grain: readonly string[];
}

/** One view's plan: chart kind, channels, a legal initial binding, its emission voice and its grain. */
function planView(i: number, p: ColumnPlan): ViewPlan {
  const kind = KINDS[i % KINDS.length]!;
  const d = (k: number): string => p.dims[(i + k) % p.dims.length]!;
  const m = (k: number): string => p.measures[(i + k) % p.measures.length]!;
  const viewId = `${kind}_${String(i).padStart(2, '0')}`;
  switch (kind) {
    case 'point':
      return { viewId, kind, channels: ['x', 'y', 'color', 'size'], initial: { x: m(0), y: m(1), color: d(0), size: m(2) }, selectionKinds: ['point', 'interval'], grain: [] };
    case 'bar':
      return { viewId, kind, channels: ['x', 'y', 'color'], initial: { x: d(0), y: m(0), color: d(1) }, selectionKinds: ['point'], grain: [d(0)] };
    case 'line':
      return { viewId, kind, channels: ['x', 'y', 'color'], initial: { x: p.date, y: m(0), color: d(0) }, selectionKinds: ['interval'], grain: [] };
    case 'heatmap':
      return { viewId, kind, channels: ['x', 'y', 'color'], initial: { x: d(0), y: d(1), color: m(0) }, selectionKinds: ['cell'], grain: [d(0), d(1)] };
    case 'boxplot':
      return { viewId, kind, channels: ['x', 'y'], initial: { x: d(0), y: m(0) }, selectionKinds: ['point'], grain: [d(0)] };
    case 'histogram':
      return { viewId, kind, channels: ['x'], initial: { x: m(0) }, selectionKinds: ['interval'], grain: [] };
  }
}

export function planViews(spec: ShapeSpec, p: ColumnPlan): ViewPlan[] {
  return Array.from({ length: spec.views }, (_, i) => planView(i, p));
}

// ── the def ──────────────────────────────────────────────────────────────────

const ANALYSIS_FACTORIES = ['correlation', 'regression', 'groupby', 'clustering'] as const;

function planAnalyses(spec: ShapeSpec, p: ColumnPlan, table: string): Record<string, AnalysisSlot> {
  const out: Record<string, AnalysisSlot> = {};
  for (let i = 0; i < spec.analyses; i++) {
    const which = ANALYSIS_FACTORIES[i % ANALYSIS_FACTORIES.length]!;
    const x = p.measures[i % p.measures.length]!;
    const y = p.measures[(i + 1) % p.measures.length]!;
    const by = p.dims[i % p.dims.length]!;
    const n = String(i).padStart(2, '0');
    if (which === 'correlation') out[`correlation_${n}`] = correlationAnalysis({ x, y });
    else if (which === 'regression') out[`regression_${n}`] = regressionAnalysis({ x, y });
    else if (which === 'groupby') out[`groupby_${n}`] = groupByAnalysis({ by, measure: x });
    else out[`clustering_${n}`] = clusteringAnalysis({ column: x, k: 4, table, outColumn: `cluster_${n}` });
  }
  return out;
}

const RESPONSES = ['highlight', 'navigate', 'mirror', 'none', 'filter'] as const;
const ON_CLEAR = ['showAll', 'leave', 'excludeAll'] as const;

/**
 * `spec.links` declared edges laid over the default rule. Deterministic and
 * deduped by `(source, kind, target)` — a repeat is a refusal at the def door,
 * and a bench that cannot build its own def is worthless.
 */
function planLinks(spec: ShapeSpec, views: readonly ViewPlan[]): LinkDecl[] {
  const out: LinkDecl[] = [];
  const seen = new Set<string>();
  const push = (l: LinkDecl): void => {
    const id = `${l.source}:${l.kind}→${l.target}`;
    if (seen.has(id) || out.length >= spec.links) return;
    seen.add(id);
    out.push(l);
  };
  for (let hop = 1; hop < views.length && out.length < spec.links; hop++) {
    for (let i = 0; i < views.length && out.length < spec.links; i++) {
      const source = views[i]!;
      const target = views[(i + hop) % views.length]!;
      if (source.viewId === target.viewId) continue;
      // every third edge is an ENCODING edge (the target follows the source's bindings)
      if (i % 3 === 2) {
        const shared = source.channels.filter((c) => target.channels.includes(c));
        if (shared.length > 0) {
          push({ source: source.viewId, kind: 'encoding', target: target.viewId, response: 'follow', channels: shared.map((c) => ({ from: c, to: c })), label: `${target.viewId} follows ${source.viewId}` });
          continue;
        }
      }
      const kind = source.selectionKinds[0]!;
      const response = RESPONSES[(i + hop) % RESPONSES.length]!;
      push({
        source: source.viewId,
        kind,
        target: target.viewId,
        response,
        // stated on every folding edge, so a cross-grain edge is never implicit
        ...(response === 'filter' || response === 'highlight' ? { fold: 'sum over the emitted group, then re-aggregate' } : {}),
        onClear: ON_CLEAR[(i + hop) % ON_CLEAR.length]!,
        label: `${source.viewId} ${response} ${target.viewId}`,
      });
    }
  }
  return out;
}

const SLOT_ORDER: readonly ProseSlot[] = ['title', 'caption', 'howToRead', 'altShort', 'altLong'];

const SLOT_TEXT: Readonly<Record<ProseSlot, string>> = {
  title: 'Weekly measure by dimension',
  caption: 'Each mark is one week of the selected group; the vertical axis carries the measure and the colour separates the categories.',
  howToRead: 'Read left to right across the weeks; brush an interval to carry the same weeks into every linked chart.',
  altShort: 'A chart of one measure across twenty-six weeks, split by category.',
  altLong:
    'A chart with weeks along the horizontal axis and one measure on the vertical axis. Colour separates six categories. ' +
    'The measure rises steadily across the range with week-to-week noise; no category departs from the overall shape.',
};

function planProse(spec: ShapeSpec, views: readonly ViewPlan[], p: ColumnPlan): ProseDecl[] {
  if (spec.proseSlots <= 0) return [];
  const slots = SLOT_ORDER.slice(0, Math.min(spec.proseSlots, SLOT_ORDER.length));
  const out: ProseDecl[] = views.map((v) => ({
    viewId: v.viewId,
    slots: Object.fromEntries(
      slots.map((s) => [
        s,
        {
          text: SLOT_TEXT[s],
          levels: ['construction'] as const,
          author: { kind: 'human' as const, by: 'author', at: '2026-09-01T00:00:00.000Z' },
          basis: { encodings: v.initial, columns: [p.date, ...Object.values(v.initial)] },
        },
      ]),
    ),
  }));
  if (spec.proseSlots >= 2) {
    out.push({
      viewId: 'dashboard',
      slots: {
        title: { text: 'Weekly measures', author: { kind: 'human', by: 'author' } },
        caption: {
          text: 'Twenty-six weeks of measures across the declared categories; every chart reads the one table and filters every other.',
          levels: ['construction'],
          author: { kind: 'human', by: 'author' },
          basis: { columns: [p.date, ...p.measures.slice(0, 2)] },
        },
      },
    });
  }
  return out;
}

/** The def for a shape — built here, never hand-written as an answer. */
export function makeDef(spec: ShapeSpec): DashboardDef {
  const p = planColumns(spec.columns);
  const views = planViews(spec, p);
  const table = 'data';
  const columns: Record<string, ColumnDecl> = { [p.id]: { role: 'identifier', type: 'string' }, [p.date]: { role: 'dimension', type: 'date', scale: 'continuous' } };
  for (const d of p.dims) columns[d] = { role: 'dimension', scale: 'discrete', type: 'string' };
  for (const m of p.measures) columns[m] = { role: 'measure', scale: 'continuous', type: 'number' };

  const encodings: ViewEncodingDecl[] = views.map((v) => ({ viewId: v.viewId, chartKind: v.kind, channels: v.channels, initial: v.initial }));
  const capabilities: CapabilityDecl[] = views.map((v) => ({ viewId: v.viewId, canProbe: true, encodings: v.selectionKinds, fields: Object.values(v.initial) }));
  const grains: GrainDecl[] = views.map((v) => ({ viewId: v.viewId, keys: v.grain }));

  return {
    meta: { title: `surface-bench ${spec.name}` },
    data: { [table]: { rows: makeRows(p, spec.rows), key: p.id, columns } },
    actors: Object.fromEntries(views.map((v, i) => [v.viewId, { actor: i % 3 === 2 ? ('agent' as const) : ('user' as const), label: `${v.kind} ${i}`, does: `filters the table to the ${v.kind} selection` }])),
    analyses: planAnalyses(spec, p, table),
    capabilities,
    encodings,
    grains,
    links: planLinks(spec, views),
    linkDefault: 'crossfilter',
    prose: planProse(spec, views, p),
    fdr: { procedure: 'LORD++', alpha: 0.05 },
    defaultTable: table,
  };
}

/** The def, through the real door. */
export function makeDashboard(spec: ShapeSpec): Dashboard {
  return buildDashboard(makeDef(spec));
}

/** What a table row must carry: the shape, in the words the reader needs to judge the byte count. */
export function shapeLabel(spec: ShapeSpec): string {
  return `${spec.views}v/${spec.columns}c/${spec.links}L/${spec.analyses}a/${spec.proseSlots}p`;
}
