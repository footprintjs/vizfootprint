/**
 * The RE-ENCODE affordance seam — the axis-label → picker two-mode dispatch
 * every re-encodable chart (scatter, line, bar, histogram) shares:
 *
 *   - CONTRACT mode (`onReencodeRequest` present): an axis-label click asks
 *     the HOST to re-encode the channel — the host owns the picker and the
 *     `reencode` verb (RP-1's `reencodeRequest` callback); the chart's
 *     built-in picker never opens.
 *   - convenience mode (no `onReencodeRequest`): the chart's built-in
 *     `<EncodingPicker>` opens on the channel; `pickerChannel` drives it and
 *     `closePicker` puts it away.
 *
 * Pair it with `<AxisLabel onOpen={openPicker}>` — the label is an honest
 * affordance because this seam makes it actionable in BOTH modes.
 */
import { useState } from 'react';

export interface ReencodePicker {
  /** The channel the built-in picker is open on, or null while closed. */
  readonly pickerChannel: string | null;
  /** Wire to `<AxisLabel onOpen>` — dispatches to the host or opens the picker. */
  openPicker(channel: string): void;
  /** Wire to the built-in picker's `onClose`. */
  closePicker(): void;
}

export function useReencodePicker(onReencodeRequest?: (channel: string) => void): ReencodePicker {
  const [pickerChannel, setPickerChannel] = useState<string | null>(null);
  const openPicker = (channel: string): void => {
    if (onReencodeRequest) onReencodeRequest(channel); // contract mode — the host owns the picker
    else setPickerChannel(channel);
  };
  return { pickerChannel, openPicker, closePicker: () => setPickerChannel(null) };
}
