/**
 * `<CompareModal>` — two positions side by side. Pick a path (or arrive with
 * refs pre-picked, e.g. the branch map's "Compare with current"), and the
 * adapter's read-only `compare` action answers with the structured diff:
 * the common-ancestor line on top, one column per side (headed by its row
 * count), and every differing state key as a plain-language chip — selections,
 * axes (encodings), analyses. A key that CHANGED between the sides shows on
 * both columns wearing a ≠ mark; a key present on one side only shows there
 * alone. An empty diff is an honest "identical since #ancestor", and a
 * rejected compare surfaces its reason — never a silent empty state.
 */
import { useEffect, useState } from 'react';
import { VizModal } from '../layout/VizModal.js';
import type { CompareEntryView, CompareView, PathsView } from '../adapter/types.js';

export interface CompareModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly paths: PathsView;
  /** Pre-picked refs (path names or commit ids) — e.g. from the branch map menu. */
  readonly initialA?: string;
  readonly initialB?: string;
  /** The adapter's read-only compare action. */
  readonly onCompare: (aRef: string, bRef: string) => Promise<CompareView>;
}

/** The kind → plain group word the chips wear. */
const KIND_WORD: Record<CompareEntryView['kind'], string> = {
  selection: 'selection',
  encoding: 'axes',
  analysis: 'analysis',
};

function Chip(props: { entry: { kind: CompareEntryView['kind']; label: string; detail: string }; changed?: boolean }): JSX.Element {
  const { entry, changed = false } = props;
  return (
    <div className={`vzf-diff-chip vzf-diff-${entry.kind}${changed ? ' vzf-diff-changed' : ''}`}>
      <span className="vzf-diff-kind">{changed ? '≠ ' : ''}{KIND_WORD[entry.kind]}</span>
      <span className="vzf-diff-text">
        {entry.label}: {entry.detail}
      </span>
    </div>
  );
}

export function CompareModal(props: CompareModalProps): JSX.Element | null {
  const { open, onClose, paths, initialA, initialB, onCompare } = props;
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [result, setResult] = useState<CompareView | null>(null);

  // (re)seed the two refs every time the modal opens: A = the caller's pick or
  // the first non-current path; B = the caller's pick or the path you are on.
  useEffect(() => {
    if (!open) return;
    const current = paths.current ?? paths.list.find((p) => p.active)?.name ?? '';
    const other = paths.list.find((p) => !p.active)?.name ?? current;
    setA(initialA ?? other);
    setB(initialB ?? current);
    setResult(null);
    // seed only on open — while open, the selects own a/b
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // run the (read-only) compare whenever both refs are picked
  useEffect(() => {
    if (!open || a === '' || b === '') return;
    let cancelled = false;
    void onCompare(a, b).then((v) => {
      if (!cancelled) setResult(v);
    });
    return () => {
      cancelled = true;
    };
  }, [open, a, b, onCompare]);

  // the pickable refs: every named path, plus any pre-picked commit id that is not a path name
  const names = paths.list.map((p) => p.name);
  const options = [...names];
  for (const extra of [initialA, initialB]) {
    if (extra !== undefined && !options.includes(extra)) options.push(extra);
  }
  const optionLabel = (ref: string): string => (names.includes(ref) ? ref : `step #${ref}`);

  const identical = result?.ok === true && result.changed.length === 0 && result.onlyA.length === 0 && result.onlyB.length === 0;

  return (
    <VizModal open={open} onClose={onClose} size="large" name="compare" title="⇄ Compare two positions">
      <div className="vzf-compare" data-vzf="compare">
        <div className="vzf-compare-pickers">
          <select className="vzf-input" data-vzf="compare-a" aria-label="side A" value={a} onChange={(e) => setA(e.target.value)}>
            {options.map((o) => (
              <option key={o} value={o}>
                {optionLabel(o)}
              </option>
            ))}
          </select>
          <span className="vzf-muted">vs</span>
          <select className="vzf-input" data-vzf="compare-b" aria-label="side B" value={b} onChange={(e) => setB(e.target.value)}>
            {options.map((o) => (
              <option key={o} value={o}>
                {optionLabel(o)}
              </option>
            ))}
          </select>
        </div>

        {result === null ? (
          <div className="vzf-empty">comparing…</div>
        ) : !result.ok ? (
          <div className="vzf-gap-row" role="status">
            <span className="vzf-gap-code">compare</span>
            <span className="vzf-gap-detail">{result.reason}</span>
          </div>
        ) : (
          <>
            <div className="vzf-compare-ancestor" data-vzf="compare-ancestor">
              {result.ancestor !== null ? (
                <>
                  common ancestor <span className="vzf-mono">#{result.ancestor}</span>
                </>
              ) : (
                'these positions share no common start'
              )}
            </div>
            {identical ? (
              <div className="vzf-compare-identical" data-vzf="compare-identical" role="status">
                These two positions are identical{result.ancestor !== null ? <> since <span className="vzf-mono">#{result.ancestor}</span></> : null}.
              </div>
            ) : (
              <div className="vzf-compare-cols">
                {([['a', result.a, result.onlyA] as const, ['b', result.b, result.onlyB] as const]).map(([side, info, only]) => (
                  <div key={side} className="vzf-compare-col" data-side={side}>
                    <div className="vzf-compare-head">
                      <span className="vzf-compare-ref">{optionLabel(info.ref)}</span>
                      {info.ref !== info.tip && <span className="vzf-mono vzf-muted">#{info.tip}</span>}
                      <span className="vzf-compare-rows">{info.rows !== null ? `${info.rows} rows selected` : 'row count unavailable'}</span>
                    </div>
                    {result.changed.map((c) => (
                      <Chip key={c.key} changed entry={{ kind: c.kind, label: c.label, detail: side === 'a' ? c.a : c.b }} />
                    ))}
                    {only.map((o) => (
                      <Chip key={o.key} entry={o} />
                    ))}
                    {result.changed.length === 0 && only.length === 0 && <div className="vzf-empty">nothing unique on this side</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </VizModal>
  );
}
