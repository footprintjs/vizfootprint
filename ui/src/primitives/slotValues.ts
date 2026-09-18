/**
 * WHAT VALUE DOES A SLOT'S NAME STAND FOR — the ONE owner of that question,
 * and the value-level twin of the slot GEOMETRY next door (`./scales.ts` ·
 * `slotAt` / `slotsCovered` / `pointerTargetWidth`, the one owner of which
 * slot a pixel is in). It lives beside them for the reason they are shared at
 * all: two charts standing on one band may not mean two different things on
 * the same gesture, so neither the pixel question nor the value question may
 * be answered twice.
 *
 * A SLOT IS A NAME FOR A VALUE, AND A CLAUSE CARRIES THE VALUE. A band's
 * labels are DISPLAY TEXT — a band axis is drawn from `String(cell)` all the
 * way down (`vizfootprint/def` · `frameDomains`'s categorical fold names every
 * cell it is given, so a number on a category channel becomes the category
 * `"7"`) — while the ROWS still hold what the column holds. A selection
 * addresses the column it was drawn on, so its values are of that column's
 * own type: a band over a boolean column selects `true`, not `"true"`, and a
 * band over a column of numbers selects `63`, not `"63"`.
 *
 * THE DEFECT THAT BOUGHT IT, measured end to end on a real page. A reader
 * dragged across a line drawn as a band over a column of numbers. The gesture
 * reached the record and LANDED A COMMIT — 4 commits before the drag, 5 after,
 * and the session's refused-requests panel unchanged at 3 — and it matched
 * NOTHING: 185 marks in force before, 0 after, the companion bar chart 372
 * rects to 2. `selectSlots` emitted `matchEmission(field, ["1", "2", …])`, a
 * set of SPELLINGS, against a column holding NUMBERS, and the library is right
 * not to match them (`vizfootprint/data` · `clauseFromWire.test.ts` pins
 * "string bounds never match numeric cells"; the memory engine's `membershipOf`
 * set is SameValueZero, so `"1"` is a member of no list holding `1`). A landed
 * clause that kept nothing is worse than a refusal AND worse than the dead
 * gesture it replaced, because the record now claims the question was
 * answered.
 *
 * THE TWO LAWS, and each is a test:
 *
 *   1. A NAME BAND IS UNTOUCHED. When every row's value IS its own name —
 *      which is every band over a string column, the common case — the answer
 *      is the names themselves, every name asked for, INCLUDING a slot no row
 *      reaches. That is `VizBar` · `endRun`'s own law ("a drag across a slot
 *      this layer has no row for still means these categories"), and it is
 *      kept here rather than repealed: on a name band there is nothing to
 *      guess, because the name is the value.
 *   2. ON A VALUE BAND A NAME WITH NO ROW IS SKIPPED, NEVER GUESSED — the
 *      never-guess law `VizLine` · `runPositionOf` already carries. A band is
 *      an order a FRAME declared and a frame's declared domain is not the rows
 *      (`bandOrder` appends, `frameDomains` folds over a whole table), so a
 *      band can name a category these rows do not hold; inventing a value for
 *      it would be a clause the reader did not make. Every name skipped ⇒
 *      NOTHING, and the caller says so out loud ({@link noSlotValuesNote}).
 *
 * Asked by every chart that lands a clause off a band: `VizLine` · `selectSlots`
 * and `tapSlot`, `VizBar` · `endRun` and `emit`, `VizBoxPlot` · `emit`,
 * `VizHeatmap` · `emitCell` (its y side — its x side already carries raw
 * bucket EDGES), and `VizTable` · `emit` (a row key is a name for a cell too).
 */

/**
 * One row as this owner reads it: the SLOT it is drawn in, and the CELL its
 * column holds there.
 *
 * `cell` is optional because a chart may have nothing else to offer — a dated
 * line point carries only its ISO string, and an ISO string is its own value —
 * and a row with no cell is read as a row whose value IS its name, which is
 * what keeps every such band byte-identical to the chart before this module.
 *
 * GENERIC IN THE CELL so a chart whose clause slot is narrower than `unknown`
 * keeps its own type through the answer rather than casting it back: the
 * heatmap's y side is a `CellSide` scalar, and `slotValues`/`slotPress` hand a
 * `TCell | string` — the cell, or the NAME where the cell could not be a
 * clause value. `unknown` by default, which is every other caller.
 */
export interface SlotRow<TCell = unknown> {
  /** The band label this row sits under (`String(cell)`, as the axis draws it). */
  readonly name: string;
  /** The x cell as the row holds it — borrowed, read and never mutated (the repo-wide rows law). */
  readonly cell?: TCell;
}

/**
 * THE VALUE ONE NAME STANDS FOR — the atom of this module, and the whole law
 * in one line: the CELL, or the NAME where the cell is not a value a clause
 * may carry.
 *
 * `null` and `undefined` are those two, and they are excluded on the CLAUSE
 * tier's own terms rather than out of caution: in the three-way point split a
 * `null` value is a real IS NULL and an `undefined` one CLEARS the selection
 * (`vizfootprint/data` · `pointValueFromWire`), so a mark drawn for an absent
 * cell would otherwise land one of two clauses nobody gestured for. Its name
 * (`"null"`, or whatever the chart drew) keeps today's answer, which is the
 * one thing about an absent cell that is certainly not a lie about a
 * different row.
 *
 * EXPORTED for the marks that are NOT slots on a band and still name a value —
 * a table ROW KEY (`VizTable` · `emit`, whose `String(row[idField])` is the
 * same lie over a numeric id column), a map region, a node id. They hold their
 * own row, so they have no band to fold and no missing slot to skip; what they
 * need is exactly this line, from this owner, rather than a second reading of
 * it beside each gesture.
 */
export function slotValue<TCell>(name: string, cell?: TCell): TCell | string {
  return cell === null || cell === undefined ? name : cell;
}

/** One row's value — {@link slotValue} over the pair a {@link SlotRow} carries. */
function valueOf<TCell>(row: SlotRow<TCell>): TCell | string {
  return slotValue(row.name, row.cell);
}

/**
 * THE VALUES A RUN OF SLOTS NAMES, in the BAND's own order — the one function
 * both gestures ask, so a drag and a press can never read one band two ways.
 *
 * `names` is the slots asked about, already in the band's order (a caller maps
 * `slotsCovered`'s indices through its own band list); `rows` is every row the
 * chart holds, in any order. The answer is DISTINCT per slot and in `names`
 * order: two rows in one slot holding one value name it once.
 *
 * MIXED TYPES IN ONE SLOT ARE ANSWERED WITH BOTH, and the argument is the
 * picture: a column holding `1` and `"1"` draws ONE mark in slot `"1"` — one
 * bar of count 2, one box over both rows, one line point at their mean — so
 * the clause that keeps what the reader pressed is the SET of both. A match is
 * already a set, so the drag needs nothing for it; a PRESS lands one value and
 * cannot say it, which is why {@link slotPress} refuses that slot out loud
 * instead of picking one of the two and dropping the other row.
 */
export function slotValues<TCell>(names: readonly string[], rows: readonly SlotRow<TCell>[]): readonly (TCell | string)[] {
  // A NAME BAND — every row's value is its own name, so there is no value to look up and nothing to
  // skip: the names ARE the answer, a slot with no row included (law 1 in the header).
  if (rows.every((row) => valueOf(row) === row.name)) return names;
  const held = new Map<string, (TCell | string)[]>();
  for (const row of rows) {
    const value = valueOf(row);
    const seen = held.get(row.name);
    if (seen === undefined) held.set(row.name, [value]);
    else if (!seen.includes(value)) seen.push(value);
  }
  // A VALUE BAND — each named slot's own values; a name the rows do not reach contributes nothing (law 2)
  return names.flatMap((name) => held.get(name) ?? []);
}

/**
 * THE ONE VALUE A PRESS LANDS, or the SENTENCE to say instead — {@link
 * slotValues} asked for one slot, so the judgement is literally one function
 * and a press and a drag cannot disagree about what a slot names.
 *
 * Three answers, because a press is a point and a point addresses ONE value:
 * the value, nothing-because-the-rows-name-none, and nothing-because-the-slot
 * -names-several. The last two are notes rather than silence for the reason
 * `noSlotsCoveredNote` is: a gesture that selected nothing is news a sighted
 * reader sees and a screen-reader user would otherwise meet as silence.
 */
export function slotPress<TCell>(name: string, rows: readonly SlotRow<TCell>[]): { readonly value: TCell | string } | { readonly note: string } {
  const values = slotValues([name], rows);
  if (values.length === 1) return { value: values[0]! };
  return { note: values.length === 0 ? noSlotValuesNote() : ambiguousSlotNote(name, values) };
}

/**
 * THE WORDS FOR A GESTURE WHOSE SLOTS NAME NO VALUE THE ROWS HOLD — owned here
 * beside the judgement exactly as `noSlotsCoveredNote` is owned beside
 * `slotsCovered`, and said by the chart through `announce`.
 *
 * ITS OWN SENTENCE, not that one's: a drag that covered no slot and a drag
 * that covered slots the rows say nothing about are two different facts, and a
 * reader told the first one while the second happened would go looking for a
 * gesture they made correctly.
 */
export function noSlotValuesNote(): string {
  return 'a selection carries the values its slots name — the rows hold none for these, so nothing was selected';
}

/**
 * THE WORDS FOR A SLOT A PRESS CANNOT ADDRESS: one label standing for more
 * than one value, which a POINT clause has no room for. It quotes the values
 * because the values are the evidence (`unaddressableIntervalRefusal`'s own
 * discipline) and it names the gesture that CAN take them, so the slot stays
 * reachable.
 */
export function ambiguousSlotNote(name: string, values: readonly unknown[]): string {
  return `the slot "${name}" names ${values.length} different values (${values.map((v) => JSON.stringify(v) ?? String(v)).join(', ')}) — a press selects one, so nothing was selected; drag across the slot to select them all`;
}
