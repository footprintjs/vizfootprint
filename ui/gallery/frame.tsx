/**
 * The FRAME page of the gallery — three layers of marks over ONE margin box, ONE
 * pair of scales and ONE guide (R6), through the whole consumer path:
 *
 *   rows → `frameDomains` (the library's fold) → `RenderState.frame`
 *        → `bindRenderer(layeredRenderer(...))` → `VizFrame` → two `VizBar`s and a `VizLine`.
 *
 * The third layer is a LINE ON A BAND: the 3★+ count per category, its x bound
 * to the same `category` column the bars stand on. Band versus run is the x
 * COLUMN's, so the frame classifies the line as a band, hands it the one band
 * order it hands the bars, and its points sit at the bars' slot centres — the
 * figure the frame used to refuse in words.
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
/** The rating a row must reach to count in the LINE — a third count series, drawn as a line over the same bands. */
const GOOD_RATING = 3;
/**
 * Each layer's mark, spelled ONCE: the fold reads it for the zero policy and
 * the channel the mark's x is bound on, and the renderer is told the same kind.
 */
const LAYER_KINDS = { all: 'bar', top: 'bar', good: 'line' } as const;
type LayerId = keyof typeof LAYER_KINDS;
const LAYER_IDS = Object.keys(LAYER_KINDS) as readonly LayerId[];
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
 * The three layers over the same table: every row, the 4★+ rows (bars), and the
 * 3★+ rows (a line). The bars bind `category` — a bar's x channel — and the line
 * binds `x`, both to the SAME column; the fold folds each channel as categories
 * and the frame reads the two names as ONE band axis.
 */
function layersOf(rows: readonly GalleryRow[]): readonly RenderLayer[] {
  const barEncodings = { category: 'category', y: 'count' };
  return [
    { layerId: 'all', table: 'gallery', rows: countsOf(rows), encodings: barEncodings },
    { layerId: 'top', table: 'gallery', rows: countsOf(rows.filter((r) => r.rating >= TOP_RATING)), encodings: barEncodings },
    { layerId: 'good', table: 'gallery', rows: countsOf(rows.filter((r) => r.rating >= GOOD_RATING)), encodings: { x: 'category', y: 'count' } },
  ];
}

/**
 * THE FOLD, over the rows this frame is about to draw. One band order per x
 * channel (the union of the layers' categories, in first-seen order — the frame
 * unites the bars' `category` and the line's `x` into one) and one count ceiling
 * (the union of every count, anchored at zero because a bar's height is read
 * from zero). Nothing on this page computes an axis of its own — the ticks a
 * reader sees and the heights they compare come from this one call. The x
 * channel's TYPE is what makes the line a band: `'string'`, folded as
 * categorical, is the whole classification.
 */
function frameOf(layers: readonly RenderLayer[]): Readonly<Record<string, ResolvedChannel>> {
  return frameDomains(
    layers.map((layer) => ({
      layerId: layer.layerId,
      chartKind: LAYER_KINDS[layer.layerId as LayerId],
      channels: Object.fromEntries(
        Object.entries(layer.encodings).map(([channel, field]) => [channel, { type: channel === 'y' ? ('number' as const) : ('string' as const), values: layer.rows.map((row) => row[field]) }]),
      ),
    })),
  );
}

function FramePage(props: { readonly view: SessionView; readonly rows: readonly GalleryRow[] }): JSX.Element {
  const { view, rows } = props;
  const state: SessionViewState = useSessionView(view);
  const [last, setLast] = useState<string>('nothing yet — click a bar in either bar layer');
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
        all: { kind: LAYER_KINDS.all, colorOf: () => 'var(--vzf-line)' },
        top: { kind: LAYER_KINDS.top, colorOf: (category) => CATEGORY_COLORS[category ?? ''] ?? 'var(--vzf-brand)' },
        good: { kind: LAYER_KINDS.good, colorOf: () => 'var(--vzf-ink)' },
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
      layers: { layerIds: [...LAYER_IDS], callbacksFor: (address) => verbs(address.split('~')[1] ?? 'all') },
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
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Three layers, one frame</h1>
      {/* the words the frame says — what was shared, what an empty slot means, and what a line on a band claims */}
      <p className="vzf-frame-words" style={{ margin: '0 0 16px', lineHeight: 1.5 }}>
        Every row, and the 4★+ rows, counted by category and drawn as two layers of bars on <strong>one frame</strong> — and the 3★+ rows as a <strong>line over the same bands</strong>. The frame folded{' '}
        <strong>one band order</strong> ({band !== undefined && band.mode === 'shared' && band.scale === 'categorical' ? band.domain.join(' · ') : 'nothing'}) and{' '}
        <strong>one count ceiling</strong> ({ceiling !== undefined && ceiling.mode === 'shared' && ceiling.scale === 'quantitative' ? `0 – ${String(ceiling.domain[1])} rows` : 'nothing'}), so the
        same category is the same slot in every layer and their heights are comparable by eye. A slot the 4★+ layer has no rows for stays <strong>empty</strong> — “no rows here” is not “none of
        them”. The line’s x is the <strong>category column itself</strong>, so each of its points sits at its slot’s centre, and the connectors between them claim nothing — on a band there is no
        between; a slot the line has no point for is a gap. The axes are drawn <strong>once</strong>, by the frame.
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
