/**
 * THE ACT'S HALF of the one column vocabulary, at its own two doors: the judge
 * that reads a landed declaration (`./shape.ts` · `landedColumnProblems`) and
 * the two functions that write and read it (`./facets.ts` · `landedMeaning` /
 * the ownership rule inside `resolveFacet`).
 *
 * The end-to-end story — an act's word reaching the channel that judges the
 * column — is `../session/landedDecl.session.test.ts`. This file is about what
 * the words are and who owns them.
 */

import { describe, expect, it } from 'vitest';
import { landedColumnProblems, landedMeaning, resolveFacet, COLUMN_MEANING_KEYS } from './index.js';
import type { ColumnMeaning } from '../data/index.js';

const AT = 'analysis "ranker" lands column "rank" on table "data"';
const judge = (raw: unknown, decl?: unknown): string[] => landedColumnProblems(raw, AT, 'rank', decl);

describe('the vocabulary a landed column may use', () => {
  it('says nothing about an act that declares only its type — the whole existing world', () => {
    expect(judge({ type: 'int' })).toEqual([]);
    expect(judge({ type: 'int' }, { role: 'measure' })).toEqual([]); // the def still owns a column the act is silent about
  });

  it('accepts the four words', () => {
    expect(judge({ type: 'int', role: 'dimension', scale: 'discrete', label: 'a place', unit: 'place' })).toEqual([]);
  });

  it('refuses a role, a scale, a label and a unit the vocabulary does not admit — every problem at once', () => {
    expect(judge({ type: 'int', role: 'rank', scale: 'ordinal', label: 7, unit: 7 })).toEqual([
      `${AT} declares role "rank" — a role is one of identifier, dimension, measure, absence`,
      `${AT} declares scale "ordinal" — a scale is one of discrete, continuous`,
      `${AT} declares a label that is not a string`,
      `${AT} declares a unit that is not a string`,
    ]);
  });

  it('refuses a key that is not one of the five, naming the five', () => {
    expect(judge({ type: 'int', colour: 'red' })).toEqual([`${AT} carries "colour", which is not a landed column key (type, role, scale, label, unit)`]);
  });

  it('refuses a landed column that is not an object at all, and says nothing else about it', () => {
    expect(judge(null)).toEqual([`${AT} must be an object { type, role?, scale?, label?, unit? }`]);
    expect(judge(['int'])).toHaveLength(1);
  });

  it('does NOT judge the type — it was always required, and judging it would move an output that has never moved', () => {
    expect(judge({ type: 'quaternion' })).toEqual([]);
  });
});

describe('one column, one owner', () => {
  it('refuses a definition entry for a column a SPEAKING act lands — even one that agrees', () => {
    const agrees = judge({ type: 'int', role: 'dimension' }, { role: 'dimension' });
    expect(agrees).toEqual([
      `${AT} declares what it lands, and the definition declares "rank" too — a column has ONE owner and the act owns the one it lands, so this column was not written. Delete the definition's entry for "rank", or take the declaration off the act.`,
    ]);
    expect(judge({ type: 'int', role: 'dimension' }, { scale: 'continuous' })).toEqual(agrees); // disagreeing says the same thing
  });

  it('says nothing when the definition is silent about that column', () => {
    expect(judge({ type: 'int', role: 'dimension' })).toEqual([]);
    expect(judge({ type: 'int', role: 'dimension' }, undefined)).toEqual([]);
    expect(judge({ type: 'int', role: 'dimension' }, 'not a declaration')).toEqual([]);
  });

  it('EVERY one of the four words makes the act the owner — none of them is a lesser claim', () => {
    for (const word of COLUMN_MEANING_KEYS) {
      const said = { type: 'int', [word]: word === 'role' ? 'dimension' : word === 'scale' ? 'discrete' : 'x' };
      expect(judge(said, { label: 'the def' })).toHaveLength(1);
    }
  });
});

describe('the four words off an act’s output', () => {
  it('drops the type and keeps whatever was said', () => {
    expect(landedMeaning({ role: 'dimension', scale: 'discrete', label: 'a place', unit: 'place' } as ColumnMeaning)).toEqual({
      role: 'dimension',
      scale: 'discrete',
      label: 'a place',
      unit: 'place',
    });
    expect(landedMeaning({ scale: 'discrete' })).toEqual({ scale: 'discrete' });
    expect(landedMeaning({ role: 'measure' })).toEqual({ role: 'measure' });
    expect(landedMeaning({ label: 'a place' })).toEqual({ label: 'a place' });
    expect(landedMeaning({ unit: 'place' })).toEqual({ unit: 'place' });
  });

  it('is UNDEFINED when the act said none of them — so no key is written and the registry row is the one it always was', () => {
    expect(landedMeaning({})).toBeUndefined();
  });
});

describe('the ownership rule, as the facet fold applies it', () => {
  const declared = { columns: { rank: { type: 'string' as const, role: 'measure' as const, scale: 'continuous' as const, label: 'the def', unit: 'kg' } } };

  it('a column the act SPOKE about is read from the act alone — no word of the definition’s survives', () => {
    expect(resolveFacet({ name: 'rank', type: 'number', landed: { role: 'dimension', scale: 'discrete' } }, declared)).toEqual({
      field: 'rank',
      type: 'number', // NOT the def's declared `string`: the act owns the column, type and all
      role: 'dimension',
      scale: 'discrete',
    });
  });

  it('it is a rule and not a merge — the definition’s label is not borrowed to fill the act’s silence', () => {
    const facet = resolveFacet({ name: 'rank', type: 'number', landed: { role: 'dimension' } }, declared);
    expect(facet.label).toBeUndefined();
    expect(facet.unit).toBeUndefined();
    expect(facet.scale).toBe('continuous'); // the type's own fallback, exactly as for a column nobody declared
  });

  it('a column the act said nothing about is the definition’s, unchanged', () => {
    expect(resolveFacet({ name: 'rank', type: 'number' }, declared)).toEqual({
      field: 'rank',
      type: 'string',
      role: 'measure',
      scale: 'continuous',
      label: 'the def',
      unit: 'kg',
    });
  });

  it('a STATE column is still the absence law’s, whoever else spoke — a declared silence outranks both', () => {
    const facet = resolveFacet(
      { name: 'state', type: 'string', landed: { role: 'measure' } },
      { absence: { field: 'state', states: ['present', 'unavailable'] } },
    );
    expect(facet.role).toBe('absence');
    expect(facet.absence).toEqual(['present', 'unavailable']);
  });
});
