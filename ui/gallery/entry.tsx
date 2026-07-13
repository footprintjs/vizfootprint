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
  type SessionView,
  type SessionViewState,
  type TimeMode,
} from '../src/index.js';
import { buildScriptedSession } from './scripted.js';
import { CATEGORIES, CATEGORY_COLORS, GALLERY_GEO, REGIONS, type GalleryRow } from './data.js';

// ── tiny local clause matcher (crossfilter self-exclusion in the page) ────────
interface Clause {
  viewId: string;
  field: string;
  kind: 'point' | 'interval';
  value: unknown;
}
function matches(row: GalleryRow, c: Clause): boolean {
  const v = row[c.field];
  if (c.kind === 'interval') {
    // numeric OR ISO-date-string bounds — mirrors src/data matchesClause
    // (lexicographic == chronological for the uniform ISO format)
    const iv = c.value as [number, number] | [string, string] | null;
    if (iv === null) return true;
    if (typeof iv[0] === 'string') return typeof v === 'string' && v >= iv[0] && v <= (iv[1] as string);
    return typeof v === 'number' && v >= iv[0] && v <= (iv[1] as number);
  }
  // a CLEARED point selection surfaces as a null/undefined value through the
  // adapter (the session keeps the entry; src/data treats it as "no filter").
  // Gallery data has no null cells, so null here can only mean "cleared".
  if (c.value == null) return true;
  return v === c.value;
}

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

  const clauses: Clause[] = state.selections.map((s) => ({ viewId: s.viewId, field: s.field, kind: s.kind, value: s.value }));
  const notOwn = (self: string) => clauses.filter((c) => c.viewId !== self);

  const scatterData = useMemo(
    () =>
      rows.map((r) => ({
        id: r.id,
        x: typeof r[xField] === 'number' ? (r[xField] as number) : 0,
        y: typeof r[yField] === 'number' ? (r[yField] as number) : 0,
        category: r.category,
      })),
    [rows, xField, yField],
  );
  const scatterKeep = (d: { id: string }): boolean => {
    const row = rows.find((r) => r.id === d.id);
    return row ? notOwn('scatter').every((c) => matches(row, c)) : true;
  };

  const barClauses = notOwn('bar');
  const barData = CATEGORIES.map((category) => ({
    category,
    count: rows.filter((r) => r.category === category && barClauses.every((c) => matches(r, c))).length,
  }));
  const barSelected = state.selections.find((s) => s.viewId === 'bar' && s.kind === 'point');

  // the line's fields come from ITS encoding fold; its data recomputes under
  // the OTHER views' selections (crossfilter self-exclusion, like the bar)
  const encL = state.encodings['line'] ?? {};
  const lineX = encL['x'] ?? 'date';
  const lineY = encL['y'] ?? 'price';
  const lineClauses = notOwn('line');
  const lineData = useMemo(
    () =>
      rows
        .filter((r) => lineClauses.every((c) => matches(r, c)))
        .map((r) => ({
          date: String(r[lineX]),
          value: typeof r[lineY] === 'number' ? (r[lineY] as number) : 0,
          series: r.category,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lineClauses is derived fresh from state.selections each render
    [rows, lineX, lineY, state.selections],
  );

  // the map's value per region = the crossfiltered row COUNT (the canonical wiring)
  const mapClauses = notOwn('map');
  const mapData = REGIONS.map((region) => ({
    region: region as string,
    value: rows.filter((r) => r.region === region && mapClauses.every((c) => matches(r, c))).length,
  }));
  const mapSelected = state.selections.find((s) => s.viewId === 'map' && s.kind === 'point');

  const selectedCount = rows.filter((r) => clauses.every((c) => matches(r, c))).length;

  return (
    <VizCockpit
      readOnly={readOnly}
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
              highlight={scatterKeep}
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
              selected={barSelected ? String(barSelected.value) : null}
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
              selected={mapSelected && mapSelected.value != null ? String(mapSelected.value) : null}
              onEmit={(e) => void view.emit('map', e, 'region click')}
            />
          ),
        },
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
