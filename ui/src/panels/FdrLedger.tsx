/**
 * `<FdrLedger>` — the online-FDR (LORD++) ledger with the TWO TRUTHS: the
 * cursor-LOCAL count ("tests visible on this branch") vs the GLOBAL, monotone,
 * never-refunded count across all branches — and the verbatim honesty line
 * ("alpha spent on abandoned branches is never refunded"). Below sits the raw
 * per-test table (a discovery row is tinted) and a plain-language headline for
 * the most recent test. Controlled by the adapter's `ledger` view.
 */
import type { LedgerView } from '../adapter/types.js';

export interface FdrLedgerProps {
  readonly ledger: LedgerView;
  readonly className?: string;
}

function headlineFor(ledger: LedgerView): string | null {
  const last = ledger.steps[ledger.steps.length - 1];
  if (!last) return null;
  const p = last.pValue.toFixed(4);
  const thr = last.alphaThreshold.toFixed(5);
  if (last.reject) return `Test #${last.step}: p=${p} — DISCOVERY (p ≤ threshold ${thr}).`;
  if (last.pValue <= ledger.alpha) return `Test #${last.step}: p=${p} — significant alone, NOT a discovery at your current test count (threshold ${thr}).`;
  return `Test #${last.step}: p=${p} — not significant (threshold ${thr}).`;
}

export function FdrLedger(props: FdrLedgerProps): JSX.Element {
  const { ledger } = props;
  const n = ledger.cursorTests;
  const m = ledger.tests;
  const headline = headlineFor(ledger);
  return (
    <div className={props.className} data-vzf="fdr-ledger">
      <div className="vzf-two-truths">
        <div className="vzf-tt-line">
          <span className="vzf-tt-k">at cursor</span>
          <span>
            {n} test{n === 1 ? '' : 's'} visible on this branch
          </span>
        </div>
        <div className="vzf-tt-line">
          <span className="vzf-tt-k">global</span>
          <span>
            W(t)={ledger.wealth.toFixed(4)} wealth · {m} test{m === 1 ? '' : 's'} across all branches
          </span>
        </div>
        <div className="vzf-tt-honest">{ledger.honesty}</div>
      </div>

      <div className="vzf-ledger-head">
        {ledger.procedure} · α={ledger.alpha} · tests={m} · W(t)={ledger.wealth.toFixed(4)} · discoveries={ledger.discoveries}
      </div>

      <div className="vzf-scroll-x">
        <table className="vzf-ledger">
          <thead>
            <tr>
              <th>#</th>
              <th>hypothesis</th>
              <th>p-value</th>
              <th>threshold αt</th>
              <th>discovery?</th>
            </tr>
          </thead>
          <tbody>
            {ledger.steps.length === 0 ? (
              <tr>
                <td colSpan={5} className="vzf-muted">
                  no test declared yet — brushing never adds a ledger row; only a declared analysis does
                </td>
              </tr>
            ) : (
              ledger.steps.map((s) => (
                <tr key={s.step} className={s.reject ? 'vzf-discovery' : ''}>
                  <td>{s.step}</td>
                  <td>{s.hypothesisId}</td>
                  <td>{s.pValue.toFixed(4)}</td>
                  <td>{s.alphaThreshold.toFixed(5)}</td>
                  <td className={s.reject ? 'vzf-verdict-yes' : 'vzf-verdict-no'}>{s.reject ? 'DISCOVERY' : 'no'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {headline && <div className="vzf-headline">{headline}</div>}
    </div>
  );
}
