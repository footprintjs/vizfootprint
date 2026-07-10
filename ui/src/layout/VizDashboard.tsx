/**
 * `<VizDashboard>` — the responsive shell. A CSS-grid with four named slots
 * (top / main / side / bottom): the chart area is `main`, panels go in `side`
 * and `bottom`, the time-travel bar typically in `top` or `bottom`. It provides
 * the SCROLLING the owner asked for — the dashboard scrolls on HEIGHT (its own
 * `overflow-y`, never the page), and wide content scrolls WITHIN its own box
 * (wrap it in `vzf-scroll-x`), so the page body never scrolls sideways.
 *
 * The `.vzf` scoping class + the theme variables live on this root element, so
 * two dashboards can wear different themes on one page and nothing leaks out.
 * `readOnly` (present mode) dims and disables the acting slots (main/side) while
 * leaving navigation (top/bottom) live, and shows a note.
 */
import type { CSSProperties, ReactNode } from 'react';
import { themeStyle, themeAttr, type ThemeConfig } from '../tokens/theme.js';

export interface VizDashboardProps {
  readonly top?: ReactNode;
  /** The chart area (also accepts `children` as an alias). */
  readonly main?: ReactNode;
  readonly children?: ReactNode;
  readonly side?: ReactNode;
  readonly bottom?: ReactNode;
  /** Present mode: dim + block the acting slots, show the note. */
  readonly readOnly?: boolean;
  readonly readOnlyNote?: ReactNode;
  readonly theme?: ThemeConfig;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function VizDashboard(props: VizDashboardProps): JSX.Element {
  const { theme, readOnly = false } = props;
  const style: CSSProperties = { ...(themeStyle(theme) as CSSProperties), ...props.style };
  return (
    <div className={`vzf vzf-root${props.className ? ' ' + props.className : ''}`} style={style} data-theme={themeAttr(theme)}>
      <div className={`vzf-dashboard${readOnly ? ' vzf-readonly' : ''}`} data-vzf="dashboard" data-readonly={readOnly ? 'true' : 'false'}>
        {readOnly && (
          <div className="vzf-readonly-note" role="status">
            {props.readOnlyNote ?? '👁 Present mode — acting is paused; navigate the story beats. Switch to Explore to act.'}
          </div>
        )}
        {props.top !== undefined && <div className="vzf-slot-top">{props.top}</div>}
        <div className="vzf-slot-main">{props.main ?? props.children}</div>
        {props.side !== undefined && <div className="vzf-slot-side">{props.side}</div>}
        {props.bottom !== undefined && <div className="vzf-slot-bottom">{props.bottom}</div>}
      </div>
    </div>
  );
}
