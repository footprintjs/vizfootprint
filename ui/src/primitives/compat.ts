/**
 * Channel ⇄ column-type compatibility — the honest "disabled-with-reason" logic
 * the EncodingPicker uses. Positional/geometric channels (x, y, size, r) need a
 * numeric or date column; categorical channels (color, shape, category) accept
 * anything. A consumer can override with the picker's `compatible` prop.
 */
import type { ColumnView } from '../adapter/types.js';

export interface Compatibility {
  readonly ok: boolean;
  /** Present only when `ok` is false — a short, plain reason. */
  readonly reason?: string;
}

const NUMERIC_CHANNELS = new Set(['x', 'y', 'size', 'r', 'radius', 'theta']);
const NUMERIC_TYPES = new Set(['number', 'date']);

export function defaultCompat(channel: string, column: ColumnView): Compatibility {
  const ch = channel.toLowerCase();
  if (NUMERIC_CHANNELS.has(ch)) {
    if (NUMERIC_TYPES.has(column.type)) return { ok: true };
    return { ok: false, reason: `${channel} needs a numeric or date column — "${column.field}" is ${column.type}` };
  }
  // color / shape / category / detail — any type encodes
  return { ok: true };
}
