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
export interface DateOrderNote {
  readonly full: string;
  readonly short: string;
}
export function foldedDateOrder(frame: Readonly<Record<string, ResolvedChannel>> | undefined, channel: string, bindingLayers = 1): DateOrderReading | undefined {
  const entry = frame?.[channel];
  return entry?.mode === 'shared' && entry.scale === 'temporal'
    ? { scope: bindingLayers > 1 ? `${entry.basis}-basis reads across ${bindingLayers} binding layers` : `frame's inspected ${entry.basis}`, ...(entry.dateOrder === undefined ? {} : { witness: entry.dateOrder }) }
    : undefined;
}
export function lineDateOrder(frame: Readonly<Record<string, ResolvedChannel>> | undefined, cells: readonly unknown[], layer?: string): DateOrderReading {
  return foldedDateOrder(frame, 'x') ?? { scope: layer === undefined ? 'drawn rows' : `drawn rows of layer ${layer}`, witness: dateOrderConflictOf(cells) };
}
/** One fact owner; a selection consequence belongs only to a date-interval emitter. */
export function dateOrderNote(reading: DateOrderReading | undefined | false, channel = 'x', selectable = channel === 'x'): DateOrderNote | undefined {
  if (!reading || reading.witness === undefined) return undefined;
  const { compared, conflicted } = reading.witness;
  const fact = `${channel}: ${conflicted} of ${compared} inspected date strings in the ${reading.scope} have text order that differs from time order.`;
  return {
    full: fact + (selectable ? ' A selected date range is matched by text, so it may keep or leave out any of these dates.' : ''),
    short: `${channel}: ${conflicted}/${compared} text ≠ time order`,
  };
}
/** Shared facts once per bound axis; independent line fallbacks name their layer. */
export function frameDateOrderNotes(layers: readonly { readonly kind: string; readonly layer: RenderLayer }[], frame: Readonly<Record<string, ResolvedChannel>> | undefined): readonly DateOrderNote[] {
  const notes: DateOrderNote[] = [];
  for (const channel of ['x', 'y']) {
    const bound = layers.filter(({ layer }) => layer.encodings[channel] !== undefined);
    if (bound.length === 0) continue;
    const note = dateOrderNote(foldedDateOrder(frame, channel, bound.length), channel, channel === 'x' && bound.some(({ kind }) => kind === 'line'));
    if (note) notes.push(note);
  }
  const x = frame?.['x'];
  if (foldedDateOrder(frame, 'x') === undefined && !(x?.mode === 'shared' && x.scale !== undefined)) {
    for (const { kind, layer } of layers) {
      if (kind !== 'line' || layer.encodings['x'] === undefined) continue;
      // The same raw-cell discriminator that produces numeric line points: a mixed
      // bag with one number is drawn numerically, so its date-shaped subset is not a date axis.
      if (layer.rows.some(row => lineCellIsNumber(row[layer.encodings['x']!]))) continue;
      const note = dateOrderNote(lineDateOrder(frame, layer.rows.map(row => row[layer.encodings['x']!]), layer.layerId));
      if (note) notes.push(note);
    }
  }
  return notes;
}
export interface DateOrderLayout {
  readonly notes: readonly (readonly string[])[];
  readonly height: number;
}
/**
 * A separate annotation band, ABOVE plot/legend and zero notes. A conservative
 * monospaced character cell and explicit line coordinates make room without a
 * DOM measurement or timer. Use compact words before refusing an undersized
 * plot; the full explanation remains accessible. No words means zero room.
 */
export function dateOrderLayout(words: readonly (string | DateOrderNote)[], width: number, maxHeight = Infinity): DateOrderLayout {
  const nonempty = words.map(word => typeof word === 'string' ? { full: word, short: word } : word).filter(word => word.full.length > 0);
  if (nonempty.length === 0) return { notes: [], height: 0 };
  const columns = Math.max(1, Math.floor(width / 7));
  const full = layout(nonempty.map(word => word.full), columns);
  return full.height <= maxHeight ? full : layout(nonempty.map(word => word.short), columns);
}
function layout(words: readonly string[], columns: number): DateOrderLayout {
  const notes = words.map(word => {
    const lines: string[] = [];
    let line = '';
    let used = 0;
    // for-of keeps surrogate pairs whole. Non-ASCII scalars get a wider
    // allowance; no glyph is dropped and original text is never rewritten.
    for (const cell of word) {
      const slots = cell.charCodeAt(0) > 0x7f ? 2 : 1;
      if (line.length > 0 && used + slots > columns) {
        lines.push(line);
        line = '';
        used = 0;
      }
      line += cell;
      used += slots;
    }
    lines.push(line);
    return lines;
  });
  return { notes, height: notes.reduce((sum, lines) => sum + lines.length * 12, 0) + 24 };
}
