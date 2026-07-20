/**
 * The gallery page — the visual acceptance surface. Mounts the FLAGSHIP
 * cockpit (`<VizCockpit>`) against the scripted real session, wired the way a
 * consumer would: one `createSessionView` store, `useSessionView` for state,
 * action callbacks back into the store.
 *
 * Single screen, nothing to scroll: the compact time bar rides the top strip
 * (⚑ opens the checkpoint naming modal), the charts FILL all remaining height
 * at their measured size (crisp SVG), and the panels live behind the report
 * chips on the slim status strip — each chip carries a live badge and opens a
 * large frosted-glass modal. The charts read their axis fields from the
 * ENCODINGS fold — pick a new column in the axis picker and the scatter
 * re-renders on the new field (the reencode verb, end to end).
 */
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  VizCockpit,
  VizScatter,
  VizBar,
  VizLine,
  VizMap,
  VizHistogram,
  VizHeatmap,
  VizBoxPlot,
  TimeTravelBar,
  BranchMap,
  BranchPill,
  PathsModal,
  CompareModal,
  ForkToast,
  CommitLog,
  FdrLedger,
  GapsPanel,
  ReadinessPanel,
  createSessionView,
  sessionSource,
  useSessionView,
  selectionForView,
  keepPredicate,
  type SessionView,
  type SessionViewState,
  type TimeMode,
} from '../src/index.js';
import { buildScriptedSession } from './scripted.js';
import { CATEGORIES, CATEGORY_COLORS, GALLERY_GEO, REGIONS, type GalleryRow } from './data.js';
import { VegaLiteCell } from './VegaLiteCell.js';
// the HOST side of the transform-ownership rule: this page (not the chart)
// computes the histogram's buckets and the box plot's statistics with
// src/data's pure host-side helpers
import { equalWidthBins, recountBins, boxSummary } from '../../src/data/index.js';

// The old page-local clause matcher is GONE (RP-1): the contract's
// `selectionForView` derives the clause-addressable selection straight from
// the adapter state's per-view fold, and `keepPredicate` folds it — one
// evaluator, parity-pinned against src/data, never a page reimplementation.

function App(props: { view: SessionView; rows: readonly GalleryRow[] }): JSX.Element {
  const { view, rows } = props;
  const state: SessionViewState = useSessionView(view);
  const [mode, setMode] = useState<TimeMode>('explore');
  const readOnly = mode === 'present';

  // ── BR-2: the named-paths loop (pill → paths modal; map menu → compare modal) ──
  const [pathsOpen, setPathsOpen] = useState(false);
  const [compareWith, setCompareWith] = useState<string | null>(null); // a commit id, or null = closed

  // the scatter's fields come from the ENCODING fold (the reencode verb's state)
  const enc = state.encodings['scatter'] ?? {};
  const xField = enc['x'] ?? 'price';
  const yField = enc['y'] ?? 'rating';
  const columns = state.columns[state.defaultTable] ?? [];

  // one clause-addressable selection per view (self named for exclusion) — RP-1
  const selFor = (self: string | null) => selectionForView(state.selections, self);

  const scatterData = useMemo(
    () =>
      rows.map((r) => ({
        id: r.id,
        x: typeof r[xField] === 'number' ? (r[xField] as number) : 0,
        y: typeof r[yField] === 'number' ? (r[yField] as number) : 0,
        category: r.category,
        row: r, // the source row — VizScatter evaluates the selection clauses against it
      })),
    [rows, xField, yField],
  );

  // aggregated charts recompute their HOST-owned data under the other views'
  // clauses (the transform-ownership rule: the host aggregates, never the chart)
  const keepBar = keepPredicate(selFor('bar'));
  const barData = CATEGORIES.map((category) => ({
    category,
    count: rows.filter((r) => r.category === category && keepBar(r)).length,
  }));

  // the line's fields come from ITS encoding fold; its data recomputes under
  // the OTHER views' selections (crossfilter self-exclusion, like the bar)
  const encL = state.encodings['line'] ?? {};
  const lineX = encL['x'] ?? 'date';
  const lineY = encL['y'] ?? 'price';
  const lineData = useMemo(
    () =>
      rows
        .filter((r) => keepPredicate(selectionForView(state.selections, 'line'))(r))
        .map((r) => ({
          date: String(r[lineX]),
          value: typeof r[lineY] === 'number' ? (r[lineY] as number) : 0,
          series: r.category,
        })),
    [rows, lineX, lineY, state.selections],
  );

  // the histogram's field comes from ITS encoding fold; the HOST owns the bins
  // (transform ownership): fixed equal-width edges over ALL rows — stable while
  // its own brush lands — with counts recomputed under the OTHER views' clauses
  // (the VizBar recompute pattern, via recountBins over the same edges).
  const encH = state.encodings['histogram'] ?? {};
  const histField = encH['x'] ?? 'price';
  const histValueOf = (r: GalleryRow): number | string | null => {
    const v = r[histField];
    return typeof v === 'number' || typeof v === 'string' ? v : null;
  };
  const histEdges = useMemo(
    () => equalWidthBins(rows.map(histValueOf).filter((v): v is number | string => v !== null), { buckets: 8 }),
    // histValueOf closes only over histField — the deps carry its real inputs
    [rows, histField],
  );
  const keepHist = keepPredicate(selFor('histogram'));
  const histData = recountBins(
    histEdges,
    rows.filter(keepHist).map(histValueOf).filter((v): v is number | string => v !== null),
  ).bins;

  // the heatmap's 2-D cells (D30): the SAME fixed x edges for every category
  // row (equalWidthBins over ALL rows — stable while its own cell is live),
  // counts recomputed per (bucket, category) under the OTHER views' clauses.
  const encHm = state.encodings['heatmap'] ?? {};
  const heatXField = encHm['x'] ?? 'price';
  const heatYField = encHm['y'] ?? 'category';
  const heatValueOf = (r: GalleryRow): number | string | null => {
    const v = r[heatXField];
    return typeof v === 'number' || typeof v === 'string' ? v : null;
  };
  const heatRowOf = (r: GalleryRow): string => String(r[heatYField]);
  const heatEdges = useMemo(
    () => equalWidthBins(rows.map(heatValueOf).filter((v): v is number | string => v !== null), { buckets: 6 }),
    // heatValueOf closes only over heatXField — the deps carry its real inputs
    [rows, heatXField],
  );
  const keepHeat = keepPredicate(selFor('heatmap'));
  const heatRows = [...new Set(rows.map(heatRowOf))];
  const heatData = heatRows.flatMap((y) =>
    recountBins(
      heatEdges,
      rows.filter((r) => heatRowOf(r) === y && keepHeat(r)).map(heatValueOf).filter((v): v is number | string => v !== null),
    ).bins.map((b) => ({ x0: b.x0, x1: b.x1, y, count: b.count })),
  );

  // the box plot's fields come from ITS encoding fold; the HOST owns the
  // per-category statistics (transform ownership, one tier up from a count):
  // boxSummary computes quartiles/whiskers/outliers over the rows that
  // survive the OTHER views' clauses (the VizBar recompute pattern).
  const encBox = state.encodings['boxplot'] ?? {};
  const boxXField = encBox['x'] ?? 'category';
  const boxYField = encBox['y'] ?? 'price';
  const boxValueOf = (r: GalleryRow): number | string | null => {
    const v = r[boxYField];
    return typeof v === 'number' || typeof v === 'string' ? v : null;
  };
  const keepBox = keepPredicate(selFor('boxplot'));
  const boxCategories = useMemo(() => [...new Set(rows.map((r) => String(r[boxXField])))], [rows, boxXField]);
  const boxData = boxCategories.flatMap((category) => {
    const values = rows
      .filter((r) => String(r[boxXField]) === category && keepBox(r))
      .map(boxValueOf)
      .filter((v): v is number | string => v !== null);
    const summary = boxSummary(values);
    return summary ? [{ category, ...summary }] : []; // an empty-under-crossfilter category is honestly omitted, never a fabricated box
  });

  // the map's value per region = the crossfiltered row COUNT (the canonical wiring)
  const keepMap = keepPredicate(selFor('map'));
  const mapData = REGIONS.map((region) => ({
    region: region as string,
    value: rows.filter((r) => r.region === region && keepMap(r)).length,
  }));

  const keepAll = keepPredicate(selFor(null)); // the whole-dashboard truth — nothing excluded
  const selectedCount = rows.filter((r) => keepAll(r)).length;

  // RP-3: the agent-authored charts — each a real cockpit cell rendered through
  // the SAME RP-2 vega-lite bridge as the 'vl' cell (VegaLiteCell), receiving
  // the crossfilter (its marks dim under every other view's selection).
  const agentChartCells = state.charts.map((chart) => ({
    id: chart.viewId,
    weight: 2.5,
    caption: `Agent-authored (ledgered ✓): ${chart.claim}`,
    render: ({ width, height }: { width: number; height: number }) => (
      <VegaLiteCell
        viewId={chart.viewId}
        spec={chart.spec as Parameters<typeof VegaLiteCell>[0]['spec']}
        rows={rows}
        selection={selFor(chart.viewId)}
        theme={{}}
        width={width}
        height={height}
        onEmit={() => {
          /* a proposed chart is a hypothesis to view — it RECEIVES crossfilter; its own brush is display-only in v1 */
        }}
      />
    ),
  }));

  return (
    <VizCockpit
      readOnly={readOnly}
      // LY-1: the arrangement is SESSION state — the cockpit renders state.layout
      // (the fold at the cursor) and every gesture lands through view.setLayout,
      // so presets/order/focus time-travel, fork, and present like everything else.
      layout={state.layout}
      onLayoutChange={(change) => void view.setLayout(change)}
      top={
        <TimeTravelBar
          compact
          mode={mode}
          onModeChange={setMode}
          commits={state.commits}
          cursor={state.cursor}
          head={state.head}
          checkpoints={state.checkpoints}
          branches={state.branches}
          viewingPast={state.viewingPast}
          pathPill={<BranchPill paths={state.paths} onClick={() => setPathsOpen(true)} />}
          onSeek={(id) => void view.seek(id)}
          onStepBack={() => void view.stepBack()}
          onStepForward={() => void view.stepForward()}
          onCheckpoint={(label) => void view.checkpoint(label)}
          onReturnToNow={() => void view.returnToNow()}
        />
      }
      toast={
        <>
          <ForkToast events={state.paths.events} onOpenPaths={() => setPathsOpen(true)} />
          <PathsModal
            open={pathsOpen}
            onClose={() => setPathsOpen(false)}
            paths={state.paths}
            cursor={state.cursor}
            readOnly={readOnly}
            onSwitch={(name) => void view.switchPath(name)}
            onRename={(from, to) => void view.renamePath(from, to)}
            onNewPath={(commitId) => void view.newPathAt(commitId)}
          />
          <CompareModal
            open={compareWith !== null}
            onClose={() => setCompareWith(null)}
            paths={state.paths}
            initialA={compareWith ?? undefined}
            initialB={state.paths.current ?? state.cursor ?? undefined}
            onCompare={(a, b) => view.compare(a, b)}
          />
        </>
      }
      charts={[
        {
          id: 'scatter',
          weight: 3,
          caption: `Scatter — drag to brush ${xField}; click an axis label to re-encode`,
          render: ({ width, height }) => (
            <VizScatter
              viewId="scatter"
              data={scatterData}
              xField={xField}
              yField={yField}
              width={width}
              height={height}
              colorOf={(c) => CATEGORY_COLORS[c ?? ''] ?? 'var(--vzf-brand)'}
              selection={selFor('scatter')}
              columns={columns}
              encoding={enc}
              onEmit={(e) => void view.emit('scatter', e, 'scatter gesture')}
              onReencode={(v, c, f) => void view.reencode(v, c, f)}
            />
          ),
        },
        {
          id: 'line',
          weight: 3,
          caption: `Line — drag to brush ${lineX}; mean ${lineY} per week by category`,
          render: ({ width, height }) => (
            <VizLine
              viewId="line"
              data={lineData}
              dateField={lineX}
              valueField={lineY}
              width={width}
              height={height}
              colorOf={(s) => CATEGORY_COLORS[s ?? ''] ?? 'var(--vzf-brand)'}
              columns={columns}
              encoding={encL}
              onEmit={(e) => void view.emit('line', e, 'time brush')}
              onReencode={(v, c, f) => void view.reencode(v, c, f)}
            />
          ),
        },
        {
          id: 'bar',
          weight: 2.5,
          caption: 'Bar — click a category to select',
          render: ({ width, height }) => (
            <VizBar
              viewId="bar"
              data={barData}
              field="category"
              width={width}
              height={height}
              colorOf={(c) => CATEGORY_COLORS[c] ?? 'var(--vzf-brand)'}
              selection={selFor('bar')}
              columns={columns}
              onEmit={(e) => void view.emit('bar', e, 'bar click')}
              onReencode={(v, c, f) => void view.reencode(v, c, f)}
            />
          ),
        },
        {
          id: 'map',
          weight: 2.5,
          caption: 'Map — click a region to select; click again to clear',
          render: ({ width, height }) => (
            <VizMap
              viewId="map"
              geo={GALLERY_GEO}
              regionField="region"
              data={mapData}
              valueLabel="rows"
              width={width}
              height={height}
              selection={selFor('map')}
              onEmit={(e) => void view.emit('map', e, 'region click')}
            />
          ),
        },
        {
          id: 'histogram',
          weight: 2.5,
          caption: `Histogram — drag across ${histField} buckets; click a bar for one bucket, again to clear`,
          render: ({ width, height }) => (
            <VizHistogram
              viewId="histogram"
              data={histData}
              field={histField}
              width={width}
              height={height}
              selection={selFor('histogram')}
              columns={columns}
              encoding={encH}
              onEmit={(e) => void view.emit('histogram', e, 'histogram brush')}
              onReencode={(v, c, f) => void view.reencode(v, c, f)}
            />
          ),
        },
        {
          id: 'heatmap',
          weight: 2.5,
          caption: `Heatmap — click a cell to select ${heatXField} AND ${heatYField} together; click again to clear`,
          render: ({ width, height }) => (
            <VizHeatmap
              viewId="heatmap"
              data={heatData}
              xField={heatXField}
              yField={heatYField}
              width={width}
              height={height}
              selection={selFor('heatmap')}
              columns={columns}
              encoding={encHm}
              onEmit={(e) => void view.emit('heatmap', e, 'heatmap cell click')}
              onReencode={(v, c, f) => void view.reencode(v, c, f)}
            />
          ),
        },
        {
          id: 'boxplot',
          weight: 2.5,
          caption: `Box plot — click a box to select ${boxXField}; ${boxYField} quartiles, whiskers, and outliers`,
          render: ({ width, height }) => (
            <VizBoxPlot
              viewId="boxplot"
              data={boxData}
              xField={boxXField}
              yField={boxYField}
              width={width}
              height={height}
              selection={selFor('boxplot')}
              columns={columns}
              encoding={encBox}
              onEmit={(e) => void view.emit('boxplot', e, 'box plot click')}
              onReencode={(v, c, f) => void view.reencode(v, c, f)}
            />
          ),
        },
        {
          id: 'vl',
          weight: 2.5,
          caption: 'Vega-Lite (bridge) — drag to brush rating',
          render: ({ width, height }) => (
            <VegaLiteCell
              viewId="vl"
              rows={rows}
              selection={selFor('vl')}
              theme={{}}
              width={width}
              height={height}
              onEmit={(e) => void view.emit('vl', e, 'vega-lite bridge gesture')}
            />
          ),
        },
        ...agentChartCells,
      ]}
      reports={[
        {
          id: 'commits',
          title: 'Commit log',
          icon: '🧾',
          badge: state.commits.length,
          content: <CommitLog commits={state.commits} onSeek={(id) => void view.seek(id)} />,
        },
        {
          id: 'branches',
          title: 'Branch map',
          icon: '🌿',
          badge: state.branches.length,
          content: (
            <BranchMap
              commits={state.commits}
              cursor={state.cursor}
              head={state.head}
              checkpoints={state.checkpoints}
              paths={state.paths.list}
              onSeek={(id) => void view.seek(id)}
              onNewPath={(id) => void view.newPathAt(id)}
              onBringOver={(id) => void view.bringOver(id)}
              onUndo={(id) => void view.undo(id)}
              onCompare={(id) => setCompareWith(id)}
            />
          ),
        },
        {
          id: 'ledger',
          title: 'FDR ledger',
          icon: '⚖️',
          badge: state.ledger.discoveries,
          content: <FdrLedger ledger={state.ledger} />,
        },
        {
          id: 'analyses',
          title: 'Analyses',
          icon: '🧪',
          badge: state.readiness.filter((r) => r.ready).length,
          content: <ReadinessPanel heading={false} analyses={state.readiness} onAnalyze={(id) => void view.analyze(id)} />,
        },
        {
          id: 'gaps',
          title: 'Gaps',
          icon: '⚠️',
          badge: state.gaps.length,
          content: <GapsPanel heading={false} gaps={state.gaps} />,
        },
      ]}
      status={`${selectedCount} of ${rows.length} rows selected · provider: scripted session`}
    />
  );
}

async function main(): Promise<void> {
  const { session, rows } = await buildScriptedSession();
  const view = createSessionView(sessionSource(session), { as: 'user' });
  await view.refresh();
  const el = document.getElementById('root');
  if (!el) throw new Error('gallery: #root missing');
  createRoot(el).render(<App view={view} rows={rows} />);
}

void main();
