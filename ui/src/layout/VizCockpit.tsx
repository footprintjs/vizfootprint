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
 * `readOnly` (present mode) makes the acting charts INERT — dimmed, pointer-
 * blocked, and out of the tab order (a paused control is disabled, never
 * merely unclickable) — while navigation (top strip) and the report chips
 * stay live; the
 * arrangement controls disable — each bookmark restores its OWN layout
 * through the session fold, so present mode replays arrangements, never
 * authors them.
 *
 * This is the ONLY layout shell — every consumer (the gallery, demo-agent)
 * mounts the cockpit as the whole page.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, UIEvent } from 'react';
import { themeStyle, themeAttr, type ThemeConfig } from '../tokens/theme.js';
import type { LayoutChange, LayoutPreset, LayoutView } from '../adapter/types.js';
import { ChartFrame, type ChartSize } from '../primitives/ChartFrame.js';
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
  /** SET-1: true when this chart's view holds a live selection — shows the ✕ clear affordance (needs `onClear`). */
  readonly active?: boolean;
  /** SET-1: clear this chart's OWN selection — a real commit with a cause. Rendered as a ✕ pill beside the chart when `active`. */
  readonly onClear?: () => void;
  /** Open the editor for THIS chart — rendered as a ✎ on the cell (shown on hover and focus), never a floating button over the cockpit. */
  readonly onEdit?: () => void;
}

/** One entry of the cockpit's menu (☰): the host's acts, in the host's words. */
export interface CockpitMenuItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly icon?: ReactNode;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  /** One line under the label, when the act needs a word of explanation. */
  readonly hint?: string;
}

/**
 * PRESENT MODE AS A SLIDESHOW — the story layer's live lens. The dashboard
 * itself is the slide: the host seeks the session to each named bookmark
 * and hands the cockpit the bookmark's words; the cockpit takes the screen
 * (fullscreen when the browser allows), hides every strip but a slim slide
 * bar, and walks prev/next on the arrow keys and space. Interactions stay
 * off: nothing is recorded in a slideshow (the cockpit is read-only).
 */
export interface CockpitSlideshow {
  readonly active: boolean;
  /** The bookmark's label. */
  readonly title: string;
  /** The dashboard's words at this bookmark (its caption), when it has any. */
  readonly words?: string;
  /** 0-based position and the count of bookmarks on the presented lineage. */
  readonly index: number;
  readonly count: number;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onExit: () => void;
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

/** The cockpit's push-aside panel. */
export interface CockpitAside {
  readonly open: boolean;
  readonly title: string;
  readonly onClose?: () => void;
  readonly children?: ReactNode;
  /** Width in CSS pixels when open. Default 380. */
  readonly width?: number;
}

export interface VizCockpitProps {
  /** The time-travel strip (pinned top). */
  readonly top?: ReactNode;
  readonly charts?: readonly CockpitChart[];
  readonly reports?: readonly CockpitReport[];
  /**
   * A side panel that PUSHES the dashboard aside (the arrangement plane's
   * drawer): it reserves its width inside the cockpit instead of floating over
   * it, animates open and closed (no motion under prefers-reduced-motion), and
   * never blocks the charts — so an edit made in it is seen happening. Use it
   * for the chart editor; use `EditorDrawer` from `vizfootprint-ui/editor`
   * when there is no cockpit to push.
   */
  readonly aside?: CockpitAside;
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
  /** The cockpit's menu (☰) at the top right: the host's acts. Omitted → no menu. */
  readonly menu?: readonly CockpitMenuItem[];
  /** Present mode as a fullscreen slideshow over the bookmarks (see {@link CockpitSlideshow}). */
  readonly slideshow?: CockpitSlideshow;
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

/** Everything a keyboard could reach in the charts band (see the read-only effect). */
const BAND_FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]';
/**
 * THE ONE EXEMPTION: a control that only ever NAVIGATES, marked by whoever
 * drew it. `<ProseText>` stamps it on a commit/bookmark anchor — a link in a
 * chart's words, or in a note, that goes to a moment in the story. Present
 * mode pauses ACTING; walking the story is the very thing it is for, so a
 * marked control keeps its tab stop and its click. (A saved-selection anchor
 * is deliberately NOT marked: applying a selection is an act.)
 *
 * Scoping by container instead was the wrong cut — the cockpit renders every
 * cell inside a `<ChartFrame>`, and a note IS a cell, so "outside the frame"
 * exempted a chart's caption while silently disabling every link inside a
 * note. What matters is what a control DOES, not where it sits.
 */
const SEEK_ONLY = '[data-vzf-seek]';
/** Where a paused node's own tabindex is remembered, so Explore restores it exactly. */
const WAS_TABINDEX = 'data-vzf-was-tabindex';
/** The keys that ACTIVATE a control. Everything else — Tab, Shift+Tab, Escape, the arrows — must always pass. */
const ACTIVATION_KEYS = new Set([' ', 'Enter']);

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
  const { theme, layout } = props;
  const show = props.slideshow;
  const showing = show?.active === true;
  // nothing is recorded in a slideshow: the cockpit is read-only while the show runs, whatever the host passed
  const readOnly = props.readOnly === true || showing;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuListRef = useRef<HTMLDivElement | null>(null);
  // the show's callbacks ride a ref: the effects below depend on `showing` alone, so a host that rebuilds the
  // slideshow object every render (the demo does) never tears the screen down between bookmarks
  const showRef = useRef(props.slideshow);
  showRef.current = props.slideshow;
  /** Close from the keyboard or an act: focus goes back to ☰ (a click outside closes without moving focus — the person is elsewhere). */
  const closeMenu = (): void => {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };
  // the menu closes on Escape (focus back on ☰) and on a click outside it; while open, the arrows rove its items
  useEffect(() => {
    if (!menuOpen) return;
    // the list is mounted while menuOpen renders it — unless the host shrank `menu` to nothing meanwhile
    const items = (): HTMLElement[] => {
      const list = menuListRef.current;
      /* v8 ignore next -- the host emptied the menu while it was open: the list is gone */
      if (list === null) return [];
      return [...list.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    };
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const list = items();
      /* v8 ignore next -- the host emptied the menu while it was open: nothing to rove */
      if (list.length === 0) return;
      e.preventDefault();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
      list[next]!.focus();
    };
    const onDown = (e: PointerEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeMenu reads refs and a setter only
  }, [menuOpen]);
  // a show takes the strip away: the menu cannot stay open under it
  useEffect(() => {
    if (showing) setMenuOpen(false);
  }, [showing]);
  /**
   * READ-ONLY MEANS INERT — not merely unclickable.
   *
   * `pointer-events: none` (the `.vzf-readonly` rule) stops the MOUSE and
   * nothing else. Every mark in the band is a focusable node — the charts draw
   * `role="button" tabIndex={0}` rects, and the cockpit's own ✕ clear rides
   * beside them — so Present mode used to say "acting is paused" while Tab
   * still reached a control and Enter still landed a real commit.
   *
   * While read-only, everything focusable in the charts band leaves the TAB
   * ORDER and says it is disabled — everything except a {@link SEEK_ONLY}
   * control, which goes to a moment in the story and is the one thing this
   * mode is for. They stay in the accessibility TREE on purpose: Present mode
   * exists to TELL the story, and a screen-reader user must still be able to
   * read the charts — which `inert`, the other obvious tool, would have
   * hidden outright.
   *
   * A MutationObserver keeps it true: the band's marks are rebuilt whenever
   * the story moves (a seek in Present mode draws new bars, and a new bar is
   * born tabbable), and those rebuilds come from the CHARTS' own renders, not
   * from this component's — so a plain effect would miss them.
   */
  useEffect(() => {
    const band = stripRef.current;
    /* v8 ignore next -- the charts band is unconditional, so the ref is always attached by the time an effect runs */
    if (band === null) return;
    const apply = (): void => {
      const nodes = [...band.querySelectorAll<Element>(BAND_FOCUSABLE)].filter((n) => !n.matches(SEEK_ONLY));
      if (readOnly) {
        for (const n of nodes) {
          if (n.hasAttribute(WAS_TABINDEX)) continue; // already paused — leave the remembered value alone
          n.setAttribute(WAS_TABINDEX, n.getAttribute('tabindex') ?? '');
          n.setAttribute('tabindex', '-1');
          n.setAttribute('aria-disabled', 'true');
        }
        return;
      }
      for (const n of nodes) {
        const was = n.getAttribute(WAS_TABINDEX);
        if (was === null) continue; // never paused (or already restored)
        if (was === '') n.removeAttribute('tabindex');
        else n.setAttribute('tabindex', was);
        n.removeAttribute(WAS_TABINDEX);
        n.removeAttribute('aria-disabled');
      }
    };
    apply();
    // Explore needs no watcher: a node born now is born free. Present does —
    // and the observer watches childList only, so `apply`'s own attribute
    // writes can never re-trigger it.
    if (!readOnly) return;
    const observer = new MutationObserver(apply);
    observer.observe(band, { subtree: true, childList: true });
    return () => observer.disconnect();
    // `readOnly` ALONE: a host that rebuilds its `charts` array every render
    // (most do — the demo polls at 1 Hz) would otherwise tear down and rebuild
    // the observer, and re-query every node in the band, once a second for as
    // long as the show runs. The observer is what catches nodes born later.
  }, [readOnly]);
  // the slideshow's keys: arrows, space and page keys walk the bookmarks, Escape leaves — never while a field or a button has the keyboard
  useEffect(() => {
    if (!showing) return;
    const onKey = (e: KeyboardEvent): void => {
      const show = showRef.current;
      /* v8 ignore next -- a keydown landing between the render that cleared the show and this listener's cleanup: real in a browser, not reachable under act() */
      if (show === undefined) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el instanceof HTMLElement && el.isContentEditable)) return; // a field keeps its keys
      if (e.key === ' ' && tag === 'BUTTON') return; // space activates the focused button, it does not also advance
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        show.onNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        show.onPrev();
      } else if (e.key === 'Escape') show.onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showing]);
  // the screen is taken while the show runs, and given back when it ends — or the show ends when the browser takes it back (F11, Esc)
  useEffect(() => {
    if (!showing) return;
    const root = document.documentElement;
    let entered = false;
    if (typeof root.requestFullscreen === 'function' && document.fullscreenElement === null) {
      entered = true;
      root.requestFullscreen().catch(() => {
        entered = false; // a browser that refused (no gesture, a policy) — the show still runs, in the window
      });
    }
    const onChange = (): void => {
      if (entered && document.fullscreenElement === null) {
        entered = false;
        showRef.current?.onExit();
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (entered && document.fullscreenElement !== null && typeof document.exitFullscreen === 'function') void document.exitFullscreen().catch(() => undefined);
    };
  }, [showing]);
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

  /**
   * In read-only, an ACT aimed at the charts band never reaches its handler —
   * belt and braces with the tab-order sweep, because a screen reader can
   * still click a control that has no tab stop.
   *
   * What it must NOT swallow: a control marked {@link SEEK_ONLY} (navigation,
   * which this mode exists for), and — from the keyboard — anything that is
   * not an activation key. Swallowing every keydown made Present mode a
   * KEYBOARD TRAP: Tab and Shift+Tab could not leave the chart, the arrows
   * could not walk the bookmarks, and Escape could not close the slideshow (a
   * React `stopPropagation` stops the native event too, so the window-level
   * handler never ran).
   */
  const pausedTarget = (e: ReactMouseEvent | ReactKeyboardEvent): Element | null => {
    if (!readOnly) return null;
    // a React DOM event inside this band always targets an element in it
    const target = e.target as Element;
    return target.closest(SEEK_ONLY) === null ? target : null;
  };
  const pauseClick = (e: ReactMouseEvent): void => {
    if (pausedTarget(e) === null) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const pauseKey = (e: ReactKeyboardEvent): void => {
    if (!ACTIVATION_KEYS.has(e.key)) return; // Tab / Shift+Tab / Escape / arrows are never an act
    if (pausedTarget(e) === null) return;
    e.preventDefault();
    e.stopPropagation();
  };

  let thumbCursor = 0;
  return (
    <div className={`vzf vzf-cockpit-root${showing ? ' vzf-slideshow' : ''}${props.className ? ' ' + props.className : ''}`} style={style} data-theme={themeAttr(theme)} data-slideshow={showing ? 'true' : undefined}>
      <div className={`vzf-cockpit${readOnly ? ' vzf-readonly' : ''}`} data-vzf="cockpit" data-readonly={readOnly ? 'true' : 'false'}>
        {readOnly && (
          <div className="vzf-readonly-note" role="status">
            {props.readOnlyNote ?? '👁 Present mode — acting is paused; navigate the bookmarks. Switch to Explore to act.'}
          </div>
        )}
        {(props.top !== undefined || switcher !== null || (props.menu !== undefined && props.menu.length > 0)) && (
          <div className="vzf-cockpit-top" data-vzf="cockpit-top">
            {props.top !== undefined && (
              <div className="vzf-cockpit-top-main" data-vzf="cockpit-top-main">
                {props.top}
              </div>
            )}
            {switcher}
            {props.menu !== undefined && props.menu.length > 0 && (
              <div className="vzf-cockpit-menu" ref={menuRef} data-vzf="cockpit-menu">
                <button type="button" ref={menuButtonRef} className="vzf-menu-button" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls="vzf-cockpit-menu-list" aria-label="Dashboard menu" onClick={() => setMenuOpen((o) => !o)}>
                  ☰
                </button>
                {menuOpen && (
                  <div className="vzf-menu-list" id="vzf-cockpit-menu-list" ref={menuListRef} role="menu" aria-label="Dashboard menu">
                    {props.menu.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        className="vzf-menu-item"
                        data-menu-item={item.id}
                        aria-disabled={item.disabled === true ? 'true' : undefined}
                        onClick={() => {
                          if (item.disabled === true) return; // a disabled item stays readable and focusable; it does nothing
                          closeMenu();
                          item.onSelect();
                        }}
                      >
                        {item.icon !== undefined && (
                          <span className="vzf-menu-icon" aria-hidden="true">
                            {item.icon}
                          </span>
                        )}
                        <span className="vzf-menu-label">{item.label}</span>
                        {item.hint !== undefined && <span className="vzf-menu-hint">{item.hint}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {showing && show !== undefined && (
          <div className="vzf-slide-bar" data-vzf="slide-bar" role="toolbar" aria-label="slideshow">
            <div className="vzf-step-group" role="group" aria-label="bookmarks">
              <button type="button" className="vzf-btn" data-slide="prev" disabled={show.index <= 0} onClick={show.onPrev} aria-label="previous bookmark">
                ⟵
              </button>
              <button type="button" className="vzf-btn" data-slide="next" disabled={show.index >= show.count - 1} onClick={show.onNext} aria-label="next bookmark">
                ⟶
              </button>
            </div>
            <div className="vzf-slide-words">
              <span className="vzf-slide-count">
                {show.index + 1} of {show.count}
              </span>
              <span className="vzf-slide-title">{show.title}</span>
              {show.words !== undefined && <span className="vzf-slide-caption">{show.words}</span>}
            </div>
            <button type="button" className="vzf-btn" data-slide="exit" onClick={show.onExit} aria-label="leave the slideshow">
              ✕
            </button>
          </div>
        )}

        <div
          className="vzf-cockpit-charts"
          data-vzf="cockpit-charts"
          data-preset={preset}
          ref={stripRef}
          onScroll={onStripScroll}
          // Read-only: these two swallow an ACT before the mark's own handler
          // sees it (see `pauseClick` / `pauseKey`). Never a seek anchor, and
          // never a key that only moves the keyboard around.
          onClickCapture={pauseClick}
          onKeyDownCapture={pauseKey}
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
                {c.onEdit !== undefined && !readOnly && (
                  <button type="button" className="vzf-cell-edit" data-vzf="cell-edit" aria-label={`Edit ${c.id}`} title="Edit this chart" onClick={c.onEdit}>
                    ✎
                  </button>
                )}
                <ChartFrame>{c.render}</ChartFrame>
                {c.onClear !== undefined && c.active === true && (
                  <button
                    type="button"
                    className="vzf-chart-clear"
                    data-vzf="clear-selection"
                    aria-label={`Clear the ${c.id} selection`}
                    // clearing is an ACT: paused in Present mode, and paused
                    // means inert — a `disabled` button, not one the mouse
                    // merely cannot reach (the keyboard could, and did)
                    disabled={readOnly}
                    title={readOnly ? 'Present mode — acting is paused; switch to Explore to clear this selection' : "Clear this view's selection (a commit, like any act)"}
                    onClick={c.onClear}
                  >
                    ✕ clear
                  </button>
                )}
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
      {props.aside !== undefined ? (
        <aside
          className={`vzf-cockpit-aside${props.aside.open ? ' vzf-open' : ''}`}
          data-vzf="cockpit-aside"
          aria-hidden={props.aside.open ? undefined : 'true'}
          style={{ ['--vzf-aside-w' as string]: `${props.aside.width ?? 380}px` }}
        >
          <div className="vzf-cockpit-aside-inner" role="complementary" aria-label={props.aside.title} style={{ width: props.aside.width ?? 380 }}>
            <div className="vzf-drawer-head">
              <span className="vzf-drawer-title">{props.aside.title}</span>
              {props.aside.onClose !== undefined ? (
                <button type="button" className="vzf-drawer-close" aria-label="Close" onClick={props.aside.onClose}>
                  ✕
                </button>
              ) : null}
            </div>
            <div className="vzf-drawer-body">{props.aside.children}</div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
