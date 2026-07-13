/**
 * `<EncodingPicker>` — the modal an interactive axis label opens. It lists the
 * columns available for a CHANNEL (x / y / color …); a column incompatible with
 * the channel is disabled and shows WHY (honest affordance, not a silent drop).
 * Picking a column fires `onReencode(viewId, channel, field)` — the UI-0 verb.
 *
 * It rides {@link VizModal} (the library's one modal system): frosted-glass
 * backdrop, `role="dialog" aria-modal`, focus trapped and restored, Esc and a
 * backdrop click close it. Initial focus lands on the first actionable COLUMN
 * so keyboard users start on the choices, not the close button. Every data
 * value (column name/type) is a React text node (textContent) — never innerHTML.
 */
import { useMemo } from 'react';
import type { ColumnView } from '../adapter/types.js';
import { VizModal } from '../layout/VizModal.js';
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

export function EncodingPicker(props: EncodingPickerProps): JSX.Element | null {
  const { open, viewId, channel, columns, currentField, onReencode, onClose } = props;
  const compat = props.compatible ?? defaultCompat;
  const titleId = useMemo(() => `vzf-enc-${viewId}-${channel}`, [viewId, channel]);

  return (
    <VizModal
      open={open}
      onClose={onClose}
      size="small"
      name="encoding-picker"
      titleId={titleId}
      initialFocus=".vzf-col-option:not([disabled])"
      title={props.title ?? `Encode the ${channel} channel`}
    >
      <div role="listbox" aria-label={`columns for ${channel}`}>
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
                  /* v8 ignore next -- defense-in-depth: this button's own `disabled={!c.ok}` prop
                     means React's event system (shouldPreventMouseEvent) never dispatches a click
                     to this handler while c.ok is false, so the guard can't observe a true value
                     via any real click; unreachable via the public API */
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
    </VizModal>
  );
}
