/**
 * THE MADE DESK'S CELLS — the charts a definition this wizard wrote implies.
 *
 * Every other host of `desk` brings its own cells, because only it knows what
 * its rows mean. A made desk has no such host: the person who made it declared
 * columns and channels and nothing else, so the cells have to be DERIVED from
 * the definition — which is exactly what makes them safe to derive. There is
 * nothing here that a person could have meant differently, because there was
 * nowhere for them to say it.
 *
 * Two surfaces mount these and they must be the same cells, for the reason the
 * NNDSS demo learned the hard way (`vizfootprint-demo/web/src/cells.tsx`): the
 * wizard's own step four, and the single file it publishes. A second spelling
 * of one dashboard is two dashboards, and the one on screen would be whichever
 * the reader happened to open.
 *
 * The desk projects; the host derives — and here the "host" is this file. Every
 * fold below reads the field through `desk.bound(...)` and the rows through the
 * selection that reaches the view THROUGH THE LINK GRAPH, so a re-encode moves
 * the marks and the caption together and a link the person switched off does
 * not move anything.
 */
import { useMemo, type ReactNode } from 'react';
import { VizBar, VizLine, VizTable, keepPredicate, type BarDatum, type LinePoint } from 'vizfootprint-ui';
import { parseCSVTyped, type Row } from 'vizfootprint/data';
import type { ChartEmission } from 'vizfootprint/mosaic';
import type { EmissionKind } from 'vizfootprint/def';
import type { DashboardDef } from 'vizfootprint/def';
import type { DeskChart, DeskProjection } from '../desk/types.js';
import { MAKE_CHART_KINDS } from './steps.js';
import type { MakeChartKind, MakeView } from './types.js';

/** How many bars a made bar chart draws before it says it stopped. Nine hundred bars is not a chart. */
export const MAKE_BAR_CAP = 40;
/** How many rows a made table prints before it says how many there were. */
export const MAKE_TABLE_CAP = 200;

/** What the cells need, read off a definition once: the rows, the views, and the column order. */
export interface MadePlan {
  readonly def: DashboardDef;
  readonly table: string;
  readonly rows: readonly Row[];
  readonly views: readonly MakeView[];
  /** The columns in the order the table declares them — the order a made table prints. */
  readonly columns: readonly string[];
  /** The column a made table selects a row BY: the first one, or nothing when the table has no columns. */
  readonly idColumn: string;
}

/** A chart kind this file can draw, or `table` — the shape it falls back to for a kind nothing here renders. */
function kindOf(chartKind: string): MakeChartKind {
  return chartKind === 'bar' || chartKind === 'line' ? chartKind : 'table';
}

/**
 * A DEFINITION BECOMES A PLAN.
 *
 * Total on purpose: it is handed a def off a published page's payload, which is
 * data that arrived from somewhere, so every missing part has an answer rather
 * than a throw. A table with no rows draws empty charts; a chart kind this file
 * cannot draw is drawn as its rows.
 */
export function planFromDef(def: DashboardDef): MadePlan {
  const table = def.defaultTable ?? Object.keys(def.data)[0] ?? '';
  const source = def.data[table];
  const csv = source?.csv;
  const parsed = csv === undefined ? null : parseCSVTyped(csv);
  const rows: readonly Row[] = parsed === null ? (source?.rows ?? []) : parsed.rows;
  const columns = parsed === null ? Object.keys(rows[0] ?? {}) : parsed.header;
  // Every DECLARED view, in the order the def names them — including the ones
  // with no encoding surface at all. A table binds nothing, so it declares no
  // encodings entry (the library refuses an empty `channels`), and reading the
  // views off `encodings` alone would have quietly dropped it.
  const views = Object.entries(def.actors).map(([viewId, meta]): MakeView => {
    const encoding = def.encodings?.find((e) => e.viewId === viewId);
    return {
      id: viewId,
      label: meta.label ?? viewId,
      chartKind: encoding === undefined ? 'table' : kindOf(encoding.chartKind),
      bindings: { ...encoding?.initial },
    };
  });
  return { def, table, rows, views, columns, idColumn: columns[0] ?? '' };
}

/** The value a chart keys a bucket by: a date reads as its ISO instant (lexicographic == chronological), everything else as its text. */
function bucketKey(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** One bar per value of `field`, counting the rows in view. ONE pass, whatever the number of bars. */
function barData(rows: readonly Row[], field: string, keep: (row: Row) => boolean): readonly BarDatum[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[field];
    if (value === null || value === undefined) continue; // a missing value is a silence, never a category called "null"
    if (!keep(row)) continue;
    const key = bucketKey(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count }));
}

/** `y` summed per bucket of `x`, over the rows in view. A row whose y is not a number is not a zero — it is not a point. */
function lineData(rows: readonly Row[], x: string, y: string, keep: (row: Row) => boolean): readonly LinePoint[] {
  const sums = new Map<string, number>();
  for (const row of rows) {
    const bucket = row[x];
    const value = row[y];
    if (bucket === null || bucket === undefined || typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (!keep(row)) continue;
    const key = bucketKey(bucket);
    sums.set(key, (sums.get(key) ?? 0) + value);
  }
  return [...sums.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, value]) => ({ date, value }));
}

/** The tallest `cap` bars, and how many there were — a truncation this desk SAYS rather than performs quietly. */
function tallest(bars: readonly BarDatum[], cap: number): { readonly shown: readonly BarDatum[]; readonly of: number } {
  if (bars.length <= cap) return { shown: bars, of: bars.length };
  return { shown: [...bars].sort((a, b) => b.count - a.count).slice(0, cap), of: bars.length };
}

/** The verb a gesture is recorded under — one word per emission kind, and the four are all of them. */
export const GESTURE_WORDS: Readonly<Record<EmissionKind, string>> = { point: 'pick', interval: 'brush', match: 'pick several on', cell: 'pick a cell of' };

/** What the log should say a gesture was, in words a person recognises. */
export function intentFor(label: string, emission: ChartEmission): string {
  return `${GESTURE_WORDS[emission.encoding.kind]} ${label}`;
}

/**
 * Everything one view needs drawn, folded once — with the fields it drew them
 * with in NAMED slots rather than a map.
 *
 * A map would have to be read back with a fallback at every use, and a fallback
 * that can never fire is a lie about what the code does: a bar always has a
 * category, a line always has an x and a y, and the emptiness they carry when a
 * channel is unbound is one honest value, decided once, here.
 */
interface Drawn {
  readonly view: MakeView;
  readonly bars: { readonly shown: readonly BarDatum[]; readonly of: number };
  readonly points: readonly LinePoint[];
  readonly rows: readonly Row[];
  readonly kept: number;
  readonly category: string;
  readonly x: string;
  readonly y: string;
}

/**
 * THE CELLS.
 *
 * Called once from the desk's own body, so the memo below is a real hook and
 * behaves like one — and it needs to be: every fold here walks the whole table,
 * and without it each one would re-run on every render of every cell.
 *
 * ONE memo for every view rather than one per view, deliberately: a hook per
 * element of a list is a hook count that changes when the list does, and a
 * definition is allowed to declare any number of charts.
 */
export function useMadeCells(desk: DeskProjection, plan: MadePlan): readonly DeskChart[] {
  const { rows, views } = plan;

  // `desk.state` carries every fact a fold below depends on — the live
  // selections, the link graph, what was cleared, and the bindings at the
  // cursor — so it is the honest key: when none of it moved, none of this did.
  const drawn = useMemo<readonly Drawn[]>(
    () =>
      views.map((view): Drawn => {
        const keep = keepPredicate(desk.selFor(view.id));
        const bound = (channel: string): string => desk.bound(view.id, channel, view.bindings[channel] ?? '');
        const empty = { bars: { shown: [], of: 0 }, points: [], rows: [], kept: 0, category: '', x: '', y: '' };
        if (view.chartKind === 'bar') {
          const category = bound('category');
          return { ...empty, view, category, bars: tallest(barData(rows, category, keep), MAKE_BAR_CAP) };
        }
        if (view.chartKind === 'line') {
          const x = bound('x');
          const y = bound('y');
          return { ...empty, view, x, y, points: lineData(rows, x, y, keep) };
        }
        const kept = rows.filter((r) => keep(r));
        return { ...empty, view, rows: kept.slice(0, MAKE_TABLE_CAP), kept: kept.length };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `desk` is rebuilt every render; `desk.state` is the fact the folds read
    [rows, views, desk.state],
  );

  return drawn.map((d): DeskChart => {
    const { view } = d;
    const emit = (emission: ChartEmission): void => void desk.view.emit(view.id, emission, intentFor(desk.label(view.id), emission));
    const reencode = (viewId: string, channel: string, field: string): void => void desk.view.reencode(viewId, channel, field);
    const common = { viewId: view.id, columns: desk.columns, fits: desk.fitsOf(view.id), encoding: desk.shown[view.id] ?? {}, selection: desk.selFor(view.id), onEmit: emit, onReencode: reencode };
    if (view.chartKind === 'bar') {
      const capped = d.bars.of > d.bars.shown.length ? ` · the ${String(d.bars.shown.length)} tallest of ${String(d.bars.of)} — the rest are there, they are not drawn` : '';
      return {
        id: view.id,
        weight: 2,
        caption: (
          <>
            {`Rows per ${d.category} (click a bar to select)${capped}`}
            {desk.words(view.id)}
          </>
        ),
        render: ({ width, height }): ReactNode => <VizBar {...common} data={d.bars.shown} field={d.category} ariaLabel={desk.altShort(view.id)} width={width} height={height} />,
      };
    }
    if (view.chartKind === 'line') {
      return {
        id: view.id,
        weight: 3,
        caption: (
          <>
            {`${d.y} summed per ${d.x} — a row with no number there is a silence, never a zero`}
            {desk.words(view.id)}
          </>
        ),
        render: ({ width, height }): ReactNode => (
          <VizLine {...common} data={d.points} dateField={d.x} valueField={d.y} ariaLabel={desk.altShort(view.id)} width={width} height={height} />
        ),
      };
    }
    const more = d.kept > d.rows.length ? ` — the first ${String(d.rows.length)} of ${String(d.kept)}` : '';
    return {
      id: view.id,
      weight: 3,
      caption: (
        <>
          {`The rows in view${more} (click one to select)`}
          {desk.words(view.id)}
        </>
      ),
      render: ({ width, height }): ReactNode => (
        <VizTable
          viewId={view.id}
          data={d.rows as readonly Record<string, unknown>[]}
          columns={plan.columns}
          idField={plan.idColumn}
          ariaLabel={desk.altShort(view.id)}
          selection={desk.selFor(view.id)}
          onEmit={emit}
          width={width}
          height={height}
        />
      ),
    };
  });
}
