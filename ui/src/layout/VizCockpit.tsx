/**
 * `<VizCockpit>` — the FLAGSHIP layout: everything on one screen, nothing to
 * scroll. The shell locks itself to the viewport (100dvh) and never overflows;
 * neither the page nor the shell ever scrolls at desktop sizes.
 *
 *   top strip     — time travel (a compact {@link TimeTravelBar} fits here),
 *                   plus the LAYOUT SWITCHER (LY-1) when a `layout` is given:
 *                   Flow / Grid / Focus as a keyboard-accessible radiogroup.
 *   charts        — fill ALL remaining height; each chart is a render prop that
 *                   receives its cell's measured size ({@link ChartFrame}), so
 *                   the SVG scales to its container while staying crisp.
 *   status strip  — one slim line: a status readout (rows selected, provider)
 *                   on the left, REPORT CHIPS on the right. Each chip carries a
 *                   live badge (gap count, discoveries, commits …) so state is
 *                   glanceable while closed, and opens a LARGE frosted-glass
 *                   {@link VizModal} hosting the full panel (CommitLog,
 *                   BranchMap, FdrLedger, …). Consumers can add their own chips
 *                   (e.g. 🐛 Debug) — it is just data.
 *
 * LY-1 — user-pickable, session-carried arrangements. The cockpit is DRIVEN:
 * `layout` (preset / order / focusId — the adapter's `state.layout`, i.e. the
 * session's fold at the cursor) decides the arrangement; every gesture
 * (switcher click, thumbnail click, drag-to-reorder drop) only CALLS
 * `onLayoutChange` — wire it to `view.setLayout` and the arrangement lands as
 * a recorded commit that time-travels with the story. Three presets, v1:
 *   - `flow`  — the weighted band (the original look, unchanged);
 *   - `grid`  — equal cells, two rows;
 *   - `focus` — one maximized chart over a compact thumbnail rail of the
 *               others (scaled-down LIVE cells — same React tree, same keys,
 *               so nothing remounts; an overlay button swaps focus and keeps
 *               tiny accidental brushes out).
 * Morphs animate transform-only via {@link useLayoutMorph} (FLIP; reduced
 * motion honoured). On narrow screens (≤700px) the charts stay the snap
 * carousel REGARDLESS of preset, and the arrangement controls hide.
 *
 * `readOnly` (present mode) dims and pointer-blocks the acting charts while
 * navigation (top strip) and the read-only report chips stay live; the
 * arrangement controls disable — each story beat restores its OWN layout
 * through the session fold, so present mode replays arrangements, never
 * authors them.
 *
 * This is the ONLY layout shell — every consumer (the gallery, demo-agent)
 * mounts the cockpit as the whole page.
 */
import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, UIEvent } from 'react';
import { themeStyle, themeAttr, type ThemeConfig } from '../tokens/theme.js';
import type { LayoutChange, LayoutPreset, LayoutView } from '../adapter/types.js';
import { ChartFrame, type ChartSize } from '../charts/ChartFrame.js';
import { VizModal } from './VizModal.js';
import { useLayoutMorph } from './layoutMorph.js';

/** One chart cell — rendered at its measured size so it fills its share of the middle band. */
export interface CockpitChart {
  readonly id: string;
  /** Relative width on the desktop grid (default 1 — e.g. 3 vs 2 gives a wider scatter). */
  readonly weight?: number;
  /** A one-line caption under the chart. */
  readonly caption?: ReactNode;
  /** Render the chart; pass `size.width`/`size.height` straight to the chart's props. */
  readonly render: (size: ChartSize) => ReactNode;
}

/** One report chip on the status strip — opens a large modal hosting `content`. */
export interface CockpitReport {
  readonly id: string;
  /** Chip label AND modal title. */
  readonly title: ReactNode;
  readonly icon?: ReactNode;
  /** Live badge on the chip (a count) — glanceable while the modal is closed. */
  readonly badge?: ReactNode;
  /** The panel the modal hosts (an existing component, unchanged). */
  readonly content: ReactNode;
}

export interface VizCockpitProps {
  /** The time-travel strip (pinned top). */
  readonly top?: ReactNode;
  readonly charts?: readonly CockpitChart[];
  readonly reports?: readonly CockpitReport[];
  /** The left side of the status strip (rows selected, provider label …). */
  readonly status?: ReactNode;
  /**
   * A non-blocking overlay host (BR-2: the `<ForkToast>` lives here). Rendered
   * inside the themed root but position-fixed — it never takes layout space,
   * so the zero-scroll invariant holds with or without a toast showing.
   */
  readonly toast?: ReactNode;
  /**
   * LY-1: the arrangement at the cursor — the adapter's `state.layout`.
   * Providing it turns on the switcher, drag-to-reorder, and the focus rail.
   * Omitted → the original weighted flow band, no arrangement chrome.
   */
  readonly layout?: LayoutView;
  /** LY-1: every arrangement gesture lands here — wire to `view.setLayout`. */
  readonly onLayoutChange?: (change: LayoutChange) => void;
  /** Present mode: dim + block the charts, show the note. */
  readonly readOnly?: boolean;
  readonly readOnlyNote?: ReactNode;
  readonly theme?: ThemeConfig;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const PRESETS: readonly LayoutPreset[] = ['flow', 'grid', 'focus'];
const PRESET_LABELS: Readonly<Record<LayoutPreset, string>> = { flow: 'Flow', grid: 'Grid', focus: 'Focus' };

/** `order` first (ids that exist, in the saved sequence), then the rest in consumer order. */
export function orderCharts(charts: readonly CockpitChart[], order: readonly string[]): CockpitChart[] {
  const byId = new Map(charts.map((c) => [c.id, c]));
  const head = order.map((id) => byId.get(id)).filter((c): c is CockpitChart => c !== undefined);
  const placed = new Set(head.map((c) => c.id));
  return [...head, ...charts.filter((c) => !placed.has(c.id))];
}

/** Move `dragId` to `targetId`'s ORIGINAL position (the drop gesture's new order). */
export function reorderIds(ids: readonly string[], dragId: string, targetId: string): string[] {
  const at = ids.indexOf(targetId);
  const next = ids.filter((id) => id !== dragId);
  next.splice(at, 0, dragId);
  return next;
}

/** The charts band's grid template for a preset (mobile CSS overrides to the carousel regardless). */
function bandStyle(preset: LayoutPreset, charts: readonly CockpitChart[]): CSSProperties {
  const n = charts.length;
  if (preset === 'grid' && n > 1) {
    // equal cells, two rows once there are 3+ charts (2×N); a pair sits side by side
    const rows = n >= 3 ? 2 : 1;
    const cols = Math.ceil(n / rows);
    return {
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
    };
  }
  if (preset === 'focus' && n > 1) {
    // one maximized row + a compact thumbnail rail (bounded so it can never squeeze the hero)
    return {
      gridTemplateColumns: `repeat(${n - 1}, minmax(0, 1fr))`,
      gridTemplateRows: 'minmax(0, 1fr) minmax(84px, 16%)',
    };
  }
  // flow — the weighted band (and the degenerate 0/1-chart case for every preset)
  return { gridTemplateColumns: charts.map((c) => `minmax(0, ${c.weight ?? 1}fr)`).join(' ') };
}

/** Where the pointer is, cell-wise: real hit-testing when the engine has it, the event target otherwise. */
function cellIdAt(e: PointerEvent): string | null {
  const under =
    typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(e.clientX, e.clientY)
      : e.target instanceof Element
        ? e.target
        : null;
  return under?.closest('[data-chart]')?.getAttribute('data-chart') ?? null;
}

export function VizCockpit(props: VizCockpitProps): JSX.Element {
  const { theme, layout, readOnly = false } = props;
  const reports = props.reports ?? [];
  const style: CSSProperties = { ...(themeStyle(theme) as CSSProperties), ...props.style };

  // ── LY-1: the driven arrangement ──
  const preset: LayoutPreset = layout?.preset ?? 'flow';
  const charts = orderCharts(props.charts ?? [], layout?.order ?? []);
  const focusedId =
    preset === 'focus' && charts.length > 0
      ? layout?.focusId !== null && layout?.focusId !== undefined && charts.some((c) => c.id === layout.focusId)
        ? layout.focusId
        : charts[0]!.id
      : null;
  const canArrange = layout !== undefined && props.onLayoutChange !== undefined && !readOnly;

  const stripRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const activeReport = reports.find((r) => r.id === openId) ?? null;

  // morph on arrangement change ONLY (transform/opacity — chart internals never re-render per frame)
  useLayoutMorph(stripRef, `${preset}|${focusedId ?? ''}|${charts.map((c) => c.id).join(',')}`);

  const emitLayout = (change: LayoutChange): void => {
    /* v8 ignore next 2 -- every arrangement control (switcher button, thumb overlay, drag handle) renders enabled only under canArrange, which requires onLayoutChange — the undefined arm is unreachable */
    props.onLayoutChange?.(change);
  };

  // ── the layout switcher (radiogroup, roving tabindex, select-follows-arrow) ──
  const pick = (p: LayoutPreset): void => emitLayout({ preset: p });
  const onSwitchKey = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = PRESETS.indexOf(preset);
    pick(PRESETS[(i + (e.key === 'ArrowRight' ? 1 : PRESETS.length - 1)) % PRESETS.length]!);
  };
  const switcher =
    layout !== undefined ? (
      <div className="vzf-layout-switch" role="radiogroup" aria-label="Cockpit layout" data-vzf="layout-switch">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={preset === p}
            tabIndex={preset === p ? 0 : -1}
            disabled={!canArrange}
            className={`vzf-layout-option${preset === p ? ' vzf-active' : ''}`}
            data-preset-option={p}
            onClick={() => pick(p)}
            onKeyDown={onSwitchKey}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>
    ) : null;

  // ── drag-to-reorder (pointer-based; the drop lands ONE order change) ──
  const beginDrag = (id: string) => (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault(); // no text selection under the drag
    setDragId(id);
    setOverId(null);
    const move = (ev: PointerEvent): void => {
      const over = cellIdAt(ev);
      setOverId(over !== null && over !== id ? over : null);
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      setDragId(null);
      setOverId(null);
      const target = cellIdAt(ev);
      if (target !== null && target !== id) {
        emitLayout({ order: reorderIds(charts.map((c) => c.id), id, target) });
      }
    };
    const cancel = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      setDragId(null);
      setOverId(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  // ── mobile carousel: keep the active dot in sync with the snap position ──
  // Each snap page spans one full strip width PLUS the flex gap between cells,
  // so page↔scrollLeft conversions must include the gap or every swipe lands
  // one gap short. (jsdom reports no computed gap → 0, which matches its layout.)
  const pageSpan = (el: HTMLElement): number => {
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
    return el.clientWidth + gap;
  };
  const onStripScroll = (e: UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget;
    if (el.clientWidth === 0) return; // no layout yet (jsdom / display:none)
    setPage(Math.max(0, Math.min(charts.length - 1, Math.round(el.scrollLeft / pageSpan(el)))));
  };
  const goToChart = (index: number): void => {
    const el = stripRef.current;
    /* v8 ignore next -- the dots render only alongside the strip in this same tree, so the strip ref is attached before any dot can be clicked */
    if (el === null) return;
    const left = index * pageSpan(el);
    if (typeof el.scrollTo === 'function') el.scrollTo({ left, behavior: 'smooth' });
    else el.scrollLeft = left; // jsdom has no Element.scrollTo
    setPage(index);
  };

  /** Explicit grid placement for the focus preset (hero row 1 spans all; thumbs line row 2). */
  const cellStyle = (id: string, thumbIndex: number): CSSProperties | undefined => {
    if (preset !== 'focus' || charts.length <= 1) return undefined;
    return id === focusedId ? { gridRow: '1', gridColumn: '1 / -1' } : { gridRow: '2', gridColumn: `${thumbIndex + 1}` };
  };

  let thumbCursor = 0;
  return (
    <div className={`vzf vzf-cockpit-root${props.className ? ' ' + props.className : ''}`} style={style} data-theme={themeAttr(theme)}>
      <div className={`vzf-cockpit${readOnly ? ' vzf-readonly' : ''}`} data-vzf="cockpit" data-readonly={readOnly ? 'true' : 'false'}>
        {readOnly && (
          <div className="vzf-readonly-note" role="status">
            {props.readOnlyNote ?? '👁 Present mode — acting is paused; navigate the story beats. Switch to Explore to act.'}
          </div>
        )}
        {(props.top !== undefined || switcher !== null) && (
          <div className="vzf-cockpit-top" data-vzf="cockpit-top">
            {props.top !== undefined && (
              <div className="vzf-cockpit-top-main" data-vzf="cockpit-top-main">
                {props.top}
              </div>
            )}
            {switcher}
          </div>
        )}

        <div
          className="vzf-cockpit-charts"
          data-vzf="cockpit-charts"
          data-preset={preset}
          ref={stripRef}
          onScroll={onStripScroll}
          style={bandStyle(preset, charts)}
        >
          {charts.map((c) => {
            const isFocused = focusedId === c.id;
            const isThumb = focusedId !== null && !isFocused;
            const placement = cellStyle(c.id, isThumb ? thumbCursor++ : 0);
            return (
              <section
                key={c.id}
                className={`vzf-cockpit-cell${isFocused ? ' vzf-focused' : ''}${isThumb ? ' vzf-thumb' : ''}${
                  dragId === c.id ? ' vzf-dragging' : ''
                }${overId === c.id ? ' vzf-drop-target' : ''}`}
                data-chart={c.id}
                data-focused={isFocused ? 'true' : undefined}
                style={placement}
              >
                {canArrange && (
                  <div
                    className="vzf-drag-handle"
                    data-vzf="drag-handle"
                    title="Drag to reorder"
                    aria-hidden="true"
                    onPointerDown={beginDrag(c.id)}
                  >
                    ⠿
                  </div>
                )}
                <ChartFrame>{c.render}</ChartFrame>
                {c.caption !== undefined && <div className="vzf-chart-caption">{c.caption}</div>}
                {isThumb && (
                  <button
                    type="button"
                    className="vzf-thumb-overlay"
                    data-vzf="focus-thumb"
                    aria-label={`Focus ${c.id}`}
                    disabled={!canArrange}
                    onClick={() => emitLayout({ focusId: c.id })}
                  />
                )}
              </section>
            );
          })}
        </div>

        {charts.length > 1 && (
          <div className="vzf-cockpit-dots" data-vzf="cockpit-dots">
            {charts.map((c, i) => (
              <button
                key={c.id}
                type="button"
                className={`vzf-cockpit-dot${i === page ? ' vzf-active' : ''}`}
                aria-label={`go to chart ${i + 1} of ${charts.length}`}
                aria-current={i === page ? 'true' : undefined}
                onClick={() => goToChart(i)}
              />
            ))}
          </div>
        )}

        <div className="vzf-cockpit-status" data-vzf="cockpit-status">
          <div className="vzf-cockpit-readout">{props.status}</div>
          <div className="vzf-cockpit-chips">
            {reports.map((r) => (
              <button
                key={r.id}
                type="button"
                className="vzf-report-chip"
                data-report={r.id}
                aria-haspopup="dialog"
                onClick={() => setOpenId(r.id)}
              >
                {r.icon !== undefined && (
                  <span className="vzf-report-icon" aria-hidden="true">
                    {r.icon}
                  </span>
                )}
                <span className="vzf-report-title">{r.title}</span>
                {r.badge !== undefined && r.badge !== null && <span className="vzf-report-badge">{r.badge}</span>}
              </button>
            ))}
          </div>
        </div>

        <VizModal
          open={activeReport !== null}
          onClose={() => setOpenId(null)}
          size="large"
          name={activeReport !== null ? `report-${activeReport.id}` : undefined}
          title={activeReport !== null ? activeReport.title : undefined}
        >
          {activeReport !== null ? activeReport.content : null}
        </VizModal>
        {props.toast}
      </div>
    </div>
  );
}
