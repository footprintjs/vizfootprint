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
  TimeTravelBar,
  BranchMap,
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
import { CATEGORIES, CATEGORY_COLORS, type GalleryRow } from './data.js';

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
    const iv = c.value as [number, number] | null;
    return iv === null || (typeof v === 'number' && v >= iv[0] && v <= iv[1]);
  }
  return v === c.value;
}

function App(props: { view: SessionView; rows: readonly GalleryRow[] }): JSX.Element {
  const { view, rows } = props;
  const state: SessionViewState = useSessionView(view);
  const [mode, setMode] = useState<TimeMode>('explore');
  const readOnly = mode === 'present';

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
          onSeek={(id) => void view.seek(id)}
          onStepBack={() => void view.stepBack()}
          onStepForward={() => void view.stepForward()}
          onCheckpoint={(label) => void view.checkpoint(label)}
          onReturnToNow={() => void view.returnToNow()}
        />
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
          id: 'bar',
          weight: 2,
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
            <BranchMap commits={state.commits} cursor={state.cursor} head={state.head} checkpoints={state.checkpoints} onSeek={(id) => void view.seek(id)} />
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
