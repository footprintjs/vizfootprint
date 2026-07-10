/**
 * `<VizCard>` / `<VizPanel>` — the surface primitives. A card is a titled
 * container; a panel is a card whose header can COLLAPSE its body (controllable
 * or self-managed). Wide content inside should be wrapped in `vzf-scroll-x` so
 * it scrolls within its own box, never the page.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';

export interface VizCardProps {
  readonly title?: ReactNode;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
}

export function VizCard(props: VizCardProps): JSX.Element {
  return (
    <div className={`vzf-card${props.className ? ' ' + props.className : ''}`}>
      {(props.title || props.actions) && (
        <div className="vzf-panel-head" style={{ cursor: 'default', marginBottom: 'var(--vzf-space-3)' }}>
          {props.title && <span className="vzf-section-head" style={{ margin: 0 }}>{props.title}</span>}
          {props.actions}
        </div>
      )}
      {props.children}
    </div>
  );
}

export interface VizPanelProps {
  readonly title?: ReactNode;
  readonly collapsible?: boolean;
  readonly defaultCollapsed?: boolean;
  /** Controlled collapsed state (pass with `onToggle`). */
  readonly collapsed?: boolean;
  readonly onToggle?: (collapsed: boolean) => void;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
}

export function VizPanel(props: VizPanelProps): JSX.Element {
  const collapsible = props.collapsible ?? true;
  const [internal, setInternal] = useState(props.defaultCollapsed ?? false);
  const collapsed = props.collapsed ?? internal;

  const toggle = (): void => {
    if (!collapsible) return;
    const next = !collapsed;
    if (props.collapsed === undefined) setInternal(next);
    props.onToggle?.(next);
  };

  return (
    <div className={`vzf-card vzf-panel${collapsed ? ' vzf-collapsed' : ''}${props.className ? ' ' + props.className : ''}`}>
      <div
        className="vzf-panel-head"
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? !collapsed : undefined}
        onClick={toggle}
        onKeyDown={(e) => {
          if (collapsible && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            toggle();
          }
        }}
        style={{ cursor: collapsible ? 'pointer' : 'default' }}
      >
        <span className="vzf-section-head" style={{ margin: 0 }}>
          {props.title}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--vzf-space-2)' }}>
          {props.actions}
          {collapsible && <span className="vzf-panel-toggle" aria-hidden="true">▾</span>}
        </span>
      </div>
      <div className="vzf-panel-body">{props.children}</div>
    </div>
  );
}
