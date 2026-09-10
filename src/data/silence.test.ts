/**
 * THE PORT: silence belongs to a column. One reading per table, answered per
 * column, with the two adapters and the two tests pinned — including the
 * exoplanet shape the demo found (three value columns, three state columns,
 * three entries) and the byte-identical bare form.
 */

import { describe, expect, it } from 'vitest';
import { readsValueTestOf, SILENCE_ARITHMETICS, silenceOfDecl, silenceOfNothing, silenceTestOf } from './silence.js';
import type { AbsenceDecl } from '../def/types.js';

/** The bare declaration, unchanged since before this port existed. */
const BARE: AbsenceDecl = { field: 'report_state', states: ['present', 'unavailable', 'unknown'] };

/** The demo's shape: a radius that may be a published bound, a mass, a period never taken. */
const MEASUREMENTS: readonly AbsenceDecl[] = [
  { field: 'radius_state', states: ['present', 'upper-bound', 'not-measured', 'unknown'], carries: ['upper-bound'], governs: ['pl_rade'] },
  { field: 'mass_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_masse'] },
  { field: 'period_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_orbper'] },
];

describe('silenceOfDecl — the bare form', () => {
  it('speaks for every OTHER column of the table, exactly as it always did', () => {
    const silence = silenceOfDecl(BARE);
    expect(silence.silenceFor('cases')?.state).toBe('report_state');
    expect(silence.silenceFor('population')?.state).toBe('report_state');
    // a column nobody ever heard of is governed too — "every other column" is not a list
    expect(silence.silenceFor('a_column_the_table_may_not_have')?.state).toBe('report_state');
  });

  it('answers undefined for the state column itself — it speaks for itself', () => {
    expect(silenceOfDecl(BARE).silenceFor('report_state')).toBeUndefined();
  });

  it('fills the defaults ONCE: no carries, present-only arithmetic', () => {
    expect(silenceOfDecl(BARE).silenceFor('cases')).toEqual({ state: 'report_state', states: ['present', 'unavailable', 'unknown'], carries: [], arithmetic: 'present-only' });
  });

  it('names its state column and governs no column by name', () => {
    const silence = silenceOfDecl(BARE);
    expect(silence.stateColumns).toEqual(['report_state']);
    // `governed` is a LISTING of what was NAMED; "every other column" names none
    expect(silence.governed).toEqual([]);
  });

  it('honours `governs` on a bare object too — one entry, only the columns it names', () => {
    const silence = silenceOfDecl({ ...BARE, governs: ['cases'] });
    expect(silence.silenceFor('cases')?.state).toBe('report_state');
    expect(silence.silenceFor('population')).toBeUndefined();
    expect(silence.governed).toEqual(['cases']);
  });
});

describe('silenceOfDecl — the list form', () => {
  it('gives each value column the entry that governs IT', () => {
    const silence = silenceOfDecl(MEASUREMENTS);
    expect(silence.silenceFor('pl_rade')?.state).toBe('radius_state');
    expect(silence.silenceFor('pl_masse')?.state).toBe('mass_state');
    expect(silence.silenceFor('pl_orbper')?.state).toBe('period_state');
  });

  it('governs no state column — not its own, and not another entry’s', () => {
    const silence = silenceOfDecl(MEASUREMENTS);
    for (const column of ['radius_state', 'mass_state', 'period_state']) expect(silence.silenceFor(column)).toBeUndefined();
  });

  it('governs nothing it was not given', () => {
    expect(silenceOfDecl(MEASUREMENTS).silenceFor('pl_name')).toBeUndefined();
  });

  it('lists every state column and every governed column, in declaration order', () => {
    const silence = silenceOfDecl(MEASUREMENTS);
    expect(silence.stateColumns).toEqual(['radius_state', 'mass_state', 'period_state']);
    expect(silence.governed).toEqual(['pl_rade', 'pl_masse', 'pl_orbper']);
  });

  it('carries per entry: the radius may hold a bound, the mass may not', () => {
    const silence = silenceOfDecl(MEASUREMENTS);
    expect(silence.silenceFor('pl_rade')?.carries).toEqual(['upper-bound']);
    expect(silence.silenceFor('pl_masse')?.carries).toEqual([]);
  });

  it('stays TOTAL when a list is malformed — the first namer wins, and an unnamed entry is the fallback', () => {
    // The def door refuses both shapes below; the port still answers, because a reader may not crash.
    const overlap = silenceOfDecl([
      { field: 'a_state', states: ['present', 'unknown'], governs: ['v'] },
      { field: 'b_state', states: ['present', 'unknown'], governs: ['v'] },
    ]);
    expect(overlap.silenceFor('v')?.state).toBe('a_state');
    expect(overlap.governed).toEqual(['v']);
    const mixed = silenceOfDecl([
      { field: 'a_state', states: ['present', 'unknown'], governs: ['v'] },
      { field: 'b_state', states: ['present', 'unknown'] },
    ]);
    expect(mixed.silenceFor('v')?.state).toBe('a_state');
    expect(mixed.silenceFor('w')?.state).toBe('b_state'); // the entry that named nothing takes the rest
  });

  it('two entries that name nothing: the FIRST is the fallback, and the second cannot take it back', () => {
    // The def door refuses this (two answers to one question); the port still answers, first wins.
    const both = silenceOfDecl([
      { field: 'a_state', states: ['present', 'unknown'] },
      { field: 'b_state', states: ['present', 'unknown'] },
    ]);
    expect(both.silenceFor('v')?.state).toBe('a_state');
    expect(both.stateColumns).toEqual(['a_state', 'b_state']);
  });

  it('one state column declared twice keeps the FIRST vocabulary — one column, one set of words', () => {
    const twice = silenceOfDecl([
      { field: 'state', states: ['present', 'unknown'], governs: ['a'] },
      { field: 'state', states: ['present', 'withheld', 'unknown'], governs: ['b'] },
    ]);
    expect(twice.vocabularyOf('state')).toEqual(['present', 'unknown']);
    // …and each entry still governs the column it named
    expect(twice.silenceFor('a')?.states).toEqual(['present', 'unknown']);
    expect(twice.silenceFor('b')?.states).toEqual(['present', 'withheld', 'unknown']);
  });

  it('an empty list governs nothing and names nothing', () => {
    const silence = silenceOfDecl([]);
    expect(silence.silenceFor('anything')).toBeUndefined();
    expect(silence.stateColumns).toEqual([]);
  });
});

describe('vocabularyOf — a state column\'s own words', () => {
  it('answers the words a state column speaks, and undefined for anything else', () => {
    const silence = silenceOfDecl(MEASUREMENTS);
    expect(silence.vocabularyOf('radius_state')).toEqual(['present', 'upper-bound', 'not-measured', 'unknown']);
    expect(silence.vocabularyOf('mass_state')).toEqual(['present', 'not-measured', 'unknown']);
    // a governed column is a VALUE column, not a state column
    expect(silence.vocabularyOf('pl_rade')).toBeUndefined();
    expect(silence.vocabularyOf('pl_name')).toBeUndefined();
  });
});

describe('silenceOfNothing — the null object', () => {
  it('answers undefined for every column, so no reader beneath the def door branches', () => {
    const silence = silenceOfNothing();
    expect(silence.silenceFor('cases')).toBeUndefined();
    expect(silence.stateColumns).toEqual([]);
    expect(silence.governed).toEqual([]);
    expect(silence.vocabularyOf('cases')).toBeUndefined();
  });
});

describe('silenceTestOf — did the SOURCE report anything', () => {
  const isSilence = silenceTestOf(silenceOfDecl(BARE).silenceFor('cases')!);

  it('`present` is not a silence and every other word is', () => {
    expect(isSilence('present')).toBe(false);
    expect(isSilence('unavailable')).toBe(true);
    expect(isSilence('unknown')).toBe(true);
  });

  it('a word the vocabulary never declared, and no word at all, are silences — those are the unjudged rows', () => {
    expect(isSilence('Unavailable')).toBe(true);
    expect(isSilence(undefined)).toBe(true);
    expect(isSilence(null)).toBe(true);
    expect(isSilence(0)).toBe(true);
  });

  it('a state that CARRIES a number is not a silence — an estimated figure is a figure', () => {
    const carried = silenceTestOf(silenceOfDecl(MEASUREMENTS).silenceFor('pl_rade')!);
    expect(carried('upper-bound')).toBe(false);
    expect(carried('not-measured')).toBe(true);
  });

  it('is independent of `arithmetic` — the source answered, whatever the sum does with it', () => {
    const entry: AbsenceDecl = { field: 's', states: ['present', 'bound', 'unknown'], carries: ['bound'], arithmetic: 'carried' };
    expect(silenceTestOf(silenceOfDecl(entry).silenceFor('v')!)('bound')).toBe(false);
    expect(silenceTestOf(silenceOfDecl({ ...entry, arithmetic: 'present-only' }).silenceFor('v')!)('bound')).toBe(false);
  });
});

describe('readsValueTestOf — does the ARITHMETIC read the cell', () => {
  it('present-only reads exactly `present`, carried state or not', () => {
    const reads = readsValueTestOf(silenceOfDecl(MEASUREMENTS).silenceFor('pl_rade')!);
    expect(reads('present')).toBe(true);
    expect(reads('upper-bound')).toBe(false); // carried, but the declaration did not opt the sum in
    expect(reads('not-measured')).toBe(false);
  });

  it('carried also reads the states named in `carries`, and nothing else', () => {
    const reads = readsValueTestOf(silenceOfDecl({ field: 's', states: ['present', 'bound', 'not-measured', 'unknown'], carries: ['bound'], arithmetic: 'carried' }).silenceFor('v')!);
    expect(reads('present')).toBe(true);
    expect(reads('bound')).toBe(true);
    expect(reads('not-measured')).toBe(false);
    expect(reads('unknown')).toBe(false);
    expect(reads(undefined)).toBe(false);
    expect(reads(7)).toBe(false);
  });

  it('carried with nothing in `carries` is present-only by arithmetic — the gate opens on no extra word', () => {
    const reads = readsValueTestOf(silenceOfDecl({ field: 's', states: ['present', 'unknown'], arithmetic: 'carried' }).silenceFor('v')!);
    expect(reads('present')).toBe(true);
    expect(reads('unknown')).toBe(false);
  });
});

describe('SILENCE_ARITHMETICS', () => {
  it('is the vocabulary the type and the validator share, so they cannot drift', () => {
    expect(SILENCE_ARITHMETICS).toEqual(['present-only', 'carried']);
    expect(Object.isFrozen(SILENCE_ARITHMETICS)).toBe(true);
  });
});
