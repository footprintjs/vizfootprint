/**
 * `<ReadinessPanel>` — each declared analysis and whether it can run at the
 * current cursor (D12 guards framing): READY, or BLOCKED with the taxonomy code
 * and any missing columns. When `onAnalyze` is supplied a READY row becomes a
 * button that declares the analysis. Controlled by the adapter's `readiness`.
 */
import type { ReadinessView } from '../adapter/types.js';

export interface ReadinessPanelProps {
  readonly analyses: readonly ReadinessView[];
  /** When present, a ready analysis becomes clickable to declare it. */
  readonly onAnalyze?: (analysisId: string) => void;
  readonly className?: string;
}

export function ReadinessPanel(props: ReadinessPanelProps): JSX.Element {
  const { analyses, onAnalyze } = props;
  return (
    <div className={props.className} data-vzf="readiness-panel">
      <div className="vzf-section-head">Declared analyses — readiness at the cursor</div>
      {analyses.length === 0 ? (
        <div className="vzf-muted" style={{ fontSize: '0.85em' }}>
          no analyses declared
        </div>
      ) : (
        analyses.map((a) => {
          const blockedText = a.ready ? '' : `blocked: ${a.blockedBy ?? ''}${a.missingColumns?.length ? ` (${a.missingColumns.join(', ')})` : ''}`;
          return (
            <div className="vzf-analysis-row" key={a.id} data-analysis={a.id}>
              <span className="vzf-analysis-id">{a.id}</span>
              <span className="vzf-analysis-kind">
                {a.kind}/{a.produces}
              </span>
              {a.ready ? (
                onAnalyze ? (
                  <button className="vzf-btn vzf-btn-primary" style={{ marginLeft: 'auto' }} onClick={() => onAnalyze(a.id)}>
                    run
                  </button>
                ) : (
                  <span className="vzf-ready">ready</span>
                )
              ) : (
                <span className="vzf-blocked" title={blockedText}>
                  {blockedText}
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
