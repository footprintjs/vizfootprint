/**
 * `<EditorDrawer>` — a side panel, not a modal: it sits at the edge of the
 * page over nothing, takes no layout space, and never blocks the dashboard,
 * so a change made in it is seen happening on the charts. Escape closes it.
 * Ships in the `vizfootprint-ui/editor` entry.
 */
import { useEffect, type ReactNode } from 'react';

export interface EditorDrawerProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children?: ReactNode;
  /** Width in CSS pixels. Default 380. */
  readonly width?: number;
  readonly className?: string;
}

export function EditorDrawer({ open, title, onClose, children, width = 380, className }: EditorDrawerProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <aside className={`vzf vzf-drawer${className ? ' ' + className : ''}`} role="complementary" aria-label={title} data-vzf="editor-drawer" style={{ width }}>
      <div className="vzf-drawer-head">
        <span className="vzf-drawer-title">{title}</span>
        <button type="button" className="vzf-drawer-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="vzf-drawer-body">{children}</div>
    </aside>
  );
}
