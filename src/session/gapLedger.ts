/**
 * GapLedger — the R14 "honest by construction" ledger. Every request the
 * surface cannot honor is filed here with a D14 taxonomy code, NEVER silently
 * dropped. Directly ports hcifootprint's gap-ledger discipline (MEMORY D17/D18).
 *
 * The two-string discipline (Q8) holds here: `detail` is INERT data, echoed
 * verbatim, never parsed or dispatched on.
 */

import type { GapCode, GapOp, GapRow } from './types.js';

export class GapLedger {
  private readonly _rows: GapRow[] = [];
  private clock = 0;

  /** File one gap. Returns the frozen row that was appended. */
  file(code: GapCode, op: GapOp, detail: string, target?: string): GapRow {
    const row: GapRow = {
      code,
      op,
      detail,
      ...(target !== undefined ? { target } : {}),
      ts: this.clock++,
    };
    Object.freeze(row);
    this._rows.push(row);
    return row;
  }

  /** All filed gaps, in arrival order. */
  rows(): readonly GapRow[] {
    return this._rows;
  }

  /** Counts by taxonomy code. */
  byCode(): Record<GapCode, number> {
    const hist = {
      'needs-column': 0,
      'needs-analysis-kind': 0,
      'needs-view': 0,
      'guard-failed': 0,
      'needs-backend-data': 0,
    } as Record<GapCode, number>;
    for (const r of this._rows) hist[r.code] += 1;
    return hist;
  }

  get size(): number {
    return this._rows.length;
  }
}
