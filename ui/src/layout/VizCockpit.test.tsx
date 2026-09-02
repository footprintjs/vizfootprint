// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VizCockpit, type CockpitChart, type CockpitReport } from './VizCockpit.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CHARTS: CockpitChart[] = [
  { id: 'scatter', weight: 3, caption: 'scatter caption', render: (s) => <svg className="vzf-chart" data-size={`${s.width}x${s.height}`} /> },
  { id: 'bar', weight: 2, render: () => <svg className="vzf-chart" /> },
];

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
