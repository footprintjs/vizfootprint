// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { mapPollState, type RawPollState } from '../adapter/sessionView.js';
import { CommitLog } from './CommitLog.js';
import { FdrLedger } from './FdrLedger.js';
import { GapsPanel } from './GapsPanel.js';
import { ReadinessPanel } from './ReadinessPanel.js';
import { formatCommitValue } from './format.js';

afterEach(cleanup);

const RAW: RawPollState = {
  records: [
    { id: '1', parent: null, viewId: 'scatter', kind: 'interval', field: 'price', value: [10, 90], cause: { requestedBy: 'user', intent: 'brush price' } },
    { id: '2', parent: '1', viewId: 'bar', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'agent', intent: 'pick formal' } },
    { id: '3', parent: '1', viewId: 'scatter', kind: 'interval', field: 'price', value: [40, 60], cause: { requestedBy: 'user' } },
  ],
  fdr: {
    procedure: 'LORD++',
    alpha: 0.05,
    tests: 2,
    discoveries: 1,
    wealth: 0.0312,
    ledger: [
      { step: 1, hypothesisId: 'corr-price-rating', pValue: 0.004, alphaThreshold: 0.02, reject: true, wealthAfter: 0.03 },
      { step: 2, hypothesisId: 'grp-cat', pValue: 0.2, alphaThreshold: 0.01, reject: false, wealthAfter: 0.02 },
    ],
  },
  analyses: [
    { id: 'correlation', kind: 'test', produces: 'evidence', ready: true },
    { id: 'clustering', kind: 'transform', produces: 'columns', ready: false, blockedBy: 'needs-column', missingColumns: ['cluster_id'] },
  ],
  gaps: [{ code: 'needs-column', op: 'analyze', detail: 'cluster_id not present on this branch', target: 'cluster_id' }],
  cursor: '1',
  head: '3',
  cursorTests: 0,
};
const S = mapPollState(RAW);

describe('formatCommitValue', () => {
  it('renders intervals, points, and cleared brushes safely', () => {
    expect(formatCommitValue({ kind: 'interval', value: [10, 90] })).toBe('10 – 90');
    expect(formatCommitValue({ kind: 'interval', value: null })).toBe('(cleared)');
    expect(formatCommitValue({ kind: 'point', value: 'Formal' })).toBe('Formal');
    expect(formatCommitValue({ kind: 'point', value: 3.14159 })).toBe('3.14');
  });

  it('FILTER-1: renders a half-open numeric interval as "at least"/"up to", never a fabricated opposite bound', () => {
    expect(formatCommitValue({ kind: 'interval', value: [150, null] })).toBe('at least 150');
    expect(formatCommitValue({ kind: 'interval', value: [null, 150] })).toBe('up to 150');
  });

  it('FILTER-1: renders an ISO-8601 date interval verbatim (no numeric rounding on a string bound)', () => {
    expect(formatCommitValue({ kind: 'interval', value: ['2026-05-01', '2026-05-31'] })).toBe('2026-05-01 – 2026-05-31');
    expect(formatCommitValue({ kind: 'interval', value: [null, '2026-05-31'] })).toBe('up to 2026-05-31');
    expect(formatCommitValue({ kind: 'interval', value: ['2026-05-01', null] })).toBe('at least 2026-05-01');
  });
});

describe('CommitLog', () => {
  it('renders a chip per commit, badges the actor, dims off-branch, seeks on click', () => {
    const onSeek = vi.fn();
    const { container } = render(<CommitLog commits={S.commits} onSeek={onSeek} />);
    const chips = container.querySelectorAll('.vzf-chip');
    expect(chips).toHaveLength(3);
    // commit 2 is the abandoned sibling (head=3) → off-branch dim
    expect(container.querySelector('[data-commit="2"]')?.classList.contains('vzf-offbranch')).toBe(true);
    expect(container.querySelector('[data-commit="1"]')?.classList.contains('vzf-offbranch')).toBe(false);
    // cursor ring on commit 1
    expect(container.querySelector('[data-commit="1"]')?.classList.contains('vzf-cursor')).toBe(true);
    // actor badge text
    expect(container.querySelector('[data-commit="2"] .vzf-badge')?.textContent).toBe('agent');
    fireEvent.click(container.querySelector('[data-commit="3"]')!);
    expect(onSeek).toHaveBeenCalledWith('3');
  });

  it('D29: a cell chip tells the compound in plain words WITHOUT the redundant joint-label prefix', () => {
    const cell = {
      id: '9',
      parent: '3',
      viewId: 'heatmap',
      kind: 'cell' as const,
      field: 'price × category',
      fields: ['price', 'category'] as const,
      value: [[100, 150], 'Formal'],
      actor: 'user' as const,
      label: 'price × category',
      onBranch: true,
      isCursor: false,
      isHead: true,
    };
    const { container } = render(<CommitLog commits={[cell]} />);
    const body = container.querySelector('.vzf-chip-body')!;
    expect(body.textContent).toBe('price 100 – 150 and category = Formal');
    expect(body.textContent).not.toContain('=  '); // no "price × category = …" double-telling
  });
});

describe('FdrLedger', () => {
  it('shows the two truths, the verbatim honesty line, and tints discovery rows', () => {
    const { container } = render(<FdrLedger ledger={S.ledger} />);
    const truths = container.querySelectorAll('.vzf-tt-line');
    expect(truths[0]!.textContent).toContain('0 tests visible on this branch'); // cursor-local
    expect(truths[1]!.textContent).toContain('2 tests across all branches'); // global
    expect(container.querySelector('.vzf-tt-honest')?.textContent).toBe('alpha spent on abandoned branches is never refunded');
    expect(container.querySelectorAll('tr.vzf-discovery')).toHaveLength(1);
    // the headline reflects the LAST test (not significant)
    expect(container.querySelector('.vzf-headline')?.textContent).toContain('not significant');
  });
});

describe('GapsPanel', () => {
  it('lists typed gaps and reads positively when empty', () => {
    const { container, rerender } = render(<GapsPanel gaps={S.gaps} />);
    expect(container.querySelector('.vzf-gap-code')?.textContent).toBe('needs-column');
    expect(container.textContent).toContain('unmet requests (1)');
    rerender(<GapsPanel gaps={[]} />);
    expect(container.textContent).toContain('every request has been served');
  });
});

describe('ReadinessPanel', () => {
  it('shows ready vs blocked with the code + missing columns', () => {
    const { container } = render(<ReadinessPanel analyses={S.readiness} />);
    expect(container.querySelector('[data-analysis="correlation"] .vzf-ready')?.textContent).toBe('ready');
    const blocked = container.querySelector('[data-analysis="clustering"] .vzf-blocked');
    expect(blocked?.textContent).toContain('needs-column');
    expect(blocked?.textContent).toContain('cluster_id');
  });

  it('a ready analysis becomes a run button when onAnalyze is given', () => {
    const onAnalyze = vi.fn();
    render(<ReadinessPanel analyses={S.readiness} onAnalyze={onAnalyze} />);
    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    expect(onAnalyze).toHaveBeenCalledWith('correlation');
  });
});
