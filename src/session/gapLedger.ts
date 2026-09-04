/**
 * GapLedger — the R14 "honest by construction" ledger. Every request the
 * surface cannot honor is filed here with a D14 taxonomy code, NEVER silently
 * dropped. Directly ports hcifootprint's gap-ledger discipline (MEMORY D17/D18).
 *
 * The two-string discipline (Q8) holds here: `detail` is INERT data, echoed
 * verbatim, never parsed or dispatched on.
 */

import { GAP_CODES } from './types.js';
import type { GapCode, GapOp, GapRow } from './types.js';

/**
 * What a thrown thing SAYS, for a gap's inert `detail`. Third-party code may
 * throw anything at all (an adapter that throws a string, a provider that
 * rejects with an object), and a gap must still read as a sentence.
 *
 * It lives beside the ledger rather than beside its callers because every one
 * of them is filing an `effect-failed` gap — the OUTBOUND half of the
 * all-or-nothing law (`README.md`, rule 3), where the act has already landed
 * and the only thing left to get right is the sentence.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

  /**
   * All filed gaps, in arrival order.
   *
   * DETACHED by COPYING: `_rows` is a list this ledger still appends to, so a
   * reader never gets the array itself (it used to, and could have pushed a
   * gap nobody filed, or spliced one away). Each row is already frozen at the
   * moment it is filed — a gap, like a commit, is finished when it lands — so
   * only the list is copied. Cold path: a copy per call is the right trade.
   */
  rows(): readonly GapRow[] {
    return Object.freeze([...this._rows]);
  }

  /**
   * Counts by taxonomy code — every code, zero included, so a reader can
   * compare two ledgers without checking for absent keys.
   *
   * The zeroes are SEEDED FROM `GAP_CODES`, not hand-listed. They were
   * hand-listed once and the list fell behind the type: `stale-offer` existed
   * as a code with no seed, so the first stale-offer gap counted as
   * `undefined + 1` — `NaN`, in a histogram, silently. Reading the codes from
   * the one place they are declared makes that drift unrepresentable.
   */
  byCode(): Record<GapCode, number> {
    const hist = Object.fromEntries(GAP_CODES.map((code) => [code, 0])) as Record<GapCode, number>;
    for (const r of this._rows) hist[r.code] += 1;
    return hist;
  }

  get size(): number {
    return this._rows.length;
  }
}
