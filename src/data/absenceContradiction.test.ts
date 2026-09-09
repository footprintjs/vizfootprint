/**
 * A table that says two things at once, refused where it enters — in a
 * sentence that names the row, the two columns and the fix, and says it once.
 */

import { describe, expect, it } from 'vitest';
import { absenceContradictionOf } from './index.js';

const ABSENCE = { field: 'report_state', states: ['present', 'unavailable', 'unknown'] } as const;

const row = (state: unknown, cases: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ region: 'north', week_index: 3, report_state: state, cases, ...extra });

describe('absenceContradictionOf', () => {
  it('accepts a table whose silent rows are silent in their value columns too — null, undefined, text, a number that is not one', () => {
    const rows = [row('present', 7), row('unavailable', null), row('unknown', undefined), row('unavailable', 'n/a'), row('unavailable', Number.NaN)];
    expect(absenceContradictionOf(rows, ABSENCE, ['cases'], 'data["cells"]')).toBeUndefined();
  });

  it('refuses the first silent row whose value column holds a number, naming the row, the state, the column, the value and the fix', () => {
    const rows = [row('present', 7), row('unavailable', 0)];
    expect(absenceContradictionOf(rows, ABSENCE, ['cases'], 'data["cells"]')).toBe(
      'data["cells"].rows[1]: report_state says "unavailable" — no value — and cases holds 0; a table cannot say both, so carry null in cases where the row reports nothing',
    );
  });

  it('says it ONCE, counting the rest — one more row, and more than one', () => {
    const two = [row('unavailable', 1), row('present', 2), row('unknown', 3)];
    expect(absenceContradictionOf(two, ABSENCE, ['cases'], 'this table')).toMatch(/^this table\.rows\[0\]: report_state says "unavailable" — no value — and cases holds 1; .* \(1 more row does the same\)$/);
    const three = [...two, row('unavailable', 4)];
    expect(absenceContradictionOf(three, ABSENCE, ['cases'], 'this table')).toMatch(/\(2 more rows do the same\)$/);
  });

  it('judges only the value columns it is given — a numeric address on a silent row is not a value', () => {
    const rows = [row('unavailable', null)]; // week_index is 3 on every row
    expect(absenceContradictionOf(rows, ABSENCE, ['cases'], 'this table')).toBeUndefined();
    expect(absenceContradictionOf(rows, ABSENCE, ['cases', 'week_index'], 'this table')).toMatch(/week_index holds 3/);
    // …and never the absence column itself, whatever it is listed as
    expect(absenceContradictionOf([row('unavailable', null, { report_state: 'unavailable' })], ABSENCE, ['report_state'], 'this table')).toBeUndefined();
  });

  it('names the FIRST value column that holds a number, in the order given', () => {
    const rows = [row('unavailable', null, { ytd: 9 })];
    expect(absenceContradictionOf(rows, ABSENCE, ['cases', 'ytd'], 'this table')).toMatch(/ytd holds 9/);
    expect(absenceContradictionOf([row('unavailable', 2, { ytd: 9 })], ABSENCE, ['ytd', 'cases'], 'this table')).toMatch(/ytd holds 9/);
  });

  it('judges every state that is not `present` — the WALKER’S law, so a word the vocabulary never declared is a silence too', () => {
    // A case slip, a new collector word, an empty cell: the walker blanks each of these rows, so a
    // number on one of them would go quietly unseen — which is the whole reason this check exists.
    expect(absenceContradictionOf([row('withheld', 5)], ABSENCE, ['cases'], 'this table')).toMatch(/report_state says "withheld" — no value — and cases holds 5/);
    expect(absenceContradictionOf([row('Unavailable', 5)], ABSENCE, ['cases'], 'this table')).toMatch(/report_state says "Unavailable"/);
    expect(absenceContradictionOf([row('', 5)], ABSENCE, ['cases'], 'this table')).toMatch(/report_state says ""/);
  });

  it('says what a state that is not a word held, rather than passing the row over unquoted', () => {
    expect(absenceContradictionOf([row(undefined, 5)], ABSENCE, ['cases'], 'this table')).toMatch(/report_state says nothing — no value — and cases holds 5/);
    expect(absenceContradictionOf([row(7, 5)], ABSENCE, ['cases'], 'this table')).toMatch(/report_state says 7 —/);
    expect(absenceContradictionOf([row(null, 5)], ABSENCE, ['cases'], 'this table')).toMatch(/report_state says null —/);
  });

  it('passes over what is not THIS defect: a row that is not an object, and a row that keeps its word', () => {
    const rows = [null, 'not a row', row('present', 5)];
    expect(absenceContradictionOf(rows, ABSENCE, ['cases'], 'this table')).toBeUndefined();
  });

  it('a state the declaration says CARRIES a value is not a silence — an estimated figure is a figure', () => {
    // the same rows, the same value column, the same door: only the declaration differs
    const rows = [row('present', 7), row('estimated', 12), row('replaced', 400)];
    const declared = { field: 'report_state', states: ['present', 'estimated', 'replaced', 'unavailable', 'unknown'], carries: ['estimated', 'replaced'] };
    expect(absenceContradictionOf(rows, declared, ['cases'], 'data["cells"]')).toBeUndefined();
    // …and without the key, those two words are silences like any other: the default is NONE
    const silent = { field: 'report_state', states: ['present', 'estimated', 'replaced', 'unavailable', 'unknown'] };
    expect(absenceContradictionOf(rows, silent, ['cases'], 'data["cells"]')).toBe(
      'data["cells"].rows[1]: report_state says "estimated" — no value — and cases holds 12; a table cannot say both, so carry null in cases where the row reports nothing (1 more row does the same)',
    );
  });

  it('a state the declaration does NOT name still refuses in the sentence it always did, `carries` or no `carries`', () => {
    const declared = { field: 'report_state', states: ['present', 'estimated', 'unavailable', 'unknown'], carries: ['estimated'] };
    const sentence = 'data["cells"].rows[0]: report_state says "unavailable" — no value — and cases holds 0; a table cannot say both, so carry null in cases where the row reports nothing';
    expect(absenceContradictionOf([row('unavailable', 0)], declared, ['cases'], 'data["cells"]')).toBe(sentence);
    // a state that is not a word at all is judged the same way — `carries` names words, and this row has none
    expect(absenceContradictionOf([row(7, 5)], declared, ['cases'], 'this table')).toMatch(/report_state says 7 —/);
  });

  it('a table with no rows, or no value columns, contradicts nothing', () => {
    expect(absenceContradictionOf([], ABSENCE, ['cases'], 'this table')).toBeUndefined();
    expect(absenceContradictionOf([row('unavailable', 5)], ABSENCE, [], 'this table')).toBeUndefined();
  });
});
