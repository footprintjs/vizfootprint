/**
 * filledTables.test.ts — THE STORE'S OWN LAWS: one slot per act, and a
 * GENERATIONAL clear.
 *
 * The generations are why this file exists. They were left to the caller at
 * first, the caller walked one level, and a fill computed from a fill survived
 * the refresh that destroyed its parent — going on answering as landed, over
 * rows computed from bytes that no longer existed, with nothing saying so. A
 * registry that answers "what died with this parent" must answer it WHOLE; a
 * caller counting levels will count one too few. Its twin
 * (`./derivedTables.test.ts`) pins the same law for the minted door.
 *
 * What is NOT here is the cross-store cascade (an aggregate cut from a fill, a
 * fill computed from an aggregate): neither store can see the other, so that
 * one belongs to the door that holds both, as a fixpoint
 * (`../def/buildDashboard.ts` · `dropComputedFrom`, pinned end to end by
 * `../session/actFilledTable.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { FilledTableStore, filledTableName, mintFilledTable, resolveDerived } from './index.js';

const act = (name: string, commitId: string, of: string, analysisId = `fill:${name}`) => mintFilledTable({ name, commitId, of, analysisId });

describe('one slot per ACT, spelled by the one speller', () => {
  it('the slot carries the commit, and the record adds nothing the declaration already says', () => {
    const filled = act('edges', 's7', 'nodes', 'buildEdges');
    expect(filled).toEqual({ name: 'edges', analysisId: 'buildEdges', commitId: 's7', of: 'nodes', physical: 'edges@s7' });
    expect(filledTableName('edges', 's7')).toBe('edges@s7');
    // the parent's version rides when there is one — the only other fact an act can state
    expect(mintFilledTable({ name: 'edges', analysisId: 'buildEdges', commitId: 's7', of: 'nodes', dataVersion: 'etag:"a"' }).dataVersion).toBe('etag:"a"');
    // …and the one refusal is the slot grammar's: a commit id that carries the reserved marker
    expect(() => act('edges', 'a@b', 'nodes')).toThrow(/reserved marker/);
  });

  it('a NAME resolves to the fill on the cursor\'s path, and the later act wins on one path', () => {
    const store = new FilledTableStore();
    const first = act('edges', 's2', 'nodes');
    const second = act('edges', 's5', 'nodes');
    store.record(first);
    store.record(second);
    expect(store.all()).toEqual([first, second]);
    // the generic resolver both doors share (`./derivedColumns.ts`): the last one on the path
    expect(resolveDerived(store.all(), ['s1', 's2', 's3']).get('edges')).toBe(first);
    expect(resolveDerived(store.all(), ['s1', 's2', 's5']).get('edges')).toBe(second);
    expect(resolveDerived(store.all(), ['s1', 's9']).get('edges')).toBeUndefined();
  });
});

describe('clear(of) is GENERATIONAL — every fill that lived on those rows, however far down', () => {
  /** nodes → edges → edge_stats → deeper, and one fill of another parent that must not move. */
  const chained = (): { readonly store: FilledTableStore; readonly names: readonly string[] } => {
    const store = new FilledTableStore();
    for (const filled of [act('edges', 's1', 'nodes'), act('edge_stats', 's2', 'edges'), act('deeper', 's3', 'edge_stats'), act('elsewhere', 's4', 'other')]) store.record(filled);
    return { store, names: ['edges', 'edge_stats', 'deeper', 'elsewhere'] };
  };

  it('three generations fall together, oldest first, and a fill of another parent stays', () => {
    const { store } = chained();
    expect(store.clear('nodes').map((t) => t.name)).toEqual(['edges', 'edge_stats', 'deeper']);
    expect(store.all().map((t) => t.name)).toEqual(['elsewhere']);
  });

  it('clearing from the MIDDLE takes what is below it and leaves what is above', () => {
    const { store } = chained();
    expect(store.clear('edges').map((t) => t.name)).toEqual(['edge_stats', 'deeper']);
    expect(store.all().map((t) => t.name)).toEqual(['edges', 'elsewhere']);
  });

  it('a parent nothing was computed from drops nothing, and a second clear of the same parent is empty', () => {
    const { store } = chained();
    expect(store.clear('ghost')).toEqual([]);
    expect(store.clear('nodes')).toHaveLength(3);
    expect(store.clear('nodes')).toEqual([]);
    expect(store.all().map((t) => t.name)).toEqual(['elsewhere']);
  });

  it('two acts that filled ONE name are both dropped — `of` is a NAME, so the loss is a ceiling', () => {
    // the derived store's own reading, word for word: a child that must outlive its namesake would
    // need the parent's SLOT on the record, not the parent's name
    const store = new FilledTableStore();
    for (const filled of [act('edges', 's1', 'nodes'), act('edges', 's2', 'nodes'), act('edge_stats', 's3', 'edges')]) store.record(filled);
    expect(store.clear('nodes').map((t) => t.physical)).toEqual(['edges@s1', 'edges@s2', 'edge_stats@s3']);
    expect(store.all()).toEqual([]);
  });
});
