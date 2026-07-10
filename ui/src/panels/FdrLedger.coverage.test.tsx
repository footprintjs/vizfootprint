// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { HONESTY_LINE, type LedgerView } from '../adapter/types.js';
import { FdrLedger } from './FdrLedger.js';

afterEach(cleanup);

function baseLedger(overrides: Partial<LedgerView>): LedgerView {
  return {
    procedure: 'LORD++',
    alpha: 0.05,
    tests: 0,
    discoveries: 0,
    wealth: 0,
    steps: [],
    cursorTests: 0,
    honesty: HONESTY_LINE,
    ...overrides,
  };
}

describe('FdrLedger — no tests declared yet', () => {
  it('renders no headline and the "no test declared" placeholder row', () => {
    const { container } = render(<FdrLedger ledger={baseLedger({})} />);
    expect(container.querySelector('.vzf-headline')).toBeNull();
    const row = container.querySelector('tbody tr td.vzf-muted');
    expect(row?.textContent).toMatch(/no test declared yet/);
  });
});

describe('FdrLedger — headline variants', () => {
  it('reads DISCOVERY when the last step rejects', () => {
    const ledger = baseLedger({
      tests: 1,
      discoveries: 1,
      steps: [{ step: 1, hypothesisId: 'h1', pValue: 0.001, alphaThreshold: 0.02, reject: true, wealthAfter: 0.03 }],
    });
    const { container } = render(<FdrLedger ledger={ledger} />);
    expect(container.querySelector('.vzf-headline')?.textContent).toBe('Test #1: p=0.0010 — DISCOVERY (p ≤ threshold 0.02000).');
  });

  it('reads "significant alone, NOT a discovery" when p ≤ alpha but the step did not reject', () => {
    const ledger = baseLedger({
      alpha: 0.05,
      tests: 2,
      steps: [{ step: 2, hypothesisId: 'h2', pValue: 0.03, alphaThreshold: 0.01, reject: false, wealthAfter: 0.02 }],
    });
    const { container } = render(<FdrLedger ledger={ledger} />);
    expect(container.querySelector('.vzf-headline')?.textContent).toBe(
      'Test #2: p=0.0300 — significant alone, NOT a discovery at your current test count (threshold 0.01000).',
    );
  });
});

describe('FdrLedger — singular counts', () => {
  it('reads "1 test" (not "tests") for both cursor-local and global counts of 1', () => {
    const ledger = baseLedger({
      tests: 1,
      cursorTests: 1,
      steps: [{ step: 1, hypothesisId: 'h1', pValue: 0.2, alphaThreshold: 0.01, reject: false, wealthAfter: 0.01 }],
    });
    const { container } = render(<FdrLedger ledger={ledger} />);
    const truths = container.querySelectorAll('.vzf-tt-line');
    expect(truths[0]!.textContent).toContain('1 test visible on this branch');
    expect(truths[1]!.textContent).toContain('1 test across all branches');
  });
});
