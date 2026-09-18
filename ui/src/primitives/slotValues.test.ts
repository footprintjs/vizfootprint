/**
 * THE ONE OWNER OF WHAT A SLOT'S NAME STANDS FOR — `slotValue`/`slotValues`/
 * `slotPress`, pinned on the two laws in its header and on the case that
 * bought it.
 *
 * The defect, measured end to end: a drag across a line drawn as a band over a
 * column of NUMBERS landed a commit (4 → 5) and matched nothing (185 marks in
 * force → 0), because the clause carried the slots' SPELLINGS against a column
 * holding numbers. A landed clause that kept nothing is worse than a refusal,
 * so the value is taken from the ROWS here and every band chart asks this one
 * function for it.
 */
import { describe, it, expect } from 'vitest';
import { slotValue, slotValues, slotPress, noSlotValuesNote, ambiguousSlotNote, type SlotRow } from './slotValues.js';

describe('slotValue — the atom: the cell, or the name where the cell can be no clause value', () => {
  it('answers the CELL when the row has one', () => {
    expect(slotValue('63', 63)).toBe(63);
    expect(slotValue('true', true)).toBe(true);
  });

  it('answers the NAME for a cell that is absent, null or undefined — a null point clause is IS NULL and an undefined one CLEARS, and a band drew neither', () => {
    expect(slotValue('null', null)).toBe('null');
    expect(slotValue('undefined', undefined)).toBe('undefined');
    expect(slotValue('Formal')).toBe('Formal');
  });

  it('is byte-identical for a string cell — the name IS the value', () => {
    expect(slotValue('Formal', 'Formal')).toBe('Formal');
  });
});

describe('slotValues — a band over a STRING column is byte-identical (law 1: a name band)', () => {
  const rows: readonly SlotRow[] = [
    { name: 'Formal', cell: 'Formal' },
    { name: 'Casual', cell: 'Casual' },
  ];

  it('answers the names verbatim', () => {
    expect(slotValues(['Formal', 'Casual'], rows)).toEqual(['Formal', 'Casual']);
  });

  it('keeps a slot NO ROW reaches — `VizBar` · `endRun`\'s own law: a drag across an empty slot still means that category, and on a name band there is nothing to guess', () => {
    expect(slotValues(['Formal', 'Smart', 'Casual'], rows)).toEqual(['Formal', 'Smart', 'Casual']);
  });

  it('reads a chart that offers no cell at all as a name band (a dated line point carries only its ISO string)', () => {
    expect(slotValues(['2024-01-01', '2024-01-02'], [{ name: '2024-01-01' }, { name: '2024-01-02' }])).toEqual(['2024-01-01', '2024-01-02']);
  });

  it('answers the names when there are no rows at all — no rows, no evidence of a value band', () => {
    expect(slotValues(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});

describe('slotValues — a band over a column of VALUES carries the values (the defect)', () => {
  const numbers: readonly SlotRow[] = [
    { name: '1', cell: 1 },
    { name: '2', cell: 2 },
    { name: '3', cell: 3 },
  ];

  it('answers the ROWS\' own numbers, not their spelling — the clause a column of numbers can answer', () => {
    expect(slotValues(['1', '2'], numbers)).toEqual([1, 2]);
  });

  it('answers a boolean column with booleans — the first-party shape that needs no declaration to disagree with its cells', () => {
    expect(slotValues(['true', 'false'], [{ name: 'true', cell: true }, { name: 'false', cell: false }])).toEqual([true, false]);
  });

  it('SKIPS a name no row reaches, never guesses one (law 2) — a frame\'s declared domain is not the rows', () => {
    expect(slotValues(['2', '7', '3'], numbers)).toEqual([2, 3]);
  });

  it('answers NOTHING when every name is skipped — the caller says so out loud rather than emitting an empty keep-list', () => {
    expect(slotValues(['7', '8'], numbers)).toEqual([]);
  });

  it('names one value ONCE however many rows hold it', () => {
    expect(slotValues(['1'], [{ name: '1', cell: 1 }, { name: '1', cell: 1 }])).toEqual([1]);
  });

  it('answers in the BAND\'s order, never the rows\' — a right-to-left drag and a left-to-right one over the same slots are one selection', () => {
    expect(slotValues(['1', '2', '3'], [{ name: '3', cell: 3 }, { name: '1', cell: 1 }, { name: '2', cell: 2 }])).toEqual([1, 2, 3]);
  });

  it('lets a row with an ABSENT cell stand for its own name on a value band — the row exists and its name is all that is known about it', () => {
    expect(slotValues(['1', 'n/a'], [{ name: '1', cell: 1 }, { name: 'n/a', cell: null }])).toEqual([1, 'n/a']);
  });
});

describe('slotValues — MIXED types in one slot are answered with BOTH', () => {
  // one column holding 1 and "1": both rows are drawn in the slot "1" — one bar of count 2, one box
  // over both — so the clause that keeps what the reader pressed is the SET of both
  const mixed: readonly SlotRow[] = [
    { name: '1', cell: 1 },
    { name: '1', cell: '1' },
    { name: '2', cell: 2 },
  ];

  it('carries every value the slot\'s rows hold, in first-seen row order', () => {
    expect(slotValues(['1'], mixed)).toEqual([1, '1']);
  });

  it('flattens a run of slots into one set, band order kept', () => {
    expect(slotValues(['1', '2'], mixed)).toEqual([1, '1', 2]);
  });
});

describe('slotPress — a press is a point, and a point addresses ONE value', () => {
  const numbers: readonly SlotRow[] = [{ name: '1', cell: 1 }, { name: '2', cell: 2 }];

  it('answers the slot\'s value', () => {
    expect(slotPress('2', numbers)).toEqual({ value: 2 });
  });

  it('answers the NAME on a name band — byte-identical to the clause every band of strings landed before this module', () => {
    expect(slotPress('Formal', [{ name: 'Formal', cell: 'Formal' }])).toEqual({ value: 'Formal' });
  });

  it('refuses a slot the rows name no value for, in the owner\'s own words', () => {
    expect(slotPress('7', numbers)).toEqual({ note: noSlotValuesNote() });
  });

  it('refuses a slot naming SEVERAL values, naming them and the gesture that CAN take them', () => {
    const both: readonly SlotRow[] = [{ name: '1', cell: 1 }, { name: '1', cell: '1' }];
    const press = slotPress('1', both);
    expect(press).toEqual({ note: ambiguousSlotNote('1', [1, '1']) });
    expect('note' in press && press.note).toContain('drag across the slot');
  });
});

describe('the sentences — one owner, quoting the evidence', () => {
  it('the nothing-named sentence says what a selection carries and that nothing was selected', () => {
    expect(noSlotValuesNote()).toBe('a selection carries the values its slots name — the rows hold none for these, so nothing was selected');
  });

  it('the ambiguous-slot sentence names the slot, counts the values and quotes them', () => {
    expect(ambiguousSlotNote('1', [1, '1'])).toBe('the slot "1" names 2 different values (1, "1") — a press selects one, so nothing was selected; drag across the slot to select them all');
  });

  it('quotes a value JSON cannot spell without throwing away its own words', () => {
    expect(ambiguousSlotNote('x', [undefined, 1])).toBe('the slot "x" names 2 different values (undefined, 1) — a press selects one, so nothing was selected; drag across the slot to select them all');
  });
});
