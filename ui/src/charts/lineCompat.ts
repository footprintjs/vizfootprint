import type { ColumnView } from '../adapter/types.js';
import { defaultCompat, type Compatibility } from '../primitives/compat.js';

/**
 * The line chart's channel/column compatibility: x takes a DATE-capable
 * column (reported type `'date'`, or vouched for via `dateFields`), a CATEGORY
 * column (`'string'`/`'boolean'`) or a NUMBER — the three x kinds this chart
 * draws ({@link xKindOf}), which is exactly what the session's own door admits
 * (`CHART_REQUIREMENTS.line.x`, `src/encoding/requirements.ts`), so the two no
 * longer disagree. The number used to be REFUSED here, and that refusal was
 * honest while it stood: the chart had no numeric-run arm and every x it drew
 * was a date or a band. It has one now, so the veto goes — a picker that greys
 * a column the chart can draw is the same lie in the other direction.
 *
 * y takes only numeric ones — each refusal names its reason (honest
 * affordance). Other channels (color …) fall through to {@link defaultCompat}.
 */
export function lineCompat(dateFields: readonly string[] = []) {
  return (channel: string, column: ColumnView): Compatibility => {
    if (channel === 'x') {
      if (column.type === 'date' || column.type === 'string' || column.type === 'boolean' || column.type === 'number' || dateFields.includes(column.field)) return { ok: true };
      return { ok: false, reason: `the x of a line needs a date, a number or a category column — "${column.field}" is ${column.type}` };
    }
    if (channel === 'y') {
      if (column.type === 'number') return { ok: true };
      return { ok: false, reason: `y needs a numeric column — "${column.field}" is ${column.type}` };
    }
    return defaultCompat(channel, column);
  };
}

