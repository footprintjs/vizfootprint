/**
 * A table that says two things at once, refused where it enters — in a
 * sentence that names the row, the two columns and the fix, and says it once.
 */

import { describe, expect, it } from 'vitest';
import { absenceContradictionOf, silenceOfDecl } from './index.js';
import type { AbsenceDecl } from '../def/types.js';

// The check takes a READING (`./silence.ts`), because silence belongs to a column; every assertion
// below is the one it always made, with the declaration adapted at the door instead of inside.
const ABSENCE = silenceOfDecl({ field: 'report_state', states: ['present', 'unavailable', 'unknown'] });

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
    const declared = silenceOfDecl({ field: 'report_state', states: ['present', 'estimated', 'replaced', 'unavailable', 'unknown'], carries: ['estimated', 'replaced'] });
    expect(absenceContradictionOf(rows, declared, ['cases'], 'data["cells"]')).toBeUndefined();
    // …and without the key, those two words are silences like any other: the default is NONE
    const silent = silenceOfDecl({ field: 'report_state', states: ['present', 'estimated', 'replaced', 'unavailable', 'unknown'] });
    expect(absenceContradictionOf(rows, silent, ['cases'], 'data["cells"]')).toBe(
      'data["cells"].rows[1]: report_state says "estimated" — no value — and cases holds 12; a table cannot say both, so carry null in cases where the row reports nothing (1 more row does the same)',
    );
  });

  it('a state the declaration does NOT name still refuses in the sentence it always did, `carries` or no `carries`', () => {
    const declared = silenceOfDecl({ field: 'report_state', states: ['present', 'estimated', 'unavailable', 'unknown'], carries: ['estimated'] });
    const sentence = 'data["cells"].rows[0]: report_state says "unavailable" — no value — and cases holds 0; a table cannot say both, so carry null in cases where the row reports nothing';
    expect(absenceContradictionOf([row('unavailable', 0)], declared, ['cases'], 'data["cells"]')).toBe(sentence);
    // a state that is not a word at all is judged the same way — `carries` names words, and this row has none
    expect(absenceContradictionOf([row(7, 5)], declared, ['cases'], 'this table')).toMatch(/report_state says 7 —/);
  });

  it('a table with no rows, or no value columns, contradicts nothing', () => {
    expect(absenceContradictionOf([], ABSENCE, ['cases'], 'this table')).toBeUndefined();
    expect(absenceContradictionOf([row('unavailable', 5)], ABSENCE, [], 'this table')).toBeUndefined();
  });

  it('passes over a value column NOTHING governs — a reading that names no owner for it holds it to nothing', () => {
    const governed = silenceOfDecl({ field: 'report_state', states: ['present', 'unavailable', 'unknown'], governs: ['cases'] });
    expect(absenceContradictionOf([row('unavailable', null, { ytd: 9 })], governed, ['ytd'], 'this table')).toBeUndefined();
    expect(absenceContradictionOf([row('unavailable', 9)], governed, ['cases'], 'this table')).toMatch(/cases holds 9/);
  });
});

/**
 * THE DEMO'S OWN TABLE — three value columns, three state columns, three
 * entries. This is the shape the per-TABLE check refused: it read one state
 * column as speaking for the whole row, so an honest row (a mass measured, a
 * radius never taken) said two things at once and the table was turned away at
 * the door. These are the proof that it is not any more.
 */
describe('absenceContradictionOf — silence belongs to a column', () => {
  const MEASUREMENTS: readonly AbsenceDecl[] = [
    { field: 'radius_state', states: ['present', 'upper-bound', 'not-measured', 'unknown'], carries: ['upper-bound'], governs: ['pl_rade'] },
    { field: 'mass_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_masse'] },
    { field: 'period_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_orbper'] },
  ];
  const SILENCE = silenceOfDecl(MEASUREMENTS);
  const VALUES = ['pl_rade', 'pl_masse', 'pl_orbper'];

  /** One planet: a radius, a mass, a period, and the three words for how each was got. */
  const planet = (radius: [unknown, unknown], mass: [unknown, unknown], period: [unknown, unknown]): Record<string, unknown> => ({
    pl_name: 'Kepler-22 b',
    radius_state: radius[0],
    pl_rade: radius[1],
    mass_state: mass[0],
    pl_masse: mass[1],
    period_state: period[0],
    pl_orbper: period[1],
  });

  it('ACCEPTS the row the per-table check refused: no radius, a mass, and a period of 88', () => {
    const rows = [planet(['not-measured', null], ['present', 6.4], ['present', 88])];
    expect(absenceContradictionOf(rows, SILENCE, VALUES, 'data["measurements"]')).toBeUndefined();
  });

  it('still FIRES when a column is silent and holds a number — and names the state column it broke', () => {
    const rows = [planet(['not-measured', 2.4], ['present', 6.4], ['present', 88])];
    expect(absenceContradictionOf(rows, SILENCE, VALUES, 'data["measurements"]')).toBe(
      'data["measurements"].rows[0]: radius_state says "not-measured" — no value — and pl_rade holds 2.4; a table cannot say both, so carry null in pl_rade where the row reports nothing',
    );
    // …and the sentence names the OTHER state column when that is the one that broke
    const mass = [planet(['present', 2.4], ['not-measured', 6.4], ['present', 88])];
    expect(absenceContradictionOf(mass, SILENCE, VALUES, 'data["measurements"]')).toMatch(/mass_state says "not-measured" — no value — and pl_masse holds 6.4/);
  });

  it('honours each entry’s OWN carries: an upper-bound radius is a figure, a not-measured mass is not', () => {
    const rows = [planet(['upper-bound', 2.4], ['not-measured', null], ['present', 88])];
    expect(absenceContradictionOf(rows, SILENCE, VALUES, 'data["measurements"]')).toBeUndefined();
    // the same word on the mass column is not declared there, so it is a silence like any other
    const mass = [planet(['present', 2.4], ['upper-bound', 6.4], ['present', 88])];
    expect(absenceContradictionOf(mass, SILENCE, VALUES, 'data["measurements"]')).toMatch(/mass_state says "upper-bound" — no value — and pl_masse holds 6.4/);
  });

  it('counts ROWS and not cells — a row that breaks two of its three columns says the same thing once', () => {
    const rows = [
      planet(['not-measured', 2.4], ['not-measured', 6.4], ['present', 88]),
      planet(['not-measured', 1.1], ['present', 6.4], ['present', 88]),
    ];
    expect(absenceContradictionOf(rows, SILENCE, VALUES, 'this table')).toMatch(/radius_state says "not-measured" — no value — and pl_rade holds 2.4; .* \(1 more row does the same\)$/);
  });

  it('never judges a state column, even when a caller lists one as a value', () => {
    const rows = [planet(['not-measured', null], ['present', 6.4], ['present', 88])];
    expect(absenceContradictionOf(rows, SILENCE, ['radius_state', 'mass_state', 'period_state'], 'this table')).toBeUndefined();
  });
});
