/**
 * `<EncodingPicker>` — the modal an interactive axis label opens. It lists the
 * columns available for a CHANNEL (x / y / color …); a column incompatible with
 * the channel is disabled and shows WHY (honest affordance, not a silent drop).
 * Picking a column fires `onReencode(viewId, channel, field)` — the UI-0 verb.
 *
 * TWO JUDGES, AND EITHER MAY REFUSE (the intersection rule). The HOST's
 * verdicts (`fits`) say what the SESSION would accept; the chart's own
 * `compatible` rule says what THIS CHART can actually draw. They are not the
 * same question, and the session's answer is the wider one: the encoding plane
 * lets a line's x take any continuous column (number or date), while
 * {@link VizLine} positions every point with `Date.parse` — so a numeric
 * column the session admits would be plotted as calendar years, or dropped
 * where it cannot be parsed. The picker therefore offers the INTERSECTION:
 * the host's verdict first (its own sentence when it refuses), then the
 * chart's rule as a VETO over what the host allowed — and a vetoed column
 * says so in words (`data-veto="chart"` + a note under the list), never
 * disappears quietly. Only an EXPLICIT `compatible` prop vetoes; with none,
 * the host's verdicts stand alone exactly as before.
 *
 * It rides {@link VizModal} (the library's one modal system): frosted-glass
 * backdrop, `role="dialog" aria-modal`, focus trapped and restored, Esc and a
 * backdrop click close it. Initial focus lands on the first actionable COLUMN
 * so keyboard users start on the choices, not the close button. Every data
 * value (column name/type) is a React text node (textContent) — never innerHTML.
 */
import { useMemo } from 'react';
import type { ColumnView, FitView } from '../adapter/types.js';
import { VizModal } from '../layout/VizModal.js';
import { defaultCompat, type Compatibility } from '../primitives/compat.js';
import { announce } from '../primitives/announce.js';

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
  /**
   * The encoding plane's verdicts for this view (`views[].fits` on the wire),
   * channel → every column judged. A refusal here is FINAL and carries the
   * session's own sentence: a channel the verdicts do not cover, or a column
   * they do not name, is disabled with a reason rather than guessed at — the
   * session would refuse it anyway. A column they ALLOW still has to pass the
   * chart's own `compatible` rule (the intersection — see the file header);
   * with no verdicts at all (an older server) that rule decides alone.
   */
  readonly fits?: Readonly<Record<string, readonly FitView[]>>;
  readonly onReencode: (viewId: string, channel: string, field: string) => void;
  readonly onClose: () => void;
  readonly title?: string;
}

/** A picker verdict: a {@link Compatibility}, plus WHO refused when the two judges disagree. */
interface Verdict extends Compatibility {
  /** True when the HOST allowed this column and the chart's own rule refused it. */
  readonly vetoedByChart?: boolean;
}

export function EncodingPicker(props: EncodingPickerProps): JSX.Element | null {
  const { open, viewId, channel, columns, currentField, onReencode, onClose } = props;
  const own = props.compatible;
  const verdicts = useMemo(() => (props.fits?.[channel] !== undefined ? new Map(props.fits[channel]!.map((f) => [f.field, f] as const)) : undefined), [props.fits, channel]);
  const compat = (ch: string, col: ColumnView): Verdict => {
    // no verdicts at all (an older server): the chart's own rule alone
    if (props.fits === undefined) return (own ?? defaultCompat)(ch, col);
    if (verdicts === undefined) return { ok: false, reason: `the session did not judge a "${ch}" channel for this view` };
    const v = verdicts.get(col.field);
    if (v === undefined) return { ok: false, reason: `the session does not know a column "${col.field}"` };
    if (!v.ok) return { ok: false, reason: v.because ?? 'does not fit' };
    // the host says yes — the chart still has to be able to DRAW it
    if (own === undefined) return { ok: true };
    const mine = own(ch, col);
    // a chart may refuse without a sentence; the picker still owes the reader one
    return mine.ok ? { ok: true } : { ok: false, reason: mine.reason ?? 'this chart cannot draw it', vetoedByChart: true };
  };
  const titleId = useMemo(() => `vzf-enc-${viewId}-${channel}`, [viewId, channel]);
  // judged once per render, so the note under the list can count the vetoes
  const judged = columns.map((col) => ({ col, verdict: compat(channel, col) }));
  const vetoed = judged.filter((j) => j.verdict.vetoedByChart === true).length;

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
      {vetoed > 0 && (
        // ABOVE the list on purpose: it explains the greying, and a picker with
        // a dozen columns scrolls — a note under the list is under the fold
        // exactly when it fires.
        <p className="vzf-picker-note" data-vzf="chart-veto-note">
          {vetoed === 1 ? 'One column below is greyed by this chart, not by the session' : `${String(vetoed)} columns below are greyed by this chart, not by the session`}: the session would accept{' '}
          {vetoed === 1 ? 'it' : 'them'} on {channel}, but this chart cannot draw {vetoed === 1 ? 'it' : 'them'}.
        </p>
      )}
      <div role="listbox" aria-label={`columns for ${channel}`}>
        {judged.length === 0 ? (
          <div className="vzf-empty">no columns available yet</div>
        ) : (
          judged.map(({ col, verdict: c }) => {
            const isCurrent = col.field === currentField;
            return (
              <button
                type="button"
                key={col.field}
                className={`vzf-col-option${isCurrent ? ' vzf-current' : ''}`}
                disabled={!c.ok}
                aria-current={isCurrent ? 'true' : undefined}
                title={c.ok ? undefined : c.vetoedByChart === true ? `${c.reason} — the session would allow it, this chart cannot draw it` : c.reason}
                data-field={col.field}
                data-veto={c.vetoedByChart === true ? 'chart' : undefined}
                onClick={() => {
                  /* v8 ignore next -- defense-in-depth: this button's own `disabled={!c.ok}` prop
                     means React's event system (shouldPreventMouseEvent) never dispatches a click
                     to this handler while c.ok is false, so the guard can't observe a true value
                     via any real click; unreachable via the public API */
                  if (!c.ok) return;
                  // Nothing focused reports this: the picker closes, the axis
                  // label and the marks move, and a screen-reader user would
                  // hear silence. Said politely, before the modal goes away —
                  // the region outlives it (primitives/announce.ts).
                  announce(`${channel} now encodes ${col.field}`);
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
