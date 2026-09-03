// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, createEvent } from '@testing-library/react';
import { VizCockpit, type CockpitChart, type CockpitReport } from './VizCockpit.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CHARTS: CockpitChart[] = [
  { id: 'scatter', weight: 3, caption: 'scatter caption', render: (s) => <svg className="vzf-chart" data-size={`${s.width}x${s.height}`} /> },
  { id: 'bar', weight: 2, render: () => <svg className="vzf-chart" /> },
];

/** ChartFrame draws nothing until it measures a real box — jsdom has no layout, so lend it one. */
const measurable = (): void => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => 400);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => 300);
};

const REPORTS: CockpitReport[] = [
  { id: 'commits', title: 'Commit log', icon: '🧾', badge: 7, content: <div data-testid="commits-panel">the log</div> },
  { id: 'gaps', title: 'Gaps', content: <div>gap rows</div> },
];

describe('VizCockpit — the single-viewport shell', () => {
  it('renders the three bands (top / charts / status) under the .vzf scoping root', () => {
    const { container } = render(<VizCockpit top={<div>TT</div>} charts={CHARTS} reports={REPORTS} status="12 of 60 rows" />);
    expect(container.querySelector('.vzf.vzf-cockpit-root')).not.toBeNull();
    expect(container.querySelector('[data-vzf="cockpit"]')).not.toBeNull();
    expect(container.querySelector('[data-vzf="cockpit-top"]')?.textContent).toBe('TT');
    expect(container.querySelectorAll('.vzf-cockpit-cell')).toHaveLength(2);
    expect(container.querySelector('[data-vzf="cockpit-status"] .vzf-cockpit-readout')?.textContent).toBe('12 of 60 rows');
  });

  it('hosts the toast slot inside the themed shell (BR-2 ForkToast host)', () => {
    const { container } = render(<VizCockpit charts={CHARTS} toast={<div data-testid="a-toast">forked!</div>} />);
    expect(container.querySelector('[data-vzf="cockpit"] [data-testid="a-toast"]')?.textContent).toBe('forked!');
  });

  it('builds the desktop grid columns from the chart weights (default weight 1)', () => {
    const { container } = render(<VizCockpit charts={[CHARTS[0]!, { id: 'plain', render: () => <svg /> }]} />);
    const strip = container.querySelector('[data-vzf="cockpit-charts"]') as HTMLElement;
    expect(strip.style.gridTemplateColumns).toBe('minmax(0, 3fr) minmax(0, 1fr)');
  });

  it('renders a caption only for the charts that carry one', () => {
    const { container } = render(<VizCockpit charts={CHARTS} />);
    expect(container.querySelector('[data-chart="scatter"] .vzf-chart-caption')?.textContent).toBe('scatter caption');
    expect(container.querySelector('[data-chart="bar"] .vzf-chart-caption')).toBeNull();
  });

  it('omits the top strip when no top node is given, and tolerates empty charts/reports', () => {
    const { container } = render(<VizCockpit />);
    expect(container.querySelector('[data-vzf="cockpit-top"]')).toBeNull();
    expect(container.querySelectorAll('.vzf-cockpit-cell')).toHaveLength(0);
    expect(container.querySelectorAll('.vzf-report-chip')).toHaveLength(0);
    expect(container.querySelector('[data-vzf="cockpit-dots"]')).toBeNull(); // no carousel for 0/1 charts
  });

  it('report chips show icon + title + live badge (badge only when supplied)', () => {
    const { container } = render(<VizCockpit reports={REPORTS} />);
    const commits = container.querySelector('[data-report="commits"]')!;
    expect(commits.querySelector('.vzf-report-icon')?.textContent).toBe('🧾');
    expect(commits.querySelector('.vzf-report-title')?.textContent).toBe('Commit log');
    expect(commits.querySelector('.vzf-report-badge')?.textContent).toBe('7');
    const gaps = container.querySelector('[data-report="gaps"]')!;
    expect(gaps.querySelector('.vzf-report-icon')).toBeNull();
    expect(gaps.querySelector('.vzf-report-badge')).toBeNull();
  });

  it('a chip opens the LARGE modal hosting that report; ✕ closes it', () => {
    const { container } = render(<VizCockpit reports={REPORTS} />);
    expect(container.querySelector('[data-vzf-modal]')).toBeNull();
    fireEvent.click(container.querySelector('[data-report="commits"]')!);
    const backdrop = container.querySelector('[data-vzf-modal="report-commits"]')!;
    expect(backdrop.classList.contains('vzf-modal-large')).toBe(true);
    expect(screen.getByTestId('commits-panel').textContent).toBe('the log');
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(container.querySelector('[data-vzf-modal]')).toBeNull();
  });

  it('switching chips swaps the hosted report', () => {
    const { container } = render(<VizCockpit reports={REPORTS} />);
    fireEvent.click(container.querySelector('[data-report="gaps"]')!);
    expect(container.querySelector('[data-vzf-modal="report-gaps"]')).not.toBeNull();
    expect(container.textContent).toContain('gap rows');
  });

  it('readOnly dims the charts band, shows the note, keeps chips clickable', () => {
    const { container } = render(<VizCockpit readOnly charts={CHARTS} reports={REPORTS} />);
    expect(container.querySelector('[data-vzf="cockpit"][data-readonly="true"]')).not.toBeNull();
    expect(container.querySelector('.vzf-cockpit')?.classList.contains('vzf-readonly')).toBe(true);
    expect(container.querySelector('.vzf-readonly-note')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-report="commits"]')!);
    expect(container.querySelector('[data-vzf-modal="report-commits"]')).not.toBeNull();
  });

  // REGRESSION (defect 5): Present mode blocked the MOUSE with CSS and nothing
  // else — a chart's ✕ clear (and every mark the charts draw as a focusable
  // rect) was still reachable by Tab, and Enter landed a real commit while the
  // banner read "acting is paused".
  it('readOnly makes the whole charts band inert: nothing in it is tabbable, and the ✕ clear is really disabled', async () => {
    measurable();
    const onClear = vi.fn();
    const marked: CockpitChart[] = [
      {
        id: 'bar',
        active: true,
        onClear,
        render: () => (
          <>
            <svg className="vzf-chart">
              <rect role="button" tabIndex={0} data-testid="mark" />
            </svg>
            {/* a chart's own control, focusable with no tabindex of its own */}
            <button type="button" data-testid="chart-btn">
              reset the zoom
            </button>
          </>
        ),
      },
    ];
    const { container, rerender } = render(<VizCockpit readOnly charts={marked} />);
    const clear = container.querySelector('[data-vzf="clear-selection"]') as HTMLButtonElement;
    expect(clear.disabled, 'a paused act is disabled, not merely unclickable').toBe(true);
    expect(clear.getAttribute('title')).toContain('acting is paused');
    fireEvent.click(clear);
    expect(onClear, 'a disabled button never fires its handler').not.toHaveBeenCalled();
    // the chart's OWN focusable mark left the tab order and says it is paused
    // (it arrives with the chart's own later render — the observer catches it)
    const mark = container.querySelector('[data-testid="mark"]')!;
    await waitFor(() => expect(mark.getAttribute('tabindex')).toBe('-1'));
    expect(mark.getAttribute('aria-disabled')).toBe('true');
    // …and stays in the accessibility tree — Present mode is for READING the story
    expect(mark.getAttribute('role')).toBe('button');

    // a chart's own button had no tabindex of its own — it is paused all the same
    expect(container.querySelector('[data-testid="chart-btn"]')!.getAttribute('tabindex')).toBe('-1');

    // back to Explore: every remembered tabindex comes back exactly as it was
    rerender(<VizCockpit charts={marked} />);
    expect(container.querySelector('[data-testid="mark"]')!.getAttribute('tabindex')).toBe('0');
    expect(container.querySelector('[data-testid="mark"]')!.hasAttribute('aria-disabled')).toBe(false);
    expect(container.querySelector('[data-testid="chart-btn"]')!.hasAttribute('tabindex'), 'a node that had no tabindex gets none back').toBe(false);
    const live = container.querySelector('[data-vzf="clear-selection"]') as HTMLButtonElement;
    expect(live.disabled).toBe(false);
    fireEvent.click(live);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('readOnly swallows an act aimed at a chart, and lets a SEEK anchor through wherever it sits — inside the frame included', async () => {
    measurable();
    const acted = vi.fn();
    const seeked = vi.fn();
    const seekedInCaption = vi.fn();
    const charts: CockpitChart[] = [
      {
        id: 'bar',
        caption: (
          <button type="button" data-vzf-seek="" data-testid="caption-link" onClick={seekedInCaption}>
            #c3
          </button>
        ),
        render: () => (
          <>
            <svg className="vzf-chart">
              <rect role="button" tabIndex={0} data-testid="mark" onClick={acted} onKeyDown={acted} />
            </svg>
            {/* a NOTE is a cell like any other, so its words live inside the
                frame — the seek anchors in them are the feature Present mode
                exists for, and used to be switched off by a frame-scoped rule */}
            <button type="button" data-vzf-seek="" data-testid="note-link" onClick={seeked}>
              go to #s2
            </button>
            <button type="button" data-testid="note-act">
              save
            </button>
          </>
        ),
      },
    ];
    const { container, rerender } = render(<VizCockpit readOnly charts={charts} />);
    const mark = container.querySelector('[data-testid="mark"]')!;
    await waitFor(() => expect(mark.getAttribute('tabindex')).toBe('-1'));
    // a screen reader can still CLICK a node that left the tab order — the act must not land
    fireEvent.click(mark);
    fireEvent.keyDown(mark, { key: 'Enter' });
    fireEvent.keyDown(mark, { key: ' ' });
    expect(acted, 'read-only means inert, not merely unclickable').not.toHaveBeenCalled();
    // a note's own ACT is paused with everything else
    expect(container.querySelector('[data-testid="note-act"]')!.getAttribute('tabindex')).toBe('-1');
    // …but its seek anchors keep BOTH their tab stop and their click, in the frame and in the caption
    const noteLink = container.querySelector('[data-testid="note-link"]')!;
    expect(noteLink.hasAttribute('tabindex'), 'a seek anchor keeps its tab stop').toBe(false);
    expect(noteLink.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(noteLink);
    expect(seeked, 'and it still goes to the moment').toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('[data-testid="caption-link"]')!);
    expect(seekedInCaption).toHaveBeenCalledTimes(1);

    // in Explore the mark acts again
    rerender(<VizCockpit charts={charts} />);
    fireEvent.click(container.querySelector('[data-testid="mark"]')!);
    expect(acted).toHaveBeenCalledTimes(1);
    // and a later Explore render walks nodes that were never paused, untouched
    rerender(<VizCockpit charts={[...charts]} status="a nudge" />);
    expect(container.querySelector('[data-testid="mark"]')!.getAttribute('tabindex')).toBe('0');
    fireEvent.click(container.querySelector('[data-testid="mark"]')!);
    expect(acted).toHaveBeenCalledTimes(2);
  });

  // REGRESSION (the first fix's own defect): swallowing EVERY keydown inside a
  // chart made Present mode a keyboard trap — Tab and Shift+Tab could not
  // leave the mark, and Escape could not close the slideshow (a React
  // stopPropagation stops the native event, so the window handler never ran).
  it('readOnly never swallows the keys that MOVE the keyboard — only the ones that act', async () => {
    measurable();
    const acted = vi.fn();
    const seeked = vi.fn();
    const charts: CockpitChart[] = [
      {
        id: 'bar',
        render: () => (
          <>
            <svg className="vzf-chart">
              <rect role="button" tabIndex={0} data-testid="mark" onKeyDown={acted} />
            </svg>
            <button type="button" data-vzf-seek="" data-testid="note-link" onKeyDown={seeked}>
              go to #s2
            </button>
          </>
        ),
      },
    ];
    const { container } = render(<VizCockpit readOnly charts={charts} />);
    const mark = container.querySelector('[data-testid="mark"]')!;
    await waitFor(() => expect(mark.getAttribute('tabindex')).toBe('-1'));
    // the activation keys are swallowed…
    for (const key of ['Enter', ' ']) {
      const e = createEvent.keyDown(mark, { key });
      fireEvent(mark, e);
      expect(e.defaultPrevented, `${key} is an act and is stopped`).toBe(true);
    }
    expect(acted).not.toHaveBeenCalled();
    // …and every key that only moves the keyboard around passes untouched
    for (const key of ['Tab', 'Escape', 'ArrowRight', 'ArrowLeft', 'PageDown']) {
      const e = createEvent.keyDown(mark, { key });
      fireEvent(mark, e);
      expect(e.defaultPrevented, `${key} must reach the browser and the shell`).toBe(false);
    }
    // Enter on a SEEK anchor is not an act either — the link must fire
    const link = container.querySelector('[data-testid="note-link"]')!;
    const onLink = createEvent.keyDown(link, { key: 'Enter' });
    fireEvent(link, onLink);
    expect(onLink.defaultPrevented, 'a seek anchor keeps its keyboard activation').toBe(false);
    expect(seeked).toHaveBeenCalledTimes(1);
  });

  it('Escape from a paused chart still leaves the slideshow', async () => {
    measurable();
    const onExit = vi.fn();
    const show = { active: true, title: 'a beat', index: 0, count: 2, onPrev: vi.fn(), onNext: vi.fn(), onExit };
    const charts: CockpitChart[] = [
      { id: 'bar', render: () => <svg className="vzf-chart"><rect role="button" tabIndex={0} data-testid="mark" /></svg> },
    ];
    const { container } = render(<VizCockpit charts={charts} slideshow={show} />);
    const mark = container.querySelector('[data-testid="mark"]')!;
    await waitFor(() => expect(mark.getAttribute('tabindex')).toBe('-1'));
    mark.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExit, 'the show closes from wherever the keyboard is standing').toHaveBeenCalled();
  });

  it('pausing twice keeps the FIRST remembered tabindex (a re-render never overwrites it with -1)', async () => {
    measurable();
    const marked: CockpitChart[] = [
      { id: 'bar', render: () => <svg className="vzf-chart"><rect role="button" tabIndex={0} data-testid="mark" /></svg> },
    ];
    const { container, rerender } = render(<VizCockpit readOnly charts={marked} />);
    await waitFor(() => expect(container.querySelector('[data-testid="mark"]')!.getAttribute('tabindex')).toBe('-1'));
    rerender(<VizCockpit readOnly charts={[...marked]} status="a nudge" />);
    rerender(<VizCockpit charts={[...marked]} status="a nudge" />);
    expect(container.querySelector('[data-testid="mark"]')!.getAttribute('tabindex')).toBe('0');
  });

  it('a custom readOnlyNote replaces the default', () => {
    const { container } = render(<VizCockpit readOnly readOnlyNote="story mode" />);
    expect(container.querySelector('.vzf-readonly-note')?.textContent).toBe('story mode');
  });

  it('applies theme variables + data-theme + className on the scoping root', () => {
    const { container } = render(<VizCockpit theme={{ mode: 'dark', colors: { brand: '#112233' } }} className="branded" />);
    const root = container.querySelector('.vzf-cockpit-root') as HTMLElement;
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.style.getPropertyValue('--vzf-brand')).toBe('#112233');
    expect(root.classList.contains('branded')).toBe(true);
  });
});

describe('VizCockpit — mobile carousel dots', () => {
  it('renders one dot per chart (2+ charts) with the first active', () => {
    const { container } = render(<VizCockpit charts={CHARTS} />);
    const dots = container.querySelectorAll('.vzf-cockpit-dot');
    expect(dots).toHaveLength(2);
    expect(dots[0]!.classList.contains('vzf-active')).toBe(true);
    expect(dots[0]!.getAttribute('aria-current')).toBe('true');
    expect(dots[1]!.classList.contains('vzf-active')).toBe(false);
  });

  it('clicking a dot pages the strip (jsdom has no Element.scrollTo → falls back to scrollLeft) and activates it', () => {
    const { container } = render(<VizCockpit charts={CHARTS} />);
    const strip = container.querySelector('[data-vzf="cockpit-charts"]') as HTMLElement;
    Object.defineProperty(strip, 'clientWidth', { value: 390, configurable: true });
    const dots = container.querySelectorAll('.vzf-cockpit-dot');
    fireEvent.click(dots[1]!);
    expect(strip.scrollLeft).toBe(390);
    expect(container.querySelectorAll('.vzf-cockpit-dot')[1]!.classList.contains('vzf-active')).toBe(true);
  });

  it('paging accounts for the flex gap between cells (one page = width + gap)', () => {
    const { container } = render(<VizCockpit charts={CHARTS} />);
    const strip = container.querySelector('[data-vzf="cockpit-charts"]') as HTMLElement;
    Object.defineProperty(strip, 'clientWidth', { value: 390, configurable: true });
    strip.style.columnGap = '16px'; // jsdom's computed style reflects inline styles
    fireEvent.click(container.querySelectorAll('.vzf-cockpit-dot')[1]!);
    expect(strip.scrollLeft).toBe(406); // 390 + 16, not one gap short
  });

  it('uses smooth scrollTo when the browser provides it', () => {
    const { container } = render(<VizCockpit charts={CHARTS} />);
    const strip = container.querySelector('[data-vzf="cockpit-charts"]') as HTMLElement;
    Object.defineProperty(strip, 'clientWidth', { value: 400, configurable: true });
    const scrollTo = vi.fn();
    (strip as unknown as { scrollTo: unknown }).scrollTo = scrollTo;
    fireEvent.click(container.querySelectorAll('.vzf-cockpit-dot')[1]!);
    expect(scrollTo).toHaveBeenCalledWith({ left: 400, behavior: 'smooth' });
  });

  it('swiping the strip moves the active dot (scroll → nearest snap page, clamped)', () => {
    const { container } = render(<VizCockpit charts={CHARTS} />);
    const strip = container.querySelector('[data-vzf="cockpit-charts"]') as HTMLElement;
    Object.defineProperty(strip, 'clientWidth', { value: 390, configurable: true });
    fireEvent.scroll(strip, { target: { scrollLeft: 385 } }); // ~page 1
    expect(container.querySelectorAll('.vzf-cockpit-dot')[1]!.classList.contains('vzf-active')).toBe(true);
    fireEvent.scroll(strip, { target: { scrollLeft: 2000 } }); // past the end → clamps to the last page
    expect(container.querySelectorAll('.vzf-cockpit-dot')[1]!.classList.contains('vzf-active')).toBe(true);
    fireEvent.scroll(strip, { target: { scrollLeft: 0 } });
    expect(container.querySelectorAll('.vzf-cockpit-dot')[0]!.classList.contains('vzf-active')).toBe(true);
  });

  it('a scroll before layout (clientWidth 0 — jsdom default) is ignored', () => {
    const { container } = render(<VizCockpit charts={CHARTS} />);
    const strip = container.querySelector('[data-vzf="cockpit-charts"]') as HTMLElement;
    fireEvent.scroll(strip, { target: { scrollLeft: 500 } });
    expect(container.querySelectorAll('.vzf-cockpit-dot')[0]!.classList.contains('vzf-active')).toBe(true);
  });
});

describe('SET-1 — the per-chart ✕ clear', () => {
  it('renders only for an ACTIVE chart that gave onClear, names the view, and calls it', () => {
    const onClear = vi.fn();
    const charts: CockpitChart[] = [
      { id: 'bar', render: () => <svg />, active: true, onClear },
      { id: 'idle', render: () => <svg />, active: false, onClear: vi.fn() },
      { id: 'noHandler', render: () => <svg />, active: true },
    ];
    const { container } = render(<VizCockpit charts={charts} />);
    const pills = container.querySelectorAll('[data-vzf="clear-selection"]');
    expect(pills).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clear the bar selection' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
