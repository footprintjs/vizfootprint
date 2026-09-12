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
import { keepPredicate, brightPredicate, selectionForView, filtersHere } from './selection.js';
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
    expect([clause.kind, clause.field, clause.value, clause.response, clause.via]).toEqual(['match', 'ref', { values: ['ref-A', 'ref-B'] }, 'filter', { path: [RADIUS_REF], label: LABEL, rows: 3 }]);
    expect('narrowed' in clause).toBe(false);
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
    expect([clause.kind, clause.field, clause.value, clause.response, clause.via]).toEqual(['match', 'ref', { values: ['ref-C'] }, 'filter', { path: [RADIUS_REF], rows: 1 }]);
    expect('label' in clause.via!).toBe(false);
    expect(REFERENCES.filter(keepPredicate(sel)).map((r) => r['year'])).toEqual([2009, 1999]);
    // …and one the session did not name for this consumer is left as it was cleared
    const plain: ClearedSelectionView = { ...pick, clearedBy: 's9', travelled: { sheet: cleared.travelled![YEARS]! } };
    expect(selectionForView([], YEARS, 'intersect', graph('filter', 'leave'), [plain]).clauses.get(SCATTER)).toMatchObject({ kind: 'match', field: 'pl_name' });
  });
});
