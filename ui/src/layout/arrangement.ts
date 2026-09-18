/**
 * THE COCKPIT'S ARRANGEMENT — which cell sits in which SLOT, how that
 * arrangement is written down, and the law that keeps a focus change from
 * moving a cell nobody touched.
 *
 * The sheet's own arrangement is one folder over (`../sheet/arrangement.ts`)
 * and this is its twin, deliberately: the same `layout:${scope}` road (LY-1),
 * the same inert commit, the same "the value is for the machine, the intent is
 * for the reader" split. Two things here are the cockpit's alone.
 *
 * ── 1 · THE CODEC, AND THE RULING IT NOW FOLLOWS ───────────────────────────
 * `../sheet/arrangement.ts` already ruled on this grammar — *a column may be
 * called `a,b`; a joined list could not carry it* — and answered it with JSON.
 * The cockpit's `order` predated that ruling and stayed a joined string, so a
 * cell whose id held a comma came back as two cells and an arrangement nobody
 * asked for. A consumer desk that rode this prop had to REFUSE such a name at
 * its own door rather than lay a second codec over the same prop
 * (`vizfootprint-demo` · `web/src/workbench/arrangement.ts` · `paneNameRefusal`),
 * and two codecs for one grammar is the drift this library refuses everywhere.
 *
 * So the cockpit follows the ruling — with ONE constraint the sheet did not
 * have: this prop has already landed on real traces as a joined string, and a
 * recorded act is never rewritten. Hence the rule below, which is one codec
 * with one round-trip test rather than two grammars:
 *
 *   **The joined form is written whenever it reads back byte-for-byte as what
 *   was handed in; otherwise JSON.** Every value that holds no separator lands
 *   exactly what it landed before this file existed (pinned:
 *   `arrangement.test.ts`, "byte identity"), a name that holds one now
 *   round-trips instead of being refused, and the reader takes both — so every
 *   trace this library ever wrote still reads.
 *
 * ── 2 · THE SLOT LAW, WHICH HAS A PROOF BEHIND IT ──────────────────────────
 *   **Every cell has a HOME SLOT and never leaves it. The focus is a LIFT, not
 *   a reshuffle. The focused cell is drawn large in the focus slot, and its
 *   home says so.**
 *
 * The obvious alternative is a TRANSPOSITION — put the focused cell in slot 0
 * by swapping it with whatever is there — and it is *provably* wrong. From a
 * recorded order `[P0, P1, P2]`, focusing `P1` draws `[P1, P0, P2]` and
 * focusing `P2` draws `[P2, P1, P0]`: going from the first to the second is not
 * a swap of `P1` and `P2` at all, it is a THREE-CYCLE, and `P0` — which nobody
 * touched — moves too. The reason is structural: *which cell was focused* is
 * HISTORY, and a pure function of (recorded order, focused cell) cannot know
 * it. The escapes are component state (a visible act that records nothing —
 * the defect `../sheet/arrangement.ts` exists to have removed) or a commit per
 * focus change (which makes the focus an act and gives one question two
 * owners). The algebra is pinned as a test, not only its outcome, so a reader
 * who prefers the simpler model fails a test rather than re-deriving it.
 *
 * WHAT THE COCKPIT DID BEFORE was neither — it was worse. The focus rail was
 * re-derived by SKIPPING the focused cell, so every cell after it shifted one
 * column: measured on the packaged cockpit with five cells, moving the focus
 * from the first to the last moved FIVE of the five, and a focus change moved
 * `|i − j| + 1` cells on average 3.0 of 5. Under this law it is exactly two —
 * one lifts, one settles back into the home it never gave up.
 *
 * **THE PRICE, STATED:** a rail needs one home per cell, including the lifted
 * one, so it has ONE MORE box than there are pictures to draw and the homes
 * beside it are narrower (five cells: five rail columns where there were four,
 * each 20% of the band instead of 25%). That is the cost of a reader's spatial
 * memory of their own dashboard, and it is the trade the worked consumer made
 * first (`vizfootprint-demo` · `web/src/workbench/README.md`).
 *
 * Everything here is a plain function over its arguments — no React, no
 * session, no engine — so a test, a build script and the cockpit share them.
 */

/**
 * The library's `layout:` namespace (LY-1), STATED here rather than imported —
 * the same reason `../sheet/arrangement.ts` states `SHEET_LAYOUT_PREFIX`: a
 * host reading a poll's layouts should not need a VALUE import of
 * `vizfootprint/branches` to land an arrangement. That makes it a COPY, so it
 * is pinned byte-for-byte against `LAYOUT_VIEW_PREFIX` in `arrangement.test.ts`.
 */
export const LAYOUT_SCOPE_PREFIX = 'layout:';

/** The synthetic identity one layout scope's notes land under: `layout:${scope}`. */
export function layoutViewId(scope: string): string {
  return `${LAYOUT_SCOPE_PREFIX}${scope}`;
}

/** The layout SCOPE the cockpit's arrangement lands under: `layout:dashboard`. */
export const COCKPIT_LAYOUT_SCOPE = 'dashboard';

/** The prop the cell order rides, beside `preset` and `focus`. */
export const COCKPIT_ORDER_PROP = 'order';

/**
 * What the joined form of an order joins names with.
 *
 * It is EXPORTED because a host that wants to know whether its own ids are in
 * the byte-identical arm can ask, rather than restating a comma of its own —
 * but no host has to: a name holding it round-trips through JSON now.
 */
export const COCKPIT_ORDER_SEPARATOR = ',';

/** No arrangement, as the commit carries it — the empty string, exactly as before. */
const CLEARED = '';

/** Do two name lists hold the same names in the same places? The whole of the codec's round-trip test. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/**
 * A LIST OF CELL IDS as the JSON arm carries one: at least one name, every
 * name real text. The sheet's `holdsNameList` law, minus the duplicate
 * refusal — the cockpit's reader has always been total about repeats
 * (`orderCharts` places a cell once, at its first mention), and tightening
 * that here would refuse a whole recorded arrangement over one repeated name.
 */
function holdsNameList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every((name) => typeof name === 'string' && name.length > 0);
}

/**
 * THE CELL ORDER BACK OUT OF THE COMMIT — total, and it reads BOTH arms.
 *
 * The JSON arm is tried only for text that opens with `[`, so a plain `a,b`
 * never reaches `JSON.parse`; anything that opens with `[` and is not a name
 * list this version knows (`[`, `[]`, `[1,2]`) falls through to the joined
 * reader, which is what every trace written before this file holds.
 */
export function cellOrderFromLayoutValue(value: string | undefined): readonly string[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  if (value.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = undefined; // WHY: not JSON at all — it is a joined list that happens to start with a bracket
    }
    if (holdsNameList(parsed)) return parsed;
  }
  return value.split(COCKPIT_ORDER_SEPARATOR).map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * THE CELL ORDER AS THE COMMIT CARRIES IT — the joined form when it survives
 * its own round trip, JSON when it does not.
 *
 * The test is the reader itself, so the writer can never invent a value the
 * reader would read as something else: a name holding the separator, a name
 * the joined reader would trim, and a name that would be mistaken for the JSON
 * arm all take the JSON road, and everything else lands the bytes it always
 * landed.
 */
export function cellOrderToLayoutValue(order: readonly string[]): string {
  if (order.length === 0) return CLEARED;
  const joined = order.join(COCKPIT_ORDER_SEPARATOR);
  return sameNames(cellOrderFromLayoutValue(joined), order) ? joined : JSON.stringify(order);
}

/**
 * WHERE EVERY CELL LIVES, and which one is lifted — the whole of the slot law
 * as data.
 *
 * `homes` is a pure function of the RECORDED ORDER alone: the focus is not one
 * of its arguments, which is the fact the law rests on and the reason a focus
 * change can move exactly two things.
 */
export interface CockpitSlots {
  /** How many home slots the rail has: ONE PER CELL, including the lifted one (see "THE PRICE"). */
  readonly columns: number;
  /** Every cell's home slot, 1-based, in the recorded order — the same map whatever is focused. */
  readonly homes: Readonly<Record<string, number>>;
  /** The cell drawn large in the focus slot; `null` when nothing is lifted (its home then draws its own picture). */
  readonly focus: string | null;
  /** The home slot showing a MARKER because its cell is lifted; `null` when nothing is. */
  readonly markerAt: number | null;
}

/**
 * THE SLOTS, FILLED — position decides geometry, and which cell is in a
 * position decides nothing about where the others are.
 *
 * A `focusId` this cockpit has no cell for lifts NOTHING rather than lifting
 * something else: a stale id on the record is left on the record and the
 * dashboard draws every cell in its own home, which is the honest reading of
 * an arrangement that names a cell that has gone.
 */
export function cockpitSlots(ids: readonly string[], focusId: string | null): CockpitSlots {
  const homes: Record<string, number> = {};
  ids.forEach((id, i) => {
    // a repeated id keeps its FIRST home: one cell cannot live in two slots, and
    // `orderCharts` has already placed it once
    if (homes[id] === undefined) homes[id] = i + 1;
  });
  const focus = focusId !== null && homes[focusId] !== undefined ? focusId : null;
  return { columns: ids.length, homes, focus, markerAt: focus === null ? null : homes[focus]! };
}

/**
 * WHAT A HOME SAYS WHILE ITS CELL IS LIFTED INTO THE FOCUS — one sentence, and
 * the only words in this file.
 *
 * It is the statement that this slot is where that cell LIVES, which is the
 * fact a reader needs for the arrangement to read as furniture rather than as
 * a shuffle. The register is the worked consumer's own (`homeSaid`), kept
 * verbatim because one fact should read one way wherever it is read.
 */
export function homeSaid(id: string): string {
  return `${id} is in the focus — this is where it sits when something else is`;
}
