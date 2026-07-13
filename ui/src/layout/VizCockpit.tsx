/**
 * `<VizCockpit>` — the FLAGSHIP layout: everything on one screen, nothing to
 * scroll. The shell locks itself to the viewport (100dvh) and never overflows;
 * neither the page nor the shell ever scrolls at desktop sizes.
 *
 *   top strip     — time travel (a compact {@link TimeTravelBar} fits here).
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
 * On narrow screens (≤700px) the charts become horizontally swipeable pages
 * (CSS scroll-snap) with dot indicators; the time strip stays pinned top and
 * the chip strip pinned bottom — still zero vertical page scroll.
 *
 * `readOnly` (present mode) dims and pointer-blocks the acting charts while
 * navigation (top strip) and the read-only report chips stay live.
 *
 * This is the ONLY layout shell — every consumer (the gallery, demo-agent)
 * mounts the cockpit as the whole page.
 */
import { useRef, useState } from 'react';
import type { CSSProperties, ReactNode, UIEvent } from 'react';
import { themeStyle, themeAttr, type ThemeConfig } from '../tokens/theme.js';
import { ChartFrame, type ChartSize } from '../charts/ChartFrame.js';
import { VizModal } from './VizModal.js';

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
  /** Present mode: dim + block the charts, show the note. */
  readonly readOnly?: boolean;
  readonly readOnlyNote?: ReactNode;
  readonly theme?: ThemeConfig;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function VizCockpit(props: VizCockpitProps): JSX.Element {
  const { theme, readOnly = false } = props;
  const charts = props.charts ?? [];
  const reports = props.reports ?? [];
  const style: CSSProperties = { ...(themeStyle(theme) as CSSProperties), ...props.style };

  const stripRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const activeReport = reports.find((r) => r.id === openId) ?? null;

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

  return (
    <div className={`vzf vzf-cockpit-root${props.className ? ' ' + props.className : ''}`} style={style} data-theme={themeAttr(theme)}>
      <div className={`vzf-cockpit${readOnly ? ' vzf-readonly' : ''}`} data-vzf="cockpit" data-readonly={readOnly ? 'true' : 'false'}>
        {readOnly && (
          <div className="vzf-readonly-note" role="status">
            {props.readOnlyNote ?? '👁 Present mode — acting is paused; navigate the story beats. Switch to Explore to act.'}
          </div>
        )}
        {props.top !== undefined && (
          <div className="vzf-cockpit-top" data-vzf="cockpit-top">
            {props.top}
          </div>
        )}

        <div
          className="vzf-cockpit-charts"
          data-vzf="cockpit-charts"
          ref={stripRef}
          onScroll={onStripScroll}
          style={{ gridTemplateColumns: charts.map((c) => `minmax(0, ${c.weight ?? 1}fr)`).join(' ') }}
        >
          {charts.map((c) => (
            <section key={c.id} className="vzf-cockpit-cell" data-chart={c.id}>
              <ChartFrame>{c.render}</ChartFrame>
              {c.caption !== undefined && <div className="vzf-chart-caption">{c.caption}</div>}
            </section>
          ))}
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
      </div>
    </div>
  );
}
