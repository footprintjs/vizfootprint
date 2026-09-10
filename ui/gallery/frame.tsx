/**
 * The FRAME page of the gallery — two layers of marks over ONE margin box, ONE
 * pair of scales and ONE guide (R6), through the whole consumer path:
 *
 *   rows → `frameDomains` (the library's fold) → `RenderState.frame`
 *        → `bindRenderer(layeredRenderer(...))` → `VizFrame` → two `VizBar`s.
 *
 * It is a separate page from the cockpit gallery on purpose, the same reason the
 * Sheet is: a second bar chart in the cockpit's document would change every
 * chart-count assertion its smoke makes, and this page's whole job is the
 * frame.
 *
 * THE WORDS THIS PAGE SAYS are the point of it — a reader has to be told what
 * was shared and what an empty slot means, or a stack of two layers is just two
 * pictures on top of each other.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { bindRenderer, layeredRenderer, createSessionView, sessionSource, useSessionView, selectionForView } from '../src/index.js';
import type { BoundRenderer, ChartEmission, RenderLayer, RenderRow, SessionView, SessionViewState } from '../src/index.js';
import { frameDomains, layerAddress } from '../../src/def/index.js';
import type { ResolvedChannel } from '../../src/def/index.js';
import { buildScriptedSession } from './scripted.js';
import { CATEGORIES, CATEGORY_COLORS, type GalleryRow } from './data.js';

/** The rating a row must reach to count in the second layer. */
const TOP_RATING = 4;
/**
 * The view every act on this frame is recorded under, and each layer's own
 * address is `bar~<layerId>`. It is the scripted session's DECLARED bar view:
 * an undeclared viewId never lands a commit, and a page that showed gestures
 * landing nothing would prove the opposite of what it is for.
 */
const VIEW_ID = 'bar';

/** One row per category, its count — the HOST's aggregation (the transform-ownership rule: the chart never counts). */
function countsOf(rows: readonly GalleryRow[]): readonly RenderRow[] {
  // the field is the table's REAL column name: a bar's click emits on the field it is bound to, and
  // the session judges that field against its columns
  return CATEGORIES.map((category) => ({ category, count: rows.filter((r) => r.category === category).length })).filter((row) => (row.count as number) > 0);
}

/**
 * The two layers, both binding the SAME two channels (`category` and `count`)
 * over the same table: every row, and the 4★+ rows. Binding the same channels is
 * what lets the fold answer for both of them at once.
 */
function layersOf(rows: readonly GalleryRow[]): readonly RenderLayer[] {
  const encodings = { category: 'category', y: 'count' };
  return [
    { layerId: 'all', table: 'gallery', rows: countsOf(rows), encodings },
    { layerId: 'top', table: 'gallery', rows: countsOf(rows.filter((r) => r.rating >= TOP_RATING)), encodings },
  ];
}

/**
 * THE FOLD, over the rows this frame is about to draw. One band order (the union
 * of both layers' categories, in first-seen order) and one count ceiling (the
 * union of both counts, anchored at zero because a bar's height is read from
 * zero). Nothing on this page computes an axis of its own — the ticks a reader
 * sees and the heights they compare come from this one call.
 */
function frameOf(layers: readonly RenderLayer[]): Readonly<Record<string, ResolvedChannel>> {
  return frameDomains(
    layers.map((layer) => ({
      layerId: layer.layerId,
      chartKind: 'bar',
      channels: {
        category: { type: 'string' as const, values: layer.rows.map((row) => row['category']) },
        y: { type: 'number' as const, values: layer.rows.map((row) => row['count']) },
      },
    })),
  );
}

function FramePage(props: { readonly view: SessionView; readonly rows: readonly GalleryRow[] }): JSX.Element {
  const { view, rows } = props;
  const state: SessionViewState = useSessionView(view);
  const [last, setLast] = useState<string>('nothing yet — click a bar in either layer');
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boundRef = useRef<BoundRenderer | null>(null);

  const layers = useMemo(() => layersOf(rows), [rows]);
  const frame = useMemo(() => frameOf(layers), [layers]);
  const selection = selectionForView(state.selections, layerAddress(VIEW_ID, 'all'));

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const renderer = layeredRenderer({
      layers: {
        all: { kind: 'bar', colorOf: () => 'var(--vzf-line)' },
        top: { kind: 'bar', colorOf: (category) => CATEGORY_COLORS[category ?? ''] ?? 'var(--vzf-brand)' },
      },
      xLabel: 'category',
      yLabel: 'rows',
    });
    const verbs = (layerId: string) => ({
      emit: (emission: ChartEmission) => {
        // the emission's shape is per KIND (`ChartEmission`), so the readout names the kind and leaves the payload to the log
        setLast(`the "${layerId}" layer emitted a ${emission.encoding.kind}`);
        void view.emit(VIEW_ID, emission, `frame gesture on the "${layerId}" layer`);
      },
      hover: () => {},
      reencodeRequest: () => {},
      navigate: () => {},
    });
    const res = bindRenderer(renderer, el, {
      viewId: VIEW_ID,
      callbacks: verbs('all'),
      // protocol 1.2: one callback bundle per layer, so a gesture lands under `frame~<layerId>`
      layers: { layerIds: ['all', 'top'], callbacksFor: (address) => verbs(address.split('~')[1] ?? 'all') },
      onGap: (gap) => {
        // honest surface, never silent — a gap here is a real bug (a build that cannot layer)
        console.error('frame page: contract gap at bind', gap);
      },
    });
    if (!res.ok) return;
    boundRef.current = res.view;
    return () => {
      res.view.unmount();
      boundRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // WHY a microtask: `reactRenderer.update` renders SYNCHRONOUSLY (flushSync — the
    // contract has no async render acknowledgement, so an imperative host sees the DOM
    // settle before its next line). Called straight from an effect, React may still be
    // rendering THIS page and says so. Pushing on a microtask puts the frame's update
    // after this render's commit — what any React host embedding a synchronous renderer
    // has to do, and the reason the bridge's own doc calls the sync render deliberate.
    queueMicrotask(() =>
      boundRef.current?.update({
        rows: layers[0]?.rows ?? [],
        encodings: { category: 'category', y: 'count' },
        selection,
        hover: null,
        theme: {},
        size: { width: 760, height: 380 },
        layers,
        frame,
      }),
    );
  }, [layers, frame, selection]);

  const band = frame['category'];
  const ceiling = frame['y'];
  return (
    <div className="vzf" style={{ padding: 24, fontFamily: 'var(--vzf-font)', maxWidth: 860 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Two layers, one frame</h1>
      {/* the words the frame says — what was shared, and what an empty slot means */}
      <p className="vzf-frame-words" style={{ margin: '0 0 16px', lineHeight: 1.5 }}>
        Every row, and the 4★+ rows, counted by category and drawn as two layers of bars on <strong>one frame</strong>. The frame folded{' '}
        <strong>one band order</strong> ({band !== undefined && band.mode === 'shared' && band.scale === 'categorical' ? band.domain.join(' · ') : 'nothing'}) and{' '}
        <strong>one count ceiling</strong> ({ceiling !== undefined && ceiling.mode === 'shared' && ceiling.scale === 'quantitative' ? `0 – ${String(ceiling.domain[1])} rows` : 'nothing'}), so the
        same category is the same slot in both layers and their heights are comparable by eye. A slot the 4★+ layer has no rows for stays <strong>empty</strong> — “no rows here” is not “none of
        them”. The axes are drawn <strong>once</strong>, by the frame.
      </p>
      <div ref={hostRef} style={{ width: 760, height: 380 }} />
      <p className="vzf-frame-readout" style={{ marginTop: 12 }}>
        {last} · {String(state.commits.length)} commits
      </p>
    </div>
  );
}

async function main(): Promise<void> {
  const { session, rows } = await buildScriptedSession();
  const view = createSessionView(sessionSource(session), { as: 'user' });
  await view.refresh();
  const el = document.getElementById('root');
  if (!el) throw new Error('frame page: #root missing');
  createRoot(el).render(<FramePage view={view} rows={rows} />);
}

void main();
