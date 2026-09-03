/**
 * WHICH FIELD A CHANNEL ENCODES — the ONE answer, resolved once per chart.
 *
 * Every re-encodable chart is told the same fact twice. Once through its own
 * per-channel field prop (`field` / `xField` / `dateField` / `valueField` …),
 * and once through `encoding`, the session's live channel→field map at the
 * cursor. The two agree right up until somebody RE-ENCODES a channel: the
 * session's map moves, and a host that still hands over the field it wrote at
 * mount leaves the chart holding two different answers to one question.
 *
 * The charts used to pick a different answer depending on which part of them
 * you asked. The built-in {@link EncodingPicker} read `encoding` — so it
 * highlighted the NEW field. The axis label, the accessible name, the mark
 * tooltips and the field the chart EMITS on a gesture read the prop — so they
 * all kept the OLD one. The visible result is a chart whose axis never moves
 * when its binding does, while its own picker says otherwise.
 *
 * `boundField` is the single resolution every chart now runs, once per
 * channel, before it draws anything: the session's binding when it named one,
 * the chart's own field prop otherwise. Two rules follow from that:
 *
 *   - the resolved name is the ONLY one the chart may use afterwards — label,
 *     accessible name, tooltip and emitted field alike, so the chart cannot
 *     name one field and select by another;
 *   - a host that passes no `encoding` at all resolves to its field prop, so
 *     CONTRACT mode (where the host maps `RenderState.encodings` onto the
 *     field props itself — see `../contract/renderers.tsx`) is untouched.
 *
 * An explicit `label` / `xLabel` / `yLabel` still wins over both: those are
 * words the caller chose, not a binding the session owns.
 */
import type { ViewEncoding } from '../adapter/types.js';

/** The field `channel` encodes: the session's binding, else the chart's own field prop. */
export function boundField(encoding: ViewEncoding, channel: string, fallback: string): string {
  return encoding[channel] ?? fallback;
}
