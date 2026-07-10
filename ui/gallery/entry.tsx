/**
 * The gallery page — the visual acceptance surface. Mounts EVERY component of
 * vizfootprint-ui against the scripted real session, wired the way a consumer
 * would: one `createSessionView` store, `useSessionView` for state, action
 * callbacks back into the store. The charts read their axis fields from the
 * ENCODINGS fold — pick a new column in the axis picker and the scatter
 * re-renders on the new field (the reencode verb, end to end).
 */
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  VizDashboard,
  VizPanel,
  VizCard,
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
    <VizDashboard
      readOnly={readOnly}
      top={
        <VizCard>
          <TimeTravelBar
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
        </VizCard>
      }
      main={
        <>
          <VizCard title={`Charts — ${selectedCount} of ${rows.length} rows selected · axis labels open the encoding picker`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 'var(--vzf-space-4)' }}>
              <figure className="vzf-chartbox">
                <VizScatter
                  viewId="scatter"
                  data={scatterData}
                  xField={xField}
                  yField={yField}
                  colorOf={(c) => CATEGORY_COLORS[c ?? ''] ?? 'var(--vzf-brand)'}
                  highlight={scatterKeep}
                  columns={columns}
                  encoding={enc}
                  onEmit={(e) => void view.emit('scatter', e, 'scatter gesture')}
                  onReencode={(v, c, f) => void view.reencode(v, c, f)}
                />
                <figcaption className="vzf-chart-caption">Scatter — drag to brush {xField}; click an axis label to re-encode</figcaption>
              </figure>
              <figure className="vzf-chartbox">
                <VizBar
                  viewId="bar"
                  data={barData}
                  field="category"
                  colorOf={(c) => CATEGORY_COLORS[c] ?? 'var(--vzf-brand)'}
                  selected={barSelected ? String(barSelected.value) : null}
                  columns={columns}
                  onEmit={(e) => void view.emit('bar', e, 'bar click')}
                  onReencode={(v, c, f) => void view.reencode(v, c, f)}
                />
                <figcaption className="vzf-chart-caption">Bar — click a category to select</figcaption>
              </figure>
            </div>
          </VizCard>
          <VizPanel title="Branch map — siblings fork downward; the active lineage rides the top lane">
            <BranchMap commits={state.commits} cursor={state.cursor} head={state.head} checkpoints={state.checkpoints} onSeek={(id) => void view.seek(id)} />
          </VizPanel>
          <VizPanel title="Commit log — one cause-tagged record per gesture; click a chip to seek">
            <CommitLog commits={state.commits} onSeek={(id) => void view.seek(id)} />
          </VizPanel>
        </>
      }
      side={
        <>
          <VizPanel title="Declared analyses — readiness at the cursor">
            <ReadinessPanel heading={false} analyses={state.readiness} onAnalyze={(id) => void view.analyze(id)} />
          </VizPanel>
          <VizPanel title={`Gaps — unmet requests (${state.gaps.length})`}>
            <GapsPanel heading={false} gaps={state.gaps} />
          </VizPanel>
        </>
      }
      bottom={
        <VizPanel title="Online-FDR ledger (LORD++) — two truths">
          <FdrLedger ledger={state.ledger} />
        </VizPanel>
      }
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
