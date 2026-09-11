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
 *
 * THE SECOND FIGURE is the two-axis one: the mean price and the mean rating per
 * week, two lines on ONE frame with TWO scales — price on the left edge, rating
 * on the right, x drawn once by the frame — and the frame's own sentence under
 * the plot saying the two are not comparable by height. Two scales are two
 * claims, and the frame says so (`twoScalesSentence`, the renderer's one
 * owner); this page adds nothing to it but the words around it.
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
/** The view the two-scale figure is recorded under: the scripted session's DECLARED line view (x: date, y: price). */
const LINE_VIEW_ID = 'line';
/** The two scales of the second figure — a layer per field, each its own y. */
const SCALE_FIELDS = ['price', 'rating'] as const;

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

/**
 * One row per week, the MEAN of `field` over that week's rows — the HOST's
 * aggregation, so the line draws a number the page computed and never one it
 * invented. Weeks with no rows are absent, not zero: "no rows here" is not "0".
 */
function weeklyMeanOf(rows: readonly GalleryRow[], field: (typeof SCALE_FIELDS)[number]): readonly RenderRow[] {
  const weeks = [...new Set(rows.map((r) => r.date))].sort();
  return weeks.map((date) => {
    const inWeek = rows.filter((r) => r.date === date);
    return { date, [field]: Math.round((inWeek.reduce((sum, r) => sum + r[field], 0) / inWeek.length) * 100) / 100 };
  });
}

/** The two-scale figure's layers: a line of the mean price and a line of the mean rating, over the same weeks. */
function scaleLayersOf(rows: readonly GalleryRow[]): readonly RenderLayer[] {
  return SCALE_FIELDS.map((field) => ({ layerId: field, table: 'gallery', rows: weeklyMeanOf(rows, field), encodings: { x: 'date', y: field } }));
}

/**
 * THE FOLD of the two-scale figure: x shared and merged (one temporal run of
 * weeks, the frame's to draw once), y DECLARED independent — two scales. The
 * declaration is the whole difference from the first figure's fold: nothing
 * here infers that price and rating should share a ceiling, and nothing could
 * make them — a merged guide is a declaration, never an inference.
 */
function scaleFrameOf(layers: readonly RenderLayer[]): Readonly<Record<string, ResolvedChannel>> {
  return frameDomains(
    layers.map((layer) => ({
      layerId: layer.layerId,
      chartKind: 'line' as const,
      channels: Object.fromEntries(Object.entries(layer.encodings).map(([channel, field]) => [channel, { type: channel === 'x' ? ('date' as const) : ('number' as const), values: layer.rows.map((row) => row[field]) }])),
    })),
    { y: { mode: 'independent' } },
  );
}

/** The second figure: two lines, two scales, the frame's sentence beneath. */
function TwoScalesFigure(props: { readonly view: SessionView; readonly rows: readonly GalleryRow[] }): JSX.Element {
  const { view, rows } = props;
  const state: SessionViewState = useSessionView(view);
  const [last, setLast] = useState<string>('nothing yet — brush a run of weeks on either line');
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boundRef = useRef<BoundRenderer | null>(null);
  const layers = useMemo(() => scaleLayersOf(rows), [rows]);
  const frame = useMemo(() => scaleFrameOf(layers), [layers]);
  const selection = selectionForView(state.selections, layerAddress(LINE_VIEW_ID, SCALE_FIELDS[0]));

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const renderer = layeredRenderer({
      layers: {
        price: { kind: 'line', colorOf: () => 'var(--vzf-brand)' },
        rating: { kind: 'line', colorOf: () => 'var(--vzf-ink)' },
      },
      xLabel: 'week',
    });
    const verbs = (layerId: string) => ({
      emit: (emission: ChartEmission) => {
        setLast(`the "${layerId}" line emitted a ${emission.encoding.kind}`);
        void view.emit(LINE_VIEW_ID, emission, `two-scale gesture on the "${layerId}" line`);
      },
      hover: () => {},
      reencodeRequest: () => {},
      navigate: () => {},
    });
    const res = bindRenderer(renderer, el, {
      viewId: LINE_VIEW_ID,
      callbacks: verbs(SCALE_FIELDS[0]),
      layers: { layerIds: [...SCALE_FIELDS], callbacksFor: (address) => verbs(address.split('~')[1] ?? SCALE_FIELDS[0]) },
      onGap: (gap) => {
        console.error('frame page: contract gap at bind (two scales)', gap);
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
    // the same microtask the first figure needs — see `FramePage`
    queueMicrotask(() =>
      boundRef.current?.update({
        rows: layers[0]?.rows ?? [],
        encodings: { x: 'date', y: SCALE_FIELDS[0] },
        selection,
        hover: null,
        theme: {},
        size: { width: 760, height: 380 },
        layers,
        frame,
      }),
    );
  }, [layers, frame, selection]);

  const run = frame['x'];
  return (
    <section data-figure="two-scales" style={{ marginTop: 40 }}>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Two lines, two scales, one frame</h2>
      <p className="vzf-frame-words-two" style={{ margin: '0 0 16px', lineHeight: 1.5 }}>
        The mean <strong>price</strong> and the mean <strong>rating</strong> per week, two lines on <strong>one frame</strong>. The frame folded <strong>one run of weeks</strong> (
        {run !== undefined && run.mode === 'shared' && run.scale === 'temporal' ? `${run.domain[0]} – ${run.domain[1]}` : 'nothing'}) and drew it <strong>once</strong>; each line’s y is{' '}
        <strong>its own scale</strong> — price on the <strong>left</strong> edge, rating on the <strong>right</strong> — because the fold declared y independent, and a dollar and a star share
        no ceiling. Two scales are two claims, so the frame says so under the plot: the heights are not comparable across them. Nothing stretched the two to fit, and nothing merged them
        because they looked alike — a merged guide is a declaration, never an inference.
      </p>
      <div ref={hostRef} style={{ width: 760, height: 380 }} />
      <p className="vzf-frame-readout-two" style={{ marginTop: 12 }}>
        {last} · {String(state.commits.length)} commits
      </p>
    </section>
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
      <section data-figure="one-guide">
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
      </section>
      <TwoScalesFigure view={view} rows={rows} />
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
