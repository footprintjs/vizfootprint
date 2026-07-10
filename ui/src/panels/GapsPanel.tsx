/**
 * `<GapsPanel>` — every unmet request, typed with its taxonomy code and never
 * dropped (the honesty ledger's negative space). Controlled by the adapter's
 * `gaps`. An empty ledger reads as a positive ("every request has been served"),
 * not a blank.
 */
import type { GapView } from '../adapter/types.js';

export interface GapsPanelProps {
  readonly gaps: readonly GapView[];
  /** Render the built-in heading (default true — pass false inside a titled VizPanel). */
  readonly heading?: boolean;
  readonly className?: string;
}

export function GapsPanel(props: GapsPanelProps): JSX.Element {
  const { gaps } = props;
  return (
    <div className={props.className} data-vzf="gaps-panel">
      {(props.heading ?? true) && <div className="vzf-section-head">Gaps — unmet requests ({gaps.length})</div>}
      {gaps.length === 0 ? (
        <div className="vzf-muted" style={{ fontSize: '0.85em' }}>
          no gaps filed — every request has been served
        </div>
      ) : (
        gaps.map((g, i) => (
          <div className="vzf-gap-row" key={`${g.code}-${i}`} data-gap={g.code}>
            <span className="vzf-gap-code">{g.code}</span>
            <span className="vzf-gap-op">{g.op}</span>
            <span className="vzf-gap-detail">{g.detail}</span>
          </div>
        ))
      )}
    </div>
  );
}
