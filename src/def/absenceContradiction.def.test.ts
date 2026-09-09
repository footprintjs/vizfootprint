/**
 * The def door refuses a table that contradicts its own absence column — once,
 * for inline rows with declared measures, in the data door's sentence.
 */

import { describe, expect, it } from 'vitest';
import { validateDashboardDef } from './index.js';

const ABSENCE = { field: 'report_state', states: ['present', 'unavailable', 'unknown'] };
const COLUMNS = { region: { role: 'dimension' }, week_index: { role: 'dimension' }, cases: { role: 'measure' } };

const defWith = (table: Record<string, unknown>): unknown => ({
  data: { cells: table },
  actors: { v: { actor: 'user' } },
});

const kept = { region: 'north', week_index: 1, report_state: 'present', cases: 7 };
const silent = { region: 'south', week_index: 1, report_state: 'unavailable', cases: null };
const contradicting = { ...silent, cases: 0 };

describe('the def door — a table that says two things at once', () => {
  it('accepts inline rows that keep their word', () => {
    expect(validateDashboardDef(defWith({ rows: [kept, silent], absence: ABSENCE, columns: COLUMNS }))).toEqual([]);
  });

  it('refuses a silent row whose declared MEASURE holds a number, naming the table, the row and the two columns', () => {
    expect(validateDashboardDef(defWith({ rows: [kept, contradicting], absence: ABSENCE, columns: COLUMNS }))).toEqual([
      'data["cells"].rows[1]: report_state says "unavailable" — no value — and cases holds 0; a table cannot say both, so carry null in cases where the row reports nothing',
    ]);
  });

  it('judges only declared measures — a dimension that is a number on a silent row is its address', () => {
    // week_index is 1 on the silent row, and it is a dimension
    expect(validateDashboardDef(defWith({ rows: [kept, silent], absence: ABSENCE, columns: COLUMNS }))).toEqual([]);
  });

  it('holds a table to nothing it did not declare: no absence vocabulary, no measures, no columns at all', () => {
    expect(validateDashboardDef(defWith({ rows: [kept, contradicting], columns: COLUMNS }))).toEqual([]);
    expect(validateDashboardDef(defWith({ rows: [kept, contradicting], absence: ABSENCE, columns: { region: { role: 'dimension' } } }))).toEqual([]);
    expect(validateDashboardDef(defWith({ rows: [kept, contradicting], absence: ABSENCE }))).toEqual([]);
  });

  it('a malformed vocabulary is refused on its own line, and this check stays silent', () => {
    const problems = validateDashboardDef(defWith({ rows: [kept, contradicting], absence: { field: 'report_state' }, columns: COLUMNS }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/absence\.states must be/);
  });

  it('a state the vocabulary declares as one that CARRIES a value is not judged a silence here either', () => {
    const CARRIES = { field: 'report_state', states: ['present', 'estimated', 'unavailable', 'unknown'], carries: ['estimated'] };
    const estimated = { region: 'south', week_index: 1, report_state: 'estimated', cases: 12 };
    expect(validateDashboardDef(defWith({ rows: [kept, estimated], absence: CARRIES, columns: COLUMNS }))).toEqual([]);
    // …and the states it does NOT name are refused in the sentence they always were
    expect(validateDashboardDef(defWith({ rows: [kept, contradicting], absence: CARRIES, columns: COLUMNS }))).toEqual([
      'data["cells"].rows[1]: report_state says "unavailable" — no value — and cases holds 0; a table cannot say both, so carry null in cases where the row reports nothing',
    ]);
  });

  it('DEFAULT NONE: a vocabulary that says nothing about carrying is judged byte for byte as it was before the key existed', () => {
    // the same fixture as the refusal above, with no `carries` key — one problem, the same words
    expect(validateDashboardDef(defWith({ rows: [kept, contradicting], absence: ABSENCE, columns: COLUMNS }))).toEqual([
      'data["cells"].rows[1]: report_state says "unavailable" — no value — and cases holds 0; a table cannot say both, so carry null in cases where the row reports nothing',
    ]);
    const estimated = { region: 'south', week_index: 1, report_state: 'estimated', cases: 12 };
    const noKey = { field: 'report_state', states: ['present', 'estimated', 'unavailable', 'unknown'] };
    expect(validateDashboardDef(defWith({ rows: [kept, estimated], absence: noKey, columns: COLUMNS }))).toEqual([
      'data["cells"].rows[1]: report_state says "estimated" — no value — and cases holds 12; a table cannot say both, so carry null in cases where the row reports nothing',
    ]);
  });

  it('a malformed `carries` is refused on its own line, and the rows are judged as if it were not there', () => {
    const problems = validateDashboardDef(defWith({ rows: [kept, contradicting], absence: { ...ABSENCE, carries: 'estimated' }, columns: COLUMNS }));
    expect(problems).toEqual([
      'data["cells"].absence.carries, if present, must be a non-empty array of non-empty strings (which of the states carry a value)',
      'data["cells"].rows[1]: report_state says "unavailable" — no value — and cases holds 0; a table cannot say both, so carry null in cases where the row reports nothing',
    ]);
  });

  it('a CSV table is not judged here — its rows are read at build', () => {
    const csv = 'region,report_state,cases\nsouth,unavailable,0\n';
    expect(validateDashboardDef(defWith({ csv, absence: ABSENCE, columns: COLUMNS }))).toEqual([]);
  });
});
