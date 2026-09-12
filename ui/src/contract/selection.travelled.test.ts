// @vitest-environment jsdom
/**
 * THE FOLD TAKES THE TRAVELLED CLAUSE AND NEVER JOINS (`selection.ts` ·
 * `travelledAt`, protocol 1.9).
 *
 * The session says, per consumer, what a clause became when it travelled a
 * declared relation (`SelectionView.travelled`): a `match` on the relation's
 * far column. This tier picks ITS OWN consumer's entry — exactly as
 * `narrowedAt` picks `narrowedFor` — and judges rows on that column with the
 * predicate every match already gets. Nothing is derived from the rows, and
 * no join is made here: the set of far values IS the session's answer.
 */
import { describe, it, expect } from 'vitest';
import { keepPredicate, brightPredicate, selectionForView, filtersHere, selfSelectedNeighbourhood, selfSelectedSet, isWalk } from './selection.js';
import type { ClearedSelectionView, LinkGraphView, SelectionView } from '../adapter/types.js';

const SCATTER = 'mass_radius~planets';
const YEARS = 'by_year~references';
const RADIUS_REF = { from: { table: 'planets', column: 'radius_ref' }, to: { table: 'references', column: 'ref' } };
const LABEL = 'where the composite took its accepted radius from';
/** The exoplanet desk's pick as the wire carries it: three planets, travelled to the years as two references. */
const pick: SelectionView = {
  viewId: SCATTER,
  field: 'pl_name',
  kind: 'match',
  value: { values: ['Kepler-22b', 'TRAPPIST-1e', 'HD 209458 b'] },
  travelled: { [YEARS]: { clause: { kind: 'match', field: 'ref', values: ['ref-A', 'ref-B'] }, via: { path: [RADIUS_REF], label: LABEL, rows: 3 } } },
};
/** The source's own clause as the fold sees it — what `via.from` must carry, byte for byte (no `fields`: a match has one column). */
const FROM = { kind: 'match', field: 'pl_name', value: { values: ['Kepler-22b', 'TRAPPIST-1e', 'HD 209458 b'] } };
const REFERENCES = [
  { ref: 'ref-A', year: 2011 },
  { ref: 'ref-B', year: 2017 },
  { ref: 'ref-C', year: 2009 },
  { year: 1999 }, // a row lacking `ref` — the missing-column law keeps it (Law 6)
];
const graph = (response: 'filter' | 'highlight', onClear?: 'leave'): LinkGraphView => ({
  default: 'crossfilter',
  views: [{ viewId: SCATTER, voice: ['match'] }, { viewId: YEARS, voice: ['match'] }],
  edges: [{ id: `${SCATTER}:match→${YEARS}`, source: SCATTER, kind: 'match', target: YEARS, response, origin: 'default', via: [RADIUS_REF], ...(onClear !== undefined ? { onClear } : {}) }],
});

describe('selectionForView — the consumer folds the travelled clause', () => {
  it('the years get the `match` on `ref`, judged on that column: the two cited references stay, the uncited one goes, the row lacking `ref` is kept', () => {
    const sel = selectionForView([pick], YEARS, 'intersect', graph('filter'));
    const clause = sel.clauses.get(SCATTER)!;
    expect([clause.kind, clause.field, clause.value, clause.response, clause.via]).toEqual(['match', 'ref', { values: ['ref-A', 'ref-B'] }, 'filter', { path: [RADIUS_REF], label: LABEL, rows: 3, from: FROM }]);
    expect('narrowed' in clause).toBe(false);
    expect('fields' in clause.via!.from).toBe(false); // omitted, not `undefined`: the row had none
    expect(REFERENCES.filter(keepPredicate(sel)).map((r) => r['year'])).toEqual([2011, 2017, 1999]);
    expect(filtersHere(clause)).toBe(true);
  });

  it('under a `highlight` edge the same set brightens, with the edge\'s response', () => {
    const sel = selectionForView([pick], YEARS, 'intersect', graph('highlight'));
    expect(sel.clauses.get(SCATTER)?.response).toBe('highlight');
    expect(REFERENCES.filter(brightPredicate(sel)).map((r) => r['year'])).toEqual([2011, 2017, 1999]);
    expect(REFERENCES.filter(keepPredicate(sel))).toHaveLength(REFERENCES.length); // a highlight never narrows
  });

  it('a consumer the session did NOT name folds the clause as the source made it — and a whole-dashboard fold names no consumer', () => {
    const elsewhere = selectionForView([pick], 'sheet', 'intersect', { ...graph('filter'), edges: [{ id: `${SCATTER}:match→sheet`, source: SCATTER, kind: 'match', target: 'sheet', response: 'filter', origin: 'default' }] });
    expect(elsewhere.clauses.get(SCATTER)).toMatchObject({ kind: 'match', field: 'pl_name', value: pick.value });
    expect('via' in elsewhere.clauses.get(SCATTER)!).toBe(false);
    const whole = selectionForView([pick], null);
    expect(whole.clauses.get(SCATTER)).toMatchObject({ kind: 'match', field: 'pl_name' });
    expect('via' in whole.clauses.get(SCATTER)!).toBe(false);
    // the source's own fold never travels to itself
    const own = selectionForView([pick], SCATTER, 'intersect', graph('filter'));
    expect(own.clauses.get(SCATTER)).toMatchObject({ kind: 'match', field: 'pl_name' });
  });

  it('with NO graph (the legacy rule: every clause filters) the travelled clause still applies, carrying no response', () => {
    const sel = selectionForView([pick], YEARS);
    const clause = sel.clauses.get(SCATTER)!;
    expect([clause.kind, clause.field, clause.value, 'response' in clause, clause.via?.rows]).toEqual(['match', 'ref', { values: ['ref-A', 'ref-B'] }, false, 3]);
    expect(REFERENCES.filter(keepPredicate(sel)).map((r) => r['year'])).toEqual([2011, 2017, 1999]);
  });

  it('a selection without the key folds byte-identically to before the key existed', () => {
    const { travelled: _dropped, ...plain } = pick;
    const before = selectionForView([plain], YEARS, 'intersect', graph('filter'));
    expect(before.clauses.get(SCATTER)).toMatchObject({ kind: 'match', field: 'pl_name', value: pick.value, response: 'filter' });
    expect('via' in before.clauses.get(SCATTER)!).toBe(false);
  });

  it('a cleared source an edge `leave`s in force keeps the travelled clause it had; a relation with no label carries none', () => {
    const cleared: ClearedSelectionView = { ...pick, clearedBy: 's9', travelled: { [YEARS]: { clause: { kind: 'match', field: 'ref', values: ['ref-C'] }, via: { path: [RADIUS_REF], rows: 1 } } } };
    const sel = selectionForView([], YEARS, 'intersect', graph('filter', 'leave'), [cleared]);
    const clause = sel.clauses.get(SCATTER)!;
    expect([clause.kind, clause.field, clause.value, clause.response, clause.via]).toEqual(['match', 'ref', { values: ['ref-C'] }, 'filter', { path: [RADIUS_REF], rows: 1, from: FROM }]);
    expect('label' in clause.via!).toBe(false);
    expect(REFERENCES.filter(keepPredicate(sel)).map((r) => r['year'])).toEqual([2009, 1999]);
    // …and one the session did not name for this consumer is left as it was cleared
    const plain: ClearedSelectionView = { ...pick, clearedBy: 's9', travelled: { sheet: cleared.travelled![YEARS]! } };
    expect(selectionForView([], YEARS, 'intersect', graph('filter', 'leave'), [plain]).clauses.get(SCATTER)).toMatchObject({ kind: 'match', field: 'pl_name' });
  });
});

// ── a walk travels by its ids (packet AN): the nodes still read it as the walk ──

const EDGES_ADDRESS = 'net~edges';
const NODES_ADDRESS = 'net~nodes';
const TIES = [
  { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' } },
  { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'id' } },
];
const COLD_WALK = { seed: 'cold', derivation: 'ego', hops: 1, ids: ['cold', 'flu', 'strep'] };
/** The disease desk's walk as the wire carries it: taken on the edges, travelled to the nodes as `id IN` the recorded ids (`src/session` · `travelByIdentity`). */
const walk: SelectionView = {
  viewId: EDGES_ADDRESS,
  field: 'source ↔ target',
  kind: 'neighbourhood',
  value: COLD_WALK,
  fields: ['source', 'target'],
  travelled: { [NODES_ADDRESS]: { clause: { kind: 'match', field: 'id', values: COLD_WALK.ids }, via: { path: TIES, label: 'one end of the tie, the other end', rows: 3 } } },
};
const NODE_ROWS = [{ id: 'flu' }, { id: 'cold' }, { id: 'strep' }, { id: 'lone' }, { name: 'no key' }];
const mirror: LinkGraphView = {
  default: 'crossfilter',
  views: [{ viewId: EDGES_ADDRESS, voice: ['neighbourhood'] }, { viewId: NODES_ADDRESS, voice: ['point'] }],
  edges: [{ id: `${EDGES_ADDRESS}:neighbourhood→${NODES_ADDRESS}`, source: EDGES_ADDRESS, kind: 'neighbourhood', target: NODES_ADDRESS, response: 'mirror', origin: 'declared', via: TIES }],
};

describe('a travelled walk at the nodes — `via.from` says it was a walk, and the nodes read the recorded body', () => {
  it('the row is the `match` on the key with a predicate over it; `via.from` is the source\'s kind, field, value AND fields, byte for byte', () => {
    const sel = selectionForView([walk], NODES_ADDRESS, 'intersect', mirror);
    const clause = sel.clauses.get(EDGES_ADDRESS)!;
    expect([clause.kind, clause.field, clause.value, clause.response, 'fields' in clause]).toEqual(['match', 'id', { values: COLD_WALK.ids }, 'mirror', false]);
    expect(clause.via).toEqual({ path: TIES, label: 'one end of the tie, the other end', rows: 3, from: { kind: 'neighbourhood', field: 'source ↔ target', value: COLD_WALK, fields: ['source', 'target'] } });
    expect(clause.via!.from.value).toBe(walk.value); // the same object the wire row holds — nothing re-derived
    // judged as any match: the walked nodes stay, the stranger goes, the row lacking `id` is kept (Law 6)
    expect(NODE_ROWS.filter(clause.predicate).map((r) => r['id'] ?? r['name'])).toEqual(['flu', 'cold', 'strep', 'no key']);
  });

  it('`selfSelectedNeighbourhood` on the nodes answers the seed, derivation, hops and ids — exactly what the pre-travel fold answered', () => {
    const travelled = selectionForView([walk], NODES_ADDRESS, 'intersect', mirror);
    const { travelled: _dropped, ...before } = walk; // the fold every 1.8 host saw: the walk narrowed-but-present at the nodes
    const untravelled = selectionForView([before], NODES_ADDRESS, 'intersect', mirror);
    expect(selfSelectedNeighbourhood(travelled)).toEqual({ fields: ['source', 'target'], seed: 'cold', derivation: 'ego', hops: 1, ids: COLD_WALK.ids });
    expect(selfSelectedNeighbourhood(travelled)).toEqual(selfSelectedNeighbourhood(untravelled));
    // the whole-dashboard fold names no consumer, so the walk there is the source's own row — the same answer
    expect(selfSelectedNeighbourhood(selectionForView([walk], null))).toEqual(selfSelectedNeighbourhood(travelled));
  });

  it('`isWalk` is the one reader: true for the walk as made and as travelled, false for a pick however it arrived — so a mirror edge outlines a travelled pick and never a travelled walk', () => {
    const atNodes = selectionForView([walk], NODES_ADDRESS, 'intersect', mirror).clauses.get(EDGES_ADDRESS)!;
    const atEdges = selectionForView([walk], EDGES_ADDRESS, 'intersect', mirror).clauses.get(EDGES_ADDRESS)!;
    const pickAtYears = selectionForView([pick], YEARS, 'intersect', graph('filter')).clauses.get(SCATTER)!;
    expect([isWalk(atNodes), isWalk(atEdges), isWalk(pickAtYears), isWalk({ kind: 'point', field: 'x', value: 1, predicate: () => true })]).toEqual([true, true, false, false]);
    // the nodes have no clause of their own; the mirrored walk brings NO keep-set (its picture is the ego net, read, not an outline)
    expect(selfSelectedSet(selectionForView([walk], NODES_ADDRESS, 'intersect', mirror))).toEqual({ values: [], exclude: false });
    // …while a travelled PICK on a mirror edge outlines its far values, as any mirrored match does
    const mirroredPick: LinkGraphView = { ...graph('filter'), edges: [{ ...graph('filter').edges[0]!, response: 'mirror' }] };
    expect(selfSelectedSet(selectionForView([pick], YEARS, 'intersect', mirroredPick))).toEqual({ values: ['ref-A', 'ref-B'], exclude: false });
  });

  it('a travelled walk whose wire row lost its endpoint pair is no walk to draw — null, exactly as the untravelled row answers', () => {
    const { fields: _lost, ...bare } = walk;
    expect(selfSelectedNeighbourhood(selectionForView([bare], NODES_ADDRESS, 'intersect', mirror))).toBeNull();
    expect('fields' in selectionForView([bare], NODES_ADDRESS, 'intersect', mirror).clauses.get(EDGES_ADDRESS)!.via!.from).toBe(false);
  });

  it('a travelled PICK is not a walk: `via.from.kind` is what tells them apart, and a walk of the frame\'s own is still preferred', () => {
    expect(selfSelectedNeighbourhood(selectionForView([pick], YEARS, 'intersect', graph('filter')))).toBeNull();
    // the nodes' own walk (a self clause of the kind) wins over one that reached it
    const own: SelectionView = { viewId: NODES_ADDRESS, field: 'a ↔ b', kind: 'neighbourhood', value: { seed: 'flu', derivation: 'ego', hops: 1, ids: ['flu'] }, fields: ['a', 'b'] };
    expect(selfSelectedNeighbourhood(selectionForView([own, walk], NODES_ADDRESS, 'intersect', mirror))?.seed).toBe('flu');
  });
});
