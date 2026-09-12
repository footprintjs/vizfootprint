/**
 * landedColumns.test.ts — THE REGISTRY OF WHAT THE ENGINE LANDED: written by a
 * landing, frozen, absent where nothing landed.
 *
 * What is pinned here is the RECORD's own law (`./landedColumns.ts`): a re-land
 * replaces the entry whole, the version is omitted (never a placeholder) for a
 * table nothing versions, the entry is deep-frozen, and it never aliases the
 * engine's objects. WHO writes it and WHO reads it are pinned where they live —
 * the build door (`../def/landedColumns.def.test.ts`) and the session's
 * synchronous judges (`../session/landedColumns.session.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { LandedColumns } from './landedColumns.js';
import type { ColumnInfo } from './types.js';

const COLS: ColumnInfo[] = [
  { name: 'planet', type: 'string' },
  { name: 'radius', type: 'number' },
];

describe('LandedColumns — one entry per table, written by a landing', () => {
  it('a table nothing versions (inline rows) has NO `version` key — omit, never invent', () => {
    const landed = new LandedColumns();
    landed.set('sheet', undefined, COLS);
    expect(landed.get('sheet')).toEqual({ columns: COLS });
    expect('version' in landed.get('sheet')!).toBe(false);
  });

  it('a sourced table keeps the version it landed at, beside the columns', () => {
    const landed = new LandedColumns();
    landed.set('cases', 'v1', COLS);
    expect(landed.get('cases')).toEqual({ version: 'v1', columns: COLS });
  });

  it('a table nothing landed answers `undefined` — the judge then reads the definition alone', () => {
    expect(new LandedColumns().get('nowhere')).toBeUndefined();
  });

  it('a RE-LAND replaces the entry whole: the new version, the new list, nothing merged from the old rows', () => {
    const landed = new LandedColumns();
    landed.set('cases', 'v1', COLS);
    landed.set('cases', 'v2', [{ name: 'planet', type: 'string' }]); // `radius` is gone in v2
    expect(landed.get('cases')).toEqual({ version: 'v2', columns: [{ name: 'planet', type: 'string' }] });
  });

  it('the entry is deep-frozen: the record, its list and every column in it', () => {
    const landed = new LandedColumns();
    landed.set('sheet', 'v1', COLS);
    const entry = landed.get('sheet')!;
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.columns)).toBe(true);
    expect(entry.columns.every((c) => Object.isFrozen(c))).toBe(true);
    // a reader that tries to edit what a later judge will read is refused, not obeyed
    expect(() => {
      (entry.columns as ColumnInfo[]).push({ name: 'forged', type: 'string' });
    }).toThrow(TypeError);
  });

  it('the entry never aliases the engine’s objects: the caller’s list and columns stay writable and unshared', () => {
    const landed = new LandedColumns();
    // the caller's own, MUTABLE objects — `ColumnInfo` is readonly on the way out, not on the way in
    const theirs: { name: string; type: ColumnInfo['type'] }[] = [{ name: 'planet', type: 'string' }];
    landed.set('sheet', undefined, theirs);
    expect(Object.isFrozen(theirs)).toBe(false);
    expect(Object.isFrozen(theirs[0])).toBe(false);
    theirs.push({ name: 'later', type: 'number' });
    theirs[0]!.name = 'renamed';
    expect(landed.get('sheet')).toEqual({ columns: [{ name: 'planet', type: 'string' }] });
  });
});
