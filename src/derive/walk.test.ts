/**
 * THE ABSENCE LAW, ENFORCED — and the kinds a row is held to.
 *
 * The law has two halves and the second is the one that was missing everywhere
 * else: a cell is absent when it is `null`, OR when the table's DECLARED
 * absence column says the row is not `present`. The demo's own rows are the
 * reason — `report_state: 'unavailable'` beside `cases: 0`, where the zero is a
 * reported nothing and `cases / population` must be absent, not `0`.
 *
 * The other half of this file is what the walker checks that the judge could
 * not: a declaration describes, but a row is what it is, and a column declared
 * `number` that holds text on one row makes THAT ROW absent — on every STRICT
 * position — rather than an answer nobody can defend. The four ops that see
 * absence get their arms unevaluated and hand back what they find; walk.ts's
 * header names that limit, and a pin below keeps the sentence true.
 */

import { describe, expect, it } from 'vitest';
import { evaluate, evaluateRow, PRESENT, readerFor, type Expr } from './index.js';
import { ABSENCE_STATES } from '../def/types.js';
import { silenceOfDecl, silenceOfNothing } from '../data/silence.js';
import type { Row } from '../data/types.js';

// The walker takes a READING (`../data/silence.ts`), because silence belongs to a column; every
// assertion below is the one the bare declaration always earned, adapted at the door.
const REPORTED = silenceOfDecl({ field: 'report_state', states: ['present', 'unavailable', 'unknown'] });

const col = (name: string): Expr => ({ col: name });
const lit = (value: number | string | boolean | null): Expr => ({ lit: value });
const RATE: Expr = { op: 'div', args: [col('cases'), col('population')] };

describe('the absence law', () => {
  const present: Row = { report_state: 'present', cases: 12, population: 1000 };
  const unavailable: Row = { report_state: 'unavailable', cases: 0, population: 1000 };

  it('answers on a row the source really reported', () => {
    expect(evaluateRow(RATE, present, REPORTED)).toBe(0.012);
  });

  it('is absent — not zero — on a row the source could not report', () => {
    expect(evaluateRow(RATE, unavailable, REPORTED)).toBeNull();
    // And this is the bug it exists to stop: without the declaration, the reported nothing reads as a measured zero.
    expect(evaluateRow(RATE, unavailable)).toBe(0);
  });

  it('lets the absence column speak for itself, so the state stays askable', () => {
    expect(evaluateRow({ op: 'eq', args: [col('report_state'), lit('unavailable')] }, unavailable, REPORTED)).toBe(true);
    expect(evaluateRow({ op: 'isAbsent', args: [col('cases')] }, unavailable, REPORTED)).toBe(true);
    expect(evaluateRow({ op: 'isAbsent', args: [col('cases')] }, present, REPORTED)).toBe(false);
  });

  it('treats every state that is not `present` as not present — a missing one included', () => {
    expect(evaluateRow(RATE, { cases: 12, population: 1000 }, REPORTED)).toBeNull();
    expect(evaluateRow(RATE, { report_state: 'unknown', cases: 12, population: 1000 }, REPORTED)).toBeNull();
  });

  it('keeps the one word the def owns', () => {
    // A drift pin, not a duplicate: the vocabulary is the def's (`AbsenceDecl.states`), and this is
    // the DEFAULT for the single word out of it the arithmetic has an opinion about.
    expect(ABSENCE_STATES[0]).toBe(PRESENT);
  });

  it('reads the DEFINITION\'S word for "reported" — a `final` row is a number, an `estimated` one is silent under present-only and read under carried', () => {
    // The vocabulary is the definition's, both anchors included: the walker never compares to
    // `PRESENT`, it reads the port's word — so a source whose word is `final` is not rewritten.
    const own = { field: 'demand_state', present: 'final', unknown: 'unclear', states: ['final', 'estimated', 'unclear'], carries: ['estimated'] } as const;
    const presentOnly = silenceOfDecl(own);
    expect(evaluateRow(col('demand'), { demand_state: 'final', demand: 24_000 }, presentOnly)).toBe(24_000);
    expect(evaluateRow(col('demand'), { demand_state: 'estimated', demand: 24_000 }, presentOnly)).toBeNull();
    expect(evaluateRow(col('demand'), { demand_state: 'unclear', demand: 24_000 }, presentOnly)).toBeNull();
    // the library's own word, undeclared in this vocabulary, is a silence like any other undeclared word
    expect(evaluateRow(col('demand'), { demand_state: 'present', demand: 24_000 }, presentOnly)).toBeNull();
    const carried = silenceOfDecl({ ...own, arithmetic: 'carried' });
    expect(evaluateRow(col('demand'), { demand_state: 'estimated', demand: 24_000 }, carried)).toBe(24_000);
    expect(evaluateRow(col('demand'), { demand_state: 'unclear', demand: 24_000 }, carried)).toBeNull();
  });

  it('reads every column when the table declared no absence at all', () => {
    const read = readerFor({ cases: 12 });
    expect(read('cases')).toBe(12);
    expect(read('missing')).toBeUndefined();
  });
});

describe('a row is what it is, whatever the declaration said', () => {
  it('is absent where the value is not the kind the position wanted', () => {
    expect(evaluateRow({ op: 'add', args: [col('cases'), lit(1)] }, { cases: 'twelve' })).toBeNull();
    expect(evaluateRow({ op: 'lower', args: [col('region')] }, { region: 12 })).toBeNull();
    expect(evaluateRow({ op: 'not', args: [col('flag')] }, { flag: 'yes' })).toBeNull();
    expect(evaluateRow({ op: 'year', args: [col('when')] }, { when: '2026/01/04' })).toBeNull();
    expect(evaluateRow({ op: 'lt', args: [col('a'), col('b')] }, { a: true, b: false })).toBeNull();
  });

  it('is absent where two values of ONE type turn out not to be', () => {
    expect(evaluateRow({ op: 'eq', args: [col('a'), col('b')] }, { a: 1, b: 'one' })).toBeNull();
    expect(evaluateRow({ op: 'eq', args: [col('a'), col('b')] }, { a: 1, b: 2 })).toBe(false);
  });

  it('is absent where a value is not a value at all', () => {
    expect(evaluateRow(col('missing'), {})).toBeNull();
    expect(evaluateRow(col('when'), { when: new Date(Number.NaN) })).toBeNull();
    expect(evaluateRow(col('when'), { when: { iso: '2026-01-04' } })).toBeNull();
    expect(evaluateRow(col('cases'), { cases: Number.POSITIVE_INFINITY })).toBeNull();
    expect(evaluateRow(col('cases'), { cases: Number.NaN })).toBeNull();
    expect(evaluateRow(col('flag'), { flag: true })).toBe(true);
  });

  it('reads a `Date` — the one shape the engine calls a date column — as the ISO day, so the date ops can read it', () => {
    // The engine calls a column `date` only when it holds `Date` objects, and the judge accepts such a
    // column into every date op; a walker that blanked it would answer silence for a column the source reported.
    const when = new Date('2026-01-04T23:59:59Z');
    expect(evaluateRow(col('when'), { when: new Date(0) })).toBe('1970-01-01');
    expect(evaluateRow(col('when'), { when })).toBe('2026-01-04');
    expect(evaluateRow({ op: 'year', args: [col('when')] }, { when })).toBe(2026);
    expect(evaluateRow({ op: 'lt', args: [col('when'), lit('2026-06-01')] }, { when })).toBe(true);
    expect(evaluateRow({ op: 'isAbsent', args: [col('when')] }, { when })).toBe(false);
  });

  it('holds only the STRICT positions to their kind — a lazy op hands back what its arm found', () => {
    // The limit walk.ts's header names, pinned so the sentence stays true: an arm wanting `same` agrees
    // with the OTHER arms, which a lazy op must not run, so nothing on the row can hold it to a kind.
    expect(evaluateRow({ op: 'add', args: [col('cases'), lit(0)] }, { cases: 'n/a' })).toBeNull();
    expect(evaluateRow({ op: 'coalesce', args: [col('cases'), lit(0)] }, { cases: 'n/a' })).toBe('n/a');
    expect(evaluateRow({ op: 'if', args: [lit(true), col('cases'), lit(0)] }, { cases: 'n/a' })).toBe('n/a');
  });

  it('spreads one absence through everything above it', () => {
    expect(evaluateRow({ op: 'add', args: [{ op: 'mul', args: [col('cases'), lit(2)] }, lit(1)] }, { cases: null })).toBeNull();
  });
});

describe('one walker, reached only through a reader', () => {
  it('walks columns as readily as rows — which is why the reader is a parameter', () => {
    const columns: Record<string, readonly unknown[]> = { cases: [12, 0, null], population: [1000, 0, 1000] };
    let at = 0;
    const read = (name: string): unknown => columns[name]?.[at];
    const values: unknown[] = [];
    for (at = 0; at < 3; at += 1) values.push(evaluate(RATE, read));
    expect(values).toEqual([0.012, null, null]);
  });

  it('answers a literal without reading anything', () => {
    expect(evaluate(lit('North'), () => undefined)).toBe('North');
  });
});

/**
 * SILENCE BELONGS TO A COLUMN — the exoplanet demo's own shape.
 *
 * A `measurements` row carries a radius, a mass and a period, each with its own
 * silence. Before this the walker read ONE state column as speaking for the
 * whole row, so a row whose radius was never taken lost its mass and its period
 * too. These pin that it does not, and that `arithmetic` is per column.
 */
describe('the absence law, per column', () => {
  const MEASURED = silenceOfDecl([
    { field: 'radius_state', states: ['present', 'upper-bound', 'not-measured', 'unknown'], carries: ['upper-bound'], governs: ['pl_rade'] },
    { field: 'mass_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_masse'] },
    { field: 'period_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_orbper'] },
  ]);
  /** No radius taken, a mass measured, a period of 88 — the 43 planets the demo found. */
  const noRadius: Row = { radius_state: 'not-measured', pl_rade: null, mass_state: 'present', pl_masse: 6.4, period_state: 'present', pl_orbper: 88 };

  it('reads the columns each entry governs and no others', () => {
    expect(evaluateRow(col('pl_rade'), noRadius, MEASURED)).toBeNull();
    expect(evaluateRow(col('pl_masse'), noRadius, MEASURED)).toBe(6.4);
    expect(evaluateRow(col('pl_orbper'), noRadius, MEASURED)).toBe(88);
  });

  it('blanks a governed cell even when the CELL holds a number — the state column is the authority', () => {
    const lying: Row = { ...noRadius, pl_rade: 2.4 };
    expect(evaluateRow(col('pl_rade'), lying, MEASURED)).toBeNull();
  });

  it('lets every state column speak for itself, so each silence stays askable', () => {
    expect(evaluateRow({ op: 'eq', args: [col('radius_state'), lit('not-measured')] }, noRadius, MEASURED)).toBe(true);
    expect(evaluateRow({ op: 'isAbsent', args: [col('pl_rade')] }, noRadius, MEASURED)).toBe(true);
    expect(evaluateRow({ op: 'isAbsent', args: [col('pl_masse')] }, noRadius, MEASURED)).toBe(false);
  });

  it('reads a column NO entry governs as it is', () => {
    expect(evaluateRow(col('pl_name'), { ...noRadius, pl_name: 'Kepler-22 b' }, MEASURED)).toBe('Kepler-22 b');
  });

  it('arithmetic: the DEFAULT reads exactly `present`, so a published bound is absent', () => {
    const bounded: Row = { ...noRadius, radius_state: 'upper-bound', pl_rade: 2.4 };
    expect(evaluateRow(col('pl_rade'), bounded, MEASURED)).toBeNull();
  });

  it("arithmetic: 'carried' reads the states the entry named in `carries`, and only those", () => {
    const carried = silenceOfDecl([{ field: 'radius_state', states: ['present', 'upper-bound', 'not-measured', 'unknown'], carries: ['upper-bound'], governs: ['pl_rade'], arithmetic: 'carried' }]);
    expect(evaluateRow(col('pl_rade'), { radius_state: 'upper-bound', pl_rade: 2.4 }, carried)).toBe(2.4);
    expect(evaluateRow(col('pl_rade'), { radius_state: 'not-measured', pl_rade: 2.4 }, carried)).toBeNull();
    expect(evaluateRow(col('pl_rade'), { radius_state: 'present', pl_rade: 1.1 }, carried)).toBe(1.1);
    // …and a carried state whose cell holds NO number is still absent: the gate opens, the arithmetic edge judges the cell
    expect(evaluateRow(col('pl_rade'), { radius_state: 'upper-bound', pl_rade: null }, carried)).toBeNull();
    expect(evaluateRow({ op: 'add', args: [col('pl_rade'), lit(0)] }, { radius_state: 'upper-bound', pl_rade: 'about two' }, carried)).toBeNull();
  });

  it("arithmetic is PER ENTRY: one column carried, its neighbour not, over the same row", () => {
    const mixed = silenceOfDecl([
      { field: 'radius_state', states: ['present', 'bound', 'unknown'], carries: ['bound'], governs: ['pl_rade'], arithmetic: 'carried' },
      { field: 'mass_state', states: ['present', 'bound', 'unknown'], carries: ['bound'], governs: ['pl_masse'] },
    ]);
    const both: Row = { radius_state: 'bound', pl_rade: 2.4, mass_state: 'bound', pl_masse: 6.4 };
    expect(evaluateRow(col('pl_rade'), both, mixed)).toBe(2.4);
    expect(evaluateRow(col('pl_masse'), both, mixed)).toBeNull();
  });

  it('reads the same governed column twice in one tree from ONE gate — the state is asked once per column, not once per read', () => {
    expect(evaluateRow({ op: 'add', args: [col('pl_masse'), col('pl_masse')] }, noRadius, MEASURED)).toBe(12.8);
    expect(evaluateRow({ op: 'add', args: [col('pl_rade'), col('pl_rade')] }, noRadius, MEASURED)).toBeNull();
  });

  it('a reading that governs nothing is the reader beneath it, untouched', () => {
    const read = readerFor({ cases: 12 }, silenceOfNothing());
    expect(read('cases')).toBe(12);
  });
});
