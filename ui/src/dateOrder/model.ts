/**
 * Date-order presentation. The fold is authoritative even without a positive
 * witness; only a line's original row cells can supply the own-extent fallback.
 * No engine reads, parser, counter, cache or selection policy lives in this module.
 */
import { dateOrderConflictOf, type DateOrderConflict, type ResolvedChannel } from 'vizfootprint/def';
import type { RenderLayer } from '../contract/types.js';
import { lineCellIsNumber } from '../primitives/lineCell.js';

export interface DateOrderReading {
  readonly scope: string;
  readonly witness?: DateOrderConflict;
}
export function foldedDateOrder(frame: Readonly<Record<string, ResolvedChannel>> | undefined, channel: string): DateOrderReading | undefined {
  const entry = frame?.[channel];
  return entry?.mode === 'shared' && entry.scale === 'temporal'
    ? { scope: `frame's inspected ${entry.basis}`, ...(entry.dateOrder === undefined ? {} : { witness: entry.dateOrder }) }
    : undefined;
}
export function lineDateOrder(frame: Readonly<Record<string, ResolvedChannel>> | undefined, cells: readonly unknown[], layer?: string): DateOrderReading {
  return foldedDateOrder(frame, 'x') ?? { scope: layer === undefined ? 'drawn rows' : `drawn rows of layer ${layer}`, witness: dateOrderConflictOf(cells) };
}
/** One sentence owner, used verbatim by the visible note and accessible name. */
export function dateOrderWords(reading: DateOrderReading | undefined | false, channel = 'x'): string {
  if (!reading || reading.witness === undefined) return '';
  const { compared, conflicted } = reading.witness;
  return `${channel}: ${conflicted} of ${compared} inspected date strings in the ${reading.scope} have text order that differs from time order. A selected date range is matched by text, so it may keep or leave out points near its ends.`;
}
/** Shared facts once per bound axis; independent line fallbacks name their layer. */
export function frameDateOrderWords(layers: readonly { readonly kind: string; readonly layer: RenderLayer }[], frame: Readonly<Record<string, ResolvedChannel>> | undefined): readonly string[] {
  const words: string[] = [];
  for (const channel of ['x', 'y']) {
    if (!layers.some(({ layer }) => layer.encodings[channel] !== undefined)) continue;
    const note = dateOrderWords(foldedDateOrder(frame, channel), channel);
    if (note) words.push(note);
  }
  const x = frame?.['x'];
  if (foldedDateOrder(frame, 'x') === undefined && !(x?.mode === 'shared' && x.scale !== undefined)) {
    for (const { kind, layer } of layers) {
      if (kind !== 'line' || layer.encodings['x'] === undefined) continue;
      // The same raw-cell discriminator that produces numeric line points: a mixed
      // bag with one number is drawn numerically, so its date-shaped subset is not a date axis.
      if (layer.rows.some(row => lineCellIsNumber(row[layer.encodings['x']!]))) continue;
      const note = dateOrderWords(lineDateOrder(frame, layer.rows.map(row => row[layer.encodings['x']!]), layer.layerId));
      if (note) words.push(note);
    }
  }
  return words;
}
export interface DateOrderLayout {
  readonly notes: readonly (readonly string[])[];
  readonly height: number;
}
/**
 * A separate annotation band, ABOVE plot/legend and zero notes. A conservative
 * monospaced character cell and explicit line coordinates make room without a
 * DOM measurement or timer. An undersized plot refuses in words rather than
 * hiding a warning. No words = zero room and byte-identical old furniture.
 */
export function dateOrderLayout(words: readonly string[], width: number): DateOrderLayout {
  if (words.length === 0) return { notes: [], height: 0 };
  const columns = Math.max(1, Math.floor(width / 7));
  const notes = words.map(word => {
    const lines: string[] = [];
    for (let start = 0; start < word.length; start += columns) lines.push(word.slice(start, start + columns));
    return lines;
  });
  return { notes, height: notes.reduce((sum, lines) => sum + lines.length * 12, 0) + 24 };
}
