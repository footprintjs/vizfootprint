/**
 * `<EncodingPicker>` — the modal an interactive axis label opens. It lists the
 * columns available for a CHANNEL (x / y / color …); a column incompatible with
 * the channel is disabled and shows WHY (honest affordance, not a silent drop).
 * Picking a column fires `onReencode(viewId, channel, field)` — the UI-0 verb.
 *
 * Accessibility: `role="dialog" aria-modal`, focus is trapped and restored, Esc
 * and a backdrop click close it, and every data value (column name/type) is a
 * React text node (textContent) — never innerHTML.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ColumnView } from '../adapter/types.js';
import { defaultCompat, type Compatibility } from './compat.js';

export interface EncodingPickerProps {
  readonly open: boolean;
  readonly viewId: string;
  /** The visual channel being rebound (e.g. 'x', 'y', 'color'). */
  readonly channel: string;
  readonly columns: readonly ColumnView[];
  /** The field currently bound to the channel (highlighted). */
  readonly currentField?: string;
  /** Override the built-in channel/column compatibility rule. */
  readonly compatible?: (channel: string, column: ColumnView) => Compatibility;
  readonly onReencode: (viewId: string, channel: string, field: string) => void;
  readonly onClose: () => void;
  readonly title?: string;
}

const FOCUSABLE = 'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])';

export function EncodingPicker(props: EncodingPickerProps): JSX.Element | null {
  const { open, viewId, channel, columns, currentField, onReencode, onClose } = props;
  const compat = props.compatible ?? defaultCompat;
  const modalRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<Element | null>(null);
  const titleId = useMemo(() => `vzf-enc-${viewId}-${channel}`, [viewId, channel]);

  // focus management: remember the opener, focus the first option, restore on close
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    // land on the first actionable COLUMN so keyboard users start on the choices,
    // not the close button; fall back to any focusable if there are none
    const target =
      modalRef.current?.querySelector<HTMLElement>('.vzf-col-option:not([disabled])') ??
      modalRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    return () => {
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      className="vzf-modal-backdrop"
      data-vzf-modal="encoding-picker"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="vzf-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={modalRef}
        onKeyDown={onKeyDown}
      >
        <div className="vzf-modal-head">
          <span className="vzf-modal-title" id={titleId}>
            {props.title ?? `Encode the ${channel} channel`}
          </span>
          <button type="button" className="vzf-btn vzf-btn-ghost" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="vzf-modal-body" role="listbox" aria-label={`columns for ${channel}`}>
          {columns.length === 0 ? (
            <div className="vzf-empty">no columns available yet</div>
          ) : (
            columns.map((col) => {
              const c = compat(channel, col);
              const isCurrent = col.field === currentField;
              return (
                <button
                  type="button"
                  key={col.field}
                  className={`vzf-col-option${isCurrent ? ' vzf-current' : ''}`}
                  disabled={!c.ok}
                  aria-current={isCurrent ? 'true' : undefined}
                  title={c.ok ? undefined : c.reason}
                  data-field={col.field}
                  onClick={() => {
                    if (!c.ok) return;
                    onReencode(viewId, channel, col.field);
                    onClose();
                  }}
                >
                  <span className="vzf-col-name">{col.field}</span>
                  {c.ok ? (
                    <span className="vzf-col-type">{col.type}</span>
                  ) : (
                    <span className="vzf-col-reason">{c.reason}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
