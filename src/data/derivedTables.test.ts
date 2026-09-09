/**
 * The derived-table grammar, on its own: a slot per act under the column's own
 * marker, a key and a relation minted from the group column, a store keyed by
 * parent that clears through the generations, and ONE resolution rule shared
 * with the columns. What a person sees is the session's test.
 */

import { describe, expect, it } from 'vitest';
import { canNameSlot, derivedColumnName, DerivedTableStore, derivedTableName, mintDerivedTable, resolveDerived, type DerivedTable, type DerivedTableAct } from './index.js';

const SUM = { as: 'total', expr: { op: 'sum', args: [{ col: 'cases' }] } } as const;

const act = (name: string, commitId: string, of = 'cells', groupBy: readonly string[] = ['disease']): DerivedTableAct => ({
  name,
  commitId,
  of,
  groupBy,
  measures: [SUM],
});

describe('derivedTableName — one slot per act, spelled by the column store', () => {
  it('carries the commit that made it, under the same marker a column wears', () => {
    expect(derivedTableName('by_disease', 's7')).toBe('by_disease@s7');
    expect(derivedTableName('by_disease', 's7')).toBe(derivedColumnName('by_disease', 's7'));
  });

  it('two acts cutting the same name get two slots', () => {
    expect(derivedTableName('by_disease', 's3')).not.toBe(derivedTableName('by_disease', 's7'));
  });

  it('refuses an ACT whose id carries the marker — the column door’s rule, not a second one', () => {
    expect(() => derivedTableName('t', 'a@b')).toThrow(/commit id "a@b" contains the reserved marker "@" — the slot for "t" could not be told apart/);
    expect(canNameSlot('a@b')).toBe(false);
  });
});

describe('mintDerivedTable — the slot, the key and the relation, none of them typed', () => {
  it('one group column IS the key, and the relation points the parent’s column at it, many-to-one', () => {
    const t = mintDerivedTable(act('by_disease', 's7'));
    expect(t).toEqual({
      ...act('by_disease', 's7'),
      physical: 'by_disease@s7',
      key: 'disease',
      relation: { from: { table: 'cells', column: 'disease' }, to: { table: 'by_disease', column: 'disease' }, kind: 'many-to-one' },
    });
  });

  it('two group columns are a tuple no relation can point at: no key, no relation, said out loud', () => {
    const t = mintDerivedTable(act('by_disease_kind', 's7', 'cells', ['disease', 'kind']));
    expect(t.key).toBeUndefined();
    expect(t.relation).toBeUndefined();
    expect('key' in t).toBe(false);
  });

  it('mints NO edge for a table cut from a parent of its own name — a minted edge keeps the laws a declared one is held to', () => {
    // `../def/relations.ts` law 3 refuses a table joined to itself at the declared door; the key stays,
    // because the row identity is true whatever the parent is called.
    const again = mintDerivedTable(act('by_disease', 's9', 'by_disease'));
    expect(again.key).toBe('disease');
    expect(again.relation).toBeUndefined();
  });

  it('the whole table as one row has no key either', () => {
    const t = mintDerivedTable(act('totals', 's7', 'cells', []));
    expect(t.physical).toBe('totals@s7');
    expect(t.key).toBeUndefined();
  });

  it('carries the filter and the parent’s data version verbatim — they are the act’s words', () => {
    const where = { op: 'eq', args: [{ col: 'kind' }, { lit: 'state' }] } as const;
    const t = mintDerivedTable({ ...act('by_disease', 's7'), where, dataVersion: 'v3' });
    expect(t.where).toBe(where);
    expect(t.dataVersion).toBe('v3');
  });

  it('throws where the speller throws, and nowhere else', () => {
    expect(() => mintDerivedTable(act('t', 'a@b'))).toThrow(/reserved marker/);
  });
});

describe('DerivedTableStore — keyed by parent, served flat', () => {
  const filled = (): { store: DerivedTableStore; a: DerivedTable; b: DerivedTable; c: DerivedTable; d: DerivedTable } => {
    const store = new DerivedTableStore();
    const a = mintDerivedTable(act('by_disease', 's1'));
    const b = mintDerivedTable(act('by_region', 's2', 'population', ['region']));
    // a table cut from a DERIVED table — `of` is a logical name, and a derived one is a name
    const c = mintDerivedTable(act('by_disease_totals', 's3', 'by_disease', []));
    const d = mintDerivedTable(act('by_disease', 's4'));
    for (const t of [a, b, c, d]) store.record(t);
    return { store, a, b, c, d };
  };

  it('an unknown parent has no derived tables', () => {
    const store = new DerivedTableStore();
    expect(store.all()).toEqual([]);
  });

  it('records in the order the tables were cut, and serves them flat — a name is resolved dashboard-wide', () => {
    const { store, a, b, c, d } = filled();
    expect(store.all()).toEqual([a, b, c, d]);
  });

  it('clearing a parent drops its tables AND the tables cut from those, oldest first, and answers what went', () => {
    const { store, a, b, c, d } = filled();
    expect(store.clear('cells')).toEqual([a, c, d]);
    expect(store.all()).toEqual([b]);
  });

  it('clearing a parent nothing was cut from drops nothing and says so', () => {
    const { store, a, b, c, d } = filled();
    expect(store.clear('nope')).toEqual([]);
    expect(store.all()).toEqual([a, b, c, d]);
  });

  it('clearing a derived parent drops only its own generations', () => {
    const { store, a, b, c, d } = filled();
    expect(store.clear('by_disease')).toEqual([c]);
    expect(store.all()).toEqual([a, b, d]);
  });
});

describe('resolveDerived — ONE rule for columns and tables', () => {
  it('resolves a table at the cursor’s branch path, later act winning on one path, off-path absent', () => {
    const { store, a, d } = (() => {
      const store = new DerivedTableStore();
      const a = mintDerivedTable(act('by_disease', 's1'));
      const d = mintDerivedTable(act('by_disease', 's4'));
      store.record(a);
      store.record(d);
      return { store, a, d };
    })();
    expect(resolveDerived(store.all(), ['s0', 's1']).get('by_disease')).toBe(a);
    expect(resolveDerived(store.all(), ['s0', 's1', 's4']).get('by_disease')).toBe(d);
    expect(resolveDerived(store.all(), ['s0', 's9']).has('by_disease')).toBe(false);
  });
});
